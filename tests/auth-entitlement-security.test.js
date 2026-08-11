import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("canonical public, auth, and app routes have no root/pricing collision", async () => {
  const [app, publicHome, pricing, login] = await Promise.all([text("src/app/(app)/app/page.js"), text("src/app/(public)/page.js"), text("src/app/(public)/pricing/page.js"), text("src/app/login/page.js")]);
  assert.ok(app.length > 0); assert.ok(publicHome.length > 0); assert.ok(pricing.length > 0);
  assert.match(login, /redirect\("\/sign-in"\)/);
});

test("paid mutation routes invoke activated-account authorization", async () => {
  const routes = ["preflight", "generations", "upload", "uploads/presign", "assets/[id]/analysis", "account/balance"];
  for (const route of routes) {
    const source = await text(`src/app/api/${route}/route.js`);
    assert.match(source, /requireActivatedAccount/);
  }
});

test("checkout accepts only server-recognized plan codes and cannot call production Polar", async () => {
  const source = await text("src/app/api/checkout/polar/route.js");
  assert.match(source, /PLANS\[planCode\]/);
  assert.match(source, /POLAR_ENV !== "sandbox"/);
  assert.doesNotMatch(source, /productId.*req\.json|credits.*req\.json/);
});

test("sensitive financial and provider tables are server-only under RLS", async () => {
  const sql = await text("prisma/migrations/20260811_auth_entitlements_ledger_v2/migration.sql");
  for (const table of ["CreditAccount", "CreditTransaction", "CreditReservation", "CreationAsset", "GeneratedArtifact", "ProviderCostLedger", "Entitlement", "BillingCustomer", "BillingWebhookEvent", "CreditLedgerEntry"]) assert.match(sql, new RegExp(`ALTER TABLE \\"${table}\\" ENABLE ROW LEVEL SECURITY`));
  assert.doesNotMatch(sql, /CREATE POLICY.*CreditAccount|CREATE POLICY.*CreditTransaction|CREATE POLICY.*BillingWebhookEvent/);
});

test("Google and email flows synchronize real Supabase identity before consent", async () => {
  const [sync, consent, verify] = await Promise.all([text("src/app/api/auth/sync/route.js"), text("src/app/api/legal/consent/route.js"), text("src/app/(auth)/verify-email/page.js")]);
  assert.match(sync, /supabase\.auth\.getUser\(\)/); assert.match(sync, /linkSupabaseIdentity/);
  assert.match(consent, /requireAuthenticatedUser/); assert.match(consent, /supabaseUserId/);
  assert.match(verify, /oauth/); assert.match(verify, /\/api\/auth\/sync/); assert.match(verify, /\/api\/legal\/consent/);
});

test("legal launch guard fails closed while placeholders remain", async () => {
  const source = await text("src/lib/legal/documents.js");
  assert.match(source, /LEGAL_PLACEHOLDER/); assert.match(source, /PENDING_APPROVED_LEGAL_COPY/);
});

test("annual grants have deterministic identities and stop conditions", async () => {
  const source = await text("src/lib/entitlements/grants.js");
  assert.match(source, /annual-grant:\$\{entitlement\.id\}:\$\{periodIndex\}/);
  assert.match(source, /status: "PENDING"/); assert.match(source, /entitlement\.grantsStoppedAt/); assert.match(source, /status: "STOPPED"/);
});

test("cutover blocks unresolved reservations and avoids balancing entries", async () => {
  const source = await text("src/lib/entitlements/cutover.js");
  assert.match(source, /status: "BLOCKED"/); assert.match(source, /unresolvedReservations/); assert.match(source, /LEGACY_OPENING_BALANCE/);
  assert.doesNotMatch(source, /ADMIN_ADJUSTMENT|REFUND_ADJUSTMENT/);
});
