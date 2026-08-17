import { parseUsdToMicroUsdConservatively } from "./execution/muapiExecutor.js";
import { calculateRequiredCredits as calculateLegacyEntitlementCredits } from "../entitlements/pricing.js";

export { parseUsdToMicroUsdConservatively };

/**
 * Authoritative Commercial Cost Registry & MicroUSD / Credit Calculation.
 * Section 11, 21 Compliance.
 */

const BASE_SYSTEM_PRICING_REVISION = "MODEL_PLATFORM_PRICING_V1";
const MINIMUM_CREATION_CREDIT_FLOOR = 1;

/**
 * Delegates to Doolphin Commercial Pricing Engine (src/lib/entitlements/pricing.js).
 */
export function calculateRequiredCredits(costComponents = {}) {
  let totalCostMicroUsd = 0n;
  const formattedComponents = {};

  for (const [key, val] of Object.entries(costComponents)) {
    let bVal = 0n;
    if (typeof val === "bigint") {
      bVal = val;
    } else {
      bVal = parseUsdToMicroUsdConservatively(val);
    }
    totalCostMicroUsd += bVal;
    formattedComponents[key] = bVal.toString();
  }

  const legacyQuote = calculateLegacyEntitlementCredits({ total: totalCostMicroUsd });

  return {
    pricingRevisionId: legacyQuote.pricingRevisionId || BASE_SYSTEM_PRICING_REVISION,
    fullyLoadedCostMicroUsd: totalCostMicroUsd,
    quotedCredits: Number(legacyQuote.quotedCredits),
    totalCredits: Number(legacyQuote.quotedCredits),
    costComponents: formattedComponents,
  };
}

/**
 * Studio/Workflow-Level Multi-Output Pricing Layer.
 * Aggregates raw microUSD costs across multiple provider outputs (outputCount) BEFORE credit rounding.
 * Generates an authoritative settlement schedule for partial success (0..N outputs).
 */
export function calculateWorkflowCommercialQuote({
  preparedUnitPlan,
  outputCount = 1,
  perOutputCosts = {},
  perCreationCosts = {},
} = {}) {
  const count = Math.max(1, Math.floor(Number(outputCount) || 1));
  const unitProviderCost = BigInt(
    preparedUnitPlan?.pricing?.providerCostMicroUsd ||
    preparedUnitPlan?.unitPricing?.providerCostMicroUsd ||
    preparedUnitPlan?.providerCostMicroUsd ||
    preparedUnitPlan?.costComponents?.providerGeneration ||
    "0"
  );

  const totalProviderCost = unitProviderCost * BigInt(count);

  let totalVariablePerOutput = 0n;
  if (preparedUnitPlan?.businessPolicy?.variableInfraCostMicroUsd) {
    totalVariablePerOutput += BigInt(preparedUnitPlan.businessPolicy.variableInfraCostMicroUsd);
  }
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

  const settlementSchedule = { 0: 0 };
  for (let k = 1; k <= count; k += 1) {
    if (k === count) {
      settlementSchedule[k] = Number(creditResult.quotedCredits);
    } else {
      const kComponents = {
        providerGeneration: unitProviderCost * BigInt(k),
        variableInfra: (totalVariablePerOutput * BigInt(k)) + totalVariablePerCreation,
      };
      const kResult = calculateRequiredCredits(kComponents);
      settlementSchedule[k] = Math.min(Number(creditResult.quotedCredits), Number(kResult.quotedCredits));
    }
  }

  return {
    priced: true,
    outputCount: count,
    providerCostMicroUsd: totalProviderCost.toString(),
    unitProviderCostMicroUsd: unitProviderCost.toString(),
    totalProviderCostMicroUsd: totalProviderCost.toString(),
    fullyLoadedCostMicroUsd: creditResult.fullyLoadedCostMicroUsd.toString(),
    quotedCredits: Number(creditResult.quotedCredits),
    totalCredits: Number(creditResult.quotedCredits),
    pricingRevisionId: creditResult.pricingRevisionId,
    costComponents: Object.fromEntries(
      Object.entries(aggregatedCostComponents).map(([k, v]) => [k, v.toString()])
    ),
    settlementSchedule,
  };
}

export function calculateCommercialCreditQuote(args = {}) {
  if (args.preparedUnitPlan) {
    return calculateWorkflowCommercialQuote(args);
  }
  if (
    args.providerCostUsd !== undefined ||
    args.providerCostMicroUsd !== undefined ||
    args.providerGeneration !== undefined ||
    args.variableInfraCostMicroUsd !== undefined ||
    args.variableInfra !== undefined
  ) {
    const providerGen =
      args.providerGeneration ??
      (args.providerCostMicroUsd !== undefined
        ? BigInt(args.providerCostMicroUsd)
        : parseUsdToMicroUsdConservatively(args.providerCostUsd || 0));
    const varInfra =
      args.variableInfra ??
      (args.variableInfraCostMicroUsd !== undefined
        ? BigInt(args.variableInfraCostMicroUsd)
        : 0n);
    const req = calculateRequiredCredits({
      providerGeneration: providerGen,
      variableInfra: varInfra,
    });
    return {
      priced: true,
      providerCostMicroUsd: providerGen.toString(),
      fullyLoadedCostMicroUsd: req.fullyLoadedCostMicroUsd.toString(),
      quotedCredits: Number(req.quotedCredits),
      totalCredits: Number(req.quotedCredits),
      pricingRevisionId: req.pricingRevisionId,
      costComponents: req.costComponents,
    };
  }
  return calculateRequiredCredits(args);
}
