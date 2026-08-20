import test from "node:test";
import assert from "node:assert/strict";

import {
  getCatalogPricingMode,
  getLiveCatalogCostUsd,
  getVerifiedProviderCostUsd,
  getVerifiedCostSource,
  assertStaticCostMatchesCatalog,
  assertLiveCostWithinVerifiedBand,
  LIVE_CATALOG_PROVENANCE,
  DRIFT_UPPER_MULTIPLE,
} from "../src/lib/models/verifiedCosts.js";

/**
 * STATIC COST / CATALOG GUARD — EXECUTED PROOF
 *
 * `tests/realtime-pricing-mechanism.test.js` proves the end-to-end estimator
 * behaviour, but it imports the contract layer and therefore `zod`, so it skips
 * on a bare checkout. The logic that decides whether a price may be billed at
 * all is too important to be provable only when node_modules happens to exist.
 *
 * This suite imports nothing but the guard module (which depends only on two
 * JSON catalogs), so it ALWAYS runs. It executes the real functions against the
 * real catalog data — no mocks, no network, no provider spend.
 */

test("the live catalog is the primary cost baseline, ahead of the third-party snapshot", () => {
  // gemini-omni-image-to-video is recorded in BOTH sources with DIFFERENT values:
  // $1.50 in MuAPI's live catalog, $2.00 in the older third-party snapshot. That
  // divergence is the whole reason precedence matters — it is a real MuAPI price
  // change, and using the stale figure as the baseline would skew every band
  // check for this model.
  assert.equal(getLiveCatalogCostUsd("gemini-omni-image-to-video"), 1.5);
  assert.equal(getVerifiedProviderCostUsd("gemini-omni-image-to-video"), 1.5, "must prefer the live catalog");
  assert.equal(getVerifiedCostSource("gemini-omni-image-to-video"), "muapi-live-catalog");
});

test("a model only in the third-party snapshot still gets a baseline", () => {
  // The secondary source is a genuine fallback, not decoration: the live subset
  // does not cover all 609 catalogue entries.
  assert.equal(getLiveCatalogCostUsd("grok-imagine-text-to-video"), null);
  assert.equal(getVerifiedProviderCostUsd("grok-imagine-text-to-video"), 0.15);
  assert.equal(getVerifiedCostSource("grok-imagine-text-to-video"), "third-party-snapshot");
});

test("pricing mode is read from MuAPI's own dynamic_pricing flag", () => {
  // Not inferred, not defaulted — read.
  assert.equal(getCatalogPricingMode("seedance-2.1-image-to-video"), false, "catalog says fixed");
  assert.equal(getCatalogPricingMode("veo3.1-fast-image-to-video"), true, "catalog says dynamic");
  assert.equal(getCatalogPricingMode("flux-3-image-to-video"), false, "catalog says fixed");
  assert.equal(
    getCatalogPricingMode("model-that-does-not-exist"),
    null,
    "an unrecorded model must yield null, never a false 'fixed' claim"
  );
});

test("BLOCKS flat-billing a model MuAPI prices dynamically", () => {
  // This is the exact defect that shipped in grok-imagine-image-2-edit: the
  // definition declared dynamicPricing:false and a $0.05 constant, while MuAPI's
  // catalog marks the model dynamic. Doolphin would have billed $0.05 regardless
  // of what MuAPI actually charged.
  const result = assertStaticCostMatchesCatalog({
    providerModelId: "grok-imagine-image-2-edit",
    staticCostUsd: 0.05,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PRICING_MODE_CONTRADICTS_CATALOG");
  assert.match(result.reason, /dynamic_pricing=true/);
  // Note the amount itself was CORRECT ($0.05 matches the catalog). Being right
  // about the number is not sufficient when the billing mode is wrong.
  assert.equal(result.catalogCostUsd, 0.05);
});

test("BLOCKS a fixed cost that disagrees with MuAPI's exact price", () => {
  const under = assertStaticCostMatchesCatalog({
    providerModelId: "seedance-2.1-image-to-video",
    staticCostUsd: 0.35, // MuAPI: exactly $0.40 -> we would absorb $0.05 every call
  });
  assert.equal(under.ok, false);
  assert.equal(under.code, "STATIC_COST_DISAGREES_WITH_CATALOG");
  assert.match(under.reason, /exact fixed price is \$0\.4000/);

  const over = assertStaticCostMatchesCatalog({
    providerModelId: "seedance-2.1-image-to-video",
    staticCostUsd: 0.5, // overcharges the customer
  });
  assert.equal(over.ok, false, "over-charging is refused too, not just under-charging");
  assert.equal(over.code, "STATIC_COST_DISAGREES_WITH_CATALOG");
});

test("ACCEPTS a fixed cost that matches MuAPI exactly, and records the proof", () => {
  const result = assertStaticCostMatchesCatalog({
    providerModelId: "seedance-2.1-image-to-video",
    staticCostUsd: 0.4,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, true, "must record that a real comparison happened");
  assert.equal(result.catalogCostUsd, 0.4);
  assert.equal(result.catalogPricingMode, false);
});

test("an unrecorded model is passed through but explicitly marked as NOT verified", () => {
  // Silence would be indistinguishable from a successful check. The caller must
  // be able to tell "verified" from "no data".
  const result = assertStaticCostMatchesCatalog({
    providerModelId: "some-brand-new-model",
    staticCostUsd: 1.23,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, false);
  assert.equal(result.catalogPricingMode, null);
});

test("the drift ceiling scales with duration so long renders are not falsely blocked", () => {
  // seedance-2.5-image-to-video-1080p is based at $4.25 in the catalog, at an
  // unspecified duration. A flat 4x ceiling ($17.00) would reject a legitimate
  // long render. With a 30s request against a 5s reference the ceiling becomes
  // 4 x 6 = 24x ($102.00), so a plausible long-render quote is allowed through.
  const base = getLiveCatalogCostUsd("seedance-2.5-image-to-video-1080p");
  assert.ok(Number.isFinite(base) && base > 0, "expected a catalog baseline");

  const flatCeiling = base * DRIFT_UPPER_MULTIPLE;
  const longRenderQuote = flatCeiling * 1.5; // above the flat ceiling, below the scaled one

  const blockedWithoutDuration = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2.5-image-to-video-1080p",
    liveCostUsd: longRenderQuote,
  });
  assert.equal(blockedWithoutDuration.ok, false, "without duration context this is out of band");
  assert.equal(blockedWithoutDuration.code, "PROVIDER_COST_DRIFT_HIGH");

  const allowedWithDuration = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2.5-image-to-video-1080p",
    liveCostUsd: longRenderQuote,
    requestedDurationSeconds: 30,
    referenceDurationSeconds: 5,
  });
  assert.equal(allowedWithDuration.ok, true, "a 30s render of a 5s-based model may legitimately cost more");
  assert.equal(allowedWithDuration.checked, true);
});

test("duration scaling never LOOSENS the floor, so under-charging stays blocked", () => {
  // The dangerous direction must not be relaxed by duration context.
  const base = getLiveCatalogCostUsd("seedance-2.5-image-to-video-1080p");
  const absurdlyLow = base / 50;

  for (const durationArgs of [{}, { requestedDurationSeconds: 30, referenceDurationSeconds: 5 }]) {
    const result = assertLiveCostWithinVerifiedBand({
      providerModelId: "seedance-2.5-image-to-video-1080p",
      liveCostUsd: absurdlyLow,
      ...durationArgs,
    });
    assert.equal(result.ok, false, "a gross under-charge must be blocked regardless of duration context");
    assert.equal(result.code, "PROVIDER_COST_DRIFT_LOW");
  }
});

test("a shorter-than-reference render does not shrink the ceiling below the flat multiple", () => {
  // Math.max(1, ratio) guard: a 2s request against a 5s reference must not
  // tighten the band to 1.6x and start rejecting normal quotes.
  const base = getLiveCatalogCostUsd("seedance-2.5-image-to-video-1080p");
  const result = assertLiveCostWithinVerifiedBand({
    providerModelId: "seedance-2.5-image-to-video-1080p",
    liveCostUsd: base * (DRIFT_UPPER_MULTIPLE - 0.5),
    requestedDurationSeconds: 2,
    referenceDurationSeconds: 5,
  });
  assert.equal(result.ok, true, "the ceiling must never fall below the flat multiple");
});

test("the live catalog documents its own cost semantics, so nobody re-derives them wrongly", () => {
  const p = LIVE_CATALOG_PROVENANCE;
  assert.match(p.source, /api\.muapi\.ai\/api\/v1\/models/);
  // The two facts that the estimator's correctness depends on must be written
  // down next to the data, not just in code comments.
  assert.match(p.costSemantics, /dynamic_pricing is FALSE/i);
  assert.match(p.costSemantics, /REPRESENTATIVE BASE/i);
  assert.match(p.costStrategyNote, /OPAQUE/i);
  assert.match(p.costStrategyNote, /never be parsed/i);
});
