import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { getMuapiApiKey } from "./muapiCredentials";
import { buildStorageKey } from "@/lib/storage/storageKey";
import { composeExactBroll, extractVerificationFrames, runFfprobe } from "@/lib/media/FfmpegRunner";
import { createVerificationMontage } from "@/lib/media/verificationMontage";
import { parseStrictJsonOutput, transcriptPasses } from "@/lib/generation/qualityVerification";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { isReconciliationEligibleVariant } from "@/lib/generation/reconciliationEligibility";
import { isModelPlatformV1Creation, settleModelPlatformWorkflow } from "@/lib/models/execution/workflowSettlement.js";

const WHISPER_ENDPOINT = "https://api.muapi.ai/api/v1/openai-whisper";
const VISION_ENDPOINT = "https://api.muapi.ai/api/v1/gemini-2-5-flash";
const FINALIZATION_LEASE_MS = 60000;

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
  const apiKey = getMuapiApiKey();
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
  const variant = await prisma.creationVariant.findUnique({ where: { id: variantId }, select: { creationId: true } });
  const isModelPlatform = variant ? await isModelPlatformV1Creation(variant.creationId) : false;

  if (!isModelPlatform) {
    await CreditEscrowService.releaseVariantReservations(variantId, errorCode || "NO_DELIVERABLE");
  }
  await prisma.creationVariant.update({ where: { id: variantId }, data: { status: "QUARANTINED", currentStage: "quality_verification", errorCode, safeError } });

  if (isModelPlatform && variant) {
    await settleModelPlatformWorkflow({ creationId: variant.creationId });
  }
}

function newFinalizationOwner(prefix = "verifier") {
  return `${prefix}:${crypto.randomUUID()}`;
}

function finalizationOwnerWhere(variantId, ownerId) {
  return { id: variantId, finalizationLeaseId: ownerId, finalizationLeaseExpiresAt: { gt: new Date() } };
}

async function claimFinalization(variantId, ownerId = newFinalizationOwner()) {
  const leaseExpiresAt = new Date(Date.now() + FINALIZATION_LEASE_MS);
  const result = await prisma.creationVariant.updateMany({
    where: {
      id: variantId,
      status: { notIn: ["COMPLETED", "QUARANTINED"] },
      OR: [
        { finalizationLeaseExpiresAt: null },
        { finalizationLeaseExpiresAt: { lte: new Date() } },
        { finalizationLeaseId: ownerId },
      ],
    },
    data: { finalizationLeaseId: ownerId, finalizationClaimedAt: new Date(), finalizationLeaseExpiresAt: leaseExpiresAt },
  });
  return result.count === 1 ? ownerId : null;
}

async function stillOwnFinalization(variantId, ownerId) {
  const current = await prisma.creationVariant.findUnique({ where: { id: variantId }, select: { finalizationLeaseId: true, finalizationLeaseExpiresAt: true } });
  return current?.finalizationLeaseId === ownerId && current?.finalizationLeaseExpiresAt && current.finalizationLeaseExpiresAt > new Date();
}

async function finalizeDeliverable({ variant, rawArtifact, evidence, ownerId }) {
  const finalStorageKey = buildStorageKey("final", [variant.creation.workspaceId, variant.creation.id, `variant_${variant.variantIndex}.mp4`]);
  let finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey } });

  if (!finalArtifact) {
    const originalObject = await R2StorageService.generateSignedUrl({ storageKey: rawArtifact.storageKey, expiresInSeconds: 900 });
    const downloaded = await downloadMediaBufferSsrfSafe(originalObject);
    await R2StorageService.uploadObject({ storageKey: finalStorageKey, buffer: downloaded.buffer, contentType: rawArtifact.mimeType });
    const finalStored = await R2StorageService.checkObjectExists(finalStorageKey);
    finalArtifact = await prisma.generatedArtifact.upsert({
      where: { creationVariantId_type_storageKey: { creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey } },
      create: { workspaceId: rawArtifact.workspaceId, creationVariantId: variant.id, type: "FINAL_VIDEO", storageKey: finalStorageKey, checksumSha256: finalStored.checksumSha256, mimeType: rawArtifact.mimeType, fileSizeBytes: finalStored.fileSizeBytes, width: rawArtifact.width, height: rawArtifact.height, durationMs: rawArtifact.durationMs, frameRate: rawArtifact.frameRate, videoCodec: rawArtifact.videoCodec, audioCodec: rawArtifact.audioCodec, validationStatus: "VALID", validationMetadata: JSON.stringify(evidence), sourceProviderUrlHost: rawArtifact.sourceProviderUrlHost, validatedAt: new Date() },
      update: {},
    });
  }

  if (!await stillOwnFinalization(variant.id, ownerId)) return null;

  await ensureDeliveryCheck(finalArtifact, evidence);
  await prisma.generatedArtifact.update({ where: { id: rawArtifact.id }, data: { validationStatus: "VALID", validationMetadata: JSON.stringify(evidence), validatedAt: new Date() } });

  const isModelPlatform = await isModelPlatformV1Creation(variant.creationId);
  if (!isModelPlatform) {
    await CreditEscrowService.settleVerifiedVariant(variant.id, true);
  }
  const completed = await prisma.creationVariant.updateMany({ where: finalizationOwnerWhere(variant.id, ownerId), data: { status: "COMPLETED", currentStage: "delivery", completedAt: new Date(), finalArtifactId: finalArtifact.id, progressValue: 100, errorCode: null, safeError: null, finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } });

  if (isModelPlatform) {
    await settleModelPlatformWorkflow({ creationId: variant.creationId });
  }
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
    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
    const rawStorageKey = buildStorageKey({ workspaceId: creation.workspaceId, creationId: creation.id, fileType: "raw_provider_video", extension: "mp4" });
    await R2StorageService.uploadObject({ storageKey: rawStorageKey, buffer, contentType: "video/mp4" });
    const rawStored = await R2StorageService.checkObjectExists(rawStorageKey);
    const rawArtifact = await prisma.generatedArtifact.upsert({
      where: { creationVariantId_type_storageKey: { creationVariantId: variant.id, type: "RAW_PROVIDER_VIDEO", storageKey: rawStorageKey } },
      create: {
        workspaceId: creation.workspaceId, creationVariantId: variant.id, type: "RAW_PROVIDER_VIDEO", storageKey: rawStorageKey, checksumSha256: rawStored.checksumSha256, mimeType: "video/mp4", fileSizeBytes: rawStored.fileSizeBytes, width: videoStream?.width || null, height: videoStream?.height || null, durationMs: Math.round(Number(probe.format?.duration || 0) * 1000), frameRate: videoStream?.r_frame_rate ? String(videoStream.r_frame_rate) : null, videoCodec: videoStream?.codec_name || null, audioCodec: audioStream?.codec_name || null, validationStatus: "PENDING", validationMetadata: JSON.stringify({ source: "muapi_seedance", probe }), sourceProviderUrlHost: new URL(videoUrl).host,
      },
      update: {},
    });

    let currentVideoPath = path.join(tempDirectory, "input.mp4");
    await fs.promises.writeFile(currentVideoPath, buffer);
    const assets = await prisma.creationAsset.findMany({ where: { creationId: creation.id } });
    // App Studio fidelity is a deterministic completion concern.  Provider
    // generations may use the assets semantically, but a readable app UI must
    // be inserted from the original bytes rather than redrawn by the model.
    const appAssets = assets.filter((asset) => asset.role === "APP_SCREEN_RECORDING" || asset.role === "APP_PRIMARY_SCREEN");
    let composedArtifact = null;
    if (creation.generationType === "APP_STUDIO" && appAssets.length) {
      const brollInputs = [];
      for (const [index, appAsset] of appAssets.entries()) {
        const sourceUrl = appAsset.storageKey?.startsWith("https://")
          ? appAsset.storageKey
          : await R2StorageService.generateSignedUrl({ storageKey: appAsset.storageKey, expiresInSeconds: 900 });
        const downloadedAsset = await downloadMediaBufferSsrfSafe(sourceUrl);
        const isVideo = appAsset.role === "APP_SCREEN_RECORDING" || appAsset.mimeType?.startsWith("video/");
        const extension = isVideo ? "mp4" : "png";
        const appPath = path.join(tempDirectory, `app-reference-${index + 1}.${extension}`);
        await fs.promises.writeFile(appPath, downloadedAsset.buffer);
        brollInputs.push({ path: appPath, isVideo });
      }
      const brollPath = path.join(tempDirectory, "composed.mp4");
      const outputDuration = Math.max(1, Number(probe.format?.duration || 0));
      const outputWidth = Number(videoStream?.width || (creation.aspectRatio === "9:16" ? 1080 : 1920));
      const outputHeight = Number(videoStream?.height || (creation.aspectRatio === "9:16" ? 1920 : 1080));
      await composeExactBroll({
        baseVideoPath: currentVideoPath,
        brollInputs,
        outputPath: brollPath,
        durationSeconds: outputDuration,
        width: outputWidth,
        height: outputHeight,
      });
      const brollBuffer = await fs.promises.readFile(brollPath);
      const composedKey = buildStorageKey({ workspaceId: creation.workspaceId, creationId: creation.id, fileType: "composed_video", extension: "mp4" });
      await R2StorageService.uploadObject({ storageKey: composedKey, buffer: brollBuffer, contentType: "video/mp4" });
      const composedStored = await R2StorageService.checkObjectExists(composedKey);
      composedArtifact = await prisma.generatedArtifact.upsert({
        where: { creationVariantId_type_storageKey: { creationVariantId: variant.id, type: "COMPOSED_VIDEO", storageKey: composedKey } },
        create: { workspaceId: creation.workspaceId, creationVariantId: variant.id, type: "COMPOSED_VIDEO", storageKey: composedKey, checksumSha256: composedStored.checksumSha256, mimeType: "video/mp4", fileSizeBytes: composedStored.fileSizeBytes, width: outputWidth, height: outputHeight, durationMs: Math.round(outputDuration * 1000), frameRate: videoStream?.r_frame_rate || null, videoCodec: "h264", audioCodec: "aac", validationStatus: "PENDING", validationMetadata: JSON.stringify({ appAssetIds: appAssets.map((asset) => asset.id), composition: "exact_app_broll" }), sourceProviderUrlHost: "local_ffmpeg", },
        update: {},
      });
      currentVideoPath = brollPath;
    }

    const montagePath = path.join(tempDirectory, "montage.jpg");
    const framePaths = await extractVerificationFrames(currentVideoPath, tempDirectory);
    await createVerificationMontage(framePaths, montagePath);
    const montageBuffer = await fs.promises.readFile(montagePath);
    const montageKey = buildStorageKey({ workspaceId: creation.workspaceId, creationId: creation.id, fileType: "verification_montage", extension: "jpg" });
    await R2StorageService.uploadObject({ storageKey: montageKey, buffer: montageBuffer, contentType: "image/jpeg" });
    const montageSignedUrl = await R2StorageService.generateSignedUrl({ storageKey: montageKey, expiresInSeconds: 3600 });

    const whisperJob = await prisma.providerJob.create({
      data: {
        creationVariantId: variant.id, provider: "MUAPI", internalModelId: "muapi.openai-whisper", providerModelVersion: "whisper-large-v3", endpoint: WHISPER_ENDPOINT, status: "PREPARED", stageIdempotencyKey: `whisper_${variant.id}`, inputFingerprint: fingerprint({ videoUrl }), registryRevision: seedanceJob.registryRevision, pricingRevision: seedanceJob.pricingRevision, adapterVersion: seedanceJob.adapterVersion, routingSnapshot: seedanceJob.routingSnapshot, capabilitySnapshot: seedanceJob.capabilitySnapshot, sanitizedRequestPayload: JSON.stringify({ file: "[REDACTED_VIDEO_URL]" }), estimatedCostMinMicroUsd: BigInt(2000), estimatedCostMaxMicroUsd: BigInt(2000),
      },
    });
    const visionPrompt = `Analyze this video verification montage for a video titled "${creation.title}". 1. Does it look like a video product ad or UGC video? 2. Is there severe visual distortion or glitched frames? Answer in JSON format: {"isProductVideo": boolean, "hasDistortion": boolean, "summary": string}`;
    const visionJob = await prisma.providerJob.create({
      data: {
        creationVariantId: variant.id, provider: "MUAPI", internalModelId: "muapi.gemini-2.5-flash-verifier", providerModelVersion: "gemini-2.5-flash", endpoint: VISION_ENDPOINT, status: "PREPARED", stageIdempotencyKey: `vision_${variant.id}`, inputFingerprint: fingerprint({ montageSignedUrl, visionPrompt }), registryRevision: seedanceJob.registryRevision, pricingRevision: seedanceJob.pricingRevision, adapterVersion: seedanceJob.adapterVersion, routingSnapshot: seedanceJob.routingSnapshot, capabilitySnapshot: seedanceJob.capabilitySnapshot, sanitizedRequestPayload: JSON.stringify({ prompt: visionPrompt, image: "[MONTAGE]" }), estimatedCostMinMicroUsd: BigInt(3000), estimatedCostMaxMicroUsd: BigInt(3000),
      },
    });

    await submitVerificationJob(whisperJob, { file: videoUrl });
    await submitVerificationJob(visionJob, { prompt: visionPrompt, image: montageSignedUrl, json_mode: true });
    return composedArtifact || rawArtifact;
  } catch (error) {
    await quarantineVariant(variant.id, "QUALITY_VERIFICATION_INIT_FAILED", error.message);
    return null;
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function handleVerificationResult(job, providerPayload) {
  if (!isReconciliationEligibleVariant(job.variant)) return { terminal: false, ignored: true, reason: "RECONCILIATION_INELIGIBLE" };
  const variant = job.variant;
  const finalizationOwner = await claimFinalization(variant.id);
  if (!finalizationOwner) return { terminal: false, claimed: false };
  try {
    const rawArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: { in: ["COMPOSED_VIDEO", "RAW_PROVIDER_VIDEO"] } }, orderBy: { createdAt: "desc" }, include: { creationVariant: true } });
    if (!rawArtifact) {
      await quarantineVariant(variant.id, "MISSING_RAW_ARTIFACT", "Raw video artifact is missing");
      return { terminal: true, success: false };
    }
    const otherJobId = job.internalModelId === "muapi.openai-whisper" ? "muapi.gemini-2.5-flash-verifier" : "muapi.openai-whisper";
    const otherJob = await prisma.providerJob.findFirst({ where: { creationVariantId: variant.id, internalModelId: otherJobId } });
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), sanitizedResultPayload: JSON.stringify(providerPayload) } });
    if (!otherJob || otherJob.status !== "SUCCEEDED") return { terminal: false, pendingOther: true };

    const whisperPayload = job.internalModelId === "muapi.openai-whisper" ? providerPayload : JSON.parse(otherJob.sanitizedResultPayload || "{}");
    const visionPayload = job.internalModelId === "muapi.gemini-2.5-flash-verifier" ? providerPayload : JSON.parse(otherJob.sanitizedResultPayload || "{}");
    const transcript = extractTranscript(whisperPayload);
    const visionAnalysis = parseStrictJsonOutput(visionPayload);

    const spokenScript = variant.creation.spokenScript || "";
    const speechOk = transcriptPasses(transcript, spokenScript);
    const visionOk = Boolean(visionAnalysis.isProductVideo) && !visionAnalysis.hasDistortion;
    const evidence = { whisperTranscript: transcript, visionAnalysis, speechOk, visionOk };

    if (speechOk && visionOk) {
      const finalArtifact = await finalizeDeliverable({ variant, rawArtifact, evidence, ownerId: finalizationOwner });
      return { terminal: true, success: Boolean(finalArtifact) };
    }
    await quarantineVariant(variant.id, "QUALITY_VERIFICATION_FAILED", "Video failed speech or visual checks");
    return { terminal: true, success: false };
  } catch (error) {
    await prisma.creationVariant.updateMany({ where: finalizationOwnerWhere(variant.id, finalizationOwner), data: { status: "PROCESSING", currentStage: "delivery_retry", errorCode: "FINALIZATION_RETRYABLE", safeError: "Final delivery is being recovered", finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } });
    throw error;
  }
}

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

async function ensureDeliveryCheck(finalArtifact, evidence) {
  if (!finalArtifact?.storageKey || !finalArtifact?.fileSizeBytes || finalArtifact.fileSizeBytes <= BigInt(1000)) {
    throw new Error("Final artifact is missing or corrupted");
  }
}
