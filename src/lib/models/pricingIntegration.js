import { calculateRequiredCredits, PRICING_REVISION } from "../entitlements/pricing.js";

/**
 * Bridges MU API provider cost estimates with Doolphin's commercial pricing engine (pricing.js).
 * Preserves all commercial invariants including:
 * - maxFullyLoadedCostPerCreditMicroUsd (21,000 microUSD = $0.021/credit)
 * - 5-credit step rounding via quotedCredits calculation
 * - Fail closed behavior on unpriced or negative inputs
 */

export function calculateCommercialCreditQuote({
  providerCostUsd,
  providerCostMicroUsd,
  variableInfraCostMicroUsd = 0n,
  additionalComponentCosts = {},
} = {}) {
  let providerCost = 0n;
  if (typeof providerCostMicroUsd === "bigint") {
    providerCost = providerCostMicroUsd;
  } else if (typeof providerCostUsd === "number" && providerCostUsd >= 0) {
    providerCost = BigInt(Math.round(providerCostUsd * 1_000_000));
  } else {
    return {
      priced: false,
      code: "PRICING_UNAVAILABLE",
      reason: "Invalid or negative provider cost supplied for commercial quote calculation.",
    };
  }

  const infraCost = typeof variableInfraCostMicroUsd === "bigint" ? variableInfraCostMicroUsd : 0n;

  const costComponents = {
    providerGeneration: providerCost,
    variableInfra: infraCost,
    ...additionalComponentCosts,
  };

  const creditResult = calculateRequiredCredits(costComponents);

  const conservativeNetRevenueMicroUsd = creditResult.quotedCredits * PRICING_REVISION.netRevenuePerCreditFloorMicroUsd;
  const contributionMicroUsd = conservativeNetRevenueMicroUsd - creditResult.fullyLoadedCostMicroUsd;
  const contributionMarginBps = conservativeNetRevenueMicroUsd === 0n
    ? 0
    : Number((contributionMicroUsd * 10_000n) / conservativeNetRevenueMicroUsd);

  return {
    priced: true,
    providerCostMicroUsd: providerCost.toString(),
    fullyLoadedCostMicroUsd: creditResult.fullyLoadedCostMicroUsd.toString(),
    rawRequiredCredits: creditResult.rawCredits.toString(),
    totalCredits: Number(creditResult.quotedCredits),
    pricingRevisionId: creditResult.pricingRevisionId,
    contributionMarginBps,
    costComponents: Object.fromEntries(
      Object.entries(costComponents).map(([key, val]) => [key, val.toString()])
    ),
  };
}
