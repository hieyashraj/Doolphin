import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const authorizationSource = fs.readFileSync(new URL("../src/lib/access/authorization.js", import.meta.url), "utf8");

test("authorization module contains zero synthetic test auth header or cookie bypass branches", () => {
  assert.doesNotMatch(authorizationSource, /x-test-user-id/i);
  assert.doesNotMatch(authorizationSource, /test-user-id/i);
  assert.doesNotMatch(authorizationSource, /ALLOW_DEV_AUTH/i);
  assert.doesNotMatch(authorizationSource, /E2E_TEST_AUTH/i);
  assert.doesNotMatch(authorizationSource, /e2e-test-auth/i);
  assert.doesNotMatch(authorizationSource, /x-e2e-test-auth/i);
});

test("requireAuthenticatedUser strictly enforces genuine Supabase authentication", () => {
  assert.match(authorizationSource, /const supabase = await createClient\(\);/);
  assert.match(authorizationSource, /const \{ data: \{ user \}, error \} = await supabase\.auth\.getUser\(\);/);
  assert.match(authorizationSource, /if \(error \|\| !user\) throw new AuthorizationError\("UNAUTHENTICATED", 401\);/);
});
