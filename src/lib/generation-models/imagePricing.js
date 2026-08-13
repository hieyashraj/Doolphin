import { calculateRequiredCredits, PRICING_REVISION } from "../entitlements/pricing.js";

export const IMAGE_PRICING_REVISION = "2026-08-13-image-sandbox-estimates-v1";
export const INTERNAL_IMAGE_DELIVERY_RESERVE_MICRO_USD = 10_000n;

// Exact MuAPI sandbox estimate-cost evidence, checked 2026-08-13.  A missing
// lookup is intentionally an unavailable configuration, never a guessed rate.
const FIXED = Object.freeze({
  "muapi.gpt-image-2-i2i": 60_000n,
  "muapi.gpt-image-2-t2i": { "1K": 60_000n, "2K": 90_000n, "4K": 150_000n },
  "muapi.seedream-v45-t2i": 50_000n,
  "muapi.seedream-v4-t2i": { atomic: 40_000n },
  "muapi.nano-banana-2-lite-t2i": 30_000n,
  "muapi.nano-banana-2-t2i": { "1K": 60_000n, "2K": 90_000n, "4K": 120_000n },
  "muapi.nano-banana-pro-t2i": { "1K": 120_000n, "2K": 120_000n, "4K": 180_000n },
  "muapi.nano-banana-t2i": 30_000n,
  "muapi.grok-imagine-quality-t2i": 50_000n,
  "muapi.grok-imagine-i2i": 50_000n,
  "muapi.grok-imagine-t2i": 50_000n,
});

function providerCost(modelId, request) {
  const entry = FIXED[modelId];
  if (typeof entry === "bigint") return entry;
  if (entry?.atomic) return entry.atomic; // Seedream v4 is one atomic paid request at 1–4 outputs.
  return entry?.[request.outputResolution] ?? null;
}

export function calculateImageQuote(model, request, authoritativeEstimatedProviderCostMicroUsd = null) {
  const estimatedProviderCostMicroUsd = authoritativeEstimatedProviderCostMicroUsd ?? providerCost(model?.id, request);
  if (estimatedProviderCostMicroUsd === null || estimatedProviderCostMicroUsd === undefined) {
    return { priced: false, code: "IMAGE_CONFIGURATION_UNPRICED", reason: "No verified MuAPI estimate-cost basis exists for this image configuration.", pricingRevisionId: IMAGE_PRICING_REVISION };
  }
  const expectedOutputCount = model.providerCapabilities.output.expectedCount === "REQUESTED_COUNT"
    ? request.requestedOutputCount : model.providerCapabilities.output.expectedCount;
  if (!Number.isInteger(expectedOutputCount) || expectedOutputCount < 1) return { priced: false, code: "IMAGE_CONFIGURATION_UNPRICED", reason: "The expected output count is not economically attributable.", pricingRevisionId: IMAGE_PRICING_REVISION };
  const internalCostReserveMicroUsd = INTERNAL_IMAGE_DELIVERY_RESERVE_MICRO_USD * BigInt(expectedOutputCount);
  const quote = calculateRequiredCredits({ providerGeneration: estimatedProviderCostMicroUsd, imageDeliveryReserve: internalCostReserveMicroUsd });
  const conservativeNetRevenueMicroUsd = quote.quotedCredits * PRICING_REVISION.netRevenuePerCreditFloorMicroUsd;
  return {
    priced: true,
    pricingRevisionId: IMAGE_PRICING_REVISION,
    estimatedProviderCostMicroUsd: estimatedProviderCostMicroUsd.toString(),
    internalCostReserveMicroUsd: internalCostReserveMicroUsd.toString(),
    fullyLoadedCostMicroUsd: quote.fullyLoadedCostMicroUsd.toString(),
    rawRequiredCredits: quote.rawCredits.toString(),
    totalCredits: Number(quote.quotedCredits),
    expectedOutputCount,
    conservativeNetRevenueMicroUsd: conservativeNetRevenueMicroUsd.toString(),
    expectedContributionMicroUsd: (conservativeNetRevenueMicroUsd - quote.fullyLoadedCostMicroUsd).toString(),
  };
}
