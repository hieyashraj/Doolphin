import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authorizationSource = fs.readFileSync(
  new URL("../src/lib/access/authorization.js", import.meta.url),
  "utf8"
);

test("getSupabaseAuthUser does not depend on or fabricate email_verified from JWT claims", () => {
  // getSupabaseAuthUser must not reference email_verified or fabricate email_confirmed_at from claims
  assert.doesNotMatch(authorizationSource, /claims\.email_verified/);
  assert.doesNotMatch(authorizationSource, /email_confirmed_at:\s*data\.claims/);

  // Must include actual supported claim metadata: id, email, app_metadata, user_metadata
  assert.match(authorizationSource, /id:\s*data\.claims\.sub/);
  assert.match(authorizationSource, /email:\s*data\.claims\.email/);
  assert.match(authorizationSource, /app_metadata:\s*data\.claims\.app_metadata/);
  assert.match(authorizationSource, /user_metadata:\s*data\.claims\.user_metadata/);
});

test("returning linked ACTIVATED user authorization is not rejected for absent JWT email_verified", () => {
  // requireVerifiedUser must not check identity.authUser.email_confirmed_at
  assert.doesNotMatch(authorizationSource, /identity\.authUser\.email_confirmed_at/);

  // requireVerifiedUser relies on Doolphin's authoritative appUser.activationStatus
  assert.match(authorizationSource, /identity\.appUser\.activationStatus === "UNVERIFIED"/);

  // Returning user with existing appUser returns directly without second getUser call
  assert.match(authorizationSource, /if \(appUser\) \{\s*return \{ authUser: user, appUser \};\s*\}/);
});

test("first-time user path requires authoritative getUser verification before identity bootstrap", () => {
  // If appUser is missing, calls supabase.auth.getUser() once for authoritative email confirmation check
  assert.match(authorizationSource, /const \{ data: \{ user: fullAuthUser \}, error: fullAuthError \} = await supabase\.auth\.getUser\(\);/);

  // First-time email users require email_confirmed_at or google provider before linkSupabaseIdentity
  assert.match(authorizationSource, /if \(!fullAuthUser\.email_confirmed_at && !isGoogle\) \{\s*throw new AuthorizationError\("EMAIL_VERIFICATION_REQUIRED", 403\);/);
});
