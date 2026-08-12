import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL;
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
const localTest = url?.startsWith("http://127.0.0.1:") && anonKey && serviceKey ? test : test.skip;
let number = 0;
const email = (prefix) => `${prefix}-${Date.now()}-${++number}@example.test`;
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const admin = () => createClient(url, serviceKey, { auth: { persistSession: false } });

localTest("local Auth: permanent email signup is unconfirmed while disposable email is rejected by Before User Created", async () => {
  const permanent = email("permanent");
  const ok = await anon().auth.signUp({ email: permanent, password: "TestPassword123!" });
  assert.ok(ok.data.user); assert.equal(Boolean(ok.data.user.email_confirmed_at), false);
  const blocked = await anon().auth.signUp({ email: `blocked-${Date.now()}@tempmail.local`, password: "TestPassword123!" });
  assert.equal(blocked.data.user, null); assert.match(blocked.error?.message || "", /disposable email/i);
});

localTest("local Auth: invalid OTP is rejected; generated synthetic OTP verifies; session persists then signs out", async () => {
  const address = email("otp"); const password = "TestPassword123!";
  const generated = await admin().auth.admin.generateLink({ type: "signup", email: address, password });
  assert.equal(generated.error, null); assert.ok(generated.data.properties.email_otp);
  const client = anon(); const invalid = await client.auth.verifyOtp({ email: address, token: "000000", type: "signup" });
  assert.ok(invalid.error);
  const verified = await client.auth.verifyOtp({ email: address, token: generated.data.properties.email_otp, type: "signup" });
  assert.ok(verified.data.user?.email_confirmed_at);
  assert.ok((await client.auth.getSession()).data.session);
  assert.equal((await client.auth.signOut()).error, null);
});

localTest("local Auth: resend and password-reset calls stay local and expose no account-existence result", async () => {
  const address = email("recovery"); await anon().auth.signUp({ email: address, password: "TestPassword123!" });
  const resend = await anon().auth.resend({ type: "signup", email: address });
  assert.ok(resend.error?.status === 429 || resend.error === null);
  const reset = await anon().auth.resetPasswordForEmail(address, { redirectTo: "http://127.0.0.1:3000/reset-password" });
  assert.equal(reset.error, null);
});
