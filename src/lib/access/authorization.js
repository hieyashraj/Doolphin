import { prisma } from "../prisma.js";
import { createClient } from "../supabase/server.js";
import { isActivatedUser } from "./account-state.js";
import { linkSupabaseIdentity } from "./identity.js";
import { logPerf } from "../perf.js";

export class AuthorizationError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function getSupabaseAuthUser(supabase) {
  if (typeof supabase?.auth?.getClaims === "function") {
    try {
      const { data } = await supabase.auth.getClaims();
      if (data?.claims?.sub) {
        return {
          data: {
            user: {
              id: data.claims.sub,
              email: data.claims.email,
              email_confirmed_at: data.claims.email_verified ? new Date().toISOString() : null,
              app_metadata: data.claims.app_metadata || {},
            },
          },
          error: null,
        };
      }
    } catch {}
  }
  const { data: { user }, error } = await supabase.auth.getUser();
  return { data: { user }, error };
}

export async function requireAuthenticatedUser(reqId) {
  const supabase = await createClient();

  const t0 = performance.now();
  const { data: { user }, error } = await getSupabaseAuthUser(supabase);
  logPerf(reqId, "auth:supabase.auth.getUser", t0);

  if (error || !user) throw new AuthorizationError("UNAUTHENTICATED", 401);

  const t1 = performance.now();
  let appUser = await prisma.user.findUnique({ where: { supabaseUserId: user.id } });
  logPerf(reqId, "auth:user.findUnique", t1);

  // Lazy one-time account bootstrap for first-time Supabase Auth users landing on app
  if (!appUser && user.email) {
    try {
      appUser = await linkSupabaseIdentity({
        supabaseUserId: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name,
      });
    } catch (err) {
      if (err?.message === "IDENTITY_LINK_CONFLICT") {
        appUser = await prisma.user.findUnique({ where: { supabaseUserId: user.id } });
      }
    }
  }

  if (!appUser) throw new AuthorizationError("IDENTITY_NOT_LINKED", 403);

  return { authUser: user, appUser };
}

export async function requireVerifiedUser(reqId) {
  const identity = await requireAuthenticatedUser(reqId);
  if (!identity.authUser.email_confirmed_at && identity.authUser.app_metadata?.provider !== "google") {
    throw new AuthorizationError("EMAIL_VERIFICATION_REQUIRED", 403);
  }
  return identity;
}

export async function requireActivatedAccount(reqId) {
  const identity = await requireVerifiedUser(reqId);
  if (
    identity.appUser.activationStatus === "SUSPENDED" ||
    identity.appUser.status === "SUSPENDED" ||
    identity.appUser.subscriptionStatus === "SUSPENDED"
  ) {
    throw new AuthorizationError("ACCOUNT_DENIED", 403);
  }
  if (!isActivatedUser(identity.appUser)) throw new AuthorizationError("ACTIVATION_REQUIRED", 402);
  const workspaceId = identity.appUser.defaultWorkspaceId;
  if (!workspaceId) throw new AuthorizationError("ACCOUNT_DENIED", 403);

  // [PERF] Single parallel query pass for membership, entitlement, and credit account
  const t2 = performance.now();
  const [membership, entitlement, creditAccount] = await Promise.all([
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: identity.appUser.id } } }),
    prisma.entitlement.findFirst({ where: { workspaceId, userId: identity.appUser.id, status: "ACTIVE", endsAt: { gt: new Date() } }, orderBy: { endsAt: "desc" } }),
    prisma.creditAccount.findUnique({ where: { workspaceId }, select: { availableCredits: true } }),
  ]);
  logPerf(reqId, "auth:workspace+entitlement+creditAccount", t2);

  if (!membership || !entitlement) throw new AuthorizationError("ACCOUNT_DENIED", 403);

  return { ...identity, membership, entitlement, creditAccount };
}

export async function requireAdminUser() {
  const identity = await requireAuthenticatedUser();
  if (!identity.appUser.isAdmin) throw new AuthorizationError("ADMIN_ACCESS_DENIED", 403);
  return identity;
}

export async function requireWorkspaceMembership(workspaceId) {
  const identity = await requireActivatedAccount();
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: identity.appUser.id } },
  });
  if (!membership) throw new AuthorizationError("WORKSPACE_ACCESS_DENIED", 403);
  return { ...identity, membership };
}

export async function requireSubscriptionFeature(feature, workspaceId) {
  const identity = workspaceId ? await requireWorkspaceMembership(workspaceId) : await requireActivatedAccount();
  const entitlement = await prisma.entitlement.findFirst({
    where: { workspaceId: workspaceId || identity.appUser.defaultWorkspaceId || undefined, status: "ACTIVE", endsAt: { gt: new Date() } },
    orderBy: { endsAt: "desc" },
  });
  if (!entitlement || !(entitlement.featuresJson || "").includes(feature)) throw new AuthorizationError("FEATURE_NOT_ENTITLED", 403);
  return { ...identity, entitlement };
}

export async function requireSufficientCredits(workspaceId, amount) {
  await requireWorkspaceMembership(workspaceId);
  const account = await prisma.creditAccount.findUnique({ where: { workspaceId } });
  if (!account || account.availableCredits < amount) throw new AuthorizationError("INSUFFICIENT_CREDITS", 402);
  return account;
}
