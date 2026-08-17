import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { downloadMediaBufferSsrfSafe } from "@/lib/downloader";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { runFfprobe } from "@/lib/media/FfmpegRunner";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { handleVerificationResult, startQualityVerification } from "@/lib/generation/qualityPipeline";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { fetchAuthenticatedMuapiResult } from "@/lib/generation/muapiResult";
import { isReconciliationEligibleVariant } from "@/lib/generation/reconciliationEligibility";
import { isModelPlatformV1Creation, settleModelPlatformWorkflow } from "@/lib/models/execution/workflowSettlement.js";
import { parseUsdToMicroUsdConservatively } from "@/lib/models/execution/muapiExecutor.js";

export const maxDuration = 300;

function extractVideoUrl(value, depth = 0) {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string" && /^https:\/\//.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of ["video", "video_url", "url", "output", "outputs", "result", "data"]) {
      if (key in value) {
        const found = extractVideoUrl(value[key], depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

async function updateCreationAggregate(creationId) {
  const isModelPlatform = await isModelPlatformV1Creation(creationId);
  if (isModelPlatform) {
    await settleModelPlatformWorkflow({ creationId, tx: prisma });
    return;
  }

  // Legacy Creation Aggregate Update
  const variants = await prisma.creationVariant.findMany({ where: { creationId } });
  const completed = variants.filter((variant) => variant.status === "COMPLETED");
  const active = variants.filter((variant) => ["QUEUED", "PROCESSING"].includes(variant.status));
  const quarantined = variants.filter((variant) => variant.status === "QUARANTINED");
  const failed = variants.filter((variant) => ["FAILED", "TIMED_OUT", "CANCELLED"].includes(variant.status));
  let status = "FAILED";
  if (completed.length === variants.length) status = "COMPLETED";
  else if (active.length) status = "PROCESSING";
  else if (completed.length) status = "PARTIAL_COMPLETED";
  else if (quarantined.length) status = "QUARANTINED";
  const firstFailure = failed[0] || quarantined[0];
  const firstCompleted = completed[0];
  let url = null;
  if (firstCompleted?.finalArtifactId) {
    const artifact = await prisma.generatedArtifact.findUnique({ where: { id: firstCompleted.finalArtifactId } });
    if (artifact) url = await R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900 });
  }
  await prisma.creation.update({
    where: { id: creationId },
    data: {
      status,
      currentStage: status === "COMPLETED" ? "delivery" : status === "PROCESSING" ? "provider_generation" : "quality_verification",
      progressValue: variants.length ? (completed.length / variants.length) * 100 : 0,
      completedAt: ["COMPLETED", "PARTIAL_COMPLETED", "FAILED", "QUARANTINED"].includes(status) ? new Date() : null,
      url,
      errorCode: firstFailure?.errorCode || null,
      safeError: firstFailure ? userFacingGenerationMessage(firstFailure.status, firstFailure.errorCode) : null,
    },
  });
}

export async function POST(req) {
  if (!verifyMuapiWebhookUrl(req.url)) return NextResponse.json({ error: "Invalid webhook token" }, { status: 401 });
  const rawBody = await req.text();
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const providerRequestId = payload.request_id || payload.id;
  if (!providerRequestId) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  let event;
  try {
    event = await prisma.webhookEvent.create({
      data: {
        provider: "MUAPI",
        providerRequestId,
        providerEventId: payload.event_id || null,
        eventType: String(payload.status || "result"),
        payloadHash,
        signatureStatus: "UNVERIFIED",
        processingStatus: "RECEIVED",
        payload: rawBody.slice(0, 100000),
        sanitizedHeaders: JSON.stringify({ "content-type": req.headers.get("content-type") }),
      },
    });
  } catch (dbError) {
    // P2002 duplicate constraint catch for exact replay idempotency
    if (dbError.code === "P2002") {
      return NextResponse.json({ success: true, duplicate: true });
    }
    throw dbError;
  }

  const job = await prisma.providerJob.findFirst({ where: { providerRequestId }, include: { variant: { include: { creation: true } } } });
  if (!job) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "IGNORED", processedAt: new Date(), errorCode: "JOB_NOT_FOUND" } });
    return NextResponse.json({ success: true, ignored: true });
  }

  if (!isReconciliationEligibleVariant(job.variant)) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "IGNORED", processedAt: new Date(), errorCode: "RECONCILIATION_INELIGIBLE" } });
    return NextResponse.json({ success: true, ignored: true });
  }
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status)) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "DUPLICATE", processedAt: new Date() } });
    return NextResponse.json({ success: true, terminal: true });
  }

  // Fetch authenticated result with Doolphin server-side MuAPI key
  let providerPayload;
  try {
    providerPayload = await fetchAuthenticatedMuapiResult(providerRequestId);
    // Mark verifiedAt ONLY after authenticated provider result is fetched/validated
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { verifiedAt: new Date(), signatureStatus: "VERIFIED" } });
  } catch (error) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "FAILED", processedAt: new Date(), errorCode: error.code || "RESULT_AUTH_FAILED" } });
    return NextResponse.json({ error: "Provider result verification is temporarily unavailable" }, { status: 503 });
  }

  if (["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"].includes(job.internalModelId)) {
    const verification = await handleVerificationResult(job, providerPayload);
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } });
    if (verification.terminal) await updateCreationAggregate(job.variant.creationId);
    return NextResponse.json({ success: true, ...verification });
  }

  const isModelPlatform = await isModelPlatformV1Creation(job.variant.creationId);
  const providerStatus = String(providerPayload.status || "").toLowerCase();

  // Conservative microUSD cost parsing
  const rawCostUsd = providerPayload?.cost?.amount_usd ?? providerPayload?.cost?.amount;
  const isRefunded = Boolean(providerPayload?.cost?.refunded);
  let actualCostMicroUsd = 0n;
  if (!isRefunded && rawCostUsd !== undefined && rawCostUsd !== null) {
    actualCostMicroUsd = parseUsdToMicroUsdConservatively(rawCostUsd);
  } else if (!isRefunded) {
    actualCostMicroUsd = job.estimatedCostMinMicroUsd || 0n;
  }

  if (["failed", "error", "cancelled", "canceled"].includes(providerStatus) || providerPayload.error) {
    if (!isModelPlatform) {
      await CreditEscrowService.releaseVariantReservations(job.creationVariantId, "PROVIDER_GENERATION_FAILED");
    }
    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          actualCostMicroUsd: isRefunded ? 0n : actualCostMicroUsd,
          providerBillingStatus: isRefunded ? "WAIVED" : "BILLED",
          errorCode: "PROVIDER_GENERATION_FAILED",
          safeError: String(providerPayload.error || "Provider generation failed"),
          sanitizedResultPayload: JSON.stringify({ status: providerStatus, error: String(providerPayload.error || "failed") })
        }
      }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "FAILED", errorCode: "PROVIDER_GENERATION_FAILED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_GENERATION_FAILED") } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
    ]);
    await updateCreationAggregate(job.variant.creationId);
    return NextResponse.json({ success: true });
  }

  const videoUrl = extractVideoUrl(providerPayload);
  if (!videoUrl) {
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", lastCheckedAt: new Date(), webhookCount: { increment: 1 } } });
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } });
    return NextResponse.json({ success: true, processing: true });
  }

  let tempPath = null;
  try {
    const downloaded = await downloadMediaBufferSsrfSafe(videoUrl);
    tempPath = path.join(os.tmpdir(), `${job.id}.mp4`);
    await fs.promises.writeFile(tempPath, downloaded.buffer);
    const probe = await runFfprobe(tempPath);
    const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
    const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
    const actualDuration = Number(probe.format?.duration || 0);
    const expectedDuration = job.variant.creation.duration || 0;
    const requestedRatio = job.variant.creation.aspectRatio || "9:16";
    const [ratioWidth, ratioHeight] = requestedRatio.split(":").map(Number);
    const expectedRatio = ratioWidth / ratioHeight;
    const actualRatio = videoStream?.width && videoStream?.height ? videoStream.width / videoStream.height : 0;
    const expectedDimensions = { "9:16": [720, 1280], "16:9": [1280, 720], "3:4": [720, 960], "4:3": [960, 720] }[requestedRatio];
    const dimensionsPassed = Boolean(expectedDimensions && Math.abs((videoStream?.width || 0) - expectedDimensions[0]) <= 8 && Math.abs((videoStream?.height || 0) - expectedDimensions[1]) <= 8);
    const codecPassed = ["h264", "hevc", "av1"].includes(videoStream?.codec_name) && ["aac", "mp3", "opus"].includes(audioStream?.codec_name);
    const mediaPassed = Boolean(videoStream && audioStream && codecPassed && dimensionsPassed && actualDuration > 0 && Math.abs(actualDuration - expectedDuration) <= 3 && Math.abs(actualRatio - expectedRatio) <= 0.04 && downloaded.buffer.length > 1000);

    if (!mediaPassed) {
      if (!isModelPlatform) {
        await CreditEscrowService.settleVerifiedVariant(job.creationVariantId, false);
      }
      await prisma.$transaction([
        prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), sanitizedResultPayload: JSON.stringify({ status: providerStatus, output: "[REDACTED_URL]" }) } }),
        prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "QUARANTINED", currentStage: "quality_verification", errorCode: "QUALITY_GATE_FAILED", safeError: "Output failed media, audio, or duration checks" } }),
        prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
      ]);
      await updateCreationAggregate(job.variant.creationId);
      return NextResponse.json({ success: true, quarantined: true });
    }

    await prisma.$transaction([
      prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", actualCostMicroUsd: actualCostMicroUsd, providerBillingStatus: "BILLED", sanitizedResultPayload: JSON.stringify({ status: providerStatus, cost: providerPayload.cost ? "[RECORDED]" : null, output: "[STORED_IN_R2]" }) } }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "PROCESSING", currentStage: "quality_verification", progressValue: 70 } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
    ]);
    await startQualityVerification({ seedanceJob: job, videoUrl, buffer: downloaded.buffer, probe, webhookUrl: req.url });
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date() } });
    await updateCreationAggregate(job.variant.creationId);
    return NextResponse.json({ success: true, verification: "PROCESSING" });
  } catch (error) {
    await prisma.$transaction([
      prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", errorCode: "RESULT_PROCESSING_RETRYABLE", safeError: "Provider output is being recovered", lastCheckedAt: new Date() } }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "PROCESSING", currentStage: "result_processing_retry", errorCode: "RESULT_PROCESSING_RETRYABLE", safeError: "Output processing is being recovered" } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "FAILED", processedAt: new Date(), errorCode: "RESULT_PROCESSING_RETRYABLE" } }),
    ]);
    return NextResponse.json({ error: "Result processing is recoverable" }, { status: 503 });
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
}
