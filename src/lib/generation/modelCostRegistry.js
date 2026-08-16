import { calculateRequiredCredits, PRICING_REVISION } from "../entitlements/pricing.js";

// This registry is deliberately separate from the capability registry. A model
// being technically reachable is never evidence that it is safe to sell.
// Values in this file must be traceable to an approved provider price source.
export const MODEL_COST_REGISTRY_REVISION = "2026-08-13-launch-safety-v1";

const COST_CONFIGURATIONS = Object.freeze({
  "muapi.seedance2.omni-reference-fast": Object.freeze({
    modelId: "muapi.seedance2.omni-reference-fast",
    status: "PRICED",
    reason: null,
    source: "MuAPI Seedance 2 Omni Reference Fast verified pricing (2026-08-13)",
    costComponents: (request) => {
      const duration = Number(request?.settings?.durationSeconds || 5);
      const outputCount = Number(request?.settings?.outputCount || 1);
      const providerGeneration = BigInt(duration * 48_380 * outputCount);
      const inputAnalysis = 10_000n;
      const verification = 5_000n;
      const composition = 5_000n;
      return { providerGeneration, inputAnalysis, verification, composition };
    },
  }),
});

function toPublicComponents(components) {
  return Object.fromEntries(Object.entries(components).map(([key, value]) => [key, value.toString()]));
}

/**
 * Returns an immutable server calculation for a validated request. Unknown or
 * incomplete cost data is intentionally not estimated: callers must fail
 * closed before reservation or provider submission.
 */
export function calculateAuthoritativeGenerationQuote(request, model) {
  const entry = COST_CONFIGURATIONS[model?.id];
  if (!entry || entry.status !== "PRICED") {
    return {
      priced: false,
      code: "GENERATION_CONFIGURATION_UNPRICED",
      reason: entry?.reason || `No approved cost configuration exists for '${model?.id || "unknown"}'.`,
      registryRevision: MODEL_COST_REGISTRY_REVISION,
      modelId: model?.id || null,
    };
  }

  // A PRICED entry must supply all directly attributable costs as functions of
  // the normalized request. Do not silently default a missing component to 0.
  const components = entry.costComponents(request);
  const requiredComponents = ["providerGeneration", "inputAnalysis", "verification", "composition"];
  if (requiredComponents.some((name) => typeof components[name] !== "bigint" || components[name] < 0n)) {
    return {
      priced: false,
      code: "GENERATION_CONFIGURATION_UNPRICED",
      reason: `Approved cost data for '${model.id}' is incomplete.`,
      registryRevision: MODEL_COST_REGISTRY_REVISION,
      modelId: model.id,
    };
  }
  const creditQuote = calculateRequiredCredits(components);
  const conservativeNetRevenueMicroUsd = creditQuote.quotedCredits * PRICING_REVISION.netRevenuePerCreditFloorMicroUsd;
  const contributionMicroUsd = conservativeNetRevenueMicroUsd - creditQuote.fullyLoadedCostMicroUsd;
  const contributionMarginBps = conservativeNetRevenueMicroUsd === 0n
    ? 0
    : Number((contributionMicroUsd * 10_000n) / conservativeNetRevenueMicroUsd);
  if (contributionMarginBps < PRICING_REVISION.targetContributionMarginBps) {
    return {
      priced: false,
      code: "GENERATION_CONFIGURATION_UNPRICED",
      reason: `Approved cost data for '${model.id}' does not meet the minimum contribution-margin guardrail.`,
      registryRevision: MODEL_COST_REGISTRY_REVISION,
      modelId: model.id,
    };
  }
  return {
    priced: true,
    registryRevision: MODEL_COST_REGISTRY_REVISION,
    modelId: model.id,
    source: entry.source,
    components: toPublicComponents(components),
    fullyLoadedCostMicroUsd: creditQuote.fullyLoadedCostMicroUsd.toString(),
    rawRequiredCredits: creditQuote.rawCredits.toString(),
    totalCredits: Number(creditQuote.quotedCredits),
    conservativeNetRevenueMicroUsd: conservativeNetRevenueMicroUsd.toString(),
    contributionMicroUsd: contributionMicroUsd.toString(),
    contributionMarginBps,
    pricingRevisionId: creditQuote.pricingRevisionId,
  };
}

export function getReachableGenerationCostConfigurations() {
  return Object.values(COST_CONFIGURATIONS).map(({ modelId, status, reason, source }) => ({ modelId, status, reason, source }));
}
