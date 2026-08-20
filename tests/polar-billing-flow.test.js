process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import test from "node:test";

const { getPolarConfig } = await import("../src/lib/billing/polarEnvironment.js");
const { processPolarBillingEvent, resolvePlanFromPolarProduct } = await import("../src/lib/billing/polarWebhookProcessor.js");
const { annualPeriods, materializeAnnualGrantSchedule, processDueGrantSchedules } = await import("../src/lib/entitlements/grants.js");
const { PLANS } = await import("../src/lib/entitlements/pricing.js");

/**
 * CREDIT AMOUNTS IN THIS SUITE — pricing revision 2026-08-credit-value-v3.
 *
 * Grant amounts are read from PLANS[code].credits (see below), so this suite
 * follows the catalog automatically across a repricing. At v3 the allowances are
 * STARTER 500, GROWTH 1,300, AGENCY 3,000, EXPLORER 40 — 1 credit = $0.025 of
 * fully-loaded cost (PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd = 25_000).
 *
 * The SEEDED_BALANCE below is a MOCK's arbitrary starting balance used to test
 * grant DELTAS; it is not the production seed (a real new workspace starts at 0,
 * see CreditEscrowService). What this suite proves is the grant lifecycle, not
 * the seed value.
 *
 * WHY THE ALLOWANCE IS NOW READ FROM THE CATALOG RATHER THAN RE-TYPED HERE:
 * this suite's subject is the GRANT LIFECYCLE — that a webhook grants the plan the
 * PRODUCT authority resolves (never the plan a caller puts in metadata), exactly
 * once, and nothing at all when the transaction rolls back. Whether the allowance
 * is the right SIZE, and whether it is profitable, is a separate guarantee owned by
 * tests/billing-plan-catalog.test.js and tests/pricing-profit-invariant.test.js
 * (which include an explicit regression guard against silent reversion of the
 * rescale). Re-typing the literal here only meant that every legitimate repricing
 * broke an unrelated transaction-atomicity test.
 *
 * The money guard is STRENGTHENED, not weakened, by this change — see assertGrants:
 * grants are now verified against the LEDGER as well as the balance, so splitting
 * one allowance into two half-grants (which nets to a correct-looking balance and
 * PASSED the old literal check) now fails.
 */
const SEEDED_BALANCE = 100; // balance createMockDb() gives ws_123 before any webhook
const EXPLORER_CREDITS = PLANS.EXPLORER.credits;
const STARTER_CREDITS = PLANS.STARTER_MONTHLY.credits;

/**
 * Asserts a workspace received EXACTLY the expected grants — by balance AND by
 * ledger cardinality.
 *
 * A balance check alone is a weaker money guard than it looks: granting half the
 * allowance twice lands on the same total as granting it once, so a genuine
 * double-grant can hide behind a correct-looking balance. The ledger is the durable
 * financial record, so the number of grant entries and each entry's amount are
 * asserted too.
 *
 * @param {object} db mock db from createMockDb()
 * @param {number[]} expectedGrantAmounts every grant expected, in any order
 */
function assertGrants(db, expectedGrantAmounts, message) {
  const account = db._store.creditAccount.get("ws_123");
  const expectedBalance = expectedGrantAmounts.reduce((sum, amount) => sum + amount, SEEDED_BALANCE);
  assert.equal(account.availableCredits, expectedBalance, `${message}: available balance`);

  const grantAmounts = Array.from(db._store.creditLedgerEntry.values()).map((entry) => entry.amount);
  assert.deepEqual(
    grantAmounts.slice().sort((a, b) => a - b),
    expectedGrantAmounts.slice().sort((a, b) => a - b),
    `${message}: ledger must record exactly these grants — no duplicates, none missing`
  );
}

// Mock DB store for unit integration tests with atomic transaction support
function createMockDb() {
  const store = {
    billingWebhookEvent: new Map(),
    user: new Map([
      ["usr_123", { id: "usr_123", supabaseUserId: "sup_123", defaultWorkspaceId: "ws_123", activationStatus: "UNVERIFIED", subscriptionStatus: "NONE" }]
    ]),
    billingCustomer: new Map(),
    entitlement: new Map(),
    creditAccount: new Map([
      ["ws_123", { id: "acc_123", workspaceId: "ws_123", availableCredits: 100, reservedCredits: 0, lifetimeIssuedCredits: 100 }]
    ]),
    creditLedgerEntry: new Map(),
    creditGrantSchedule: new Map(),
  };

  function cloneStore(s) {
    return {
      billingWebhookEvent: new Map(Array.from(s.billingWebhookEvent.entries()).map(([k, v]) => [k, { ...v }])),
      user: new Map(Array.from(s.user.entries()).map(([k, v]) => [k, { ...v }])),
      billingCustomer: new Map(Array.from(s.billingCustomer.entries()).map(([k, v]) => [k, { ...v }])),
      entitlement: new Map(Array.from(s.entitlement.entries()).map(([k, v]) => [k, { ...v }])),
      creditAccount: new Map(Array.from(s.creditAccount.entries()).map(([k, v]) => [k, { ...v }])),
      creditLedgerEntry: new Map(Array.from(s.creditLedgerEntry.entries()).map(([k, v]) => [k, { ...v }])),
      creditGrantSchedule: new Map(Array.from(s.creditGrantSchedule.entries()).map(([k, v]) => [k, { ...v }])),
    };
  }

  const db = {
    _store: store,
    billingWebhookEvent: {
      findUnique: async ({ where }) => store.billingWebhookEvent.get(where.polarEventId) || null,
    },
    entitlement: {
      findUnique: async ({ where }) => {
        if (where.polarSubscriptionId) return Array.from(store.entitlement.values()).find(e => e.polarSubscriptionId === where.polarSubscriptionId) || null;
        if (where.polarOrderId) return Array.from(store.entitlement.values()).find(e => e.polarOrderId === where.polarOrderId) || null;
        if (where.id) return store.entitlement.get(where.id) || null;
        return null;
      },
    },
    creditGrantSchedule: {
      findMany: async ({ where }) => {
        return Array.from(store.creditGrantSchedule.values()).filter(s => s.status === where.status && s.dueAt <= where.dueAt.lte);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of store.creditGrantSchedule.values()) {
          if ((where.id === s.id || where.entitlementId === s.entitlementId) && (!where.status || s.status === where.status)) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: async (fn) => {
      const snapshot = cloneStore(db._store);
      const txStore = db._store;

      const tx = {
        billingWebhookEvent: {
          findUnique: async ({ where }) => txStore.billingWebhookEvent.get(where.polarEventId) || null,
          create: async ({ data }) => {
            const record = { id: `bwe_${Date.now()}_${Math.random()}`, ...data };
            txStore.billingWebhookEvent.set(data.polarEventId, record);
            return record;
          },
          update: async ({ where, data }) => {
            const record = txStore.billingWebhookEvent.get(where.polarEventId);
            if (record) Object.assign(record, data);
            return record;
          },
        },
        user: {
          findUnique: async ({ where }) => {
            if (where.supabaseUserId) return Array.from(txStore.user.values()).find(u => u.supabaseUserId === where.supabaseUserId) || null;
            if (where.id) return txStore.user.get(where.id) || null;
            return null;
          },
          update: async ({ where, data }) => {
            const u = txStore.user.get(where.id);
            if (!u) throw new Error("User not found");
            Object.assign(u, data);
            return u;
          },
        },
        billingCustomer: {
          upsert: async ({ where, create, update }) => {
            let existing = txStore.billingCustomer.get(where.polarCustomerId);
            if (existing) { Object.assign(existing, update); return existing; }
            existing = { id: `bc_${Date.now()}`, ...create };
            txStore.billingCustomer.set(where.polarCustomerId, existing);
            return existing;
          },
        },
        entitlement: {
          findUnique: async ({ where }) => {
            if (where.polarSubscriptionId) return Array.from(txStore.entitlement.values()).find(e => e.polarSubscriptionId === where.polarSubscriptionId) || null;
            if (where.polarOrderId) return Array.from(txStore.entitlement.values()).find(e => e.polarOrderId === where.polarOrderId) || null;
            if (where.id) return txStore.entitlement.get(where.id) || null;
            return null;
          },
          findFirst: async ({ where }) => {
            const all = Array.from(txStore.entitlement.values());
            if (where.planCode === "EXPLORER") return all.find(e => e.planCode === "EXPLORER") || null;
            if (where.polarCustomerId) return all.reverse().find(e => e.polarCustomerId === where.polarCustomerId) || null;
            return null;
          },
          create: async ({ data }) => {
            const record = { id: `ent_${Date.now()}_${Math.random()}`, status: "ACTIVE", ...data };
            txStore.entitlement.set(record.id, record);
            return record;
          },
          update: async ({ where, data }) => {
            const record = txStore.entitlement.get(where.id) || Array.from(txStore.entitlement.values()).find(e => e.polarSubscriptionId === where.polarSubscriptionId);
            if (!record) throw new Error("Entitlement not found");
            Object.assign(record, data);
            return record;
          },
        },
        creditAccount: {
          update: async ({ where, data }) => {
            const acc = txStore.creditAccount.get(where.workspaceId);
            if (!acc) throw new Error("Credit account missing");
            if (data.availableCredits?.increment) acc.availableCredits += data.availableCredits.increment;
            if (data.lifetimeIssuedCredits?.increment) acc.lifetimeIssuedCredits += data.lifetimeIssuedCredits.increment;
            return acc;
          },
        },
        creditLedgerEntry: {
          findUnique: async ({ where }) => txStore.creditLedgerEntry.get(where.idempotencyKey) || null,
          create: async ({ data }) => {
            if (txStore.creditLedgerEntry.has(data.idempotencyKey)) {
              const err = new Error("Unique constraint failed"); err.code = "P2002"; throw err;
            }
            const record = { id: `cle_${Date.now()}_${Math.random()}`, ...data };
            txStore.creditLedgerEntry.set(data.idempotencyKey, record);
            return record;
          },
        },
        creditGrantSchedule: {
          upsert: async ({ where, create, update }) => {
            const key = `${where.entitlementId_periodIndex.entitlementId}:${where.entitlementId_periodIndex.periodIndex}`;
            let existing = txStore.creditGrantSchedule.get(key);
            if (existing) { Object.assign(existing, update); return existing; }
            existing = { id: `cgs_${Date.now()}_${Math.random()}`, ...create };
            txStore.creditGrantSchedule.set(key, existing);
            return existing;
          },
          findMany: async ({ where }) => {
            return Array.from(txStore.creditGrantSchedule.values()).filter(s => s.status === where.status && s.dueAt <= where.dueAt.lte);
          },
          updateMany: async ({ where, data }) => {
            let count = 0;
            for (const s of store.creditGrantSchedule.values()) {
              if ((where.id === s.id || where.entitlementId === s.entitlementId) && (!where.status || s.status === where.status)) {
                Object.assign(s, data);
                count++;
              }
            }
            return { count };
          },
        },
      };

      try {
        return await fn(tx);
      } catch (err) {
        db._store = snapshot;
        throw err;
      }
    },
  };

  return db;
}

function mockHeader(id) {
  return { get: (k) => (k === "webhook-id" ? id : null) };
}

test("ENVIRONMENT RESOLVER: rejects contradictory & missing environments (fails closed)", () => {
  const origPolar = process.env.POLAR_ENV;
  const origDoolphin = process.env.DOOLPHIN_ENV;
  const origVercel = process.env.VERCEL_ENV;

  delete process.env.POLAR_ENV;
  delete process.env.DOOLPHIN_ENV;
  delete process.env.VERCEL_ENV;

  assert.throws(() => getPolarConfig(), /Ambiguous or unconfigured/);

  // Contradictory: DOOLPHIN_ENV=staging + POLAR_ENV=production
  process.env.DOOLPHIN_ENV = "staging";
  process.env.POLAR_ENV = "production";
  assert.throws(() => getPolarConfig(), /Ambiguous or unconfigured/);

  // Contradictory: DOOLPHIN_ENV=production + VERCEL_ENV=preview
  process.env.DOOLPHIN_ENV = "production";
  process.env.POLAR_ENV = "production";
  process.env.VERCEL_ENV = "preview";
  assert.throws(() => getPolarConfig(), /Ambiguous or unconfigured/);

  if (origPolar) process.env.POLAR_ENV = origPolar; else delete process.env.POLAR_ENV;
  if (origDoolphin) process.env.DOOLPHIN_ENV = origDoolphin; else delete process.env.DOOLPHIN_ENV;
  if (origVercel) process.env.VERCEL_ENV = origVercel; else delete process.env.VERCEL_ENV;
});

test("METADATA FINANCIAL FALLBACK REMOVAL (4 Explicit Scenarios)", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_789";

  // Scenario 1: Recognized Starter product + metadata Agency -> Starter authority wins.
  // Exactly ONE grant, of the STARTER allowance, NOT the Agency allowance the
  // attacker-supplied metadata asked for.
  const db1 = createMockDb();
  const res1 = await processPolarBillingEvent({
    id: "msg_mismatch_1",
    type: "order.paid",
    data: {
      id: "ord_mm_1",
      product_id: "prod_starter_789",
      subscription_id: "sub_mm_1",
      billing_reason: "subscription_create",
      customer_id: "cust_mm_1",
      metadata: { planCode: "AGENCY_MONTHLY", supabaseUserId: "sup_123" },
    },
  }, mockHeader("msg_mismatch_1"), db1);
  assert.equal(res1.status, "PROCESSED");
  assert.equal(res1.entitlement.planCode, "STARTER_MONTHLY");
  assertGrants(db1, [STARTER_CREDITS], "recognized Starter product + Agency metadata");
  assert.notEqual(
    db1._store.creditAccount.get("ws_123").availableCredits,
    SEEDED_BALANCE + PLANS.AGENCY_MONTHLY.credits,
    "a metadata-supplied Agency plan must never be granted off a Starter product"
  );

  // Scenario 2: Recognized Starter product + no metadata -> Starter granted
  const db2 = createMockDb();
  const res2 = await processPolarBillingEvent({
    id: "msg_nometadata_2",
    type: "order.paid",
    data: {
      id: "ord_nm_2",
      product_id: "prod_starter_789",
      subscription_id: "sub_nm_2",
      billing_reason: "subscription_create",
      customer_id: "cust_nm_2",
      metadata: { supabaseUserId: "sup_123" },
    },
  }, mockHeader("msg_nometadata_2"), db2);
  assert.equal(res2.status, "PROCESSED");
  assert.equal(res2.entitlement.planCode, "STARTER_MONTHLY");
  assertGrants(db2, [STARTER_CREDITS], "recognized Starter product + no plan metadata");

  // Scenario 3: Missing product_id + metadata Starter -> IGNORED_UNRECOGNIZED_PRODUCT, zero credits
  const db3 = createMockDb();
  const res3 = await processPolarBillingEvent({
    id: "msg_noprod_3",
    type: "order.paid",
    data: {
      id: "ord_np_3",
      billing_reason: "subscription_create",
      metadata: { planCode: "STARTER_MONTHLY", supabaseUserId: "sup_123" },
    },
  }, mockHeader("msg_noprod_3"), db3);
  assert.equal(res3.status, "IGNORED_UNRECOGNIZED_PRODUCT");
  assertGrants(db3, [], "missing product_id + Starter metadata");

  // Scenario 4: Unknown product_id + metadata Agency -> IGNORED_UNRECOGNIZED_PRODUCT, zero credits
  const db4 = createMockDb();
  const res4 = await processPolarBillingEvent({
    id: "msg_unknownprod_4",
    type: "order.paid",
    data: {
      id: "ord_up_4",
      product_id: "prod_fake_unknown_999",
      billing_reason: "subscription_create",
      metadata: { planCode: "AGENCY_MONTHLY", supabaseUserId: "sup_123" },
    },
  }, mockHeader("msg_unknownprod_4"), db4);
  assert.equal(res4.status, "IGNORED_UNRECOGNIZED_PRODUCT");
  assertGrants(db4, [], "unknown product_id + Agency metadata");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("WEBHOOK TRANSACTION ATOMICITY: failure mid-transaction rolls back event insertion & credits", async () => {
  process.env.POLAR_PRODUCT_EXPLORER = "prod_explorer_111";

  const db = createMockDb();
  const payload = {
    id: "msg_fail_mid_tx",
    type: "order.paid",
    data: { id: "ord_fail_1", product_id: "prod_explorer_111", billing_reason: "purchase", metadata: { supabaseUserId: "INVALID_USER_ID" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payload, mockHeader("msg_fail_mid_tx"), db),
    /Billing identity is not linked to a workspace/
  );

  assert.equal(db._store.billingWebhookEvent.size, 0);
  // The rolled-back attempt must leave NO trace: no balance change, no ledger entry.
  assertGrants(db, [], "after a mid-transaction failure");

  payload.data.metadata.supabaseUserId = "sup_123";
  const retryRes = await processPolarBillingEvent(payload, mockHeader("msg_fail_mid_tx"), db);
  assert.equal(retryRes.status, "PROCESSED");
  assert.equal(db._store.billingWebhookEvent.get("msg_fail_mid_tx").processedAt !== null, true);
  // The retry grants exactly ONE Explorer allowance — the rolled-back first attempt
  // must not have banked a partial grant that the retry then tops up.
  assertGrants(db, [EXPLORER_CREDITS], "after retrying the rolled-back event");

  delete process.env.POLAR_PRODUCT_EXPLORER;
});

test("PRODUCT MAPPING: unknown Polar product fails financially closed", async () => {
  const db = createMockDb();
  const payload = {
    id: "msg_unknown_prod",
    type: "order.paid",
    data: { id: "ord_unknown", product_id: "prod_unrecognized_999", billing_reason: "subscription_create", metadata: {} },
  };

  const res = await processPolarBillingEvent(payload, mockHeader("msg_unknown_prod"), db);
  assert.equal(res.status, "IGNORED_UNRECOGNIZED_PRODUCT");
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 100);
});

test("CREDIT INVARIANT: order.created (even with status=paid) issues ZERO billing credits and ZERO entitlements", async () => {
  process.env.POLAR_PRODUCT_EXPLORER = "prod_explorer_111";
  const db = createMockDb();
  const payload = {
    id: "msg_evt_created_1",
    type: "order.created",
    data: { id: "ord_100", status: "paid", product_id: "prod_explorer_111", billing_reason: "purchase", metadata: { supabaseUserId: "sup_123" } },
  };

  const initialEntitlementsCount = db._store.entitlement.size;
  const initialUser = { ...db._store.user.get("usr_123") };

  const res = await processPolarBillingEvent(payload, mockHeader("msg_evt_created_1"), db);
  assert.equal(res.status, "PROCESSED_NO_GRANT");
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 100);
  assert.equal(db._store.entitlement.size, initialEntitlementsCount);
  assert.equal(db._store.user.get("usr_123").activationStatus, initialUser.activationStatus);

  delete process.env.POLAR_PRODUCT_EXPLORER;
});

test("IDEMPOTENCY: order.created and order.paid for same order ID do NOT conflict in BillingWebhookEvent", async () => {
  process.env.POLAR_PRODUCT_EXPLORER = "prod_explorer_111";

  const db = createMockDb();
  const createdPayload = { id: "msg_order_created_99", type: "order.created", data: { id: "ord_same_123" } };
  const paidPayload = {
    id: "msg_order_paid_99",
    type: "order.paid",
    data: { id: "ord_same_123", product_id: "prod_explorer_111", billing_reason: "purchase", metadata: { supabaseUserId: "sup_123" } },
  };

  await processPolarBillingEvent(createdPayload, mockHeader("msg_order_created_99"), db);
  const paidRes = await processPolarBillingEvent(paidPayload, mockHeader("msg_order_paid_99"), db);

  assert.equal(db._store.billingWebhookEvent.size, 2);
  assert.ok(paidRes.entry);

  delete process.env.POLAR_PRODUCT_EXPLORER;
});

test("MONTHLY BILLING: order.paid + subscription_create grants Month 1 credits", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();
  const payload = {
    id: "msg_monthly_init_1",
    type: "order.paid",
    data: {
      id: "ord_m1",
      product_id: "prod_starter_111",
      subscription_id: "sub_m1",
      billing_reason: "subscription_create",
      customer_id: "cust_m1",
      metadata: { supabaseUserId: "sup_123" },
    },
  };

  const res = await processPolarBillingEvent(payload, mockHeader("msg_monthly_init_1"), db);
  assert.equal(res.status, "PROCESSED");
  assertGrants(db, [STARTER_CREDITS], "monthly subscription_create");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("MONTHLY RENEWAL: order.paid + subscription_cycle grants cycle credits using polarSubscriptionId match", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();
  await processPolarBillingEvent({
    id: "msg_m1",
    type: "order.paid",
    data: { id: "ord_m1", product_id: "prod_starter_111", subscription_id: "sub_m1", billing_reason: "subscription_create", customer_id: "cust_m1", metadata: { supabaseUserId: "sup_123" } },
  }, mockHeader("msg_m1"), db);

  const renewalPayload = {
    id: "msg_m2",
    type: "order.paid",
    data: {
      id: "ord_m2_renew",
      product_id: "prod_starter_111",
      subscription_id: "sub_m1",
      billing_reason: "subscription_cycle",
      customer_id: "cust_m1",
      current_period_start: "2026-09-14T12:00:00Z",
      current_period_end: "2026-10-14T12:00:00Z",
      metadata: { supabaseUserId: "sup_123" },
    },
  };

  const res = await processPolarBillingEvent(renewalPayload, mockHeader("msg_m2"), db);
  assert.equal(res.status, "PROCESSED");
  // TWO grants and only two: one for subscription_create, one for subscription_cycle.
  assertGrants(db, [STARTER_CREDITS, STARTER_CREDITS], "monthly create + one renewal cycle");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("ANNUAL BILLING: order.paid + subscription_create materializes 12 periods & grants Month 0 atomically", async () => {
  process.env.POLAR_PRODUCT_STARTER_ANNUAL = "prod_starter_ann_111";

  const db = createMockDb();
  const payload = {
    id: "msg_ann_1",
    type: "order.paid",
    data: {
      id: "ord_ann_1",
      product_id: "prod_starter_ann_111",
      subscription_id: "sub_ann_1",
      billing_reason: "subscription_create",
      customer_id: "cust_ann_1",
      metadata: { supabaseUserId: "sup_123" },
    },
  };

  const res = await processPolarBillingEvent(payload, mockHeader("msg_ann_1"), db);
  assert.equal(res.status, "PROCESSED");
  // Annual charges ONCE but grants one month's allowance at a time. Exactly ONE grant
  // now; materializing all 12 periods as credits up front would hand a customer a
  // year of credits they could burn before the term is served.
  assertGrants(db, [STARTER_CREDITS], "annual subscription_create (Month 0 only)");
  assert.equal(db._store.creditGrantSchedule.size, 12);

  // Month 0 is already GRANTED and months 1-11 are not yet due, so the cron must be a
  // strict no-op — re-granting Month 0 here would be a duplicate allowance.
  const cronProcessed = await processDueGrantSchedules(new Date(), db);
  assert.equal(cronProcessed, 0);
  assertGrants(db, [STARTER_CREDITS], "annual after an immediate cron pass");

  delete process.env.POLAR_PRODUCT_STARTER_ANNUAL;
});

test("CANCELLATION: cancel_at_period_end sets CANCEL_AT_PERIOD_END without stopping prepaid annual grants", async () => {
  process.env.POLAR_PRODUCT_STARTER_ANNUAL = "prod_starter_ann_111";

  const db = createMockDb();
  await processPolarBillingEvent({
    id: "msg_ann_cancel",
    type: "order.paid",
    data: { id: "ord_ann_c", product_id: "prod_starter_ann_111", subscription_id: "sub_ann_c", billing_reason: "subscription_create", customer_id: "cust_ann_c", metadata: { supabaseUserId: "sup_123" } },
  }, mockHeader("msg_ann_cancel"), db);

  const cancelPayload = {
    id: "msg_cancel_sub",
    type: "subscription.canceled",
    data: { id: "sub_ann_c", cancel_at_period_end: true },
  };

  const res = await processPolarBillingEvent(cancelPayload, mockHeader("msg_cancel_sub"), db);
  assert.equal(res.status, "PROCESSED_CANCELLATION_SCHEDULED");

  const ent = Array.from(db._store.entitlement.values())[0];
  assert.equal(ent.status, "CANCEL_AT_PERIOD_END");
  assert.equal(Boolean(ent.grantsStoppedAt), false);

  delete process.env.POLAR_PRODUCT_STARTER_ANNUAL;
});

test("REVOCATION: subscription.revoked immediately stops pending schedules", async () => {
  process.env.POLAR_PRODUCT_STARTER_ANNUAL = "prod_starter_ann_111";

  const db = createMockDb();
  await processPolarBillingEvent({
    id: "msg_rev_init",
    type: "order.paid",
    data: { id: "ord_rev", product_id: "prod_starter_ann_111", subscription_id: "sub_rev", billing_reason: "subscription_create", customer_id: "cust_rev", metadata: { supabaseUserId: "sup_123" } },
  }, mockHeader("msg_rev_init"), db);

  const revokePayload = {
    id: "msg_revoked",
    type: "subscription.revoked",
    data: { id: "sub_rev" },
  };

  const res = await processPolarBillingEvent(revokePayload, mockHeader("msg_revoked"), db);
  assert.equal(res.status, "PROCESSED_REVOKED");

  const ent = Array.from(db._store.entitlement.values())[0];
  assert.equal(ent.status, "REVOKED");
  assert.ok(ent.grantsStoppedAt);

  delete process.env.POLAR_PRODUCT_STARTER_ANNUAL;
});

test("REFUND: full order.refunded revokes entitlement without ledger balance corruption", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();
  await processPolarBillingEvent({
    id: "msg_ref_init",
    type: "order.paid",
    data: { id: "ord_ref", product_id: "prod_starter_111", subscription_id: "sub_ref", billing_reason: "subscription_create", customer_id: "cust_ref", metadata: { supabaseUserId: "sup_123" } },
  }, mockHeader("msg_ref_init"), db);

  const refundPayload = {
    id: "msg_ref_evt",
    type: "order.refunded",
    data: { id: "ord_ref", order_id: "ord_ref", amount: 2900, amount_refunded: 2900 },
  };

  const res = await processPolarBillingEvent(refundPayload, mockHeader("msg_ref_evt"), db);
  assert.equal(res.status, "PROCESSED_FULL_REFUND_REVOKED");
  assert.equal(res.isFullRefund, true);

  const ent = Array.from(db._store.entitlement.values())[0];
  assert.equal(ent.status, "REVOKED");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("A. MATCHING PROCESSED DUPLICATE: same webhook ID + same financial identity returns ALREADY_PROCESSED", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";
  const db = createMockDb();
  const payload = {
    id: "msg_dup_match",
    type: "order.paid",
    data: { id: "ord_dup_match", product_id: "prod_starter_111", subscription_id: "sub_dup_match", billing_reason: "subscription_create", customer_id: "cust_dup_match", metadata: { supabaseUserId: "sup_123" } },
  };

  const res1 = await processPolarBillingEvent(payload, { "webhook-id": "msg_dup_match" }, db);
  assert.equal(res1.status, "PROCESSED");

  const res2 = await processPolarBillingEvent(payload, { "webhook-id": "msg_dup_match" }, db);
  assert.equal(res2.status, "ALREADY_PROCESSED");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("B. MISSING PERSISTED PAYLOAD: null payloadJson fails closed with IdempotencyIntegrityConflict", async () => {
  const db = createMockDb();
  db._store.billingWebhookEvent.set("msg_null_payload", {
    id: "bwe_null",
    polarEventId: "msg_null_payload",
    eventType: "order.paid",
    payloadJson: null,
    processedAt: new Date(),
  });

  const payload = {
    id: "msg_null_payload",
    type: "order.paid",
    data: { id: "ord_null", product_id: "prod_starter_111", subscription_id: "sub_null", billing_reason: "subscription_create", customer_id: "cust_null", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payload, { "webhook-id": "msg_null_payload" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );
});

test("C. MALFORMED PERSISTED PAYLOAD: JSON parse failure fails closed with IdempotencyIntegrityConflict", async () => {
  const db = createMockDb();
  db._store.billingWebhookEvent.set("msg_bad_json", {
    id: "bwe_bad",
    polarEventId: "msg_bad_json",
    eventType: "order.paid",
    payloadJson: "{ malformed json...",
    processedAt: new Date(),
  });

  const payload = {
    id: "msg_bad_json",
    type: "order.paid",
    data: { id: "ord_bad", product_id: "prod_starter_111", subscription_id: "sub_bad", billing_reason: "subscription_create", customer_id: "cust_bad", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payload, { "webhook-id": "msg_bad_json" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );
});

test("D. DIFFERENT PRODUCT ID: Same webhook ID but different productId fails closed", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";
  process.env.POLAR_PRODUCT_GROWTH_MONTHLY = "prod_growth_222";

  const db = createMockDb();
  const payloadOriginal = {
    id: "msg_prod_diff",
    type: "order.paid",
    data: { id: "ord_prod_diff", product_id: "prod_starter_111", subscription_id: "sub_prod_diff", billing_reason: "subscription_create", customer_id: "cust_prod_diff", metadata: { supabaseUserId: "sup_123" } },
  };
  await processPolarBillingEvent(payloadOriginal, { "webhook-id": "msg_prod_diff" }, db);

  const payloadTampered = {
    id: "msg_prod_diff",
    type: "order.paid",
    data: { id: "ord_prod_diff", product_id: "prod_growth_222", subscription_id: "sub_prod_diff", billing_reason: "subscription_create", customer_id: "cust_prod_diff", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payloadTampered, { "webhook-id": "msg_prod_diff" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
  delete process.env.POLAR_PRODUCT_GROWTH_MONTHLY;
});

test("E. DIFFERENT BILLING REASON: Same webhook ID but different billingReason fails closed", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();
  const payloadOriginal = {
    id: "msg_reason_diff",
    type: "order.paid",
    data: { id: "ord_reason_diff", product_id: "prod_starter_111", subscription_id: "sub_reason_diff", billing_reason: "subscription_create", customer_id: "cust_reason_diff", metadata: { supabaseUserId: "sup_123" } },
  };
  await processPolarBillingEvent(payloadOriginal, { "webhook-id": "msg_reason_diff" }, db);

  const payloadTampered = {
    id: "msg_reason_diff",
    type: "order.paid",
    data: { id: "ord_reason_diff", product_id: "prod_starter_111", subscription_id: "sub_reason_diff", billing_reason: "subscription_cycle", customer_id: "cust_reason_diff", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payloadTampered, { "webhook-id": "msg_reason_diff" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("F. DIFFERENT ORDER ID: Same webhook ID but different orderId fails closed", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();
  const payloadOriginal = {
    id: "msg_ord_diff",
    type: "order.paid",
    data: { id: "ord_orig_123", product_id: "prod_starter_111", subscription_id: "sub_ord_diff", billing_reason: "subscription_create", customer_id: "cust_ord_diff", metadata: { supabaseUserId: "sup_123" } },
  };
  await processPolarBillingEvent(payloadOriginal, { "webhook-id": "msg_ord_diff" }, db);

  const payloadTampered = {
    id: "msg_ord_diff",
    type: "order.paid",
    data: { id: "ord_tampered_999", product_id: "prod_starter_111", subscription_id: "sub_ord_diff", billing_reason: "subscription_create", customer_id: "cust_ord_diff", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payloadTampered, { "webhook-id": "msg_ord_diff" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

test("G. AMBIGUOUS P2002 CONSTRAINT: P2002 on another constraint is NOT swallowed and rethrows", async () => {
  const db = createMockDb();

  const customDb = {
    ...db,
    $transaction: async () => {
      const err = new Error("Unique constraint failed on the fields: (`otherConstraint`)");
      err.code = "P2002";
      err.meta = { modelName: "BillingWebhookEvent", target: ["otherConstraint"] };
      throw err;
    },
  };

  const payload = {
    id: "msg_ambiguous_p2002",
    type: "order.paid",
    data: { id: "ord_ambiguous", product_id: "prod_starter_111", subscription_id: "sub_amb", billing_reason: "subscription_create", customer_id: "cust_amb", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payload, { "webhook-id": "msg_ambiguous_p2002" }, customDb),
    (err) => err.code === "P2002" && err.meta?.target?.[0] === "otherConstraint"
  );
});

test("H. TARGETED P2002 CONCURRENCY RACE: P2002 specifically on polarEventId resolves to ALREADY_PROCESSED", async () => {
  const db = createMockDb();
  db._store.billingWebhookEvent.set("msg_target_race", {
    id: "bwe_target_race",
    polarEventId: "msg_target_race",
    eventType: "order.paid",
    payloadJson: JSON.stringify({
      id: "msg_target_race",
      type: "order.paid",
      data: { id: "ord_target_race", product_id: "prod_starter_111", subscription_id: "sub_target_race", billing_reason: "subscription_create", customer_id: "cust_target_race", metadata: { supabaseUserId: "sup_123" } },
    }),
    processedAt: new Date(),
  });

  const customDb = {
    ...db,
    $transaction: async () => {
      const err = new Error("Unique constraint failed on the fields: (`polarEventId`)");
      err.code = "P2002";
      err.meta = { modelName: "BillingWebhookEvent", target: ["polarEventId"] };
      throw err;
    },
  };

  const payload = {
    id: "msg_target_race",
    type: "order.paid",
    data: { id: "ord_target_race", product_id: "prod_starter_111", subscription_id: "sub_target_race", billing_reason: "subscription_create", customer_id: "cust_target_race", metadata: { supabaseUserId: "sup_123" } },
  };

  const res = await processPolarBillingEvent(payload, { "webhook-id": "msg_target_race" }, customDb);
  assert.equal(res.status, "ALREADY_PROCESSED");
  assert.equal(res.webhookId, "msg_target_race");
});

test("RENEWAL REGRESSION: Existing subscription + new subscription_cycle order grants new credits exactly once", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";

  const db = createMockDb();

  // Month 1 purchase
  const initialPayload = {
    id: "msg_init_cycle",
    type: "order.paid",
    data: { id: "ord_init_cycle", product_id: "prod_starter_111", subscription_id: "sub_cycle_reg", billing_reason: "subscription_create", customer_id: "cust_cycle_reg", metadata: { supabaseUserId: "sup_123" } },
  };
  await processPolarBillingEvent(initialPayload, { "webhook-id": "msg_init_cycle" }, db);
  assertGrants(db, [STARTER_CREDITS], "month 1 purchase");

  // Month 2 renewal order (new order ID)
  const renewalPayload = {
    id: "msg_renew_cycle",
    type: "order.paid",
    data: { id: "ord_renew_cycle", product_id: "prod_starter_111", subscription_id: "sub_cycle_reg", billing_reason: "subscription_cycle", customer_id: "cust_cycle_reg", metadata: { supabaseUserId: "sup_123" } },
  };
  const resCycle = await processPolarBillingEvent(renewalPayload, { "webhook-id": "msg_renew_cycle" }, db);
  assert.equal(resCycle.status, "PROCESSED");
  // EXACTLY ONCE for the renewal: two ledger grants in total, never three, never one.
  assertGrants(db, [STARTER_CREDITS, STARTER_CREDITS], "month 1 purchase + month 2 renewal");

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});


