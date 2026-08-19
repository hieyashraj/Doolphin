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
  // Revision 2026-08-credit-rescale-v2: 1 credit = $0.005 (5_000 microUSD).
  // $2.000000 of cost is an exact multiple of both the ceiling and 5 credits:
  // 2_000_000 / 5_000 = 400 credits exactly.
  const exact = calculateRequiredCredits({ providerGeneration: 2_000_000n });
  assert.equal(exact.rawCredits, 400n);
  assert.equal(exact.quotedCredits, 400n);
  // One microUSD more must ceiling-divide to 401 then round up to 405, proving
  // rounding always favours Doolphin and never under-charges.
  const fractional = calculateRequiredCredits({ providerGeneration: 2_000_001n });
  assert.equal(fractional.rawCredits, 401n);
  assert.equal(fractional.quotedCredits, 405n);
  assert.equal(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd, 5_000n);
});
