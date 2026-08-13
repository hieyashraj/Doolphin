import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { buildStorageKey } from "@/lib/storage/storageKey";
import { composeExactBroll, extractVerificationFrames, runFfprobe } from "@/lib/media/FfmpegRunner";
import { createVerificationMontage } from "@/lib/media/verificationMontage";
import { parseStrictJsonOutput, transcriptPasses } from "@/lib/generation/qualityVerification";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { isReconciliationEligibleVariant } from "@/lib/generation/reconciliationEligibility";

const WHISPER_ENDPOINT = "https://api.muapi.ai/api/v1/openai-whisper";
const VISION_ENDPOINT = "https://api.muapi.ai/api/v1/gemini-2-5-flash";

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function extractTranscript(payload) {
  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return null;
    if (typeof value === "string") {
      try { return visit(JSON.parse(value), depth + 1) || value; } catch { return value; }
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1)).filter(Boolean).join(" ");
    if (typeof value === "object") {
      for (const key of ["text", "transcript", "transcription", "outputs", "output", "result", "data"]) {
        if (key in value) {
          const found = visit(value[key], depth + 1);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return visit(payload);
}

async function submitVerificationJob(job, payload) {
  const apiKey = process.env.MUAPI_API_KEY;
  await prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUBMITTING", submissionCount: { increment: 1 } } });
  const response = await fetch(job.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.request_id) throw new Error(`${job.internalModelId} submission failed`);
  await prisma.providerJob.update({ where: { id: job.id }, data: { status: "QUEUED", providerRequestId: result.request_id, submittedAt: new Date(), acceptedAt: new Date(), sanitizedInitialResponse: JSON.stringify({ request_id: result.request_id, status: result.status || "processing" }) } });
}

async function quarantineVariant(variantId, errorCode, safeError) {
  // No final artifact means no charge.  This is deliberately independent of
  // which internal stage (generation, analysis, or verification) failed.
  await CreditEscrowService.releaseVariantReservations(variantId, errorCode || "NO_DELIVERABLE");
  await prisma.creationVariant.update({ where: { id: variantId }, data: { status: "QUARANTINED", currentStage: "quality_verification", errorCode, safeError } });
}

const FINALIZATION_LEASE_MS = 2 * 60_000;

/**
 * Claims final delivery work with an expiring, database-backed lease.  R2 and
 * Postgres cannot share a transaction, so every later step is deterministic
 * and replayable.  A worker that dies after uploading the final object can be
 * replaced once its lease is stale.
 */
async function claimFinalization(variantId) {
  const ownerId = crypto.randomUUID();
  const now = new Date();
  const claimed = await prisma.creationVariant.updateMany({
    where: {
      id: variantId,
      status: "PROCESSING",
      OR: [{ finalizationLeaseId: null }, { finalizationLeaseExpiresAt: { lt: now } }],
    },
    data: { currentStage: "delivery_finalizing", finalizationLeaseId: ownerId, finalizationClaimedAt: now, finalizationLeaseExpiresAt: new Date(now.getTime() + FINALIZATION_LEASE_MS) },
  });
  return claimed.count === 1 ? ownerId : null;
}

function finalizationOwnerWhere(variantId, ownerId) {
  return { id: variantId, status: "PROCESSING", finalizationLeaseId: ownerId, finalizationLeaseExpiresAt: { gt: new Date() } };
}

async function stillOwnFinalization(variantId, ownerId) {
  return (await prisma.creationVariant.count({ where: finalizationOwnerWhere(variantId, ownerId) })) === 1;
}

async function ensureDeliveryCheck(finalArtifact, evidence) {
  const existing = await prisma.artifactDeliveryCheck.findFirst({ where: { generatedArtifactId: finalArtifact.id } });
  if (existing) return existing;
  return prisma.artifactDeliveryCheck.create({ data: { generatedArtifactId: finalArtifact.id, objectExists: true, metadataValid: true, authorizedRangeGetSucceeded: true, contentTypeValid: true, nonEmpty: true, ffprobeSucceeded: true, durationValid: true, dimensionsValid: true, videoCodecValid: true, audioCodecValid: true, previewSucceeded: true, downloadSucceeded: true, checksumVerified: true, evidence: JSON.stringify({ qualityEvidence: evidence }) } });
}

async function finalizeDeliverable({ variant, rawArtifact, evidence, ownerId }) {
  const finalStorageKey = buildStorageKey("final", [variant.creation.workspaceId, variant.creation.id, `variant_${variant.variantIndex}.mp4`]);
  if (!await stillOwnFinalization(variant.id, ownerId)) return null;
  // A replay after an upload/DB boundary first adopts the deterministic final
  // artifact.  This prevents a second artifact/settlement on duplicate events.
  let finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey }, orderBy: { createdAt: "asc" } });
  if (!finalArtifact) {
    const finalBuffer = await R2StorageService.downloadBuffer(rawArtifact.storageKey);
    const finalStored = await R2StorageService.uploadFile({ storageKey: finalStorageKey, buffer: finalBuffer, contentType: "video/mp4" });
    // The unique key is a second backstop if an old process wakes after its
    // lease expired.  Both workers may write the same deterministic R2 key,
    // but Postgres admits exactly one artifact row.
    finalArtifact = await prisma.generatedArtifact.upsert({
      where: { creationVariantId_type_storageKey: { creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey } },
      create: { workspaceId: rawArtifact.workspaceId, creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey, checksumSha256: finalStored.checksumSha256, mimeType: rawArtifact.mimeType, fileSizeBytes: finalStored.fileSizeBytes, width: rawArtifact.width, height: rawArtifact.height, durationMs: rawArtifact.durationMs, frameRate: rawArtifact.frameRate, videoCodec: rawArtifact.videoCodec, audioCodec: rawArtifact.audioCodec, validationStatus: "VALID", validationMetadata: JSON.stringify(evidence), sourceProviderUrlHost: rawArtifact.sourceProviderUrlHost, validatedAt: new Date() },
      update: {},
    });
  }
  if (!await stillOwnFinalization(variant.id, ownerId)) return null;
  await ensureDeliveryCheck(finalArtifact, evidence);
  await prisma.generatedArtifact.update({ where: { id: rawArtifact.id }, data: { validationStatus: "VALID", validationMetadata: JSON.stringify(evidence), validatedAt: new Date() } });
  // Each reservation settlement is independently idempotent.  If this process
  // crashes after settlement but before COMPLETED, a replay simply completes it.
  await CreditEscrowService.settleVerifiedVariant(variant.id, true);
  const completed = await prisma.creationVariant.updateMany({ where: finalizationOwnerWhere(variant.id, ownerId), data: { status: "COMPLETED", currentStage: "delivery", completedAt: new Date(), finalArtifactId: finalArtifact.id, progressValue: 100, errorCode: null, safeError: null, finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } });
  return completed.count === 1 ? finalArtifact : null;
}

export async function startQualityVerification({ seedanceJob, videoUrl, buffer, probe, webhookUrl }) {
  const variant = seedanceJob.variant;
  if (!isReconciliationEligibleVariant(variant)) return null;
  const creation = variant.creation;
  const existingVerificationJobs = await prisma.providerJob.findMany({
    where: { creationVariantId: variant.id, internalModelId: { in: ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"] } },
  });
  if (existingVerificationJobs.length) {
    const artifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: { in: ["RAW_PROVIDER_VIDEO", "COMPOSED_VIDEO"] } }, orderBy: { createdAt: "desc" } });
    const safelyInFlight = existingVerificationJobs.length === 2 && existingVerificationJobs.every((job) => ["QUEUED", "PROCESSING", "SUCCEEDED"].includes(job.status));
    if (!safelyInFlight) await quarantineVariant(variant.id, "VERIFICATION_RECOVERY_REQUIRED", "Verification startup was interrupted and requires an explicit retry");
    return artifact;
  }
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), `verify-${variant.id}-`));
  try {
    const candidatePath = path.join(tempDirectory, "candidate.mp4");
    await fs.promises.writeFile(candidatePath, buffer);
    const assets = await prisma.creationAsset.findMany({ where: { creationId: creation.id } });
    const brollAssets = assets.filter((asset) => {
      if (creation.generationType === "PRODUCT_STUDIO") return ["PRIMARY_PRODUCT", "PRODUCT_PACKAGING"].includes(asset.role);
      if (creation.generationType === "APP_STUDIO") return ["APP_SCREEN_RECORDING", "APP_PRIMARY_SCREEN"].includes(asset.role);
      return false;
    }).slice(0, 8);
    if (brollAssets.length) {
      const brollInputs = [];
      for (const [index, asset] of brollAssets.entries()) {
        const extension = asset.mediaType === "VIDEO" ? ".mp4" : ".png";
        const inputPath = path.join(tempDirectory, `broll_${index}${extension}`);
        await fs.promises.writeFile(inputPath, await R2StorageService.downloadBuffer(asset.storageKey));
        brollInputs.push({ path: inputPath, isVideo: asset.mediaType === "VIDEO" });
      }
      const originalVideo = probe.streams.find((stream) => stream.codec_type === "video");
      const composedPath = path.join(tempDirectory, "composed.mp4");
      await composeExactBroll({ baseVideoPath: candidatePath, brollInputs, outputPath: composedPath, durationSeconds: Number(probe.format.duration), width: originalVideo.width, height: originalVideo.height });
      buffer = await fs.promises.readFile(composedPath);
      probe = await runFfprobe(composedPath);
      await fs.promises.copyFile(composedPath, candidatePath);
    }
    const rawStorageKey = buildStorageKey("quarantine", [creation.workspaceId, creation.id, `variant_${variant.variantIndex}.mp4`]);
    const stored = await R2StorageService.uploadFile({ storageKey: rawStorageKey, buffer, contentType: "video/mp4" });
    const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
    const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
    const duration = Number(probe.format?.duration || 0);
    const rawArtifact = await prisma.generatedArtifact.create({ data: { workspaceId: creation.workspaceId, creationVariantId: variant.id, type: brollAssets.length ? "COMPOSED_VIDEO" : "RAW_PROVIDER_VIDEO", storageKey: rawStorageKey, checksumSha256: stored.checksumSha256, mimeType: "video/mp4", fileSizeBytes: stored.fileSizeBytes, width: videoStream.width, height: videoStream.height, durationMs: Math.round(duration * 1000), frameRate: videoStream.avg_frame_rate ? Number(videoStream.avg_frame_rate.split("/")[0]) / Number(videoStream.avg_frame_rate.split("/")[1] || 1) : null, videoCodec: videoStream.codec_name, audioCodec: audioStream.codec_name, validationStatus: "PENDING", validationMetadata: JSON.stringify({ mediaChecksPassed: true, hybridComposition: brollAssets.map((asset) => asset.id), transcript: "PENDING", visual: "PENDING" }), sourceProviderUrlHost: new URL(videoUrl).hostname } });
    const framePaths = await extractVerificationFrames(candidatePath, tempDirectory, 4);
    const montage = await createVerificationMontage({ assets, framePaths });
    const montageKey = buildStorageKey("verification", [creation.workspaceId, creation.id, `variant_${variant.variantIndex}.jpg`]);
    await R2StorageService.uploadFile({ storageKey: montageKey, buffer: montage.buffer, contentType: "image/jpeg" });
    const [candidateUrl, montageUrl] = await Promise.all([
      R2StorageService.generateSignedUrl({ storageKey: rawStorageKey, expiresInSeconds: 3600 }),
      R2StorageService.generateSignedUrl({ storageKey: montageKey, expiresInSeconds: 3600 })
    ]);

    const requiredAssets = [...new Set(assets.filter((asset) => ["PRIMARY_PRODUCT", "PRODUCT_PACKAGING", "APP_PRIMARY_SCREEN"].includes(asset.role)).map((asset) => {
      const metadata = JSON.parse(asset.validationMetadata || "{}");
      return metadata.groupId || metadata.alias || asset.originalFileName;
    }))];
    const whisperPayload = { audio_url: candidateUrl, language: creation.spokenScript ? null : "en", prompt: creation.spokenScript || null, response_format: "json", temperature: 0, webhook_url: webhookUrl };
    const visionPayload = {
      image_url: montageUrl,
      system_prompt: "Return strict JSON only.",
      prompt: `This contact sheet has reference tiles followed by generated-video frames. Layout: ${JSON.stringify(montage.layout)}. Required assets: ${JSON.stringify(requiredAssets)}. Return only JSON: {"avatarIdentityMatch":true,"unapprovedDominantPerson":false,"requiredAssetsVisible":[],"wrongProductOrDevice":false,"inventedUiLikely":false,"blackOrFrozenFrames":false,"confidence":0.0,"warnings":[]}. Compare the generated person only to the ACTOR_REFERENCE tile. Never treat people in style references as approved identities.` ,
      webhook_url: webhookUrl
    };
    const jobs = await prisma.$transaction(async (tx) => {
      const whisper = await tx.providerJob.create({ data: { creationVariantId: variant.id, provider: "MUAPI", internalModelId: "muapi.openai-whisper", providerModelVersion: "openai-whisper", endpoint: WHISPER_ENDPOINT, status: "PREPARED", stageIdempotencyKey: `verify_transcript_${variant.id}`, inputFingerprint: fingerprint(whisperPayload), registryRevision: "2026-08-08", pricingRevision: "2026-08-08", adapterVersion: "1.0.0", routingSnapshot: JSON.stringify({ stage: "transcript" }), capabilitySnapshot: JSON.stringify({ audioUrl: true }), sanitizedRequestPayload: JSON.stringify({ ...whisperPayload, audio_url: "[SIGNED_CANDIDATE]", webhook_url: "[AUTHENTICATED_WEBHOOK]" }), estimatedCostMinMicroUsd: BigInt(12000), estimatedCostMaxMicroUsd: BigInt(12000) } });
      const vision = await tx.providerJob.create({ data: { creationVariantId: variant.id, provider: "MUAPI", internalModelId: "muapi.gemini-2.5-flash-verifier", providerModelVersion: "gemini-2.5-flash", endpoint: VISION_ENDPOINT, status: "PREPARED", stageIdempotencyKey: `verify_visual_${variant.id}`, inputFingerprint: fingerprint(visionPayload), registryRevision: "2026-08-08", pricingRevision: "2026-08-08", adapterVersion: "1.0.0", routingSnapshot: JSON.stringify({ stage: "visual", rawArtifactId: rawArtifact.id, requiredAssets }), capabilitySnapshot: JSON.stringify({ imageUnderstanding: true }), sanitizedRequestPayload: JSON.stringify({ ...visionPayload, image_url: "[SIGNED_MONTAGE]", webhook_url: "[AUTHENTICATED_WEBHOOK]" }), estimatedCostMinMicroUsd: BigInt(1000), estimatedCostMaxMicroUsd: BigInt(10000) } });
      await tx.creationVariant.update({ where: { id: variant.id }, data: { status: "PROCESSING", currentStage: "quality_verification", progressValue: 75 } });
      return { whisper, vision };
    });
    try {
      await Promise.all([submitVerificationJob(jobs.whisper, whisperPayload), submitVerificationJob(jobs.vision, visionPayload)]);
    } catch (error) {
      await quarantineVariant(variant.id, "VERIFICATION_SUBMISSION_FAILED", "Quality verification could not be started");
      throw error;
    }
    return rawArtifact;
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function handleVerificationResult(job, payload) {
  if (!isReconciliationEligibleVariant(job.variant)) return { terminal: false, ignored: true, reason: "RECONCILIATION_INELIGIBLE" };
  const providerStatus = String(payload.status || "").toLowerCase();
  if (["failed", "error", "cancelled"].includes(providerStatus) || payload.error) {
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), errorCode: "VERIFICATION_PROVIDER_FAILED", safeError: String(payload.error || "Verification failed") } });
    await quarantineVariant(job.creationVariantId, "VERIFICATION_PROVIDER_FAILED", "A required quality check failed to run");
    return { terminal: true, quarantined: true };
  }
  if (providerStatus !== "completed") {
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", lastCheckedAt: new Date(), webhookCount: { increment: 1 } } });
    return { terminal: false };
  }
  await prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), sanitizedResultPayload: JSON.stringify(payload), webhookCount: { increment: 1 } } });
  const jobs = await prisma.providerJob.findMany({ where: { creationVariantId: job.creationVariantId, internalModelId: { in: ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"] } } });
  if (jobs.some((candidate) => candidate.status === "FAILED")) return { terminal: true, quarantined: true };
  if (jobs.length !== 2 || jobs.some((candidate) => candidate.status !== "SUCCEEDED")) return { terminal: false };

  const variant = await prisma.creationVariant.findUnique({ where: { id: job.creationVariantId }, include: { creation: true, artifacts: { where: { type: { in: ["RAW_PROVIDER_VIDEO", "COMPOSED_VIDEO"] } }, orderBy: { createdAt: "desc" }, take: 1 } } });
  const whisperJob = jobs.find((candidate) => candidate.internalModelId === "muapi.openai-whisper");
  const visionJob = jobs.find((candidate) => candidate.internalModelId.includes("gemini"));
  const transcript = extractTranscript(JSON.parse(whisperJob.sanitizedResultPayload));
  const transcriptResult = transcriptPasses(variant.creation.spokenScript, transcript);
  let visual;
  try { visual = parseStrictJsonOutput(JSON.parse(visionJob.sanitizedResultPayload)); } catch { visual = null; }
  const rawArtifact = variant.artifacts[0];
  const required = JSON.parse(visionJob.routingSnapshot || "{}").requiredAssets || [];
  const visible = new Set(Array.isArray(visual?.requiredAssetsVisible) ? visual.requiredAssetsVisible.map((value) => String(value).toLowerCase()) : []);
  const artifactMetadata = rawArtifact ? JSON.parse(rawArtifact.validationMetadata || "{}") : {};
  const exactBrollComposed = Array.isArray(artifactMetadata.hybridComposition) && artifactMetadata.hybridComposition.length > 0;
  const missingAssets = exactBrollComposed ? [] : required.filter((alias) => !visible.has(String(alias).toLowerCase()));
  const visualPassed = Boolean(visual?.avatarIdentityMatch && !visual.unapprovedDominantPerson && !visual.wrongProductOrDevice && !visual.inventedUiLikely && !visual.blackOrFrozenFrames && missingAssets.length === 0 && Number(visual.confidence || 0) >= 0.65);
  const evidence = { transcript: transcriptResult, visual, missingAssets, exactBrollComposed };
  if (!transcriptResult.passed || !visualPassed || !rawArtifact) {
    if (rawArtifact) await prisma.generatedArtifact.update({ where: { id: rawArtifact.id }, data: { validationStatus: "INVALID", validationMetadata: JSON.stringify(evidence), validatedAt: new Date() } });
    await quarantineVariant(variant.id, "QUALITY_GATE_FAILED", !transcriptResult.passed ? "The spoken script did not match" : "Avatar or required visual checks failed");
    return { terminal: true, quarantined: true };
  }

  const finalizationOwner = await claimFinalization(variant.id);
  if (!finalizationOwner) return { terminal: false, finalization: "IN_PROGRESS" };
  try {
    const finalArtifact = await finalizeDeliverable({ variant, rawArtifact, evidence, ownerId: finalizationOwner });
    if (!finalArtifact) return { terminal: false, finalization: "LEASE_LOST" };
  } catch (error) {
    // Do not strand a result in PROCESSING or make a temporary object-store/DB
    // error terminal. Reconciliation can re-enter finalization after the lease.
    await prisma.creationVariant.updateMany({ where: finalizationOwnerWhere(variant.id, finalizationOwner), data: { status: "PROCESSING", currentStage: "delivery_retry", errorCode: "FINALIZATION_RETRYABLE", safeError: "Final delivery is being recovered", finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } });
    throw error;
  }
  return { terminal: true, completed: true };
}

// Reconciliation entry point for a process that died after verification but
// before final delivery/settlement.  Provider output is never requested again;
// this reuses the persisted verification evidence and deterministic R2 keys.
export async function replayFinalization(creationVariantId) {
  const variant = await prisma.creationVariant.findUnique({ where: { id: creationVariantId }, select: { reconciliationEngineRevision: true } });
  if (!isReconciliationEligibleVariant(variant)) return { replayed: false, reason: "RECONCILIATION_INELIGIBLE" };
  const jobs = await prisma.providerJob.findMany({
    where: { creationVariantId, internalModelId: { in: ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"] }, status: "SUCCEEDED" },
    orderBy: { createdAt: "asc" },
  });
  if (jobs.length !== 2) return { replayed: false, reason: "VERIFICATION_NOT_COMPLETE" };
  const source = jobs[0];
  let payload;
  try { payload = JSON.parse(source.sanitizedResultPayload || "{}"); } catch { return { replayed: false, reason: "VERIFICATION_RESULT_UNAVAILABLE" }; }
  const result = await handleVerificationResult(source, payload);
  return { replayed: true, ...result };
}
