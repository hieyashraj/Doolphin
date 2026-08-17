import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Require LOCAL_SUPABASE_* environment variables.
// A normal `node --test` without LOCAL_SUPABASE_* variables will safely skip local integration tests
// and NEVER parse .env or hit remote staging / production by accident.
const url = process.env.LOCAL_SUPABASE_URL;
const pubKey = process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY || process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;

const isLocalConfigured = Boolean(url && pubKey && serviceKey && url.includes("127.0.0.1"));
const localTest = isLocalConfigured ? test : test.skip;

const pubClient = () => createClient(url, pubKey, { auth: { persistSession: false } });
const adminClient = () => createClient(url, serviceKey, { auth: { persistSession: false } });

let counter = 0;
const testEmail = (prefix) => `auth_lifecycle_${Date.now()}_${++counter}_${prefix}@example.test`;

localTest("Auth Lifecycle: unconfirmed signInWithPassword returns email_not_confirmed error code", async () => {
  const email = testEmail("unconfirmed_signin");
  const password = "TestPassword123!";
  const { data, error } = await pubClient().auth.signUp({ email, password });
  assert.equal(error, null);
  assert.ok(data.user);

  // Attempt sign-in with unconfirmed email
  const signInRes = await pubClient().auth.signInWithPassword({ email, password });
  assert.ok(signInRes.error);
  assert.equal(signInRes.error.code, "email_not_confirmed");

  // Incorrect password returns neutral invalid credentials error
  const badPassRes = await pubClient().auth.signInWithPassword({ email, password: "WrongPassword123!" });
  assert.ok(badPassRes.error);
  assert.notEqual(badPassRes.error.code, "email_not_confirmed");

  await adminClient().auth.admin.deleteUser(data.user.id);
});

localTest("Auth Lifecycle: disposable sentinel tempmail.local is rejected by Before User Created hook", async () => {
  const email = `disposable_${Date.now()}@tempmail.local`;
  const password = "TestPassword123!";
  const { data, error } = await pubClient().auth.signUp({ email, password });
  assert.ok(error);
  assert.equal(data.user, null);
  assert.match(error.message || "", /disposable email/i);
});

localTest("Auth Lifecycle: unconfirmed user identity provisioning is rejected by linkSupabaseIdentity helper boundary", async () => {
  const email = testEmail("sync_unconfirmed");
  const password = "TestPassword123!";
  const { data } = await pubClient().auth.signUp({ email, password });

  const { linkSupabaseIdentity } = await import("../src/lib/access/identity.js");
  await assert.rejects(
    async () => {
      await linkSupabaseIdentity({
        supabaseUserId: data.user.id,
        email: email,
        name: "Unconfirmed User",
        isConfirmed: false,
      });
    },
    /EMAIL_VERIFICATION_REQUIRED/
  );

  await adminClient().auth.admin.deleteUser(data.user.id);
});

localTest("Auth Lifecycle: invalid OTP is rejected and valid OTP confirms account", async () => {
  const email = testEmail("otp_verify");
  const password = "TestPassword123!";

  const generated = await adminClient().auth.admin.generateLink({
    type: "signup",
    email,
    password,
  });
  assert.equal(generated.error, null);
  const otp = generated.data.properties.email_otp;
  assert.ok(otp);

  const client = pubClient();
  const invalidRes = await client.auth.verifyOtp({ email, token: "000000", type: "email" });
  assert.ok(invalidRes.error);

  const validRes = await client.auth.verifyOtp({ email, token: otp, type: "email" });
  assert.equal(validRes.error, null);
  assert.ok(validRes.data.user?.email_confirmed_at);

  await adminClient().auth.admin.deleteUser(generated.data.user.id);
});

localTest("Auth Lifecycle: confirmed account linkSupabaseIdentity creates exactly one User, Workspace, WorkspaceMember, CreditAccount & repeat sync is idempotent", async () => {
  const email = testEmail("full_flow");
  const password = "TestPassword123!";

  const generated = await adminClient().auth.admin.generateLink({
    type: "signup",
    email,
    password,
  });
  const otp = generated.data.properties.email_otp;
  const userId = generated.data.user.id;

  const client = pubClient();
  await client.auth.verifyOtp({ email, token: otp, type: "email" });

  const { linkSupabaseIdentity } = await import("../src/lib/access/identity.js");
  const appUser1 = await linkSupabaseIdentity({
    supabaseUserId: userId,
    email: email,
    name: "Verified User",
    isConfirmed: true,
  });

  assert.equal(appUser1.activationStatus, "VERIFIED_PAYWALLED");

  // Idempotency: repeat sync
  const appUser2 = await linkSupabaseIdentity({
    supabaseUserId: userId,
    email: email,
    name: "Verified User",
    isConfirmed: true,
  });

  assert.equal(appUser1.id, appUser2.id);

  const { prisma } = await import("../src/lib/prisma.js");
  const users = await prisma.user.findMany({ where: { supabaseUserId: userId } });
  assert.equal(users.length, 1);

  const workspaces = await prisma.workspace.findMany({ where: { ownerUserId: appUser1.id } });
  assert.equal(workspaces.length, 1);

  const members = await prisma.workspaceMember.findMany({ where: { userId: appUser1.id } });
  assert.equal(members.length, 1);

  const creditAccounts = await prisma.creditAccount.findMany({ where: { workspaceId: workspaces[0].id } });
  assert.equal(creditAccounts.length, 1);

  // Clean up DB records and auth user
  await prisma.creditAccount.deleteMany({ where: { workspaceId: workspaces[0].id } });
  await prisma.workspaceMember.deleteMany({ where: { userId: appUser1.id } });
  await prisma.workspace.deleteMany({ where: { ownerUserId: appUser1.id } });
  await prisma.user.deleteMany({ where: { id: appUser1.id } });
  await adminClient().auth.admin.deleteUser(userId);
});
