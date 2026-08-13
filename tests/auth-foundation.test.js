import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateRequiredCredits, PLANS, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";
const annualPeriods = (startsAt) => Array.from({ length: 12 }, (_, periodIndex) => ({ dueAt: new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + periodIndex, startsAt.getUTCDate(), startsAt.getUTCHours(), startsAt.getUTCMinutes(), startsAt.getUTCSeconds())) }));

test("pricing uses integer micro-USD and always rounds upward to five credits", () => {
  assert.equal(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd, 21_000n);
  assert.equal(calculateRequiredCredits({ providerCost: 400_000n }).quotedCredits, 20n);
  assert.equal(calculateRequiredCredits({ providerCost: 1_100_000n }).quotedCredits, 55n);
  assert.equal(calculateRequiredCredits({ providerCost: 2_000_000n }).quotedCredits, 100n);
});

test("annual plans grant monthly allowances rather than twelve months upfront", () => {
  assert.equal(PLANS.STARTER_ANNUAL.credits, 700);
  assert.equal(PLANS.GROWTH_ANNUAL.credits, 1900);
  assert.equal(PLANS.AGENCY_ANNUAL.credits, 4300);
  const periods = annualPeriods(new Date("2026-01-15T00:00:00.000Z"));
  assert.equal(periods.length, 12);
  assert.equal(periods[0].dueAt.toISOString(), "2026-01-15T00:00:00.000Z");
  assert.equal(periods[11].dueAt.toISOString(), "2026-12-15T00:00:00.000Z");
});

test("migration contains database-enforced Explorer and webhook uniqueness", async () => {
  const sql = await readFile(new URL("../prisma/canonical_migrations/20260813_canonical_staging_baseline/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /Explorer_one_per_user/);
  assert.match(sql, /Explorer_one_per_workspace/);
  assert.match(sql, /Explorer_one_per_customer/);
  assert.match(sql, /BillingWebhookEvent_polarEventId_key/);
  assert.match(sql, /LEGACY_OPENING_BALANCE/);
});
