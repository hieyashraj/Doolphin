import test from "node:test";
import assert from "node:assert/strict";

import { assertRequestWithinPlan, planCapabilities } from "../src/lib/entitlements/planCapabilities.js";
import { APPROVED_PLANS } from "../src/lib/entitlements/plan-catalog.js";

/**
 * PLAN CAPABILITY ENFORCEMENT — EXECUTED PROOF
 *
 * These caps were declared on every plan and read by nothing, which made the
 * advertised tiering untrue in both directions. These tests hold the enforcement
 * to the figures the pricing page shows.
 */

test("every plan's advertised caps are actually enforced", () => {
  for (const plan of APPROVED_PLANS) {
    const caps = planCapabilities(plan.code);
    assert.equal(caps.maxResolution, plan.maxResolution, `${plan.code} resolution cap`);
    assert.equal(caps.maxDurationSeconds, plan.maxDurationSeconds, `${plan.code} duration cap`);

    // At the cap is allowed; the cap is inclusive.
    assert.equal(
      assertRequestWithinPlan({
        planCode: plan.code,
        resolution: plan.maxResolution,
        durationSeconds: plan.maxDurationSeconds,
      }).ok,
      true,
      `${plan.code} must allow exactly its advertised maximum`,
    );
  }
});

test("resolution is compared by rank, not alphabetically", () => {
  // A string comparison ranks "1080p" below "720p", which would let a 720p plan
  // request 1080p. This is the specific bug the rank table prevents.
  const explorer = assertRequestWithinPlan({ planCode: "EXPLORER", resolution: "1080p" });
  assert.equal(explorer.ok, false);
  assert.equal(explorer.code, "PLAN_RESOLUTION_EXCEEDED");

  // And 720p on a 720p plan still passes.
  assert.equal(assertRequestWithinPlan({ planCode: "EXPLORER", resolution: "720p" }).ok, true);
  // Lower than the cap is fine.
  assert.equal(assertRequestWithinPlan({ planCode: "EXPLORER", resolution: "480p" }).ok, true);
});

test("4K is refused on plans that do not advertise it", () => {
  for (const code of ["EXPLORER", "STARTER_MONTHLY", "STARTER_ANNUAL"]) {
    const verdict = assertRequestWithinPlan({ planCode: code, resolution: "4k" });
    assert.equal(verdict.ok, false, `${code} must refuse 4K`);
    assert.equal(verdict.code, "PLAN_RESOLUTION_EXCEEDED");
    // The message must name the limit and the plan, so the user can act.
    assert.match(verdict.reason, /supports up to/);
    assert.ok(verdict.allowedResolutions.length > 0);
  }

  for (const code of ["GROWTH_MONTHLY", "AGENCY_MONTHLY"]) {
    assert.equal(
      assertRequestWithinPlan({ planCode: code, resolution: "4k" }).ok,
      true,
      `${code} advertises 4K and must allow it`,
    );
  }
});

test("case and spelling variants of a resolution are handled", () => {
  // The catalogue writes 4k and 4K inconsistently; both must be caught, or the
  // cap is bypassable by casing alone.
  for (const variant of ["4k", "4K", " 4K ", "4K"]) {
    assert.equal(
      assertRequestWithinPlan({ planCode: "EXPLORER", resolution: variant }).ok,
      false,
      `variant '${variant}' must be refused`,
    );
  }
});

test("duration over the plan limit is refused with the real numbers", () => {
  const verdict = assertRequestWithinPlan({ planCode: "EXPLORER", durationSeconds: 30 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "PLAN_DURATION_EXCEEDED");
  assert.equal(verdict.maxDurationSeconds, 5);
  assert.equal(verdict.requestedDurationSeconds, 30);
  assert.match(verdict.reason, /up to 5 seconds/);

  assert.equal(assertRequestWithinPlan({ planCode: "GROWTH_MONTHLY", durationSeconds: 30 }).ok, true);
  assert.equal(assertRequestWithinPlan({ planCode: "STARTER_MONTHLY", durationSeconds: 16 }).ok, false);
  assert.equal(assertRequestWithinPlan({ planCode: "STARTER_MONTHLY", durationSeconds: 15 }).ok, true);
});

test("an unrecognised plan makes no judgement rather than blocking", () => {
  // Entitlement itself is enforced by requireActivatedAccount, which runs first.
  // This module refusing an unknown plan code would turn a data gap into a
  // total outage for that user.
  const verdict = assertRequestWithinPlan({ planCode: "SOMETHING_NEW", resolution: "4k" });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.enforced, false);
  assert.equal(planCapabilities("SOMETHING_NEW"), null);
});

test("an unknown resolution is allowed through rather than failing closed", () => {
  // The model's own supported list has already been validated upstream. A format
  // this module has not been taught about is a gap here, not an attempt to cheat,
  // and refusing it would break a legitimate request for a newly supported
  // resolution. No financial guard depends on this check.
  assert.equal(assertRequestWithinPlan({ planCode: "EXPLORER", resolution: "8K" }).ok, true);
  assert.equal(assertRequestWithinPlan({ planCode: "EXPLORER", resolution: null }).ok, true);
});

test("Explorer's 5s cap is tighter than some models' minimum duration", () => {
  // Recorded deliberately as a product consequence rather than a defect: models
  // whose shortest supported clip exceeds 5 seconds (grok-imagine starts at 6s)
  // are unusable on Explorer. Enforcing the advertised cap is correct; whether
  // Explorer should advertise 5s is a pricing decision.
  const verdict = assertRequestWithinPlan({ planCode: "EXPLORER", durationSeconds: 6 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.maxDurationSeconds, 5);
});
