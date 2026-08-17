import { calculateRequiredCredits, PRICING_REVISION } from "../entitlements/pricing.js";
import { ERROR_CODES } from "./errors.js";

/**
 * Deterministic USD -> microUSD Conservative Conversion.
 * Converts string or numeric USD values to integer microUSD (BigInt) without binary floating-point undercharge.
 * Conservative Rounding Rule: If sub-microUSD digits exist (past 6 decimal places), rounds UP by +1 microUSD.
 */
export function parseUsdToMicroUsdConservatively(usdInput) {
  if (typeof usdInput === "bigint") return usdInput;
  if (usdInput === null || usdInput === undefined) return 0n;

  const strVal = typeof usdInput === "number" ? usdInput.toString() : String(usdInput).trim();
  const numVal = Number(strVal);
  if (isNaN(numVal) || numVal < 0) {
    throw new Error(`Invalid USD cost '${usdInput}'`);
  }

  const parts = strVal.split(".");
  const dollars = BigInt(parts[0] || "0");
  let fractionStr = (parts[1] || "").substring(0, 6);

  const remainingFraction = (parts[1] || "").substring(6);
  const subMicroUsdRemainder = remainingFraction.replace(/0+$/, "").length > 0;

  fractionStr = fractionStr.padEnd(6, "0");
  let microUsd = dollars * 1_000_000n + BigInt(fractionStr);

  if (subMicroUsdRemainder) {
    microUsd += 1n;
  }

  return microUsd;
}

/**
 * Bridges MU API provider cost estimates with Doolphin's commercial pricing engine (pricing.js).
 */
export function calculateCommercialCreditQuote({
  providerCostUsd,
  providerCostMicroUsd,
  variableInfraCostMicroUsd = 0n,
  additionalComponentCosts = {},
} = {}) {
  let providerCost = 0n;
  try {
    if (typeof providerCostMicroUsd === "bigint") {
      providerCost = providerCostMicroUsd;
    } else if (providerCostMicroUsd !== undefined && providerCostMicroUsd !== null) {
      providerCost = BigInt(providerCostMicroUsd.toString());
    } else {
      providerCost = parseUsdToMicroUsdConservatively(providerCostUsd);
    }
  } catch (err) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: `Invalid provider cost supplied: ${err.message}`,
    };
  }

  const infraCost = typeof variableInfraCostMicroUsd === "bigint"
    ? variableInfraCostMicroUsd
    : parseUsdToMicroUsdConservatively(variableInfraCostMicroUsd);

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

/**
 * Studio/Workflow-Level Multi-Output Pricing Layer.
 * Aggregates raw microUSD costs across multiple provider outputs (outputCount) BEFORE credit rounding.
 */
export function calculateWorkflowCommercialQuote({
  preparedUnitPlan,
  outputCount = 1,
  perOutputCosts = {},
  perCreationCosts = {},
} = {}) {
  const count = Math.max(1, Math.floor(Number(outputCount) || 1));
  const unitProviderCost = BigInt(preparedUnitPlan?.pricing?.providerCostMicroUsd || "0");

  const totalProviderCost = unitProviderCost * BigInt(count);

  let totalVariablePerOutput = 0n;
  for (const val of Object.values(perOutputCosts)) {
    totalVariablePerOutput += parseUsdToMicroUsdConservatively(val);
  }

  let totalVariablePerCreation = 0n;
  for (const val of Object.values(perCreationCosts)) {
    totalVariablePerCreation += parseUsdToMicroUsdConservatively(val);
  }

  const aggregatedCostComponents = {
    providerGeneration: totalProviderCost,
    variableInfra: (totalVariablePerOutput * BigInt(count)) + totalVariablePerCreation,
  };

  const creditResult = calculateRequiredCredits(aggregatedCostComponents);

  return {
    priced: true,
    outputCount: count,
    unitProviderCostMicroUsd: unitProviderCost.toString(),
    totalProviderCostMicroUsd: totalProviderCost.toString(),
    fullyLoadedCostMicroUsd: creditResult.fullyLoadedCostMicroUsd.toString(),
    quotedCredits: Number(creditResult.quotedCredits),
    pricingRevisionId: creditResult.pricingRevisionId,
    costComponents: Object.fromEntries(
      Object.entries(aggregatedCostComponents).map(([k, v]) => [k, v.toString()])
    ),
  };
}
