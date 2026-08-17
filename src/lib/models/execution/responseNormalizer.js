import { ModelPlatformError, ERROR_CODES } from "../errors.js";

/**
 * Server-Only MU API Response Normalizer.
 *
 * Lifecycle & Financial Invariants:
 * 1. Preserves exact rawProviderStatus ("queued", "pending", "processing", "completed", "failed", "cancelled").
 * 2. Maps canonical status across all 6 provider states without collapsing them.
 * 3. Preserves financial metadata separately: actualCostUsd, actualCreditsCharged, bonusCreditsUsed, isRefunded.
 * 4. RefundState is set to "REFUNDED" ONLY when provider explicitly reports a refund (never manufactures FAILED_NO_CHARGE).
 */

export function normalizeMuapiResponse(executionResult, preparedPlan) {
  if (!executionResult || !executionResult.rawResponse) {
    throw new ModelPlatformError(
      ERROR_CODES.PROVIDER_RESPONSE_INVALID,
      "Invalid execution result provided for response normalization"
    );
  }

  const raw = executionResult.rawResponse;

  // Extract Provider Request ID
  const providerRequestId =
    raw.request_id || raw.requestId || raw.id || raw.job_id || raw.jobId || null;

  // Extract Raw & Canonical Provider Lifecycle Status
  const rawProviderStatus = String(raw.status || raw.state || "pending").toLowerCase();
  let status = "PENDING";

  if (["queued"].includes(rawProviderStatus)) {
    status = "QUEUED";
  } else if (["pending"].includes(rawProviderStatus)) {
    status = "PENDING";
  } else if (["processing", "generating", "running"].includes(rawProviderStatus)) {
    status = "PROCESSING";
  } else if (["completed", "success", "succeeded", "finished", "done"].includes(rawProviderStatus)) {
    status = "COMPLETED";
  } else if (["failed", "error", "rejected"].includes(rawProviderStatus)) {
    status = "FAILED";
  } else if (["cancelled", "canceled"].includes(rawProviderStatus)) {
    status = "CANCELLED";
  } else if (raw.url || raw.video_url || raw.images || raw.output) {
    status = "COMPLETED";
  }

  // Extract Asset Outputs
  const outputAssets = [];
  if (typeof raw.url === "string") outputAssets.push(raw.url);
  if (typeof raw.video_url === "string") outputAssets.push(raw.video_url);
  if (Array.isArray(raw.images)) {
    raw.images.forEach((img) => {
      if (typeof img === "string") outputAssets.push(img);
      else if (img?.url) outputAssets.push(img.url);
    });
  }
  if (Array.isArray(raw.output)) {
    raw.output.forEach((item) => {
      if (typeof item === "string") outputAssets.push(item);
      else if (item?.url) outputAssets.push(item.url);
    });
  }

  // Financial Metadata Preservation
  const costObj = typeof raw.cost === "object" ? raw.cost : {};
  const actualCostUsd =
    raw.amount_usd !== undefined
      ? Number(raw.amount_usd)
      : raw.cost_usd !== undefined
      ? Number(raw.cost_usd)
      : costObj.amount_usd !== undefined
      ? Number(costObj.amount_usd)
      : raw.actual_cost !== undefined
      ? Number(raw.actual_cost)
      : null;

  const actualCostMicroUsd =
    actualCostUsd !== null && !isNaN(actualCostUsd) && actualCostUsd >= 0
      ? BigInt(Math.round(actualCostUsd * 1_000_000))
      : null;

  const actualCreditsCharged =
    raw.amount_credits !== undefined
      ? Number(raw.amount_credits)
      : raw.credits_charged !== undefined
      ? Number(raw.credits_charged)
      : costObj.amount_credits !== undefined
      ? Number(costObj.amount_credits)
      : null;

  const bonusCreditsUsed =
    raw.bonus_credits_used !== undefined
      ? Number(raw.bonus_credits_used)
      : costObj.bonus_credits_used !== undefined
      ? Number(costObj.bonus_credits_used)
      : 0;

  // Strict Refund Extraction (No Manufactured FAILED_NO_CHARGE)
  const isRefunded = Boolean(raw.refunded || costObj.refunded || rawProviderStatus === "refunded");
  const refundState = isRefunded ? "REFUNDED" : "NONE";

  return {
    canonicalModelId: preparedPlan?.canonicalModelId || executionResult.dispatchedPlan?.canonicalModelId || null,
    providerModelId: preparedPlan?.providerModelId || executionResult.dispatchedPlan?.providerModelId || null,
    providerRequestId,
    rawProviderStatus,
    status,
    outputAssets,
    actualCostUsd,
    actualCostMicroUsd: actualCostMicroUsd !== null ? actualCostMicroUsd.toString() : null,
    actualCreditsCharged,
    bonusCreditsUsed,
    isRefunded,
    refundState,
    error: status === "FAILED" || status === "CANCELLED" ? raw.error || raw.message || `Provider generation ${status.toLowerCase()}` : null,
    providerPayloadHash: preparedPlan?.providerPayloadHash || executionResult.dispatchedPlan?.providerPayloadHash || null,
    providerSpecHash: preparedPlan?.providerSpecHash || executionResult.dispatchedPlan?.providerSpecHash || null,
    rawResponse: raw,
  };
}
