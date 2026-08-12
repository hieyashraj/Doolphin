import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/app/(auth)/verify-email/page.js", import.meta.url), "utf8");

test("signup OTP verification uses a trimmed email and six-digit token with Supabase email verification", () => {
  assert.match(page, /params\.get\("email"\)\?\.trim\(\) \|\| ""/);
  assert.match(page, /const token = code\.trim\(\);/);
  assert.match(page, /verifyOtp\(\{\s*email,\s*token,\s*type: "email",\s*\}\)/s);
});

test("signup resend remains a signup resend and clears the prior OTP", () => {
  assert.match(page, /resend\(\{ type: "signup", email \}\)/);
  assert.match(page, /setCode\(""\);\s*setMessage\("A new verification code has been sent\."\)/s);
});
