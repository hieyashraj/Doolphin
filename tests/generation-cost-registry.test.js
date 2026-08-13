import test from "node:test";
import assert from "node:assert/strict";
import { calculateRequiredCredits, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";
import { calculateAuthoritativeGenerationQuote, getReachableGenerationCostConfigurations } from "../src/lib/generation/modelCostRegistry.js";
import { getGenerationModel } from "../src/lib/generation/modelRegistry.js";

test("reachable provider model is fail-closed until its exact approved cost source is configured", () => {
  const model = getGenerationModel("muapi.seedance2.omni-reference-fast");
  const quote = calculateAuthoritativeGenerationQuote({ settings: { outputCount: 1 }, assets: [] }, model);
  assert.equal(quote.priced, false);
  assert.equal(quote.code, "GENERATION_CONFIGURATION_UNPRICED");
  assert.match(quote.reason, /No approved/);
  assert.deepEqual(getReachableGenerationCostConfigurations().map(({ modelId, status }) => ({ modelId, status })), [
    { modelId: "muapi.seedance2.omni-reference-fast", status: "UNPRICED" },
  ]);
});

test("approved economics always ceiling-divide then round up to the next five credits", () => {
  const exact = calculateRequiredCredits({ providerGeneration: 1_680_000n });
  assert.equal(exact.rawCredits, 80n);
  assert.equal(exact.quotedCredits, 80n);
  const fractional = calculateRequiredCredits({ providerGeneration: 1_680_001n });
  assert.equal(fractional.rawCredits, 81n);
  assert.equal(fractional.quotedCredits, 85n);
  assert.equal(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd, 21_000n);
});
