import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationSchedulePlan } from "../src/lib/generation/reconciliationSchedule.js";

test("reconciliation schedule is staging-only and requires authenticated HTTPS configuration", () => {
  assert.deepEqual(reconciliationSchedulePlan({}), { enabled:false, reason:"STAGING_ENVIRONMENT_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ VERCEL_ENV:"preview" }), { enabled:false, reason:"STAGING_ENVIRONMENT_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ DOOLPHIN_ENV:"staging", VERCEL_ENV:"production" }), { enabled:false, reason:"STAGING_ENVIRONMENT_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ DOOLPHIN_ENV:"staging" }), { enabled:false, reason:"CRON_SECRET_REQUIRED" });
  assert.deepEqual(reconciliationSchedulePlan({ DOOLPHIN_ENV:"staging", CRON_SECRET:"x", WEBHOOK_URL:"http://localhost:3000" }), { enabled:false, reason:"WEBHOOK_URL_HTTPS_REQUIRED" });
  const plan = reconciliationSchedulePlan({ DOOLPHIN_ENV:"staging", CRON_SECRET:"x", WEBHOOK_URL:"https://staging.example.test" });
  assert.equal(plan.enabled, true);
  assert.equal(plan.method, "POST");
});
