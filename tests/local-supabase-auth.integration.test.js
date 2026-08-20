import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createClient } from "@supabase/supabase-js";

// Local Supabase remains the default developer experience. Remote execution is
// deliberately opt-in and requires BOTH workflow-owned flags: the test does not
// become capable of talking to a hosted project merely because a connection URL
// happens to exist in an engineer's shell.
const isRemoteDisposableStaging =
  process.env.RUN_REMOTE_STAGING_INTEGRATION === "1" &&
  process.env.DOOLPHIN_DISPOSABLE_TARGET_VERIFIED === "true";
const isLocalSupabase = process.env.LOCAL_SUPABASE_URL?.startsWith("http://127.0.0.1:");
const url = isRemoteDisposableStaging ? process.env.TEST_SUPABASE_URL : process.env.LOCAL_SUPABASE_URL;
const anonKey = isRemoteDisposableStaging ? process.env.TEST_SUPABASE_PUBLISHABLE_KEY : process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = isRemoteDisposableStaging ? process.env.TEST_SUPABASE_SERVICE_ROLE_KEY : process.env.LOCAL_SUPABASE_SERVICE_KEY;
const integrationTest = (isLocalSupabase || isRemoteDisposableStaging) && anonKey && serviceKey ? test : test.skip;
const localOnlyTest = isLocalSupabase && anonKey && serviceKey ? test : test.skip;

let number = 0;
const createdUserIds = new Set();
const email = (prefix) => `doolphin-qa-${prefix}-${Date.now()}-${++number}@example.test`;
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const admin = () => createClient(url, serviceKey, { auth: { persistSession: false } });
function remember(user) { if (user?.id) createdUserIds.add(user.id); return user; }

// Hosted staging is intentionally left clean after every Auth test. This lives in
// `after` rather than in individual test tails, so an assertion failure cannot
// turn into an accumulating pile of users or rate-limit the next run.
after(async () => {
  if (!isRemoteDisposableStaging) return;
  for (const userId of createdUserIds) await admin().auth.admin.deleteUser(userId);
});

integrationTest("Supabase Auth: permanent email signup is unconfirmed while disposable email is rejected by Before User Created", async () => {
  const permanent = email("permanent");
  const ok = await anon().auth.signUp({ email: permanent, password: "TestPassword123!" });
  remember(ok.data.user);
  assert.ok(ok.data.user); assert.equal(Boolean(ok.data.user.email_confirmed_at), false);
  const blocked = await anon().auth.signUp({ email: `doolphin-qa-blocked-${Date.now()}@tempmail.local`, password: "TestPassword123!" });
  assert.equal(blocked.data.user, null); assert.match(blocked.error?.message || "", /disposable email/i);
});

integrationTest("Supabase Auth: invalid OTP is rejected; generated synthetic OTP verifies; session persists then signs out", async () => {
  const address = email("otp"); const password = "TestPassword123!";
  const generated = await admin().auth.admin.generateLink({ type: "signup", email: address, password });
  remember(generated.data.user);
  assert.equal(generated.error, null); assert.ok(generated.data.properties.email_otp);
  const client = anon(); const invalid = await client.auth.verifyOtp({ email: address, token: "000000", type: "email" });
  assert.ok(invalid.error);
  const verified = await client.auth.verifyOtp({ email: address, token: generated.data.properties.email_otp, type: "email" });
  assert.ok(verified.data.user?.email_confirmed_at);
  assert.ok((await client.auth.getSession()).data.session);
  assert.equal((await client.auth.signOut()).error, null);
});

// Password-reset redirect URLs require an Auth allow-list. The local stack owns
// that config; a hosted staging project may intentionally not. Keep this coverage
// local until its redirect allow-list is checked in as reproducible project setup.
localOnlyTest("local Auth: resend and password-reset calls stay local and expose no account-existence result", async () => {
  const address = email("recovery"); const signedUp = await anon().auth.signUp({ email: address, password: "TestPassword123!" }); remember(signedUp.data.user);
  const resend = await anon().auth.resend({ type: "signup", email: address });
  assert.ok(resend.error?.status === 429 || resend.error === null);
  const reset = await anon().auth.resetPasswordForEmail(address, { redirectTo: "http://127.0.0.1:3000/reset-password" });
  assert.equal(reset.error, null);
});
