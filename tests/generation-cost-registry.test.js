import test from "node:test";
import assert from "node:assert/strict";
import { calculateRequiredCredits, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";
import { calculateAuthoritativeGenerationQuote, getReachableGenerationCostConfigurations } from "../src/lib/generation/modelCostRegistry.js";
import { getGenerationModel } from "../src/lib/generation/modelRegistry.js";

test("reachable provider model calculates authoritative generation quote when cost source is configured", () => {
  const model = getGenerationModel("muapi.seedance2.omni-reference-fast");
  const quote = calculateAuthoritativeGenerationQuote({ settings: { durationSeconds: 5, outputCount: 1 }, assets: [] }, model);
  assert.equal(quote.priced, true);
  assert.equal(typeof quote.totalCredits, "number");
  assert.equal(quote.totalCredits > 0, true);
  assert.deepEqual(getReachableGenerationCostConfigurations().map(({ modelId, status }) => ({ modelId, status })), [
    { modelId: "muapi.seedance2.omni-reference-fast", status: "PRICED" },
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
