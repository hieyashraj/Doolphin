import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isActivatedUser, postSignInDestination, safeAccountState } from "../src/lib/access/account-state.js";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

const activatedFixture = {
  authUser: { email: "activated@example.test", email_confirmed_at: "2026-08-12T19:09:16.888Z" },
  appUser: { id: "user_activated", activationStatus: "ACTIVATED", subscriptionStatus: "ACTIVE", defaultWorkspaceId: "workspace_starter" },
  membership: { workspaceId: "workspace_starter", userId: "user_activated", role: "OWNER" },
  workspace: { id: "workspace_starter", billingPlan: "starter", status: "ACTIVE" },
  entitlement: { workspaceId: "workspace_starter", userId: "user_activated", planCode: "STARTER_MONTHLY", status: "ACTIVE" },
  creditAccount: { availableCredits: 700 },
};

test("activated Starter fixture reaches /app and receives its safe 700-credit account state", () => {
  assert.equal(isActivatedUser(activatedFixture.appUser), true);
  assert.equal(activatedFixture.membership.workspaceId, activatedFixture.appUser.defaultWorkspaceId);
  assert.equal(activatedFixture.entitlement.status, "ACTIVE");
  assert.equal(activatedFixture.entitlement.planCode, "STARTER_MONTHLY");
  assert.equal(postSignInDestination({ ok: true }), "/app");
  assert.deepEqual(safeAccountState(activatedFixture), { name: "activated", email: "activated@example.test", credits: 700, planCode: "STARTER_MONTHLY" });
});

test("verified but unpaid accounts continue to pricing", () => {
  assert.equal(isActivatedUser({ activationStatus: "VERIFIED_PAYWALLED" }), false);
  assert.equal(postSignInDestination({ ok: false }), "/pricing");
});

test("activated authorization requires the linked default-workspace membership and active entitlement", async () => {
  const source = await text("src/lib/access/authorization.js");
  assert.match(source, /activationStatus === "SUSPENDED"/);
  assert.match(source, /workspaceId_userId/);
  // The active-entitlement predicate was inline here and duplicated; it now lives
  // in one place so the layout gate, the feature check and any future middleware
  // cannot drift apart about who has paid.
  assert.match(source, /findActiveEntitlement/);
  assert.match(source, /ACCOUNT_DENIED/);
  // A missing or lapsed entitlement must be ACTIVATION_REQUIRED (-> /pricing),
  // never ACCOUNT_DENIED (-> a dead end), because paying fixes it.
  assert.match(source, /if \(!entitlement\) throw new AuthorizationError\("ACTIVATION_REQUIRED", 402\)/);
});

test("the single active-entitlement predicate keeps paid-through-period-end access", async () => {
  const { ACTIVE_ENTITLEMENT_STATUSES, activeEntitlementWhere } = await import("../src/lib/access/entitlement.js");
  // Someone who cancels has paid through the end of the period. Access must end
  // on endsAt, not on the moment they click cancel.
  assert.deepEqual([...ACTIVE_ENTITLEMENT_STATUSES], ["ACTIVE", "CANCEL_AT_PERIOD_END"]);
  for (const status of ["REVOKED", "EXPIRED", "PENDING_REVIEW"]) {
    assert.ok(!ACTIVE_ENTITLEMENT_STATUSES.includes(status), `${status} must never grant access`);
  }
  const now = new Date("2026-08-20T00:00:00.000Z");
  const where = activeEntitlementWhere({ workspaceId: "ws_1", userId: "user_1", now });
  assert.deepEqual(where.status, { in: ["ACTIVE", "CANCEL_AT_PERIOD_END"] });
  assert.deepEqual(where.endsAt, { gt: now });
  assert.equal(where.workspaceId, "ws_1");
  assert.equal(where.userId, "user_1");
});

test("sign-in follows server account authorization and Navbar has a guarded Supabase sign-out action", async () => {
  const [signIn, navbar, layout] = await Promise.all([text("src/app/(auth)/sign-in/page.js"), text("src/components/Navbar.js"), text("src/app/(app)/layout.js")]);
  assert.match(signIn, /window\.location\.replace\("\/app"\)/);
  assert.match(navbar, /auth\.signOut\(\)/); assert.match(navbar, /Signing out…/); assert.match(navbar, /disabled=\{signingOut\}/);
  assert.match(layout, /ACTIVATION_REQUIRED/); assert.match(layout, /denied=1/);
});
