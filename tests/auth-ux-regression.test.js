import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { finishVerifiedEmail, verifyEmailCode } from "../src/lib/auth/verification-flow.js";
import { signupCanProceedToVerification } from "../src/lib/auth/signup-outcome.js";

const root = new URL("../", import.meta.url);
const text = (path) => readFile(new URL(path, root), "utf8");

test("hosted regression: a successful OTP remains verified when later account synchronization fails", async () => {
  let syncCalls = 0;
  const result = await verifyEmailCode({
    verifyOtp: async () => ({ error: null }),
    email: "confirmed@example.test",
    token: "123456",
    synchronize: async () => { syncCalls += 1; return { ok: false }; },
    recordConsent: async () => ({ ok: true }),
  });
  assert.equal(result.status, "verified");
  assert.equal(result.setup.status, "setup-error");
  assert.equal(syncCalls, 1);
});

test("only a failed Supabase verifyOtp result is classified as an invalid OTP", async () => {
  const invalid = await verifyEmailCode({ verifyOtp: async () => ({ error: { code: "otp_expired" } }), synchronize: async () => ({ ok: true }), recordConsent: async () => ({ ok: true }) });
  assert.equal(invalid.status, "invalid-otp");
  assert.deepEqual(await finishVerifiedEmail({ synchronize: async () => ({ ok: true }), recordConsent: async () => ({ ok: false }) }), { status: "setup-error" });
});

test("duplicate Supabase obfuscation does not advance to an OTP screen or disclose account data", async () => {
  assert.equal(signupCanProceedToVerification({ data: { user: { identities: [{ id: "new-email-identity" }] } }, error: null }), true);
  assert.equal(signupCanProceedToVerification({ data: { user: { identities: [] } }, error: null }), false);
  assert.equal(signupCanProceedToVerification({ data: { user: null }, error: { message: "duplicate" } }), false);
  const route = await text("src/app/api/auth/sign-up/route.js");
  assert.match(route, /signupCanProceedToVerification/);
  assert.match(route, /We couldn’t create a new account with those details\. Try signing in or resetting your password\./);
  assert.doesNotMatch(route, /service_role|auth\.admin|listUsers|getUserByEmail/i);
  assert.doesNotMatch(route, /userId|email_confirmed_at/);
});

test("all auth primary actions have named busy states and disable repeat submissions", async () => {
  const pages = await Promise.all(["sign-up", "sign-in", "verify-email", "forgot-password", "reset-password"].map((name) => text(`src/app/(auth)/${name}/page.js`)));
  for (const page of pages) {
    assert.match(page, /disabled=\{/);
    assert.match(page, /aria-busy/);
    assert.match(page, /text-white/);
  }
  assert.match(pages[0], /Creating account…/); assert.match(pages[1], /Signing in…/); assert.match(pages[2], /Verifying…/); assert.match(pages[2], /Sending…/); assert.match(pages[3], /Sending…/);
});

test("unsupported Google OAuth and dead notification settings are not exposed", async () => {
  const signIn = await text("src/app/(auth)/sign-in/page.js");
  const navbar = await text("src/components/Navbar.js");
  assert.match(signIn, /NEXT_PUBLIC_SUPABASE_GOOGLE_OAUTH_ENABLED === "true"/);
  assert.match(signIn, /googleOAuthEnabled &&/);
  assert.doesNotMatch(navbar, /label: "Notifications"/);
  assert.doesNotMatch(navbar, /toggleCompletionNotifications/);
});

test("account deletion requires typed confirmation and remains non-mutating", async () => {
  const navbar = await text("src/components/Navbar.js");
  assert.match(navbar, /deleteConfirmation !== "DELETE"/);
  assert.match(navbar, /Type DELETE to continue/);
  assert.match(navbar, /Nothing will be deleted from this screen/);
  assert.doesNotMatch(navbar, /fetch\([^\n]*delete/i);
});

test("a revisited verified session continues setup instead of consuming an old OTP", async () => {
  const page = await text("src/app/(auth)/verify-email/page.js");
  assert.match(page, /auth\.getUser\(\)/);
  assert.match(page, /user\?\.email_confirmed_at/);
  assert.match(page, /continueAfterVerification\(\)/);
  assert.match(page, /Continue to pricing/);
});

test("Supabase signup email template is self-contained and preserves the OTP placeholder", async () => {
  const template = await text("docs/supabase-confirm-signup-template.html");
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.match(template, /background:#f6f0e5/);
  assert.match(template, /If you did not try to create a Doolphin account/);
  assert.doesNotMatch(template, /<script|https?:\/\/|@import/i);
});
