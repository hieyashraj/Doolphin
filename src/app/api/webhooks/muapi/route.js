import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { runFfprobe } from "@/lib/media/FfmpegRunner";
import { downloadMediaBufferSsrfSafe } from "@/lib/downloader";
import { handleVerificationResult, startQualityVerification } from "@/lib/generation/qualityPipeline";
import { fetchAuthenticatedMuapiResult } from "@/lib/generation/muapiResult";
import { isReconciliationEligibleVariant } from "@/lib/generation/reconciliationEligibility";
import { buildMuapiWebhookUrl, verifyMuapiCallbackToken } from "@/lib/generation/webhookSecurity";
import { classifyMuapiProviderStatus } from "@/lib/generation/muapiStatusClassifier";
import { processAuthenticatedImageResult } from "@/lib/generation/imagePipeline";
import { isAuthenticatedImageDeliveryJob, shouldReplayDeliveryCallback } from "@/lib/generation/deliveryPolicy";
import { validateVideoMedia } from "@/lib/generation/videoMediaValidation";
import { parseUsdToMicroUsdConservatively } from "@/lib/models/execution/muapiExecutor.js";
import { isModelPlatformV1Creation, settleModelPlatformWorkflow } from "@/lib/models/execution/workflowSettlement.js";

function extractVideoUrl(payload) {
  const visit = (val, depth = 0) => {
    if (depth > 7 || val == null) return null;
    if (typeof val === "string") {
      if (val.startsWith("http://") || val.startsWith("https://")) {
        const lower = val.toLowerCase();
        if (lower.includes(".mp4") || lower.includes("/video") || lower.includes("result") || lower.includes("output")) return val;
      }
      try { return visit(JSON.parse(val), depth + 1); } catch { return null; }
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
    }
    if (typeof val === "object") {
      for (const key of ["video_url", "video", "output_url", "url", "result", "file", "outputs", "output"]) {
        if (key in val) {
          const found = visit(val[key], depth + 1);
          if (found) return found;
        }
      }
    }
    return null;
  };
  return visit(payload);
}

async function updateCreationAggregate(creationId) {
  const isModelPlatform = await isModelPlatformV1Creation(creationId);
  if (isModelPlatform) {
    return await settleModelPlatformWorkflow({ creationId });
  }

  const creation = await prisma.creation.findUnique({ where: { id: creationId }, include: { variants: true } });
  if (!creation) return;
  const statuses = creation.variants.map((v) => v.status);
  const isCompleted = statuses.length > 0 && statuses.every((s) => s === "COMPLETED");
  const isFailed = statuses.length > 0 && statuses.every((s) => ["FAILED", "CANCELLED", "QUARANTINED"].includes(s));
  const isPartial = statuses.some((s) => s === "COMPLETED") && statuses.some((s) => ["FAILED", "CANCELLED", "QUARANTINED"].includes(s));

  if (isCompleted) {
    await prisma.creation.update({ where: { id: creationId }, data: { status: "COMPLETED", currentStage: "delivery", completedAt: new Date() } });
  } else if (isFailed) {
    await prisma.creation.update({ where: { id: creationId }, data: { status: "FAILED", currentStage: "failed" } });
  } else if (isPartial) {
    await prisma.creation.update({ where: { id: creationId }, data: { status: "PARTIAL_COMPLETED", currentStage: "delivery", completedAt: new Date() } });
  }
}

export async function POST(req) {
  // Requirement 3: Token validation before DB write
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || url.searchParams.get("webhook_token") || req.headers.get("x-doolphin-webhook-token");

  if (!verifyMuapiCallbackToken(token)) {
    return NextResponse.json({ error: "Unauthorized callback token" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const providerRequestId = String(body.request_id || body.requestId || body.id || "").trim();
  if (!providerRequestId) {
    return NextResponse.json({ error: "Missing provider request_id" }, { status: 400 });
  }

  const payloadString = JSON.stringify(body);
  const payloadHash = crypto.createHash("sha256").update(payloadString).digest("hex");
  const eventType = String(body.event || body.type || body.status || "muapi.webhook");

  // WebhookEvent Prisma write schema fix
  let event;
  let duplicateEvent = false;
  try {
    event = await prisma.webhookEvent.create({
      data: {
        provider: "MUAPI",
        providerRequestId,
        providerEventId: body.event_id || body.eventId || null,
        eventType,
        payloadHash,
        signatureStatus: "UNVERIFIED",
        processingStatus: "RECEIVED",
        payload: payloadString,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      duplicateEvent = true;
      event = await prisma.webhookEvent.findFirst({ where: { provider: "MUAPI", providerRequestId, payloadHash } });
      if (!event) throw error;
    } else {
      throw error;
    }
  }

  const job = await prisma.providerJob.findFirst({
    where: { providerRequestId },
    include: { variant: { include: { creation: true } } },
  });

  if (!job) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "IGNORED", processedAt: new Date(), errorCode: "JOB_NOT_FOUND" } });
    return NextResponse.json({ success: true, ignored: true });
  }

  if (duplicateEvent && !shouldReplayDeliveryCallback(job)) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "DUPLICATE", processedAt: new Date() } });
    return NextResponse.json({ success: true, duplicate: true });
  }

  if (!isReconciliationEligibleVariant(job.variant)) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "IGNORED", processedAt: new Date(), errorCode: "RECONCILIATION_INELIGIBLE" } });
    return NextResponse.json({ success: true, ignored: true });
  }
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.status) && !shouldReplayDeliveryCallback(job)) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "DUPLICATE", processedAt: new Date() } });
    return NextResponse.json({ success: true, terminal: true });
  }

  // Fetch authenticated result with Doolphin server-side MuAPI key
  let providerPayload;
  try {
    providerPayload = await fetchAuthenticatedMuapiResult(providerRequestId);
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { verifiedAt: new Date(), signatureStatus: "UNVERIFIED" } });
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

  // Image Studio callbacks share this authenticated endpoint, but their
  // terminal payloads must be finalized by Sharp/R2 rather than classified as
  // video or sent through ffprobe. Snapshot strategies are authoritative for
  // new jobs; generationType keeps callbacks for older IMAGE_STUDIO jobs safe.
  if (isAuthenticatedImageDeliveryJob(job)) {
    try {
      const result = await processAuthenticatedImageResult(job, providerPayload);
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "FAILED", processedAt: new Date(), errorCode: error.code || "IMAGE_RESULT_PROCESSING_RETRYABLE" } });
      return NextResponse.json({ error: "Image result processing failed temporarily" }, { status: 503 });
    }
  }

  // Defect 4: Provider status classification before financial reconciliation
  const rawStatus = providerPayload.status;
  const classification = classifyMuapiProviderStatus(providerPayload);

  if (classification.type === "UNKNOWN") {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "FAILED", processedAt: new Date(), errorCode: "UNKNOWN_PROVIDER_STATUS" } });
    return NextResponse.json({ error: `Unrecognized provider status '${classification.status || rawStatus}'` }, { status: 503 });
  }

  if (classification.type === "INTERMEDIATE") {
    // Intermediate status (even if payload contains a videoUrl):
    // Update ProviderJob operational status & lastCheckedAt ONLY.
    // Do NOT touch ProviderCostLedger.reconciledAt, do NOT trigger workflow credit settlement!
    await prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", lastCheckedAt: new Date(), webhookCount: { increment: 1 } } });
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } });
    return NextResponse.json({ success: true, processing: true });
  }

  const isModelPlatform = await isModelPlatformV1Creation(job.variant.creationId);

  // Defect 4: Financial Cost Reconciliation on Terminal Statuses Only
  const rawCostUsd = providerPayload?.cost?.amount_usd ?? providerPayload?.cost?.amount;
  const isRefunded = Boolean(providerPayload?.cost?.refunded);

  let actualCostMicroUsd = null;
  let providerBillingStatus = "ESTIMATED";

  if (isRefunded) {
    actualCostMicroUsd = 0n;
    providerBillingStatus = "WAIVED";
  } else if (rawCostUsd !== undefined && rawCostUsd !== null) {
    actualCostMicroUsd = parseUsdToMicroUsdConservatively(rawCostUsd);
    providerBillingStatus = "BILLED";
  }

  if (classification.type === "FAILURE_TERMINAL") {
    if (!isModelPlatform) {
      await CreditEscrowService.releaseVariantReservations(job.creationVariantId, "PROVIDER_GENERATION_FAILED");
    }
    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          actualCostMicroUsd,
          providerBillingStatus,
          errorCode: "PROVIDER_GENERATION_FAILED",
          safeError: String(providerPayload.error || "Provider generation failed"),
          sanitizedResultPayload: JSON.stringify({ status: classification.status, error: String(providerPayload.error || "failed") })
        }
      }),
      prisma.providerCostLedger.updateMany({
        where: { providerJobId: job.id },
        data: {
          actualCostMicroUsd,
          providerBillingStatus,
          providerRequestId,
          reconciledAt: new Date(),
        },
      }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "FAILED", errorCode: "PROVIDER_GENERATION_FAILED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_GENERATION_FAILED") } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
    ]);
    await updateCreationAggregate(job.variant.creationId);
    return NextResponse.json({ success: true });
  }

  // SUCCESS_TERMINAL status handling
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
    const mediaValidation = validateVideoMedia({
      probe,
      byteLength: downloaded.buffer.length,
      creation: job.variant.creation,
      capabilitySnapshot: job.capabilitySnapshot,
    });

    if (!mediaValidation.passed) {
      if (!isModelPlatform) {
        await CreditEscrowService.settleVerifiedVariant(job.creationVariantId, false);
      }
      await prisma.$transaction([
        prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), actualCostMicroUsd, providerBillingStatus, sanitizedResultPayload: JSON.stringify({ status: classification.status, output: "[REDACTED_URL]" }) } }),
        prisma.providerCostLedger.updateMany({
          where: { providerJobId: job.id },
          data: {
            actualCostMicroUsd,
            providerBillingStatus,
            providerRequestId,
            reconciledAt: new Date(),
          },
        }),
        prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "QUARANTINED", currentStage: "quality_verification", errorCode: "QUALITY_GATE_FAILED", safeError: "Output failed capability-aware media integrity checks" } }),
        prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
      ]);
      await updateCreationAggregate(job.variant.creationId);
      return NextResponse.json({ success: true, quarantined: true });
    }

    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          actualCostMicroUsd,
          providerBillingStatus,
          sanitizedResultPayload: JSON.stringify({ status: classification.status, output: "[REDACTED_URL]" })
        }
      }),
      prisma.providerCostLedger.updateMany({
        where: { providerJobId: job.id },
        data: {
          actualCostMicroUsd,
          providerBillingStatus,
          providerRequestId,
          reconciledAt: new Date(),
        },
      }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "PROCESSING", currentStage: "quality_verification", progressValue: 50 } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "PROCESSED", processedAt: new Date() } }),
    ]);

    const verifierWebhookUrl = buildMuapiWebhookUrl(process.env.WEBHOOK_URL || process.env.NEXTAUTH_URL || "https://api.doolphin.com");
    await startQualityVerification({ seedanceJob: job, videoUrl, buffer: downloaded.buffer, probe, webhookUrl: verifierWebhookUrl });
    return NextResponse.json({ success: true, verified: true });
  } catch (error) {
    await prisma.$transaction([
      prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING", lastCheckedAt: new Date(), errorCode: "RESULT_PROCESSING_RETRYABLE", safeError: "Result delivery is being processed" } }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "PROCESSING", currentStage: "result_processing_retry", errorCode: "RESULT_PROCESSING_RETRYABLE", safeError: "Result delivery is being processed" } }),
      prisma.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: "FAILED", processedAt: new Date(), errorCode: error.message } }),
    ]);
    return NextResponse.json({ error: "Result processing failed temporarily" }, { status: 503 });
  } finally {
    if (tempPath) await fs.promises.unlink(tempPath).catch(() => {});
  }
}
