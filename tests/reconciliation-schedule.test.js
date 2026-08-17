import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationSchedulePlan } from "../src/lib/generation/reconciliationSchedule.js";

test("reconciliation schedule is eligible in every environment (including production) and requires only a bearer secret plus an HTTPS callback base", () => {
  // Reconciliation is the sole recovery path for lost/delayed/rejected MuAPI
  // webhooks and the sole mechanism that releases timed-out credit
  // reservations. Gating it to staging-only made it permanently unreachable
  // in production. It must now be enabled purely on the presence of
  // CRON_SECRET + an HTTPS WEBHOOK_URL, regardless of DOOLPHIN_ENV/VERCEL_ENV.
  assert.deepEqual(reconciliationSchedulePlan({}), { enabled:false, reason:"CRON_SECRET_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ VERCEL_ENV:"preview" }), { enabled:false, reason:"CRON_SECRET_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ VERCEL_ENV:"production", CRON_SECRET:"x" }), { enabled:false, reason:"WEBHOOK_URL_HTTPS_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ VERCEL_ENV:"production", CRON_SECRET:"x", WEBHOOK_URL:"http://localhost:3000" }), { enabled:false, reason:"WEBHOOK_URL_HTTPS_REQUIRED" });
  const prodPlan = reconciliationSchedulePlan({ VERCEL_ENV:"production", CRON_SECRET:"x", WEBHOOK_URL:"https://doolphin.example.com" });
  assert.equal(prodPlan.enabled, true, "production must be eligible for reconciliation scheduling");
  assert.equal(prodPlan.method, "GET", "Vercel Cron issues GET requests");
  const stagingPlan = reconciliationSchedulePlan({ DOOLPHIN_ENV:"staging", CRON_SECRET:"x", WEBHOOK_URL:"https://staging.example.test" });
  assert.equal(stagingPlan.enabled, true);
});
