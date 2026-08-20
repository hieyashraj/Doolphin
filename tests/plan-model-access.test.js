import test from "node:test";
import assert from "node:assert/strict";
import { assertModelAllowedForPlan, isModelAllowedForPlan, restrictedFamiliesForPlan } from "../src/lib/entitlements/modelAccess.js";
import { APPROVED_PLANS, PLAN_FEATURES, STANDARD_VIDEO_CREDITS, standardVideosFor } from "../src/lib/entitlements/plan-catalog.js";

const PAID = APPROVED_PLANS.filter((plan) => plan.code !== "EXPLORER").map((plan) => plan.code);

test("every paid plan may use every model, including Seedance 2.5", () => {
  for (const planCode of PAID) {
    assert.deepEqual(restrictedFamiliesForPlan(planCode), [], `${planCode} must not restrict any model family`);
    for (const providerModelId of [
      "seedance-2.5-spicy-video-extend-480p",
      "muapi.seedance-2.5-spicy-video-extend-480p",
      "seedance-2.5-omni-reference-4k",
      "seedance-2-omni-reference-no-video-fast",
      "grok-imagine-image-2-edit",
    ]) {
      assert.doesNotThrow(() => assertModelAllowedForPlan({ planCode, providerModelId }), `${planCode} should allow ${providerModelId}`);
    }
  }
});

test("the Explorer trial is refused Seedance 2.5 in every id form and resolution tier", () => {
  for (const providerModelId of [
    "seedance-2.5-spicy-video-extend-480p",
    "muapi.seedance-2.5-spicy-video-extend-480p",
    "seedance-2.5-omni-reference",
    "seedance-2.5-omni-reference-1080p",
    "seedance-2.5-omni-reference-4k",
    "seedance-2.5-image-to-video-480p",
  ]) {
    assert.throws(
      () => assertModelAllowedForPlan({ planCode: "EXPLORER", providerModelId }),
      (error) => error.code === "MODEL_NOT_IN_PLAN" && error.status === 403,
      `Explorer must refuse ${providerModelId}`
    );
  }
});

test("the Seedance 2 family stays available to the trial and is never confused with 2.5", () => {
  for (const providerModelId of [
    "seedance-2-omni-reference-no-video-fast",
    "muapi.seedance2.omni-reference-fast",
    "seedance-2-image-to-video",
    "seedance-2-mini-image-to-video",
    "seedance-2.1-image-to-video",
  ]) {
    assert.equal(isModelAllowedForPlan({ planCode: "EXPLORER", providerModelId }), true, `Explorer should keep ${providerModelId}`);
  }
});

test("an unknown plan code fails closed rather than granting the restricted family", () => {
  assert.throws(
    () => assertModelAllowedForPlan({ planCode: "NOT_A_PLAN", providerModelId: "seedance-2.5-omni-reference" }),
    (error) => error.code === "MODEL_NOT_IN_PLAN"
  );
  assert.equal(isModelAllowedForPlan({ planCode: undefined, providerModelId: "seedance-2.5-omni-reference" }), false);
});

test("an explicit catalog family value is honoured even when the id is opaque", () => {
  assert.throws(
    () => assertModelAllowedForPlan({ planCode: "EXPLORER", providerModelId: "some-opaque-id", modelFamily: "seedance-2.5" }),
    (error) => error.code === "MODEL_NOT_IN_PLAN"
  );
});

// ---------------------------------------------------------------------------
// Truth-in-advertising: the pricing page's headline numbers are derived, not
// typed. These guard the specific failure that shipped earlier — a hardcoded 30
// credits per video against a real cost of 155, overstating output by over 5x.
// ---------------------------------------------------------------------------

test("advertised videos-per-plan is floored and consistent with the credit allowance", () => {
  assert.equal(STANDARD_VIDEO_CREDITS, 35, "a standard 5s 720p Seedance 2 Omni Fast generation costs 35 credits");
  assert.equal(standardVideosFor(40), 1);
  assert.equal(standardVideosFor(500), 14);
  assert.equal(standardVideosFor(1300), 37);
  assert.equal(standardVideosFor(3000), 85);
  // Never round up: 69 credits is one video, not two.
  assert.equal(standardVideosFor(69), 1);
});

test("no plan advertises seats, workspaces, or a resolution or duration ceiling", () => {
  const forbidden = /\bseats?\b|\bworkspaces?\b|\b4K\b|\b1080p\b|\b720p\b|up to \d+s/i;
  for (const [tier, features] of Object.entries(PLAN_FEATURES)) {
    for (const item of features.items) {
      const text = `${item.label} ${item.detail || ""}`;
      assert.equal(forbidden.test(text), false, `${tier} advertises an unenforced capability: "${text}"`);
    }
  }
  for (const plan of APPROVED_PLANS) {
    for (const field of ["seats", "workspaces", "maxResolution", "maxDurationSeconds"]) {
      assert.equal(field in plan, false, `${plan.code} still declares unenforced field '${field}'`);
    }
  }
});
