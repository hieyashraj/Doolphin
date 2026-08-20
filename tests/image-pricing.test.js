import test from "node:test";
import assert from "node:assert/strict";
import { getImageModel } from "../src/lib/generation-models/imageRegistry.js";
import { calculateImageQuote } from "../src/lib/generation-models/imagePricing.js";
import { PRICING_REVISION } from "../src/lib/entitlements/pricing.js";

// Credit expectations below are stated at revision 2026-08-credit-value-v3
// ($0.025 of fully-loaded cost per credit). Rather than hardcode a magic total,
// each case also asserts the invariant that credits always COVER the loaded cost,
// so a future rescale cannot silently make a generation loss-making.
const CEILING = Number(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd);

function assertCoversCost(quote) {
  assert.equal(quote.priced, true);
  assert.ok(
    quote.totalCredits * CEILING >= Number(quote.fullyLoadedCostMicroUsd),
    `charging ${quote.totalCredits} credits must cover ${quote.fullyLoadedCostMicroUsd} microUSD of loaded cost`
  );
}

test("image quotes include the approved one-cent delivery reserve and round upward to five credits", () => {
  const model = getImageModel("muapi.nano-banana-2-lite-t2i");
  const quote = calculateImageQuote(model, { aspectRatio: "1:1" });
  assert.equal(quote.estimatedProviderCostMicroUsd, "30000");
  assert.equal(quote.internalCostReserveMicroUsd, "10000");
  assert.equal(quote.fullyLoadedCostMicroUsd, "40000");
  // 40000 / 25000 = 2 raw credits, rounded up to the nearest 5.
  assert.equal(quote.totalCredits, 5);
  assertCoversCost(quote);
});

test("Nano Banana Pro 4K is conservatively quoted at ten credits", () => {
  const quote = calculateImageQuote(getImageModel("muapi.nano-banana-pro-t2i"), { outputResolution: "4K" });
  assert.equal(quote.estimatedProviderCostMicroUsd, "180000");
  // 180000 provider + 10000 reserve = 190000 -> ceil(/25000) = 8 -> round to 10.
  assert.equal(quote.totalCredits, 10);
  assertCoversCost(quote);
});

test("Seedream v4 keeps one atomic charge while delivery reserve tracks requested outputs", () => {
  const model = getImageModel("muapi.seedream-v4-t2i");
  const quote = calculateImageQuote(model, { requestedOutputCount: 4 });
  assert.equal(quote.estimatedProviderCostMicroUsd, "40000");
  assert.equal(quote.internalCostReserveMicroUsd, "40000");
  assert.equal(quote.expectedOutputCount, 4);
  // Provider bills once for 1-4 outputs, but delivery cost scales: 80000 -> ceil(/25000)=4 -> 5.
  assert.equal(quote.totalCredits, 5);
  assertCoversCost(quote);
});

// ---------------------------------------------------------------------------
// The Grok family is priced per request by MuAPI (dynamic_pricing: true). It
// used to sit in the FIXED table at a flat $0.05, so a failed live estimate
// silently flat-billed a model whose real price varies. That is the same defect
// tests/static-cost-catalog-guard.test.js prevents in the model-platform layer,
// and it was reachable here because the image path never ran that guard.
// ---------------------------------------------------------------------------

test("MONEY GUARD: a dynamically priced Grok model cannot be quoted without a live estimate", () => {
  for (const id of ["muapi.grok-imagine-t2i", "muapi.grok-imagine-i2i", "muapi.grok-imagine-quality-t2i"]) {
    const model = getImageModel(id) || { id };
    const quote = calculateImageQuote(model, { aspectRatio: "1:1" });
    assert.equal(quote.priced, false, `${id} must not produce an offline price`);
    assert.equal(quote.code, "IMAGE_ESTIMATE_REQUIRED");
  }
});

test("a Grok model still prices correctly when the authoritative live estimate is supplied", () => {
  const model = getImageModel("muapi.grok-imagine-t2i") || { id: "muapi.grok-imagine-t2i", providerCapabilities: { output: { expectedCount: 1 } } };
  const quote = calculateImageQuote(model, { aspectRatio: "1:1" }, 50_000n);
  assert.equal(quote.priced, true);
  assert.equal(quote.estimatedProviderCostMicroUsd, "50000");
  assertCoversCost(quote);
});
