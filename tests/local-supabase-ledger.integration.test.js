import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const localDatabase = process.env.DATABASE_URL?.includes("127.0.0.1:54322") && process.env.DIRECT_URL?.includes("127.0.0.1:54322");
// A hosted database is eligible only after the workflow guard has verified that
// all TEST_* URLs point to the same non-production Supabase project. This keeps
// a stray DATABASE_URL in a developer shell from ever enabling TRUNCATE.
const remoteDisposableStaging =
  process.env.RUN_REMOTE_STAGING_INTEGRATION === "1" &&
  process.env.DOOLPHIN_DISPOSABLE_TARGET_VERIFIED === "true";
const integrationDatabase = localDatabase || remoteDisposableStaging;
const integrationTest = integrationDatabase ? test : test.skip;

const require = createRequire(import.meta.url);
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: integrationDatabase ? process.env.DIRECT_URL : "postgresql://invalid" });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
let grantCreditsIdempotently;
const now = new Date("2026-08-11T12:00:00.000Z");
let sequence = 0;
const id = (prefix) => `${prefix}_${++sequence}`;

async function clear() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "LegalConsent", "CreditGrantSchedule", "CreditLedgerEntry", "BillingWebhookEvent", "BillingCustomer", "Entitlement", "LedgerCutover", "CreditReservation", "CreditTransaction", "CreditAccount", "WorkspaceMember", "Workspace", "User" CASCADE');
}
async function fixture({ activationStatus = "ACTIVATED", email = null } = {}) {
  const user = await db.user.create({ data: { email: email || `${id("user")}@example.test`, normalizedEmail: email || undefined, supabaseUserId: id("supabase"), activationStatus } });
  const workspace = await db.workspace.create({ data: { name: id("workspace"), ownerUserId: user.id } });
  await db.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } });
  await db.creditAccount.create({ data: { workspaceId: workspace.id, availableCredits: 0, lifetimeIssuedCredits: 0 } });
  await db.user.update({ where: { id: user.id }, data: { defaultWorkspaceId: workspace.id } });
  return { user: { ...user, defaultWorkspaceId: workspace.id }, workspace };
}
async function grant({ workspaceId, userId, amount, reason, key }) { return grantCreditsIdempotently({ workspaceId, userId, amount, reason, idempotencyKey: key }, db); }
async function annualSchedule(entitlement, credits) {
  for (let periodIndex = 0; periodIndex < 12; periodIndex += 1) {
    const dueAt = new Date(Date.UTC(entitlement.startsAt.getUTCFullYear(), entitlement.startsAt.getUTCMonth() + periodIndex, entitlement.startsAt.getUTCDate()));
    await db.creditGrantSchedule.upsert({ where: { entitlementId_periodIndex: { entitlementId: entitlement.id, periodIndex } }, update: {}, create: { entitlementId: entitlement.id, workspaceId: entitlement.workspaceId, userId: entitlement.userId, periodIndex, periodStartsAt: dueAt, dueAt, credits, idempotencyKey: `annual-grant:${entitlement.id}:${periodIndex}` } });
  }
}
async function processDue(nowAt) {
  const schedules = await db.creditGrantSchedule.findMany({ where: { status: "PENDING", dueAt: { lte: nowAt } } });
  for (const row of schedules) await db.$transaction(async (tx) => {
    const current = await tx.creditGrantSchedule.findUnique({ where: { id: row.id } });
    const entitlement = await tx.entitlement.findUnique({ where: { id: row.entitlementId } });
    if (!current || current.status !== "PENDING") return;
    if (!entitlement || entitlement.grantsStoppedAt || entitlement.endsAt <= nowAt) { await tx.creditGrantSchedule.update({ where: { id: row.id }, data: { status: "STOPPED", stoppedAt: nowAt } }); return; }
    await grant({ workspaceId: row.workspaceId, userId: row.userId, amount: row.credits, reason: "STARTER_MONTHLY_GRANT", key: row.idempotencyKey });
    await tx.creditGrantSchedule.update({ where: { id: row.id }, data: { status: "GRANTED", grantedAt: nowAt } });
  });
}
async function reconcile(workspaceId) {
  const account = await db.creditAccount.findUnique({ where: { workspaceId } });
  const unresolved = await db.creditReservation.count({ where: { workspaceId, status: "RESERVED" } });
  if (!account || unresolved) return db.ledgerCutover.upsert({ where: { workspaceId }, update: { status: "BLOCKED" }, create: { workspaceId, status: "BLOCKED" } });
  const existing = await db.creditLedgerEntry.findFirst({ where: { workspaceId, reason: "LEGACY_OPENING_BALANCE" } });
  if (!existing) await db.creditLedgerEntry.create({ data: { workspaceId, amount: account.availableCredits, reason: "LEGACY_OPENING_BALANCE", idempotencyKey: `opening:${workspaceId}` } });
  const total = await db.creditLedgerEntry.aggregate({ where: { workspaceId }, _sum: { amount: true } });
  const discrepancy = (total._sum.amount || 0) - account.availableCredits;
  return db.ledgerCutover.upsert({ where: { workspaceId }, update: { status: discrepancy ? "BLOCKED" : "RECONCILED", discrepancyCredits: discrepancy }, create: { workspaceId, status: discrepancy ? "BLOCKED" : "RECONCILED", discrepancyCredits: discrepancy } });
}

if (integrationDatabase) {
  before(async () => { ({ grantCreditsIdempotently } = await import("../src/lib/entitlements/ledger.js")); await clear(); });
  after(async () => {
    await clear();
    await db.legalDocumentVersion.deleteMany({ where: { documentType: "TERMS", version: "integration-test-v1" } });
    await db.$disconnect();
    await pool.end();
  });
}

integrationTest("database: Explorer partial unique indexes reject repeat user, workspace, and customer claims", async () => {
  const a = await fixture(); const b = await fixture();
  await db.entitlement.create({ data: { userId: a.user.id, workspaceId: a.workspace.id, planCode: "EXPLORER", billingInterval: "ONE_TIME", polarCustomerId: "cust-local", polarOrderId: "order-local", startsAt: now, endsAt: new Date("2036-01-01") } });
  await assert.rejects(() => db.entitlement.create({ data: { userId: a.user.id, workspaceId: b.workspace.id, planCode: "EXPLORER", billingInterval: "ONE_TIME", startsAt: now, endsAt: now } }));
  await assert.rejects(() => db.entitlement.create({ data: { userId: b.user.id, workspaceId: a.workspace.id, planCode: "EXPLORER", billingInterval: "ONE_TIME", startsAt: now, endsAt: now } }));
  await assert.rejects(() => db.entitlement.create({ data: { userId: b.user.id, workspaceId: b.workspace.id, planCode: "EXPLORER", billingInterval: "ONE_TIME", polarCustomerId: "cust-local", startsAt: now, endsAt: now } }));
});

integrationTest("database: twenty concurrent duplicate billing grants produce one mutation and nineteen benign no-ops", async () => {
  const { user, workspace } = await fixture();
  await db.billingWebhookEvent.create({ data: { polarEventId: "evt-local", eventType: "order.created", payloadJson: "{}" } });
  await assert.rejects(() => db.billingWebhookEvent.create({ data: { polarEventId: "evt-local", eventType: "order.created", payloadJson: "{}" } }));
  const results = await Promise.all(Array.from({ length: 20 }, () => grant({ workspaceId: workspace.id, userId: user.id, amount: 50, reason: "EXPLORER_GRANT", key: "webhook:evt-local" })));
  assert.equal(results.filter((result) => result.status === "PROCESSED").length, 1);
  assert.equal(results.filter((result) => result.status === "ALREADY_PROCESSED").length, 19);
  assert.equal((await db.creditAccount.findUnique({ where: { workspaceId: workspace.id } })).availableCredits, 50);
  assert.equal(await db.creditLedgerEntry.count({ where: { workspaceId: workspace.id } }), 1);
});

integrationTest("database: exact Explorer, Starter, Growth and Agency grants are ledgered", async () => {
  const grants = [["EXPLORER_GRANT", 50], ["STARTER_MONTHLY_GRANT", 700], ["GROWTH_MONTHLY_GRANT", 1900], ["AGENCY_MONTHLY_GRANT", 4300]];
  for (const [reason, amount] of grants) { const { user, workspace } = await fixture(); await grant({ workspaceId: workspace.id, userId: user.id, amount, reason, key: id("grant") }); assert.equal((await db.creditAccount.findUnique({ where: { workspaceId: workspace.id } })).availableCredits, amount); }
});

integrationTest("database: annual schedule has twelve periods, catches up once, continues through cancel-at-period-end, and stops after immediate revocation", async () => {
  const { user, workspace } = await fixture();
  const entitlement = await db.entitlement.create({ data: { userId: user.id, workspaceId: workspace.id, planCode: "STARTER_ANNUAL", billingInterval: "ANNUAL", status: "CANCEL_AT_PERIOD_END", startsAt: now, endsAt: new Date("2027-08-11") } });
  await annualSchedule(entitlement, 700); assert.equal(await db.creditGrantSchedule.count({ where: { entitlementId: entitlement.id } }), 12);
  await processDue(new Date("2026-10-11")); await processDue(new Date("2026-10-11"));
  assert.equal((await db.creditLedgerEntry.aggregate({ where: { workspaceId: workspace.id }, _sum: { amount: true } }))._sum.amount, 2100);
  await db.entitlement.update({ where: { id: entitlement.id }, data: { grantsStoppedAt: new Date("2026-10-12") } }); await processDue(new Date("2026-11-12"));
  assert.equal((await db.creditGrantSchedule.findFirst({ where: { entitlementId: entitlement.id, periodIndex: 3 } })).status, "STOPPED");
});

integrationTest("database: Ledger V2 blocks unresolved reservations, creates one opening entry, and blocks discrepancies without repair", async () => {
  const { workspace } = await fixture();
  await db.creditAccount.update({ where: { workspaceId: workspace.id }, data: { availableCredits: 23 } });
  const creation = await db.creation.create({ data: { workspaceId: workspace.id, userId: (await db.workspaceMember.findFirst({ where: { workspaceId: workspace.id } })).userId, generationType: "LEGACY", presetId: "local-test", idempotencyKey: id("creation"), status: "DRAFT" } });
  const variant = await db.creationVariant.create({ data: { creationId: creation.id, variantIndex: 0, status: "DRAFT" } });
  await db.creditReservation.create({ data: { workspaceId: workspace.id, creationId: creation.id, creationVariantId: variant.id, amount: 2, idempotencyKey: id("reserve") } });
  assert.equal((await reconcile(workspace.id)).status, "BLOCKED");
  await db.creditReservation.updateMany({ where: { workspaceId: workspace.id }, data: { status: "RELEASED", releasedAt: now } });
  assert.equal((await reconcile(workspace.id)).status, "RECONCILED"); await reconcile(workspace.id);
  assert.equal(await db.creditLedgerEntry.count({ where: { workspaceId: workspace.id, reason: "LEGACY_OPENING_BALANCE" } }), 1);
  await db.creditLedgerEntry.create({ data: { workspaceId: workspace.id, amount: 1, reason: "ADMIN_ADJUSTMENT", idempotencyKey: id("unexpected") } });
  assert.equal((await reconcile(workspace.id)).status, "BLOCKED");
  assert.equal(await db.creditLedgerEntry.count({ where: { workspaceId: workspace.id } }), 2);
});

integrationTest("database: LegalConsent is bound to the identity and document version, and duplicate acceptance is rejected", async () => {
  const { user } = await fixture();
  const terms = await db.legalDocumentVersion.upsert({
    where: { documentType_version: { documentType: "TERMS", version: "integration-test-v1" } },
    update: { isCurrent: true },
    create: { documentType: "TERMS", version: "integration-test-v1", contentHash: "integration-test-terms", isCurrent: true },
  });
  await db.legalConsent.create({ data: { userId: user.id, supabaseUserId: user.supabaseUserId, legalDocumentVersionId: terms.id, source: "LOCAL_TEST" } });
  await assert.rejects(() => db.legalConsent.create({ data: { userId: user.id, supabaseUserId: user.supabaseUserId, legalDocumentVersionId: terms.id, source: "LOCAL_TEST" } }));
});
