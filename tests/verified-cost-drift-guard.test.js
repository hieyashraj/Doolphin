import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertLiveCostWithinVerifiedBand,
  getVerifiedProviderCostUsd,
  getVerifiedModelEntry,
  listVerifiedModelIds,
  VERIFIED_COST_PROVENANCE,
  DRIFT_UPPER_MULTIPLE,
  DRIFT_LOWER_DIVISOR,
} from "../src/lib/models/verifiedCosts.js";

/**
 * VERIFIED COST DRIFT GUARD
 *
 * The runtime price comes from MuAPI's estimate-cost endpoint. That is the right
 * authority, but a single unchecked source has two silent money-losing failure
 * modes: it can regress to an implausibly LOW value (we under-charge and absorb
 * the difference on every call), or report $0.00 for a paid model (we give away
 * paid generations). These tests prove the cross-check catches both.
 *
 * Pure arithmetic against a vendored snapshot. No network, no provider spend.
 */

test("the verified snapshot carries full provenance and a stated cost unit", () => {
  assert.equal(VERIFIED_COST_PROVENANCE.costUnit, "USD per generation");
  assert.match(VERIFIED_COST_PROVENANCE.source, /github\.com\/SamurAIGPT\/muapi-cli/);
  assert.ok(VERIFIED_COST_PROVENANCE.sourceCommit && VERIFIED_COST_PROVENANCE.sourceCommit !== "unknown", "must record the exact upstream commit");
  assert.match(VERIFIED_COST_PROVENANCE.upstreamOrigin, /schema_data\.json/);
  // The unit claim must be evidence-backed, not asserted.
  assert.match(VERIFIED_COST_PROVENANCE.costUnitEvidence, /cost per generation/);
  // Must state plainly that it is a snapshot and not the billing authority.
  assert.match(VERIFIED_COST_PROVENANCE.warning, /SNAPSHOT/);
  assert.match(VERIFIED_COST_PROVENANCE.warning, /estimate-cost/);
});

test("the snapshot actually contains the models Doolphin sells", () => {
  const ids = listVerifiedModelIds();
  assert.ok(ids.length > 200, `expected a broad snapshot, got ${ids.length} models`);
  // The model currently wired into the video studio must be covered.
  const core = getVerifiedProviderCostUsd("seedance-2-omni-reference-no-video-fast");
  assert.equal(typeof core, "number");
  assert.ok(core > 0, "core model must have a positive verified cost");
});

test("a live cost inside the tolerance band is accepted and reported as cross-checked", () => {
  const verified = getVerifiedProviderCostUsd("seedance-2-omni-reference-no-video-fast");
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    liveCostUsd: verified,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, true, "an in-band comparison must be flagged as actually checked");
  assert.equal(result.verifiedCostUsd, verified);
});

test("BLOCKS an implausibly LOW live cost (the under-charge direction)", () => {
  const verified = getVerifiedProviderCostUsd("seedance-2-omni-reference-no-video-fast");
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    liveCostUsd: verified / (DRIFT_LOWER_DIVISOR * 2),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROVIDER_COST_DRIFT_LOW");
  assert.match(result.reason, /Refusing to under-charge/);
});

test("BLOCKS $0.00 reported for a model verified as paid", () => {
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    liveCostUsd: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROVIDER_COST_ZERO_FOR_PAID_MODEL");
  assert.match(result.reason, /Refusing to sell a paid generation for free/);
});

test("BLOCKS an absurdly HIGH live cost so a customer is never over-charged on a bad reading", () => {
  const verified = getVerifiedProviderCostUsd("seedance-2-omni-reference-no-video-fast");
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    liveCostUsd: verified * (DRIFT_UPPER_MULTIPLE + 1),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROVIDER_COST_DRIFT_HIGH");
});

test("BLOCKS non-finite and negative provider costs", () => {
  for (const bad of [NaN, Infinity, -1, -0.0001, "abc", null, undefined]) {
    const result = assertLiveCostWithinVerifiedBand({
      providerModelId: "seedance-2-omni-reference-no-video-fast",
      liveCostUsd: bad,
    });
    assert.equal(result.ok, false, `live cost ${String(bad)} must be rejected`);
    assert.equal(result.code, "PROVIDER_COST_IMPLAUSIBLE");
  }
});

test("an unknown model is allowed through but explicitly marked as NOT cross-checked", () => {
  // New models legitimately appear faster than the snapshot refreshes. That must
  // not block sales, but it must be visible rather than looking verified.
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "some-model-released-tomorrow",
    liveCostUsd: 1.23,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, false, "must report that no cross-check happened");
  assert.equal(result.verifiedCostUsd, null);
});

test("the tolerance band is asymmetric, stricter against under-charging than over-charging", () => {
  // Under-charging is the direction that silently destroys margin on every call,
  // so it must tolerate less divergence than the over-charging direction.
  assert.ok(DRIFT_LOWER_DIVISOR > DRIFT_UPPER_MULTIPLE,
    `lower divisor (${DRIFT_LOWER_DIVISOR}) should exceed upper multiple (${DRIFT_UPPER_MULTIPLE})`);
});

test("the estimator wires the drift guard in BEFORE computing a credit quote", () => {
  const src = fs.readFileSync(new URL("../src/lib/models/execution/estimateCost.js", import.meta.url), "utf8");
  const guard = src.indexOf("assertLiveCostWithinVerifiedBand");
  const quote = src.indexOf("calculateCommercialCreditQuote({\n      providerCostMicroUsd");
  assert.ok(guard > 0, "estimator must import and call the drift guard");
  assert.ok(quote > guard, "the drift guard must run BEFORE the dynamic-path credit quote is computed");
  // The failure must be a fail-closed unpriced result, not a warning.
  assert.match(src, /code: drift\.code/);
  assert.match(src, /verifiedCostCrossChecked: drift\.checked === true/);
});

test("verified cost entries expose the metadata needed to audit a price", () => {
  const entry = getVerifiedModelEntry("seedance-2-omni-reference-no-video-fast");
  assert.ok(entry, "core model entry must exist");
  assert.equal(typeof entry.costUsdPerGeneration, "number");
  assert.ok(entry.category, "category must be recorded");
  assert.ok(Object.isFrozen(entry), "entries must be immutable to callers");
});
