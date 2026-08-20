import assert from "node:assert/strict";
import test from "node:test";
import { APPROVED_PLANS, PLAN_BY_CODE } from "../src/lib/entitlements/plan-catalog.js";
import { PLANS } from "../src/lib/entitlements/pricing.js";

test("all billing surfaces derive from the approved Doolphin plan catalog", () => {
  assert.equal(APPROVED_PLANS.length, 7);
  assert.deepEqual(Object.fromEntries(["EXPLORER", "STARTER_MONTHLY", "GROWTH_MONTHLY", "AGENCY_MONTHLY"].map((code) => [code, [PLAN_BY_CODE[code].price, PLAN_BY_CODE[code].credits]])), {
    EXPLORER: ["$2.99", 220], STARTER_MONTHLY: ["$29/month", 2500], GROWTH_MONTHLY: ["$79/month", 7000], AGENCY_MONTHLY: ["$179/month", 16000]
  });
  for (const code of ["STARTER_ANNUAL", "GROWTH_ANNUAL", "AGENCY_ANNUAL"]) assert.equal(PLANS[code].credits, PLAN_BY_CODE[code].credits);
});
