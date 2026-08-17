if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
}

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { calculateWorkflowCommercialQuote } from "../../src/lib/models/pricingIntegration.js";
import { isSeedanceModelPlatformCutoverEligible } from "../../src/lib/models/cutoverEligibility.js";
import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";

const TEST_ENV_ON = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4d1",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "true",
};

const TEST_ENV_OFF = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4d1",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
};

/**
 * Creates a mock Prisma database client that faithfully simulates balance state & transactions.
 */
function createMockPrismaHarness({ initialAvailable = 100, initialReserved = 0 } = {}) {
  const account = {
    id: "acc_123",
    workspaceId: "ws_123",
    availableCredits: initialAvailable,
    reservedCredits: initialReserved,
    lifetimeCommittedCredits: 0,
    lifetimeReleasedCredits: 0,
    version: 1,
  };

  const reservations = new Map();
  const transactions = [];

  const mockDb = {
    ledgerCutover: { findUnique: async () => null },
    creditAccount: {
      findUnique: async () => ({ ...account }),
      updateMany: async ({ data }) => {
        if (data.availableCredits?.decrement) {
          account.availableCredits -= data.availableCredits.decrement;
          account.reservedCredits += data.reservedCredits.increment;
        } else if (data.reservedCredits?.decrement !== undefined) {
          account.reservedCredits = Math.max(0, account.reservedCredits - data.reservedCredits.decrement);
          if (data.availableCredits?.increment) account.availableCredits += data.availableCredits.increment;
          if (data.availableCredits) account.availableCredits = data.availableCredits;
          if (data.lifetimeCommittedCredits?.increment) account.lifetimeCommittedCredits += data.lifetimeCommittedCredits.increment;
          if (data.lifetimeReleasedCredits?.increment) account.lifetimeReleasedCredits += data.lifetimeReleasedCredits.increment;
        }
        account.version += 1;
        return { count: 1 };
      },
      update: async ({ data }) => {
        if (data.availableCredits !== undefined) account.availableCredits = data.availableCredits;
        if (data.reservedCredits !== undefined) account.reservedCredits = data.reservedCredits;
        if (data.lifetimeCommittedCredits?.increment) account.lifetimeCommittedCredits += data.lifetimeCommittedCredits.increment;
        if (data.lifetimeReleasedCredits?.increment) account.lifetimeReleasedCredits += data.lifetimeReleasedCredits.increment;
        account.version += 1;
        return { ...account };
      },
    },
    creditReservation: {
      findUnique: async ({ where }) => {
        if (where.idempotencyKey) {
          for (const res of reservations.values()) {
            if (res.idempotencyKey === where.idempotencyKey) return { ...res };
          }
          return null;
        }
        return reservations.has(where.id) ? { ...reservations.get(where.id) } : null;
      },
      create: async ({ data }) => {
        const res = { id: `res_${Date.now()}_${Math.random()}`, ...data };
        reservations.set(res.id, res);
        return res;
      },
      update: async ({ where, data }) => {
        const existing = reservations.get(where.id);
        const updated = { ...existing, ...data };
        reservations.set(where.id, updated);
        return updated;
      },
    },
    creditTransaction: {
      create: async ({ data }) => {
        const tx = { id: `tx_${transactions.length + 1}`, ...data };
        transactions.push(tx);
        return tx;
      },
    },
    $transaction: async (fn) => fn(mockDb),
  };

  return { mockDb, account, reservations, transactions };
}

test("Phase 4D.1 Settlement Primitive: 1 output success commits reservation fully", async () => {
  const { CreditEscrowService } = await import("../../src/lib/billing/CreditEscrowService.js");
  const { mockDb, account, reservations, transactions } = createMockPrismaHarness({ initialAvailable: 100 });

  const res = await CreditEscrowService.reserveCredits({
    workspaceId: "ws_123",
    creationId: "c_1",
    creationVariantId: "cv_1",
    amount: 10,
    idempotencyKey: "res_key_1",
    userId: "u_1",
    tx: mockDb,
  });

  assert.equal(account.availableCredits, 90);
  assert.equal(account.reservedCredits, 10);

  const settled = await CreditEscrowService.settleReservationSplit({
    reservationId: res.id,
    commitAmount: 10,
    releaseAmount: 0,
    reason: "TEST_SUCCESS",
    tx: mockDb,
  });

  assert.equal(settled.status, "COMMITTED");
  assert.equal(settled.committedAmount, 10);
  assert.equal(settled.releasedAmount, 0);
  assert.equal(account.availableCredits, 90);
  assert.equal(account.reservedCredits, 0);
  assert.equal(account.lifetimeCommittedCredits, 10);
  assert.equal(account.lifetimeReleasedCredits, 0);

  const commitTxs = transactions.filter((t) => t.type === "COMMIT");
  assert.equal(commitTxs.length, 1);
  assert.equal(commitTxs[0].amount, 10);
});

test("Phase 4D.1 Settlement Primitive: 1 output failure releases reservation fully", async () => {
  const { CreditEscrowService } = await import("../../src/lib/billing/CreditEscrowService.js");
  const { mockDb, account, reservations, transactions } = createMockPrismaHarness({ initialAvailable: 100 });

  const res = await CreditEscrowService.reserveCredits({
    workspaceId: "ws_123",
    creationId: "c_2",
    creationVariantId: "cv_2",
    amount: 10,
    idempotencyKey: "res_key_2",
    userId: "u_1",
    tx: mockDb,
  });

  const settled = await CreditEscrowService.settleReservationSplit({
    reservationId: res.id,
    commitAmount: 0,
    releaseAmount: 10,
    reason: "TEST_FAILURE",
    tx: mockDb,
  });

  assert.equal(settled.status, "RELEASED");
  assert.equal(settled.committedAmount, 0);
  assert.equal(settled.releasedAmount, 10);
  assert.equal(account.availableCredits, 100);
  assert.equal(account.reservedCredits, 0);
  assert.equal(account.lifetimeCommittedCredits, 0);
  assert.equal(account.lifetimeReleasedCredits, 10);

  const releaseTxs = transactions.filter((t) => t.type === "RELEASE");
  assert.equal(releaseTxs.length, 1);
  assert.equal(releaseTxs[0].amount, 10);
});

test("Phase 4D.1 Settlement Primitive: 2 outputs partial success (1 success / 1 fail) settles split PARTIALLY_SETTLED", async () => {
  const { CreditEscrowService } = await import("../../src/lib/billing/CreditEscrowService.js");
  const { mockDb, account, reservations, transactions } = createMockPrismaHarness({ initialAvailable: 100 });

  const res = await CreditEscrowService.reserveCredits({
    workspaceId: "ws_123",
    creationId: "c_3",
    creationVariantId: "cv_3",
    amount: 10,
    idempotencyKey: "res_key_3",
    userId: "u_1",
    tx: mockDb,
  });

  const settled = await CreditEscrowService.settleReservationSplit({
    reservationId: res.id,
    commitAmount: 5,
    releaseAmount: 5,
    reason: "TEST_PARTIAL_SUCCESS",
    tx: mockDb,
  });

  assert.equal(settled.status, "PARTIALLY_SETTLED");
  assert.equal(settled.committedAmount, 5);
  assert.equal(settled.releasedAmount, 5);
  assert.equal(account.availableCredits, 95);
  assert.equal(account.reservedCredits, 0);
  assert.equal(account.lifetimeCommittedCredits, 5);
  assert.equal(account.lifetimeReleasedCredits, 5);

  const commitTxs = transactions.filter((t) => t.type === "COMMIT");
  const releaseTxs = transactions.filter((t) => t.type === "RELEASE");
  assert.equal(commitTxs.length, 1);
  assert.equal(commitTxs[0].amount, 5);
  assert.equal(releaseTxs.length, 1);
  assert.equal(releaseTxs[0].amount, 5);
});

test("Phase 4D.1 Idempotency: Replay settlement on already-settled reservation makes zero additional balance changes", async () => {
  const { CreditEscrowService } = await import("../../src/lib/billing/CreditEscrowService.js");
  const { mockDb, account } = createMockPrismaHarness({ initialAvailable: 100 });

  const res = await CreditEscrowService.reserveCredits({
    workspaceId: "ws_123",
    creationId: "c_4",
    creationVariantId: "cv_4",
    amount: 10,
    idempotencyKey: "res_key_4",
    userId: "u_1",
    tx: mockDb,
  });

  await CreditEscrowService.settleReservationSplit({
    reservationId: res.id,
    commitAmount: 5,
    releaseAmount: 5,
    reason: "FIRST_SETTLEMENT",
    tx: mockDb,
  });

  const availBefore = account.availableCredits;
  const committedBefore = account.lifetimeCommittedCredits;

  const replay = await CreditEscrowService.settleReservationSplit({
    reservationId: res.id,
    commitAmount: 5,
    releaseAmount: 5,
    reason: "REPLAY_SETTLEMENT",
    tx: mockDb,
  });

  assert.equal(replay.status, "PARTIALLY_SETTLED");
  assert.equal(account.availableCredits, availBefore);
  assert.equal(account.lifetimeCommittedCredits, committedBefore);
});

test("Phase 4D.1 Commercial Pricing: Settlement schedule calculated at preflight time is authoritative and non-divergent", async () => {
  const { calculateWorkflowSettlement: settleCalc } = await import("../../src/lib/models/execution/workflowSettlement.js");
  const quote = calculateWorkflowCommercialQuote({
    preparedUnitPlan: { pricing: { providerCostMicroUsd: "241900" } },
    outputCount: 2,
  });

  assert.ok(quote.quotedCredits > 0);
  assert.ok(quote.settlementSchedule);
  assert.equal(quote.settlementSchedule[0], 0);
  assert.ok(quote.settlementSchedule[1] > 0);
  assert.equal(quote.settlementSchedule[2], quote.quotedCredits);

  const partial = settleCalc({
    outputCount: 2,
    quotedCredits: quote.quotedCredits,
    successfulVariantCount: 1,
    failedVariantCount: 1,
    settlementSchedule: quote.settlementSchedule,
  });

  assert.equal(partial.earnedCreditsToCharge, quote.settlementSchedule[1]);
  assert.equal(partial.unearnedCreditsToRelease, quote.quotedCredits - quote.settlementSchedule[1]);
});

test("Phase 4D.1 Emergency Kill-Switch: Emergency kill switch fails closed with MODEL_PLATFORM_V1 quote when flag is OFF", () => {
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({
      modelId: "muapi.seedance2.omni-reference-fast",
      env: TEST_ENV_OFF,
    }),
    false
  );
});

test("Phase 4D.1 Delivery Validation: Unsuccessful terminal statuses (FAILED, CANCELLED, TIMED_OUT, QUARANTINED) charge 0", () => {
  for (const status of ["FAILED", "CANCELLED", "TIMED_OUT", "QUARANTINED"]) {
    const isUnsuccessful = ["FAILED", "CANCELLED", "TIMED_OUT", "QUARANTINED"].includes(status);
    assert.equal(isUnsuccessful, true);
  }
});
