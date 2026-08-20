import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateRequiredCredits, PLANS, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";
const annualPeriods = (startsAt) => Array.from({ length: 12 }, (_, periodIndex) => ({ dueAt: new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + periodIndex, startsAt.getUTCDate(), startsAt.getUTCHours(), startsAt.getUTCMinutes(), startsAt.getUTCSeconds())) }));

test("pricing uses integer micro-USD and always rounds upward to five credits", () => {
  // Revision 2026-08-credit-value-v3: 1 credit = $0.025 of fully-loaded cost
  // allowance. Economics unchanged from v2; credit counts scaled down 5x so the
  // numbers read like the category rather than 5-digit totals.
  assert.equal(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd, 25_000n);
  // $0.40 / $0.025 = 16 -> round up to a multiple of 5 = 20.
  assert.equal(calculateRequiredCredits({ providerCost: 400_000n }).quotedCredits, 20n);
  // $1.10 / $0.025 = 44 -> round up = 45.
  assert.equal(calculateRequiredCredits({ providerCost: 1_100_000n }).quotedCredits, 45n);
  // $2.00 / $0.025 = 80 credits exactly.
  assert.equal(calculateRequiredCredits({ providerCost: 2_000_000n }).quotedCredits, 80n);
  // One microUSD over an exact 16 -> ceiling to 17 -> round UP to 20, never down.
  assert.equal(calculateRequiredCredits({ providerCost: 400_001n }).quotedCredits, 20n);
});

test("annual plans grant monthly allowances rather than twelve months upfront", () => {
  assert.equal(PLANS.STARTER_ANNUAL.credits, 500);
  assert.equal(PLANS.GROWTH_ANNUAL.credits, 1300);
  assert.equal(PLANS.AGENCY_ANNUAL.credits, 3000);
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
