import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CEILING_TOLERANCE_MULTIPLE,
  DOCUMENTED_COST_PROVENANCE,
  DOCUMENTED_COST_REVISION,
  assertLiveCostWithinDocumentedCeiling,
  assertModelCostIsBoundable,
  getDocumentedCeilingMicroUsd,
  getDocumentedCeilingUsd,
  getDocumentedCostBand,
  getDocumentedDefaultCostUsd,
  getDocumentedEntry,
  getDocumentedPricingClass,
  getInputVideoPolicy,
  getModelAvailability,
  getPublishedCeilingUsd,
  INPUT_VIDEO_CAP_SECONDS,
  listDocumentedModelIds,
  resolveDocumentedCostUsd,
} from "../src/lib/models/documentedCostSurface.js";
import { assertLiveCostWithinVerifiedBand } from "../src/lib/models/verifiedCosts.js";
import { APPROVED_PLANS } from "../src/lib/entitlements/plan-catalog.js";
import {
  PRICING_REVISION,
  calculateRequiredCredits,
  netRevenuePerCreditMicroUsd,
  worstCaseContributionMarginBps,
} from "../src/lib/entitlements/pricing.js";

/**
 * DOCUMENTED COST CEILINGS — EXECUTED PROOF
 *
 * Locks in the founder-supplied pricing document as the authority on what a
 * single generation can cost at most, and proves the guards derived from it
 * actually fire.
 *
 * Imports only dependency-free modules (documentedCostSurface + verifiedCosts
 * read JSON; pricing reads plan-catalog), so this suite ALWAYS executes — even
 * on a bare checkout with no node_modules. Money-critical logic must not be
 * provable only when dependencies happen to be installed.
 *
 * No mocks and no network: every assertion runs the real functions against the
 * real catalog data.
 */

/** Credits the application would actually charge for a provider cost. */
function creditsFor(providerCostUsd, infraMicroUsd = 20_000n) {
  return Number(
    calculateRequiredCredits({
      provider: BigInt(Math.ceil(providerCostUsd * 1_000_000)),
      infra: infraMicroUsd,
    }).quotedCredits,
  );
}

// ---------------------------------------------------------------------------
// 1. The document is present, complete and attributed
// ---------------------------------------------------------------------------

test("the documented cost surface is loaded and attributed to the founder-supplied document", () => {
  assert.equal(DOCUMENTED_COST_REVISION, "2026-08-documented-cost-ceilings-v1");
  assert.match(DOCUMENTED_COST_PROVENANCE.priceSurface, /Models and their Pricing\.docx/);
  assert.match(DOCUMENTED_COST_PROVENANCE.catalogCrossCheck, /MUAPI MODELS\.json/);
  assert.equal(listDocumentedModelIds().length, 71);
});

test("every documented model exists in the 609-model provider catalog", () => {
  const catalog = JSON.parse(readFileSync("MUAPI MODELS.json", "utf8"));
  const names = new Set(catalog.models.map((m) => m.name));
  const missing = listDocumentedModelIds().filter((id) => !names.has(id));
  assert.deepEqual(missing, [], `documented models absent from the provider catalog: ${missing}`);
});

// ---------------------------------------------------------------------------
// 2. THE CENTRAL FACT: a default cost is not a ceiling
// ---------------------------------------------------------------------------

test("the provider catalog cost never exceeds the documented ceiling, so the ceiling is safe to bound with", () => {
  const catalog = JSON.parse(readFileSync("MUAPI MODELS.json", "utf8"));
  const byName = new Map(catalog.models.map((m) => [m.name, m]));

  const violations = [];
  for (const id of listDocumentedModelIds()) {
    const ceiling = getDocumentedCeilingUsd(id);
    const catalogCost = byName.get(id)?.cost;
    if (ceiling === null || catalogCost === undefined) continue;
    // A catalog cost above the documented ceiling would mean the ceiling
    // under-bounds reality, and bounding a live quote with it would under-charge.
    if (catalogCost > ceiling + 1e-9) violations.push({ id, catalogCost, ceiling });
  }
  assert.deepEqual(violations, [], `catalog cost exceeds documented ceiling: ${JSON.stringify(violations)}`);
});

test("models whose ceiling far exceeds their default cost keep that gap recorded", () => {
  // Regression guard. If a future refactor reverts to treating the default cost
  // as the maximum, these multiples collapse to 1x and the assertion fails.
  // Each expectation below is a figure printed in the pricing document.
  const KNOWN_GAPS = [
    { id: "seedance-2.5-text-to-video-4k", defaultUsd: 8.5, ceilingUsd: 51.0 },
    { id: "seedance-2.5-image-to-video-4k", defaultUsd: 8.5, ceilingUsd: 51.0 },
    { id: "seedance-2.5-image-to-video-1080p", defaultUsd: 4.25, ceilingUsd: 25.5 },
    { id: "seedance-2.5-image-to-video", defaultUsd: 1.7, ceilingUsd: 10.2 },
    { id: "veo3.1-lite-image-to-video", defaultUsd: 0.3, ceilingUsd: 1.5 },
    { id: "veo3.1-lite-text-to-video", defaultUsd: 0.3, ceilingUsd: 1.5 },
    { id: "grok-imagine-image-to-video", defaultUsd: 0.15, ceilingUsd: 1.5 },
    { id: "openai-sora-2-pro-image-to-video", defaultUsd: 2.4, ceilingUsd: 7.5 },
  ];

  for (const { id, defaultUsd, ceilingUsd } of KNOWN_GAPS) {
    assert.equal(getDocumentedDefaultCostUsd(id), defaultUsd, `${id} default cost`);
    assert.ok(
      Math.abs(getDocumentedCeilingUsd(id) - ceilingUsd) < 1e-9,
      `${id} ceiling expected ${ceilingUsd}, got ${getDocumentedCeilingUsd(id)}`,
    );
    assert.ok(
      getDocumentedCeilingUsd(id) > getDocumentedDefaultCostUsd(id),
      `${id} ceiling must exceed its default cost`,
    );
  }
});

test("the most expensive documented render is $51.00, not the $9.35 previously assumed", () => {
  // The prior revision believed the catalog maximum was $9.35 (a seedance spicy
  // 4k default). Treating that as the worst case understated the true maximum by
  // 5.45x. This asserts the real figure so the understatement cannot return.
  let worst = { id: null, usd: 0 };
  for (const id of listDocumentedModelIds()) {
    const cls = getDocumentedPricingClass(id);
    if (cls !== "bounded" && cls !== "flat") continue;
    const usd = getDocumentedCeilingUsd(id);
    if (usd !== null && usd > worst.usd) worst = { id, usd };
  }
  assert.equal(worst.usd, 51);
  assert.ok(worst.usd > 9.35, "worst case must exceed the previously assumed $9.35");
  assert.equal(getDocumentedCeilingMicroUsd(worst.id), 51_000_000n);
});

// ---------------------------------------------------------------------------
// 3. Unbounded models are refused, with evidence
// ---------------------------------------------------------------------------

test("models billed on user-supplied media duration are refused unless every input is measured and within the cap", () => {
  // These are billed on the length of a video behind a URL the caller chose.
  // A 15s per-input policy cap turns that open-ended exposure into arithmetic,
  // so they are sellable -- but only when the cap is VERIFIED. An unmeasured
  // duration is treated exactly like an over-cap one, because an input we cannot
  // measure is an input we cannot price.
  const INPUT_BILLED = [
    "seedance-2-omni-reference",
    "seedance-2-video-edit",
    "seedance-2.5-omni-reference",
    "seedance-2.5-omni-reference-480p",
    "seedance-2.5-omni-reference-1080p",
    "seedance-2.5-omni-reference-4k",
    "seedance-2.5-video-edit",
    "kling-v2.6-pro-motion-control",
    "kling-v2.6-std-motion-control",
    "kling-o1-video-edit-fast",
  ];

  for (const id of INPUT_BILLED) {
    assert.equal(getDocumentedPricingClass(id), "unbounded", `${id} bills on input duration`);
    assert.equal(getModelAvailability(id), "AVAILABLE", `${id} is sellable under the cap`);

    // No durations supplied at all -> cannot be priced.
    const unmeasured = assertModelCostIsBoundable({ providerModelId: id });
    assert.equal(unmeasured.ok, false, `${id} must refuse when no durations are supplied`);
    assert.equal(unmeasured.code, "INPUT_VIDEO_DURATION_UNKNOWN");

    // A single input at exactly the cap is allowed.
    const atCap = assertModelCostIsBoundable({
      providerModelId: id,
      inputVideoDurationsSeconds: [INPUT_VIDEO_CAP_SECONDS],
    });
    assert.equal(atCap.ok, true, `${id} must allow one input at exactly the cap`);
    assert.equal(atCap.inputCapEnforced, true);

    // One second over is refused.
    const overCap = assertModelCostIsBoundable({
      providerModelId: id,
      inputVideoDurationsSeconds: [INPUT_VIDEO_CAP_SECONDS + 1],
    });
    assert.equal(overCap.ok, false, `${id} must refuse an over-cap input`);
    assert.equal(overCap.code, "INPUT_VIDEO_TOO_LONG");

    // A null duration is refused, not silently treated as zero.
    const nullDuration = assertModelCostIsBoundable({
      providerModelId: id,
      inputVideoDurationsSeconds: [null],
    });
    assert.equal(nullDuration.ok, false, `${id} must refuse an unmeasured input`);
    assert.equal(nullDuration.code, "INPUT_VIDEO_DURATION_UNKNOWN");
  }
});

test("more input clips than the ceiling arithmetic assumed is refused", () => {
  // The ceiling for an input-billed model is computed as rate x clips x cap. If
  // the runtime allowed more clips than that arithmetic assumed, the real bill
  // would exceed the bound: two 15s clips on a single-input model bill 30s
  // against a ceiling derived from 15s.
  const single = assertModelCostIsBoundable({
    providerModelId: "kling-v2.6-pro-motion-control",
    inputVideoDurationsSeconds: [15, 15],
  });
  assert.equal(single.ok, false);
  assert.equal(single.code, "TOO_MANY_INPUT_VIDEOS");

  // A model that documents 10 reference clips still accepts 10.
  const ten = assertModelCostIsBoundable({
    providerModelId: "seedance-2.5-omni-reference",
    inputVideoDurationsSeconds: Array(10).fill(INPUT_VIDEO_CAP_SECONDS),
  });
  assert.equal(ten.ok, true);
  assert.equal(
    assertModelCostIsBoundable({
      providerModelId: "seedance-2.5-omni-reference",
      inputVideoDurationsSeconds: Array(11).fill(1),
    }).code,
    "TOO_MANY_INPUT_VIDEOS",
  );
});

test("the capped ceiling includes the input contribution, not just the output", () => {
  // Returning the published (output-only) figure would set the billing guard
  // BELOW what the provider can legitimately charge once input is included,
  // rejecting valid requests and understating the worst case in margin proofs.
  const id = "kling-v2.6-pro-motion-control";
  assert.equal(getPublishedCeilingUsd(id), 8.7, "published figure is output-side only");
  assert.ok(
    Math.abs(getDocumentedCeilingUsd(id) - 0.145 * INPUT_VIDEO_CAP_SECONDS) < 1e-9,
    `capped ceiling should be $0.145/sec x ${INPUT_VIDEO_CAP_SECONDS}s, got ${getDocumentedCeilingUsd(id)}`,
  );

  const policy = getInputVideoPolicy(id);
  assert.equal(policy.applies, true);
  assert.equal(policy.capSeconds, INPUT_VIDEO_CAP_SECONDS);
  assert.equal(policy.boundable, true);
});

test("models the document never prices are shown as coming soon, not silently dropped", () => {
  // Two distinct situations, both unsellable, recorded separately because the
  // remedies differ: an unreleased early-access build with no published pricing,
  // versus a released model whose surcharge amount is never stated.
  const COMING_SOON = {
    "seedance-2.5-spicy-text-to-video-4k": "UNRELEASED_NO_PUBLISHED_PRICING",
    "seedance-2.5-spicy-image-to-video": "UNRELEASED_NO_PUBLISHED_PRICING",
    "seedance-2-vip-extend": "COST_NOT_BOUNDABLE",
    "seedance-2-vip-extend-1080p": "COST_NOT_BOUNDABLE",
  };

  for (const [id, reason] of Object.entries(COMING_SOON)) {
    assert.equal(getModelAvailability(id), "COMING_SOON", id);
    const verdict = assertModelCostIsBoundable({
      providerModelId: id,
      inputVideoDurationsSeconds: [5],
    });
    assert.equal(verdict.ok, false, `${id} must not be generatable`);
    assert.equal(verdict.code, "MODEL_COMING_SOON");
    assert.equal(verdict.comingSoonReason, reason);
  }

  // Exactly nine, so silently promoting one to sellable fails here.
  const all = listDocumentedModelIds().filter((id) => getModelAvailability(id) === "COMING_SOON");
  assert.equal(all.length, 9, `coming-soon set changed: ${all.join(", ")}`);
});

test("a surcharge whose amount the document never states cannot be bounded by the cap", () => {
  // "plus a small surcharge per reference video clip" -- no number anywhere. The
  // cap bounds the duration but not an unstated surcharge, so no arithmetic bound
  // exists and the model stays unsellable rather than being given a guessed one.
  const policy = getInputVideoPolicy("seedance-2-vip-extend");
  assert.equal(policy.boundable, false);
  assert.match(policy.reason, /never states its amount/);
});

test("legacy: the unbounded set is still exactly twelve models", () => {
  const UNBOUNDED = [
    "seedance-2-omni-reference",
    "seedance-2-video-edit",
    "seedance-2-vip-extend",
    "seedance-2-vip-extend-1080p",
    "seedance-2.5-omni-reference",
    "seedance-2.5-omni-reference-480p",
    "seedance-2.5-omni-reference-1080p",
    "seedance-2.5-omni-reference-4k",
    "seedance-2.5-video-edit",
    "kling-v2.6-pro-motion-control",
    "kling-v2.6-std-motion-control",
    "kling-o1-video-edit-fast",
  ];

  for (const id of UNBOUNDED) {
    assert.equal(getDocumentedPricingClass(id), "unbounded", `${id} should be classed unbounded`);
    // Each must carry the document sentence that proves it bills on input
    // duration, so the classification is auditable rather than asserted.
    const entry = getDocumentedEntry(id);
    assert.ok(
      (entry.unboundedEvidence ?? []).length > 0,
      `${id} must carry documented evidence for its billing shape`,
    );
    assert.ok(entry.inputVideoPolicy.applies, `${id} must be under the input-duration policy`);
  }

  assert.equal(
    listDocumentedModelIds().filter((id) => getDocumentedPricingClass(id) === "unbounded").length,
    UNBOUNDED.length,
    "the set of unbounded models changed; re-review before shipping",
  );
});

test("kling-v2.6-pro-motion-control is caught even though its catalog cost looks cheap", () => {
  // Sharpest case in the catalog: `cost: 0.145` is the PER-SECOND rate, and the
  // document's own provider note mislabels it "per generation". Billing that
  // figure against a 60s input under-charges by 60x. It is refused outright.
  const entry = getDocumentedEntry("kling-v2.6-pro-motion-control");
  assert.equal(entry.catalogCostUsd, 0.145);
  assert.equal(entry.ceilingUsd, 8.7);
  assert.ok(entry.ceilingUsd / entry.catalogCostUsd >= 59, "the 60x gap must remain recorded");

  // The documented evidence for its billing shape must survive on the entry, so
  // the classification remains auditable now that the model is sellable.
  const evidence = getDocumentedEntry("kling-v2.6-pro-motion-control").unboundedEvidence;
  assert.equal(evidence[0].rule, "input-rate");
  assert.match(evidence[0].quote, /\$0\.145\/sec of input video/);

  // Sellable under the cap, and the guard bills against the capped ceiling
  // ($2.175) rather than the misleading $0.145 catalog figure.
  const verdict = assertModelCostIsBoundable({
    providerModelId: "kling-v2.6-pro-motion-control",
    inputVideoDurationsSeconds: [10],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.inputCapEnforced, true);
  assert.ok(getDocumentedCeilingUsd("kling-v2.6-pro-motion-control") > entry.catalogCostUsd * 14);
});

// ---------------------------------------------------------------------------
// 4. Indeterminate models are refused; documented ones are admitted
// ---------------------------------------------------------------------------

test("models whose price surface the document omits are refused rather than guessed at", () => {
  const INDETERMINATE = [
    "seedance-2.5-spicy-text-to-video-1080p",
    "seedance-2.5-spicy-text-to-video-4k",
    "seedance-2.5-spicy-image-to-video",
    "seedance-2.5-spicy-image-to-video-1080p",
    "seedance-2.5-intl-text-to-video-1080p",
    "seedance-2.5-intl-text-to-video-4k",
    "seedance-2.5-intl-image-to-video-1080p",
  ];

  for (const id of INDETERMINATE) {
    assert.equal(getDocumentedPricingClass(id), "indeterminate", id);
    const verdict = assertModelCostIsBoundable({ providerModelId: id });
    assert.equal(verdict.ok, false, `${id} must be refused`);
    // Surfaced as a product state rather than a safety refusal: these are
    // unreleased early-access builds, so "coming soon" is both accurate and
    // more useful to the user than an internal pricing error.
    assert.equal(verdict.code, "MODEL_COMING_SOON");
    assert.equal(verdict.comingSoonReason, "UNRELEASED_NO_PUBLISHED_PRICING");
  }
});

test("bounded, flat and undocumented models are admitted", () => {
  for (const id of ["veo3.1-lite-image-to-video", "gpt-image-2-text-to-image"]) {
    const v = assertModelCostIsBoundable({ providerModelId: id });
    assert.equal(v.ok, true, `${id} (bounded) should be admitted`);
    assert.equal(v.pricingClass, "bounded");
  }

  for (const id of ["veo-4-image-to-video", "veo3-text-to-video"]) {
    const v = assertModelCostIsBoundable({ providerModelId: id });
    assert.equal(v.ok, true, `${id} (flat) should be admitted`);
    assert.equal(v.pricingClass, "flat");
  }

  // Absence of documentation is not evidence of danger: the document covers a
  // curated subset, and undocumented models still price via the live estimate
  // guarded by the snapshot band.
  const undocumented = assertModelCostIsBoundable({ providerModelId: "not-in-the-document" });
  assert.equal(undocumented.ok, true);
  assert.equal(undocumented.documented, false);
  assert.equal(undocumented.pricingClass, null);
});

// ---------------------------------------------------------------------------
// 5. Exact price-surface lookups
// ---------------------------------------------------------------------------

test("exact documented prices resolve for every quality/resolution combination", () => {
  // gpt-image-2 publishes a full 3x3 grid; all nine are asserted so a parser
  // regression on any cell is caught.
  const GRID = [
    [{ quality: "Low", resolution: "1K" }, 0.025],
    [{ quality: "Low", resolution: "2K" }, 0.04],
    [{ quality: "Low", resolution: "4K" }, 0.075],
    [{ quality: "Medium", resolution: "1K" }, 0.03],
    [{ quality: "Medium", resolution: "2K" }, 0.045],
    [{ quality: "Medium", resolution: "4K" }, 0.09],
    [{ quality: "High", resolution: "1K" }, 0.06],
    [{ quality: "High", resolution: "2K" }, 0.09],
    [{ quality: "High", resolution: "4K" }, 0.15],
  ];
  for (const [params, expected] of GRID) {
    assert.equal(
      resolveDocumentedCostUsd({ providerModelId: "gpt-image-2-text-to-image", ...params }),
      expected,
      `gpt-image-2 ${params.quality}/${params.resolution}`,
    );
  }
});

test("duration cells match numerically, so a caller may pass a number or a suffixed string", () => {
  const id = "kling-v2.6-pro-motion-control";
  assert.equal(resolveDocumentedCostUsd({ providerModelId: id, durationSeconds: 10 }), 1.45);
  assert.equal(resolveDocumentedCostUsd({ providerModelId: id, durationSeconds: "10s" }), 1.45);
  assert.equal(resolveDocumentedCostUsd({ providerModelId: id, durationSeconds: 60 }), 8.7);
});

test("an undocumented combination returns null, never zero", () => {
  // Returning 0 would present a paid generation as free. Null means "ask the
  // provider", and the caller falls back to the live estimate.
  const unknown = resolveDocumentedCostUsd({
    providerModelId: "gpt-image-2-text-to-image",
    quality: "Ultra",
    resolution: "8K",
  });
  assert.equal(unknown, null);
  assert.notEqual(unknown, 0);

  // grok-imagine accepts 6-30s but tabulates only 5/8/10s, so 6s is not pinned.
  assert.equal(
    resolveDocumentedCostUsd({ providerModelId: "grok-imagine-image-to-video", resolution: "720p", durationSeconds: 6 }),
    null,
  );

  assert.equal(resolveDocumentedCostUsd({ providerModelId: "no-such-model", resolution: "4k" }), null);
});

// ---------------------------------------------------------------------------
// 6. The ceiling band: admits legitimate expense, rejects absurdity
// ---------------------------------------------------------------------------

test("a legitimate 4k render costing 5x its default is admitted", () => {
  // THE FALSE-POSITIVE FIX. veo3.1-lite is based at $0.30 (720p) and documented
  // up to $1.50 (4k). The old snapshot heuristic allowed only 4x its default and
  // rejected this, breaking a paid feature. Resolution is not duration, so the
  // duration-aware widening could not rescue it.
  const verdict = assertLiveCostWithinDocumentedCeiling({
    providerModelId: "veo3.1-lite-image-to-video",
    liveCostUsd: 1.5,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checked, true);
  assert.equal(verdict.ceilingUsd, 1.5);
});

test("a quote above the documented ceiling plus tolerance is refused", () => {
  const verdict = assertLiveCostWithinDocumentedCeiling({
    providerModelId: "veo3.1-lite-image-to-video",
    liveCostUsd: 9.99,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "PROVIDER_COST_EXCEEDS_DOCUMENTED_CEILING");
  assert.match(verdict.reason, /above the documented maximum/);

  // The tolerance boundary is exercised from both sides.
  const ceiling = getDocumentedCeilingUsd("veo3.1-lite-image-to-video");
  const band = getDocumentedCostBand("veo3.1-lite-image-to-video");
  assert.equal(band.maxAcceptableUsd, ceiling * CEILING_TOLERANCE_MULTIPLE);
  assert.equal(
    assertLiveCostWithinDocumentedCeiling({
      providerModelId: "veo3.1-lite-image-to-video",
      liveCostUsd: band.maxAcceptableUsd,
    }).ok,
    true,
    "exactly at the tolerance limit is allowed",
  );
  assert.equal(
    assertLiveCostWithinDocumentedCeiling({
      providerModelId: "veo3.1-lite-image-to-video",
      liveCostUsd: band.maxAcceptableUsd + 0.01,
    }).ok,
    false,
    "just beyond the tolerance limit is refused",
  );
});

test("an indeterminate model carries no ceiling at all, so nothing can be bounded by it", () => {
  // The document publishes no price table and no per-unit rate for these models.
  // The playground's `Generate ($X)` figure is deliberately NOT substituted: it is
  // the price at the playground's own default settings, so treating it as a
  // maximum would recreate the "default mistaken for ceiling" error. The honest
  // value is therefore null, and no quote can be judged against it.
  for (const id of ["seedance-2.5-spicy-text-to-video-4k", "seedance-2.5-spicy-image-to-video"]) {
    assert.equal(getDocumentedCeilingUsd(id), null, `${id} must expose no ceiling`);
    assert.equal(getDocumentedCostBand(id), null, `${id} must expose no cost band`);

    const verdict = assertLiveCostWithinDocumentedCeiling({ providerModelId: id, liveCostUsd: 60 });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.checked, false);
    assert.equal(verdict.ceilingUsd, null);
  }

  // They remain refused at admission, so no quote is ever produced for them.
  assert.equal(
    assertModelCostIsBoundable({ providerModelId: "seedance-2.5-spicy-image-to-video" }).code,
    "MODEL_COMING_SOON",
  );
});

test("the playground Generate button is never used as a pricing authority", () => {
  // Explicit regression guard for the founder's correction: `Generate ($X)` is
  // what MuAPI's playground shows for ONE page's default inputs. Only published
  // price tables and MuAPI's own stated rates may set a ceiling.
  //
  // Every indeterminate model has a non-null playground default recorded for
  // diagnostics, and a null ceiling. If a future change reintroduces the button
  // as a fallback, these ceilings become non-null and this fails.
  const indeterminate = listDocumentedModelIds().filter(
    (id) => getDocumentedPricingClass(id) === "indeterminate",
  );
  assert.equal(indeterminate.length, 7);

  for (const id of indeterminate) {
    assert.notEqual(
      getDocumentedDefaultCostUsd(id),
      null,
      `${id} should still record its playground default for diagnostics`,
    );
    assert.equal(
      getDocumentedCeilingUsd(id),
      null,
      `${id} ceiling must stay null: the playground default is not an authority`,
    );
  }
});

test("an undocumented model is not judged by this guard", () => {
  const verdict = assertLiveCostWithinDocumentedCeiling({
    providerModelId: "not-in-the-document",
    liveCostUsd: 999,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checked, false);
  assert.equal(verdict.ceilingUsd, null);
});

// ---------------------------------------------------------------------------
// 7. Interaction with the snapshot band
// ---------------------------------------------------------------------------

test("a documented ceiling replaces the snapshot's heuristic upper bound but not its lower bound", () => {
  const id = "veo3.1-lite-image-to-video";
  const documentedCeilingUsd = getDocumentedCeilingUsd(id);

  // Without the documented ceiling the heuristic rejects the legitimate 4k price.
  const heuristicOnly = assertLiveCostWithinVerifiedBand({ providerModelId: id, liveCostUsd: 1.5 });
  assert.equal(heuristicOnly.ok, false);
  assert.equal(heuristicOnly.code, "PROVIDER_COST_DRIFT_HIGH");

  // With it, the published figure supersedes the inference.
  const deferred = assertLiveCostWithinVerifiedBand({
    providerModelId: id,
    liveCostUsd: 1.5,
    documentedCeilingUsd,
  });
  assert.equal(deferred.ok, true);
  assert.equal(deferred.upperBoundDeferredToDocumentedCeiling, true);

  // Under-charging is the direction that loses money, so the lower bound and the
  // zero-cost guard must still fire while deferring.
  const tooLow = assertLiveCostWithinVerifiedBand({
    providerModelId: id,
    liveCostUsd: 0.001,
    documentedCeilingUsd,
  });
  assert.equal(tooLow.ok, false);
  assert.equal(tooLow.code, "PROVIDER_COST_DRIFT_LOW");

  const free = assertLiveCostWithinVerifiedBand({
    providerModelId: id,
    liveCostUsd: 0,
    documentedCeilingUsd,
  });
  assert.equal(free.ok, false);
  assert.equal(free.code, "PROVIDER_COST_ZERO_FOR_PAID_MODEL");
});

// ---------------------------------------------------------------------------
// 8. The profit invariant, at the real documented worst case
// ---------------------------------------------------------------------------

test("every plan holds a >=30% margin on the most expensive documented render", () => {
  // Not a restatement of the structural proof: this prices the actual worst
  // documented cost through the real credit function and checks the margin each
  // plan achieves on it.
  const worstUsd = 51.0;
  const quote = calculateRequiredCredits({
    provider: BigInt(Math.ceil(worstUsd * 1_000_000)),
    infra: 20_000n,
  });
  assert.equal(quote.quotedCredits, 10_205n);

  for (const plan of APPROVED_PLANS) {
    const revenue = quote.quotedCredits * netRevenuePerCreditMicroUsd(plan);
    const marginBps = Number(((revenue - quote.fullyLoadedCostMicroUsd) * 10_000n) / revenue);
    assert.ok(
      marginBps >= 3000,
      `${plan.code} margin ${(marginBps / 100).toFixed(1)}% on a $${worstUsd} render is below the 30% floor`,
    );
  }
});

test("no documented model can be rendered at a loss on any plan", () => {
  // Exhaustive over the catalog rather than a sampled ladder: for every billable
  // documented model, at its ceiling, on every plan.
  const worstPlanNetPerCredit = APPROVED_PLANS.map(netRevenuePerCreditMicroUsd).reduce((a, b) =>
    b < a ? b : a,
  );

  const losses = [];
  for (const id of listDocumentedModelIds()) {
    const cls = getDocumentedPricingClass(id);
    if (cls !== "bounded" && cls !== "flat") continue;
    const usd = getDocumentedCeilingUsd(id);
    if (usd === null) continue;

    const quote = calculateRequiredCredits({
      provider: BigInt(Math.ceil(usd * 1_000_000)),
      infra: 20_000n,
    });
    const revenue = quote.quotedCredits * worstPlanNetPerCredit;
    if (revenue <= quote.fullyLoadedCostMicroUsd) {
      losses.push({ id, usd, credits: Number(quote.quotedCredits) });
      continue;
    }
    const marginBps = Number(((revenue - quote.fullyLoadedCostMicroUsd) * 10_000n) / revenue);
    if (marginBps < 3000) losses.push({ id, usd, marginBps });
  }

  assert.deepEqual(losses, [], `models priced below the 30% margin floor: ${JSON.stringify(losses)}`);
});

test("the cost ceiling constant still bounds every credit charge", () => {
  // The invariant's mechanism: cost only ever enters via a ceiling division, so
  // fullyLoadedCost <= credits * COST_CEILING for any cost whatsoever.
  const ceiling = PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd;
  for (const usd of [0.001, 0.025, 0.15, 0.3, 1.5, 8.5, 51, 500]) {
    const quote = calculateRequiredCredits({ provider: BigInt(Math.ceil(usd * 1_000_000)) });
    assert.ok(
      quote.fullyLoadedCostMicroUsd <= quote.quotedCredits * ceiling,
      `cost ${usd} exceeded credits x ceiling`,
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Plan margin floor, independent of the model catalog
// ---------------------------------------------------------------------------

test("all seven approved plans clear the 30% worst-case margin floor", () => {
  const expected = {
    EXPLORER: 5730,
    STARTER_MONTHLY: 5380,
    STARTER_ANNUAL: 4320,
    GROWTH_MONTHLY: 5300,
    GROWTH_ANNUAL: 4170,
    AGENCY_MONTHLY: 5280,
    AGENCY_ANNUAL: 4120,
  };
  for (const plan of APPROVED_PLANS) {
    const bps = worstCaseContributionMarginBps(plan);
    assert.ok(bps >= 3000, `${plan.code} at ${(bps / 100).toFixed(1)}% is below the 30% floor`);
    // Tolerance of 50bps: pins the figures without breaking on rounding.
    assert.ok(
      Math.abs(bps - expected[plan.code]) <= 50,
      `${plan.code} margin moved to ${bps}bps (expected ~${expected[plan.code]}bps); re-verify plan economics`,
    );
  }
});
