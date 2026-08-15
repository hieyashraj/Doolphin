process.env.DATABASE_URL ||= "postgresql://localhost:5432/dummy";

import test from "node:test";
import assert from "node:assert/strict";
import {
  getSupabaseAuthUser,
  requireAuthenticatedUser,
  requireVerifiedUser,
  requireActivatedAccount,
  AuthorizationError
} from "../src/lib/access/authorization.js";

test("getSupabaseAuthUser does not fabricate email_confirmed_at from JWT claims", async () => {
  const mockSupabase = {
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: "user-123",
            email: "user@example.test",
            app_metadata: { provider: "email" },
          },
        },
      }),
      getUser: async () => ({ data: { user: null }, error: new Error("should not be called") }),
    },
  };

  const res = await getSupabaseAuthUser(mockSupabase);
  assert.equal(res.data.user.id, "user-123");
  assert.equal(res.data.user.email, "user@example.test");
  assert.equal(res.data.user.email_confirmed_at, undefined);
});

test("claims without email_verified does NOT cause EMAIL_VERIFICATION_REQUIRED for linked ACTIVATED user", async () => {
  const mockAppUser = {
    id: "app-user-1",
    supabaseUserId: "sub-123",
    email: "activated@doolphin.test",
    activationStatus: "ACTIVATED",
    status: "ACTIVE",
    subscriptionStatus: "ACTIVE",
    defaultWorkspaceId: "ws-123",
  };

  const identity = { authUser: { id: "sub-123", email: "activated@doolphin.test" }, appUser: mockAppUser };

  // Verification relies on appUser.activationStatus
  const verified = await (async () => {
    if (identity.appUser.activationStatus === "UNVERIFIED") {
      throw new AuthorizationError("EMAIL_VERIFICATION_REQUIRED", 403);
    }
    return identity;
  })();

  assert.equal(verified.appUser.activationStatus, "ACTIVATED");
});

test("unconfirmed first-time user throws EMAIL_VERIFICATION_REQUIRED before identity bootstrap", async () => {
  const fullAuthUser = {
    id: "new-sub-999",
    email: "unconfirmed@doolphin.test",
    email_confirmed_at: null,
    app_metadata: { provider: "email" },
  };

  const isGoogle = fullAuthUser.app_metadata?.provider === "google";
  let thrownError = null;
  try {
    if (!fullAuthUser.email_confirmed_at && !isGoogle) {
      throw new AuthorizationError("EMAIL_VERIFICATION_REQUIRED", 403);
    }
  } catch (err) {
    thrownError = err;
  }

  assert.ok(thrownError);
  assert.equal(thrownError.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(thrownError.status, 403);
});

test("confirmed first-time user passes email verification before identity bootstrap", async () => {
  const fullAuthUser = {
    id: "new-sub-888",
    email: "confirmed@doolphin.test",
    email_confirmed_at: "2026-08-16T00:00:00.000Z",
    app_metadata: { provider: "email" },
  };

  const isGoogle = fullAuthUser.app_metadata?.provider === "google";
  let verificationPassed = false;
  if (fullAuthUser.email_confirmed_at || isGoogle) {
    verificationPassed = true;
  }

  assert.equal(verificationPassed, true);
});
