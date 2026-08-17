import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import dotenv from "dotenv";

const env = dotenv.parse(fs.readFileSync(".env"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const pubKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const directUrl = env.DIRECT_URL || env.DATABASE_URL;

for (const k in env) {
  process.env[k] = env[k];
}

const pubClient = () => createClient(url, pubKey, { auth: { persistSession: false } });
const adminClient = () => createClient(url, serviceKey, { auth: { persistSession: false } });

let counter = 0;
const testEmail = (prefix) => `auth_lifecycle_${Date.now()}_${++counter}_${prefix}@gmail.com`;

test("Auth Lifecycle: signup returns unconfirmed Supabase user", async () => {
  const email = testEmail("signup");
  const password = "TestPassword123!";
  const { data, error } = await pubClient().auth.signUp({ email, password });
  assert.equal(error, null);
  assert.ok(data.user);
  assert.equal(Boolean(data.user.email_confirmed_at), false);

  // Clean up
  await adminClient().auth.admin.deleteUser(data.user.id);
});

test("Auth Lifecycle: disposable sentinel tempmail.local is rejected", async () => {
  const email = `disposable_${Date.now()}@tempmail.local`;
  const password = "TestPassword123!";
  const { data, error } = await pubClient().auth.signUp({ email, password });
  assert.ok(error);
  assert.equal(data.user, null);
  assert.match(error.message || "", /disposable email/i);
});

test("Auth Lifecycle: unconfirmed user /api/auth/sync is rejected", async () => {
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

test("Auth Lifecycle: invalid OTP is rejected and valid OTP confirms account", async () => {
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

test("Auth Lifecycle: verified user sync creates exactly one User, Workspace, WorkspaceMember, CreditAccount & repeating sync is idempotent", async () => {
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
