process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import assert from "node:assert/strict";
import test from "node:test";

const { getPolarConfig } = await import("../src/lib/billing/polarEnvironment.js");
const { processPolarBillingEvent, resolvePlanFromPolarProduct } = await import("../src/lib/billing/polarWebhookProcessor.js");
const { annualPeriods, materializeAnnualGrantSchedule, processDueGrantSchedules } = await import("../src/lib/entitlements/grants.js");

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

  // Scenario 1: Recognized Starter product + metadata Agency -> Starter authority wins (700 credits granted, NOT 4300)
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
  assert.equal(db1._store.creditAccount.get("ws_123").availableCredits, 800);

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
  assert.equal(db2._store.creditAccount.get("ws_123").availableCredits, 800);

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
  assert.equal(db3._store.creditAccount.get("ws_123").availableCredits, 100);

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
  assert.equal(db4._store.creditAccount.get("ws_123").availableCredits, 100);

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
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 100);

  payload.data.metadata.supabaseUserId = "sup_123";
  const retryRes = await processPolarBillingEvent(payload, mockHeader("msg_fail_mid_tx"), db);
  assert.equal(retryRes.status, "PROCESSED");
  assert.equal(db._store.billingWebhookEvent.get("msg_fail_mid_tx").processedAt !== null, true);
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 150);

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

test("CREDIT INVARIANT: order.created issues ZERO billing credits", async () => {
  const db = createMockDb();
  const payload = {
    id: "msg_evt_created_1",
    type: "order.created",
    data: { id: "ord_100", status: "created", billing_reason: "subscription_create", metadata: { supabaseUserId: "sup_123" } },
  };

  const res = await processPolarBillingEvent(payload, mockHeader("msg_evt_created_1"), db);
  assert.equal(res.status, "PROCESSED_NO_GRANT");
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 100);
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
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 800);

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
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 1500);

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
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 800);
  assert.equal(db._store.creditGrantSchedule.size, 12);

  const cronProcessed = await processDueGrantSchedules(new Date(), db);
  assert.equal(cronProcessed, 0);
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 800);

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

test("CONCURRENCY DEDUPLICATION: P2002 on polarEventId returns ALREADY_PROCESSED when processed event exists", async () => {
  const db = createMockDb();
  db._store.billingWebhookEvent.set("msg_race_1", {
    id: "bwe_race_1",
    polarEventId: "msg_race_1",
    eventType: "order.paid",
    payloadJson: JSON.stringify({
      id: "msg_race_1",
      type: "order.paid",
      data: { id: "ord_race_1", product_id: "prod_starter_111", subscription_id: "sub_race_1", billing_reason: "subscription_create", customer_id: "cust_race_1", metadata: { supabaseUserId: "sup_123" } },
    }),
    processedAt: new Date(),
  });

  // Force transaction to throw P2002 specifically for polarEventId
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
    id: "msg_race_1",
    type: "order.paid",
    data: { id: "ord_race_1", product_id: "prod_starter_111", subscription_id: "sub_race_1", billing_reason: "subscription_create", customer_id: "cust_race_1", metadata: { supabaseUserId: "sup_123" } },
  };

  const res = await processPolarBillingEvent(payload, { "webhook-id": "msg_race_1" }, customDb);
  assert.equal(res.status, "ALREADY_PROCESSED");
  assert.equal(res.webhookId, "msg_race_1");
});

test("CONCURRENCY INTEGRITY: P2002 from non-webhook constraint is NOT swallowed and rethrows", async () => {
  const db = createMockDb();

  const customDb = {
    ...db,
    $transaction: async () => {
      const err = new Error("Unique constraint failed on the fields: (`polarOrderId`)");
      err.code = "P2002";
      err.meta = { modelName: "Entitlement", target: ["polarOrderId"] };
      throw err;
    },
  };

  const payload = {
    id: "msg_other_p2002",
    type: "order.paid",
    data: { id: "ord_other_p2002", product_id: "prod_starter_111", subscription_id: "sub_other", billing_reason: "subscription_create", customer_id: "cust_other", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payload, { "webhook-id": "msg_other_p2002" }, customDb),
    (err) => err.code === "P2002" && err.meta?.modelName === "Entitlement"
  );
});

test("PAYLOAD INTEGRITY: Duplicate webhook ID with conflicting payload fails closed", async () => {
  process.env.POLAR_PRODUCT_STARTER_MONTHLY = "prod_starter_111";
  process.env.POLAR_PRODUCT_GROWTH_MONTHLY = "prod_growth_222";

  const db = createMockDb();
  const payloadOriginal = {
    id: "msg_reuse_1",
    type: "order.paid",
    data: { id: "ord_orig", product_id: "prod_starter_111", subscription_id: "sub_orig", billing_reason: "subscription_create", customer_id: "cust_orig", metadata: { supabaseUserId: "sup_123" } },
  };

  await processPolarBillingEvent(payloadOriginal, { "webhook-id": "msg_reuse_1" }, db);

  const payloadConflicting = {
    id: "msg_reuse_1",
    type: "order.paid",
    data: { id: "ord_TAMPERED", product_id: "prod_growth_222", subscription_id: "sub_TAMPERED", billing_reason: "subscription_create", customer_id: "cust_TAMPERED", metadata: { supabaseUserId: "sup_123" } },
  };

  await assert.rejects(
    async () => processPolarBillingEvent(payloadConflicting, { "webhook-id": "msg_reuse_1" }, db),
    (err) => err.code === "IDEMPOTENCY_INTEGRITY_CONFLICT"
  );

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
  delete process.env.POLAR_PRODUCT_GROWTH_MONTHLY;
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
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 800);

  // Month 2 renewal order (new order ID)
  const renewalPayload = {
    id: "msg_renew_cycle",
    type: "order.paid",
    data: { id: "ord_renew_cycle", product_id: "prod_starter_111", subscription_id: "sub_cycle_reg", billing_reason: "subscription_cycle", customer_id: "cust_cycle_reg", metadata: { supabaseUserId: "sup_123" } },
  };
  const resCycle = await processPolarBillingEvent(renewalPayload, { "webhook-id": "msg_renew_cycle" }, db);
  assert.equal(resCycle.status, "PROCESSED");
  assert.equal(db._store.creditAccount.get("ws_123").availableCredits, 1500);

  delete process.env.POLAR_PRODUCT_STARTER_MONTHLY;
});

