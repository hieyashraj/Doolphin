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
});

/**
 * Models MuAPI prices dynamically (`dynamic_pricing: true` in its catalog).
 *
 * For these there is no such thing as a correct offline price: the $0.05 the
 * catalog publishes is a representative base, not a rate. They previously sat in
 * the FIXED table at a flat 50_000n, which meant that whenever the live
 * estimate-cost call failed, Doolphin would silently flat-bill a model whose real
 * price varies per request — the exact defect that
 * tests/static-cost-catalog-guard.test.js was written to prevent in the
 * model-platform layer, reproduced in the image layer where that guard does not run.
 *
 * They are listed here rather than simply deleted so the omission is explicit and
 * a future contributor cannot "helpfully" restore a hardcoded number. A quote for
 * one of these REQUIRES an authoritative live estimate; without it we fail closed
 * and the caller returns 503 rather than guessing with someone's money.
 */
const DYNAMIC_ONLY = Object.freeze(new Set([
  "muapi.grok-imagine-t2i",
  "muapi.grok-imagine-i2i",
  "muapi.grok-imagine-quality-t2i",
  "muapi.grok-imagine-image-2",
]));

function providerCost(modelId, request) {
  const entry = FIXED[modelId];
  if (typeof entry === "bigint") return entry;
  if (entry?.atomic) return entry.atomic; // Seedream v4 is one atomic paid request at 1–4 outputs.
  return entry?.[request.outputResolution] ?? null;
}

export function calculateImageQuote(model, request, authoritativeEstimatedProviderCostMicroUsd = null) {
  // A dynamically priced model may never fall back to an offline number.
  if (authoritativeEstimatedProviderCostMicroUsd === null && DYNAMIC_ONLY.has(model?.id)) {
    return { priced: false, code: "IMAGE_ESTIMATE_REQUIRED", reason: "MuAPI prices this model per request, so a live estimate is required before it can be charged.", pricingRevisionId: IMAGE_PRICING_REVISION };
  }
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
