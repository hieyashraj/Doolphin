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
  // Revision 2026-08-credit-value-v3: 1 credit = $0.025 (25_000 microUSD).
  // $2.000000 of cost is an exact multiple of both the ceiling and 5 credits:
  // 2_000_000 / 25_000 = 80 credits exactly.
  const exact = calculateRequiredCredits({ providerGeneration: 2_000_000n });
  assert.equal(exact.rawCredits, 80n);
  assert.equal(exact.quotedCredits, 80n);
  // One microUSD more must ceiling-divide to 81 then round up to 85, proving
  // rounding always favours Doolphin and never under-charges.
  const fractional = calculateRequiredCredits({ providerGeneration: 2_000_001n });
  assert.equal(fractional.rawCredits, 81n);
  assert.equal(fractional.quotedCredits, 85n);
  assert.equal(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd, 25_000n);
});
