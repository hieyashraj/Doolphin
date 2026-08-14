import crypto from "crypto";
import sharp from "sharp";
import { prisma } from "../prisma.js";
import { R2StorageService } from "../storage/r2StorageService.js";
import { buildStorageKey } from "../storage/storageKey.js";
import { downloadMediaBufferSsrfSafe } from "../downloader.js";
import { CreditEscrowService } from "../billing/CreditEscrowService.js";
import { getImageModel } from "../generation-models/imageRegistry.js";
import { isReconciliationEligibleVariant } from "./reconciliationEligibility.js";
import { muapiCostMicroUsd } from "./muapiResult.js";
import { PRICING_REVISION } from "../entitlements/pricing.js";

const MIME_BY_FORMAT = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const ACCEPTED_MIME = new Set(Object.values(MIME_BY_FORMAT));

function sanitizeResult(payload) {
  return JSON.stringify({ status: payload?.status || null, outputCount: Array.isArray(payload?.outputs) ? payload.outputs.length : 0, cost: payload?.cost ? "[RECORDED]" : null });
}

async function updateImageCreation(creationId) {
  const variants = await prisma.creationVariant.findMany({ where: { creationId }, select: { status: true, finalArtifactId: true } });
  const complete = variants.every((variant) => variant.status === "COMPLETED");
  const failed = variants.some((variant) => ["FAILED", "TIMED_OUT", "CANCELLED", "QUARANTINED"].includes(variant.status));
  const artifact = variants.find((variant) => variant.finalArtifactId)?.finalArtifactId;
  const finalArtifact = artifact ? await prisma.generatedArtifact.findUnique({ where: { id: artifact } }) : null;
  await prisma.creation.update({ where: { id: creationId }, data: {
    status: complete ? "COMPLETED" : failed ? "FAILED" : "PROCESSING",
    currentStage: complete ? "delivery" : failed ? "failed" : "provider_generation",
    progressValue: complete ? 100 : failed ? 0 : 50,
    completedAt: complete || failed ? new Date() : null,
    url: finalArtifact ? await R2StorageService.generateSignedUrl({ storageKey: finalArtifact.storageKey, expiresInSeconds: 900 }) : null,
  } });
}

const TERMINAL_VARIANT_STATUSES = new Set(["COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED", "QUARANTINED"]);

async function markNoDelivery(job, code, safeError) {
  if (TERMINAL_VARIANT_STATUSES.has(job.variant?.status)) return;
  await CreditEscrowService.releaseVariantReservations(job.creationVariantId, code);
  await prisma.$transaction([
    prisma.providerJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), errorCode: code, safeError, sanitizedResultPayload: JSON.stringify({ error: code }) } }),
    prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "FAILED", currentStage: "failed", errorCode: code, safeError } }),
  ]);
  await updateImageCreation(job.variant.creationId);
}

async function claimFinalization(variantId, ownerId) {
  const claimed = await prisma.creationVariant.updateMany({ where: { id: variantId, status: "PROCESSING", OR: [{ finalizationLeaseId: null }, { finalizationLeaseExpiresAt: { lt: new Date() } }] }, data: { finalizationLeaseId: ownerId, finalizationClaimedAt: new Date(), finalizationLeaseExpiresAt: new Date(Date.now() + 120_000), currentStage: "delivery_finalizing" } });
  return claimed.count === 1;
}

async function createDerivatives({ original, workspaceId, creationId, variantId, outputIndex }) {
  try {
    const image = sharp(original.buffer, { failOn: "error" });
    const [thumbnail, card] = await Promise.all([
      image.clone().resize({ width: 360, height: 360, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer(),
      image.clone().resize({ width: 960, height: 720, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(),
    ]);
    const derivativeEntries = [["IMAGE_THUMBNAIL", "thumbnails", thumbnail], ["IMAGE_CARD", "images", card]];
    for (const [type, namespace, buffer] of derivativeEntries) {
      const key = buildStorageKey(namespace, [workspaceId, creationId, `variant_${variantId}`, `output_${outputIndex}.${type === "IMAGE_THUMBNAIL" ? "thumb" : "card"}.jpg`]);
      const stored = await R2StorageService.uploadFile({ storageKey: key, buffer, contentType: "image/jpeg" });
      await prisma.generatedArtifact.upsert({ where: { creationVariantId_type_outputIndex: { creationVariantId: variantId, type, outputIndex } }, create: { workspaceId, creationVariantId: variantId, type, outputIndex, storageKey: key, checksumSha256: stored.checksumSha256, mimeType: "image/jpeg", fileSizeBytes: stored.fileSizeBytes, validationStatus: "VALID", validatedAt: new Date() }, update: { storageKey: key, checksumSha256: stored.checksumSha256, fileSizeBytes: stored.fileSizeBytes, validationStatus: "VALID", validatedAt: new Date() } });
    }
  } catch (error) {
    // Final image delivery is already durable.  Derivatives are performance
    // conveniences and retryable, not a financial/fulfilment gate.
    console.warn("[IMAGE_DERIVATIVE_RETRYABLE]", error.message);
  }
}

export async function processAuthenticatedImageResult(job, payload) {
  if (!isReconciliationEligibleVariant(job.variant)) return { ignored: true, reason: "RECONCILIATION_INELIGIBLE" };
  if (TERMINAL_VARIANT_STATUSES.has(job.variant?.status)) {
    return { ignored: true, reason: "VARIANT_ALREADY_TERMINAL", status: job.variant.status };
  }
  const model = getImageModel(job.internalModelId);
  if (!model) return markNoDelivery(job, "IMAGE_MODEL_UNAVAILABLE", "The image model is unavailable."), { failed: true };
  const parsed = model.adapter.parseAuthenticatedResult(payload);
  await prisma.providerJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), pollCount: { increment: 1 } } });
  if (!parsed.terminal) return { processing: true };
  if (!parsed.succeeded) { await markNoDelivery(job, "PROVIDER_GENERATION_FAILED", "Image generation failed before delivery."); return { failed: true }; }
  const expected = model.providerCapabilities.output.expectedCount === "REQUESTED_COUNT"
    ? JSON.parse(job.routingSnapshot).imageRequest.requestedOutputCount : model.providerCapabilities.output.expectedCount;
  if (parsed.outputUrls.length !== expected) { await markNoDelivery(job, "IMAGE_OUTPUT_COUNT_INVALID", "The provider returned an incomplete image result."); return { failed: true }; }
  const ownerId = `image-finalize:${crypto.randomUUID()}`;
  if (!await claimFinalization(job.creationVariantId, ownerId)) return { finalization: "IN_PROGRESS" };
  try {
    const variant = await prisma.creationVariant.findUnique({ where: { id: job.creationVariantId }, include: { creation: true } });
    const finals = [];
    for (const [outputIndex, url] of parsed.outputUrls.entries()) {
      const downloaded = await downloadMediaBufferSsrfSafe(url);
      const metadata = await sharp(downloaded.buffer, { failOn: "error" }).metadata();
      const mimeType = MIME_BY_FORMAT[metadata.format];
      if (!mimeType || !ACCEPTED_MIME.has(mimeType) || !metadata.width || !metadata.height) throw new Error("IMAGE_QA_INVALID_MEDIA");
      const storageKey = buildStorageKey("final", [variant.creation.workspaceId, variant.creation.id, `variant_${variant.variantIndex}`, `image_${outputIndex}.${metadata.format === "jpeg" ? "jpg" : metadata.format}`]);
      const stored = await R2StorageService.uploadFile({ storageKey, buffer: downloaded.buffer, contentType: mimeType });
      const artifact = await prisma.generatedArtifact.upsert({ where: { creationVariantId_type_outputIndex: { creationVariantId: variant.id, type: "FINAL_IMAGE", outputIndex } }, create: { workspaceId: variant.creation.workspaceId, creationVariantId: variant.id, type: "FINAL_IMAGE", outputIndex, storageKey, checksumSha256: stored.checksumSha256, mimeType, fileSizeBytes: stored.fileSizeBytes, width: metadata.width, height: metadata.height, validationStatus: "VALID", validationMetadata: JSON.stringify({ sourceProviderUrlHost: new URL(url).hostname }), validatedAt: new Date(), sourceProviderUrlHost: new URL(url).hostname }, update: { storageKey, checksumSha256: stored.checksumSha256, mimeType, fileSizeBytes: stored.fileSizeBytes, width: metadata.width, height: metadata.height, validationStatus: "VALID", validatedAt: new Date() } });
      // Signed retrieval verifies that the delivered original can be retrieved.
      await R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 60 });
      finals.push({ artifact, buffer: downloaded.buffer });
    }
    const actual = muapiCostMicroUsd(payload);
    const quote = JSON.parse(job.routingSnapshot || "{}").quote || {};
    const actualContributionMarginMicroUsd = actual === null ? null : (BigInt(quote.totalCredits || 0) * PRICING_REVISION.netRevenuePerCreditFloorMicroUsd) - actual - BigInt(quote.internalCostReserveMicroUsd || 0);
    await prisma.$transaction([
      prisma.providerJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", completedAt: new Date(), actualCostMicroUsd: actual, actualContributionMarginMicroUsd, providerBillingStatus: actual === null ? "ESTIMATED" : "BILLED", sanitizedResultPayload: sanitizeResult(payload) } }),
      prisma.creationVariant.update({ where: { id: variant.id }, data: { status: "COMPLETED", currentStage: "delivery", completedAt: new Date(), progressValue: 100, finalArtifactId: finals[0].artifact.id, finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } }),
    ]);
    await CreditEscrowService.settleVerifiedVariant(variant.id, true);
    await updateImageCreation(variant.creationId);
    await Promise.all(finals.map(({ buffer }, outputIndex) => createDerivatives({ original: { buffer }, workspaceId: variant.creation.workspaceId, creationId: variant.creation.id, variantId: variant.id, outputIndex })));
    return { completed: true, artifactCount: finals.length };
  } catch (error) {
    await prisma.creationVariant.updateMany({ where: { id: job.creationVariantId, finalizationLeaseId: ownerId }, data: { status: "PROCESSING", currentStage: "result_processing_retry", errorCode: "IMAGE_FINALIZATION_RETRYABLE", safeError: "Image delivery is being recovered.", finalizationLeaseId: null, finalizationClaimedAt: null, finalizationLeaseExpiresAt: null } });
    throw error;
  }
}
