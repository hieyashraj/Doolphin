import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAndValidateGenerationRequest } from "@/lib/generation/contract";
import { compileCanonicalPrompt } from "@/lib/generation/promptCompiler";
import { getProviderAdapter } from "@/lib/adapters";
import { buildMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { claimProviderSubmission, clearSubmissionLease, newSubmissionOwner, submissionOwnerWhere } from "@/lib/generation/providerSubmissionLease";
import { replayFinalization } from "@/lib/generation/qualityPipeline";
import { isStagingEnvironment } from "@/lib/generation-models/types";
import { isReconciliationEligibleVariant, reconciliationEligibleVariantWhere } from "@/lib/generation/reconciliationEligibility";
import { getImageModel } from "@/lib/generation-models/imageRegistry";
import { fetchAuthenticatedMuapiResult } from "@/lib/generation/muapiResult";
import { processAuthenticatedImageResult } from "@/lib/generation/imagePipeline";
import { getMuapiApiKey } from "@/lib/generation/muapiCredentials";

export const maxDuration = 300;

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && req.headers.get("authorization") === `Bearer ${expected}`);
}

function providerUrl(asset, baseUrl) {
  if (asset.role === "ACTOR_REFERENCE") return new URL(asset.url, `${baseUrl.replace(/\/$/, "")}/`).toString();
  return R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 3600 });
}

async function updateTimedOutCreation(creationId) {
  const variants = await prisma.creationVariant.findMany({ where: { creationId }, select: { status: true, errorCode: true } });
  const active = variants.some((variant) => ["QUEUED", "PROCESSING"].includes(variant.status));
  if (active) return;
  const completed = variants.filter((variant) => variant.status === "COMPLETED").length;
  const quarantined = variants.some((variant) => variant.status === "QUARANTINED");
  const failed = variants.find((variant) => ["FAILED", "TIMED_OUT", "CANCELLED"].includes(variant.status));
  const status = completed ? "PARTIAL_COMPLETED" : quarantined ? "QUARANTINED" : failed ? "FAILED" : "TIMED_OUT";
  const errorCode = failed?.errorCode || (status === "TIMED_OUT" ? "WORKFLOW_TIMEOUT" : null);
  await prisma.creation.update({ where: { id: creationId }, data: { status, completedAt: new Date(), currentStage: status === "PARTIAL_COMPLETED" ? "delivery" : "quality_verification", progressValue: variants.length ? completed / variants.length * 100 : 0, errorCode, safeError: errorCode ? userFacingGenerationMessage(status, errorCode) : null } });
}

async function refreshCreationAfterRecovery(creationId) {
  const variants = await prisma.creationVariant.findMany({ where: { creationId }, select: { status: true } });
  if (!variants.length || variants.some((variant) => ["QUEUED", "PROCESSING"].includes(variant.status))) return;
  const completed = variants.filter((variant) => variant.status === "COMPLETED").length;
  const status = completed === variants.length ? "COMPLETED" : completed ? "PARTIAL_COMPLETED" : variants.some((variant) => variant.status === "QUARANTINED") ? "QUARANTINED" : "FAILED";
  await prisma.creation.update({ where: { id: creationId }, data: { status, currentStage: status.includes("COMPLETED") ? "delivery" : "quality_verification", completedAt: new Date(), progressValue: completed / variants.length * 100 } });
}

async function recordSubmissionFailure(outbox, error) {
  const providerJobId = JSON.parse(outbox.payload).providerJobId;
  const providerJob = await prisma.providerJob.findUnique({ where: { id: providerJobId }, include: { variant: { select: { reconciliationEngineRevision: true } } } });
  if (!providerJob || !isReconciliationEligibleVariant(providerJob.variant)) return "EXCLUDED_LEGACY";
  if (error.submissionOutcomeUnknown) {
    await prisma.$transaction([
      prisma.providerJob.updateMany({ where: submissionOwnerWhere(providerJobId, error.submissionOwner), data: { status: "SUBMISSION_UNKNOWN", errorCode: "PROVIDER_SUBMISSION_UNKNOWN", safeError: "Provider submission could not be confirmed", submissionLeaseExpiresAt: new Date() } }),
      prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 }, lastError: "Submission outcome is ambiguous; provider reconciliation required" } }),
    ]);
    return "AMBIGUOUS_STOPPED";
  }
  if (error.knownRejected) {
    const job = providerJob;
    if (!job) return "JOB_MISSING";
    await CreditEscrowService.releaseVariantReservations(job.creationVariantId, "PROVIDER_SUBMISSION_REJECTED");
    await prisma.$transaction([
      prisma.providerJob.updateMany({ where: submissionOwnerWhere(providerJobId, error.submissionOwner), data: { status: "FAILED", completedAt: new Date(), errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: "Provider rejected submission", ...clearSubmissionLease() } }),
      prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_SUBMISSION_REJECTED") } }),
      prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 }, lastError: error.message } }),
    ]);
    return "FAILED_REFUNDED";
  }
  const attemptCount = outbox.attemptCount + 1;
  if (attemptCount < 3) {
    await prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "FAILED", attemptCount, nextAttemptAt: new Date(Date.now() + 60_000), lastError: error.message } });
    return "RETRY_SCHEDULED";
  }
  const job = providerJob;
  if (!job) return "JOB_MISSING";
  await CreditEscrowService.releaseVariantReservations(job.creationVariantId, "PROVIDER_SUBMISSION_UNAVAILABLE");
  await prisma.$transaction([
    prisma.providerJob.update({ where: { id: job.id }, data: { status: "FAILED", completedAt: new Date(), errorCode: "PROVIDER_SUBMISSION_UNAVAILABLE", safeError: "Provider submission was unavailable after retries" } }),
    prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_UNAVAILABLE", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_SUBMISSION_UNAVAILABLE") } }),
    prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DEAD_LETTER", attemptCount, lastError: error.message } }),
  ]);
  const variant = await prisma.creationVariant.findUnique({ where: { id: job.creationVariantId }, select: { creationId: true } });
  if (variant) await updateTimedOutCreation(variant.creationId);
  return "FAILED_REFUNDED";
}

async function submitPrepared(outbox, baseUrl) {
  const body = JSON.parse(outbox.payload);
  const job = await prisma.providerJob.findUnique({ where: { id: body.providerJobId }, include: { variant: { include: { creation: true } } } });
  if (!job) return "SKIPPED";
  if (!isReconciliationEligibleVariant(job.variant)) return "EXCLUDED_LEGACY";
  if (["QUEUED", "PROCESSING", "SUCCEEDED"].includes(job.status)) {
    await prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DISPATCHED" } });
    return "ALREADY_SUBMITTED";
  }
  const submissionOwner = newSubmissionOwner("reconcile");
  const claim = await claimProviderSubmission({ prisma, providerJobId: job.id, ownerId: submissionOwner });
  if (!claim.claimed) {
    if (claim.state === "ALREADY_SUBMITTED") {
      await prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DISPATCHED" } });
      return "ALREADY_SUBMITTED";
    }
    if (claim.state === "CLAIMED_BY_OTHER") return "CLAIMED_BY_OTHER";
    if (claim.state === "SUBMISSION_UNKNOWN") {
      await prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DEAD_LETTER", lastError: "Submission lease expired; provider reconciliation required" } });
      return "AMBIGUOUS_STOPPED";
    }
    await prisma.$transaction([
      prisma.providerJob.updateMany({ where: { id: job.id, status: "PREPARED" }, data: { status: "SUBMISSION_UNKNOWN", errorCode: "SUBMISSION_AMBIGUOUS", safeError: "Automatic retry stopped to prevent duplicate billing" } }),
      prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DEAD_LETTER", lastError: "Submission state is ambiguous; manual reconciliation required" } })
    ]);
    return "AMBIGUOUS_STOPPED";
  }
  const quote = await prisma.preflightQuote.findUnique({ where: { id: body.quoteId } });
  if (!quote) throw new Error("Preflight snapshot missing");
  const validation = normalizeAndValidateGenerationRequest(JSON.parse(quote.requestSnapshot));
  if (!validation.valid) throw new Error("Immutable request failed revalidation");
  const request = validation.request;
  for (const asset of request.assets) asset.url = await providerUrl(asset, baseUrl);
  const compiled = compileCanonicalPrompt(request);
  const webhookUrl = buildMuapiWebhookUrl(baseUrl);
  const payload = getProviderAdapter("seedance-2").formatPayload({ prompt: compiled.compiledPrompt, settings: { duration: request.settings.durationSeconds, resolution: request.settings.resolution, aspect_ratio: request.settings.aspectRatio }, images: compiled.imageUrls, webhookUrl });
  let response;
  try {
    response = await fetch(job.endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": getMuapiApiKey() }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  } catch (cause) {
    const error = new Error("Provider submission could not be confirmed");
    error.submissionOutcomeUnknown = true;
    error.submissionOwner = submissionOwner;
    error.cause = cause;
    throw error;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.request_id) {
    // A parsed provider HTTP response is an explicit rejection, unlike a
    // network timeout where the provider may have accepted a paid request.
    const error = new Error(`Provider submission was rejected (${response.status})`);
    error.knownRejected = true;
    error.submissionOwner = submissionOwner;
    throw error;
  }
  await prisma.$transaction([
    prisma.providerJob.updateMany({ where: submissionOwnerWhere(job.id, submissionOwner), data: { status: "QUEUED", providerRequestId: result.request_id, submittedAt: new Date(), acceptedAt: new Date(), sanitizedInitialResponse: JSON.stringify({ request_id: result.request_id, status: result.status || "processing" }), ...clearSubmissionLease() } }),
    prisma.creationVariant.update({ where: { id: job.creationVariantId }, data: { status: "PROCESSING", currentStage: "provider_generation" } }),
    prisma.creation.update({ where: { id: job.variant.creationId }, data: { status: "PROCESSING", currentStage: "provider_generation" } }),
    prisma.queueOutbox.update({ where: { id: outbox.id }, data: { status: "DISPATCHED" } })
  ]);
  return "SUBMITTED";
}

async function pollJob(job, webhookUrl) {
  const response = await fetch(`https://api.muapi.ai/api/v1/predictions/${encodeURIComponent(job.providerRequestId)}/result`, { headers: { "x-api-key": getMuapiApiKey() }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) return "POLL_FAILED";
  const payload = await response.json();
  await prisma.providerJob.update({ where: { id: job.id }, data: { lastCheckedAt: new Date(), pollCount: { increment: 1 } } });
  const status = String(payload.status || "").toLowerCase();
  if (["completed", "failed", "error", "cancelled", "canceled"].includes(status) || payload.error) {
    const callback = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, request_id: payload.request_id || job.providerRequestId }), signal: AbortSignal.timeout(120000) });
    if (!callback.ok) throw new Error(`Internal callback processing failed (${callback.status})`);
    return "RECONCILED";
  }
  await prisma.providerJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
  return "ACTIVE";
}

async function pollImageJob(job) {
  const payload = await fetchAuthenticatedMuapiResult(job.providerRequestId);
  return processAuthenticatedImageResult(job, payload);
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req) {
  // Reconciliation may reserve/release/settle durable state. It is staging
  // only, server-to-server only, and never trusts caller-controlled input to
  // choose its environment.
  if (!isStagingEnvironment()) return NextResponse.json({ error: "Unavailable" }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { getMuapiApiKey(); } catch { return NextResponse.json({ error: "Sandbox provider credential required" }, { status: 503 }); }
  // WEBHOOK_URL is the explicit provider/reconciliation callback base. Do not
  // couple new staging infrastructure to legacy NextAuth compatibility URLs.
  const baseUrl = process.env.WEBHOOK_URL;
  if (!baseUrl?.startsWith("https://")) return NextResponse.json({ error: "Public HTTPS base URL required" }, { status: 503 });
  const now = new Date();
  const actions = [];
  // QueueOutbox predates a relational variant key. Resolve the durable,
  // server-owned variant revision before selecting work; legacy aggregate IDs
  // never reach a provider-submission handler.
  const eligibleVariants = await prisma.creationVariant.findMany({ where: reconciliationEligibleVariantWhere(), select: { id: true } });
  const eligibleVariantIds = eligibleVariants.map((variant) => variant.id);
  const pending = eligibleVariantIds.length ? await prisma.queueOutbox.findMany({ where: { aggregateId: { in: eligibleVariantIds }, eventType: "SUBMIT_MUAPI_SEEDANCE", OR: [{ status: "PENDING" }, { status: "FAILED", nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 10 }) : [];
  for (const outbox of pending) {
    try { actions.push({ outboxId: outbox.id, result: await submitPrepared(outbox, baseUrl) }); }
    catch (error) {
      actions.push({ outboxId: outbox.id, result: await recordSubmissionFailure(outbox, error) });
    }
  }

  const activeJobs = await prisma.providerJob.findMany({ where: { variant: { is: { ...reconciliationEligibleVariantWhere(), status: { in: ["QUEUED", "PROCESSING"] } } }, status: { in: ["QUEUED", "PROCESSING"] }, providerRequestId: { not: null }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 30_000) } }] }, take: 20 });
  // A no-op reconciliation must not require callback credentials. Construct
  // the callback filter only when an eligible provider result can need it.
  const webhookUrl = activeJobs.some((job) => !getImageModel(job.internalModelId)) ? buildMuapiWebhookUrl(baseUrl) : null;
  for (const job of activeJobs) {
    try { actions.push({ providerJobId: job.id, result: getImageModel(job.internalModelId) ? await pollImageJob(await prisma.providerJob.findUnique({ where: { id: job.id }, include: { variant: { include: { creation: true } } } })) : await pollJob(job, webhookUrl) }); }
    catch (error) { actions.push({ providerJobId: job.id, result: "POLL_FAILED", error: error.message }); }
  }

  // A webhook may have completed both verification jobs immediately before a
  // worker died during final R2/DB/settlement. Replay from persisted evidence;
  // no provider request is sent and the finalization lease admits one worker.
  const finalizationRetries = await prisma.creationVariant.findMany({
    where: { ...reconciliationEligibleVariantWhere(), status: "PROCESSING", currentStage: { in: ["delivery_retry", "delivery_finalizing"] } },
    select: { id: true, creationId: true }, take: 20,
  });
  for (const variant of finalizationRetries) {
    try {
      const result = await replayFinalization(variant.id);
      if (result.completed || result.quarantined) await refreshCreationAfterRecovery(variant.creationId);
      actions.push({ variantId: variant.id, result });
    }
    catch (error) { actions.push({ variantId: variant.id, result: "FINALIZATION_RETRY_FAILED", error: error.message }); }
  }

  const timedOut = await prisma.creationVariant.findMany({ where: { ...reconciliationEligibleVariantWhere(), status: { in: ["QUEUED", "PROCESSING"] }, timeoutAt: { lt: now } } });
  for (const variant of timedOut) {
    await CreditEscrowService.releaseVariantReservations(variant.id, "WORKFLOW_TIMEOUT");
    await prisma.providerJob.updateMany({ where: { creationVariantId: variant.id, status: { in: ["PREPARED", "QUEUED", "PROCESSING"] } }, data: { status: "TIMED_OUT", errorCode: "WORKFLOW_TIMEOUT", safeError: "Workflow timed out before completion." } });
    await prisma.creationVariant.update({ where: { id: variant.id }, data: { status: "TIMED_OUT", errorCode: "WORKFLOW_TIMEOUT", safeError: userFacingGenerationMessage("TIMED_OUT", "WORKFLOW_TIMEOUT") } });
    await updateTimedOutCreation(variant.creationId);
    actions.push({ variantId: variant.id, result: "TIMED_OUT" });
  }
  return NextResponse.json({ success: true, actions });
}
