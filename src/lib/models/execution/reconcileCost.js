/**
 * Pure Cost Reconciliation Engine.
 * Compares preflight estimated cost versus provider-reported actual cost.
 *
 * Terminal State Rule:
 * - Cost reconciliation is ONLY finalized when provider enters a TERMINAL state:
 *   COMPLETED, FAILED, CANCELLED.
 * - Non-terminal states (QUEUED, PENDING, PROCESSING) return IN_FLIGHT_NON_TERMINAL
 *   without prematurely finalizing actual-cost or refund reconciliations.
 *
 * Classifications:
 * - IN_FLIGHT_NON_TERMINAL: Job is still in-flight (queued/pending/processing).
 * - EXACT: Estimated cost matches actual cost exactly.
 * - UNDER_ESTIMATE: Actual cost exceeds estimated cost.
 * - OVER_ESTIMATE: Actual cost is lower than estimated cost (preserves bonusCreditsUsed).
 * - REFUNDED: Provider explicitly reported a refund.
 * - ACTUAL_COST_UNAVAILABLE: MU API did not supply actual cost metadata upon terminal completion.
 */

export function reconcileExecutionCost({ preparedPlan, normalizedResult } = {}) {
  const status = normalizedResult?.status ? String(normalizedResult.status).toUpperCase() : "PENDING";
  const estimatedCostStr = preparedPlan?.pricing?.providerCostMicroUsd;
  const estimatedCostMicroUsd = estimatedCostStr ? BigInt(estimatedCostStr) : null;

  // Non-Terminal In-Flight Check
  const isTerminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
  if (!isTerminal) {
    return {
      classification: "IN_FLIGHT_NON_TERMINAL",
      status,
      estimatedCostMicroUsd: estimatedCostMicroUsd !== null ? estimatedCostMicroUsd.toString() : null,
      actualCostMicroUsd: null,
      varianceMicroUsd: null,
      variancePercentage: null,
      isFinalized: false,
      requiresAudit: false,
    };
  }

  // Explicit Provider Refund Check
  if (normalizedResult?.refundState === "REFUNDED" || normalizedResult?.isRefunded) {
    return {
      classification: "REFUNDED",
      status,
      estimatedCostMicroUsd: estimatedCostMicroUsd !== null ? estimatedCostMicroUsd.toString() : null,
      actualCostMicroUsd: normalizedResult?.actualCostMicroUsd || null,
      varianceMicroUsd: "0",
      variancePercentage: 0,
      isFinalized: true,
      requiresAudit: true,
    };
  }

  const actualCostStr = normalizedResult?.actualCostMicroUsd;
  if (!actualCostStr) {
    return {
      classification: "ACTUAL_COST_UNAVAILABLE",
      status,
      estimatedCostMicroUsd: estimatedCostMicroUsd !== null ? estimatedCostMicroUsd.toString() : null,
      actualCostMicroUsd: null,
      varianceMicroUsd: null,
      variancePercentage: null,
      isFinalized: true,
      requiresAudit: false,
    };
  }

  const actualCostMicroUsd = BigInt(actualCostStr);

  if (estimatedCostMicroUsd === null) {
    return {
      classification: "ACTUAL_COST_UNAVAILABLE",
      status,
      estimatedCostMicroUsd: null,
      actualCostMicroUsd: actualCostMicroUsd.toString(),
      varianceMicroUsd: null,
      variancePercentage: null,
      isFinalized: true,
      requiresAudit: true,
    };
  }

  const varianceMicroUsd = actualCostMicroUsd - estimatedCostMicroUsd;

  if (varianceMicroUsd === 0n) {
    return {
      classification: "EXACT",
      status,
      estimatedCostMicroUsd: estimatedCostMicroUsd.toString(),
      actualCostMicroUsd: actualCostMicroUsd.toString(),
      varianceMicroUsd: "0",
      variancePercentage: 0,
      isFinalized: true,
      requiresAudit: false,
    };
  }

  const estimatedNum = Number(estimatedCostMicroUsd);
  const varianceNum = Number(varianceMicroUsd);
  const variancePercentage = estimatedNum > 0 ? (varianceNum / estimatedNum) * 100 : 0;

  if (varianceMicroUsd > 0n) {
    return {
      classification: "UNDER_ESTIMATE",
      status,
      estimatedCostMicroUsd: estimatedCostMicroUsd.toString(),
      actualCostMicroUsd: actualCostMicroUsd.toString(),
      varianceMicroUsd: varianceMicroUsd.toString(),
      variancePercentage: Math.round(variancePercentage * 100) / 100,
      isFinalized: true,
      requiresAudit: variancePercentage > 10,
    };
  }

  return {
    classification: "OVER_ESTIMATE",
    status,
    estimatedCostMicroUsd: estimatedCostMicroUsd.toString(),
    actualCostMicroUsd: actualCostMicroUsd.toString(),
    varianceMicroUsd: varianceMicroUsd.toString(),
    variancePercentage: Math.round(variancePercentage * 100) / 100,
    bonusCreditsUsed: (normalizedResult?.bonusCreditsUsed || 0) > 0,
    isFinalized: true,
    requiresAudit: false,
  };
}
