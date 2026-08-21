import test from "node:test";
import assert from "node:assert/strict";
import { linkSupabaseIdentity, normalizeEmail } from "../src/lib/access/identity.js";

// In-memory relational mock. linkSupabaseIdentity takes an injectable db, so this
// suite runs with zero external dependencies (no Prisma, no database).
function createMockDb(seedUsers = []) {
  const store = { users: seedUsers.map((u) => ({ defaultWorkspaceId: null, ...u })), workspaces: [], members: [], creditAccounts: [] };
  let seq = 1;
  const api = {
    _store: store,
    user: {
      findUnique: async ({ where }) => {
        if (where.supabaseUserId !== undefined) return store.users.find((u) => u.supabaseUserId === where.supabaseUserId) || null;
        if (where.id !== undefined) return store.users.find((u) => u.id === where.id) || null;
        return null;
      },
      findFirst: async ({ where }) => {
        const clauses = where.OR || [where];
        return store.users.find((u) => clauses.some((c) =>
          (c.normalizedEmail !== undefined && u.normalizedEmail === c.normalizedEmail) ||
          (c.email !== undefined && u.email === c.email))) || null;
      },
      create: async ({ data }) => {
        if (data.email && store.users.some((u) => u.email === data.email)) { const e = new Error("Unique email"); e.code = "P2002"; throw e; }
        const u = { id: `user_${seq++}`, defaultWorkspaceId: null, ...data };
        store.users.push(u);
        return u;
      },
      update: async ({ where, data }) => {
        const u = store.users.find((x) => x.id === where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      },
    },
    workspace: { create: async ({ data }) => { const w = { id: `ws_${seq++}`, ...data }; store.workspaces.push(w); return w; } },
    workspaceMember: { create: async ({ data }) => { const m = { id: `wm_${seq++}`, ...data }; store.members.push(m); return m; } },
    creditAccount: { create: async ({ data }) => { const a = { id: `ca_${seq++}`, ...data }; store.creditAccounts.push(a); return a; } },
    $transaction: async (fn) => fn(api),
  };
  return api;
}

const link = (db, args) => linkSupabaseIdentity({ isConfirmed: true, ...args }, db);

// --- Guards -----------------------------------------------------------------

test("onboarding: an unverified email is refused (verification cannot be skipped)", async () => {
  const db = createMockDb();
  await assert.rejects(() => linkSupabaseIdentity({ supabaseUserId: "sb_1", email: "a@b.com", isConfirmed: false }, db), /EMAIL_VERIFICATION_REQUIRED/);
});

test("onboarding: a missing email is refused", async () => {
  const db = createMockDb();
  await assert.rejects(() => link(db, { supabaseUserId: "sb_1", email: "" }), /verified email address is required/);
});

// --- New account ------------------------------------------------------------

test("onboarding: a brand-new verified email provisions user + workspace + membership + credit account", async () => {
  const db = createMockDb();
  const user = await link(db, { supabaseUserId: "sb_new", email: "New@Example.com", name: "Ada" });

  assert.equal(user.supabaseUserId, "sb_new");
  assert.equal(user.normalizedEmail, "new@example.com");
  assert.equal(user.activationStatus, "VERIFIED_PAYWALLED");
  assert.ok(user.defaultWorkspaceId, "must have a default workspace");
  assert.equal(db._store.workspaces.length, 1);
  assert.equal(db._store.members.length, 1);
  assert.equal(db._store.members[0].role, "OWNER");
  assert.equal(db._store.creditAccounts.length, 1);
  assert.equal(db._store.creditAccounts[0].availableCredits, 0, "no free credits before purchase");
});

test("onboarding: re-syncing the same identity is idempotent (no duplicate workspaces)", async () => {
  const db = createMockDb();
  const first = await link(db, { supabaseUserId: "sb_same", email: "same@example.com" });
  const second = await link(db, { supabaseUserId: "sb_same", email: "same@example.com" });
  assert.equal(first.id, second.id);
  assert.equal(db._store.workspaces.length, 1, "must not create a second workspace on re-sync");
  assert.equal(db._store.creditAccounts.length, 1);
});

// --- THE BUG: returning user / recreated auth id ---------------------------

test("onboarding: a verified email re-binds to a NEW supabase id instead of locking the user out", async () => {
  // Prior Doolphin account for this email, tied to an OLD/stale supabase id
  // (e.g. the auth user was deleted and recreated, or the email was used in an
  // earlier test). This is exactly the state that produced the setup error.
  const db = createMockDb([
    { id: "user_legacy", supabaseUserId: "sb_OLD", email: "return@example.com", normalizedEmail: "return@example.com", name: "Returning", activationStatus: "ACTIVATED", defaultWorkspaceId: "ws_legacy" },
  ]);

  const user = await link(db, { supabaseUserId: "sb_NEW", email: "return@example.com" });

  assert.equal(user.id, "user_legacy", "must reuse the existing account, not create a new one");
  assert.equal(user.supabaseUserId, "sb_NEW", "must re-bind to the current supabase identity");
  assert.equal(user.defaultWorkspaceId, "ws_legacy", "keeps the existing workspace and its data");
  assert.equal(user.activationStatus, "ACTIVATED", "must NOT downgrade a paid account");
  assert.equal(db._store.users.length, 1, "no duplicate account");
  assert.equal(db._store.workspaces.length, 0, "existing workspace reused, none created");
});

test("onboarding: an older account that never got a workspace is repaired on next sign-in", async () => {
  const db = createMockDb([
    { id: "user_partial", supabaseUserId: "sb_partial", email: "partial@example.com", normalizedEmail: "partial@example.com", activationStatus: "VERIFIED_PAYWALLED", defaultWorkspaceId: null },
  ]);
  const user = await link(db, { supabaseUserId: "sb_partial", email: "partial@example.com" });
  assert.ok(user.defaultWorkspaceId, "missing workspace must be provisioned");
  assert.equal(db._store.workspaces.length, 1);
  assert.equal(db._store.members.length, 1);
  assert.equal(db._store.creditAccounts.length, 1);
});

test("onboarding: a legacy account with no supabase id at all gets linked and keeps its status", async () => {
  const db = createMockDb([
    { id: "user_pre", supabaseUserId: null, email: "pre@example.com", normalizedEmail: "pre@example.com", activationStatus: "ACTIVATED", defaultWorkspaceId: "ws_pre" },
  ]);
  const user = await link(db, { supabaseUserId: "sb_pre_new", email: "pre@example.com" });
  assert.equal(user.id, "user_pre");
  assert.equal(user.supabaseUserId, "sb_pre_new");
  assert.equal(user.activationStatus, "ACTIVATED");
});

// --- Email normalization ----------------------------------------------------

test("onboarding: email matching is case- and whitespace-insensitive", async () => {
  assert.equal(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  const db = createMockDb([
    { id: "user_norm", supabaseUserId: "sb_old_norm", email: "case@example.com", normalizedEmail: "case@example.com", activationStatus: "ACTIVATED", defaultWorkspaceId: "ws_norm" },
  ]);
  // Same email, different casing/spacing, brand-new supabase id -> same account.
  const user = await link(db, { supabaseUserId: "sb_new_norm", email: "  CASE@Example.com  " });
  assert.equal(user.id, "user_norm");
  assert.equal(user.supabaseUserId, "sb_new_norm");
});
