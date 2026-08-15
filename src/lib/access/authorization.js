import { prisma } from "../prisma.js";
import { createClient } from "../supabase/server.js";
import { isActivatedUser } from "./account-state.js";
import { logPerf } from "../perf.js";

export class AuthorizationError extends Error { constructor(code, status = 403) { super(code); this.code = code; this.status = status; } }

export async function requireAuthenticatedUser(reqId) {
  const supabase = await createClient();

  // [PERF] supabase.auth.getUser()
  const t0 = performance.now();
  const { data: { user }, error } = await supabase.auth.getUser();
  logPerf(reqId, "auth:supabase.auth.getUser", t0);
  if (error || !user) throw new AuthorizationError("UNAUTHENTICATED", 401);

  // [PERF] user/identity DB lookup
  const t1 = performance.now();
  const appUser = await prisma.user.findUnique({ where: { supabaseUserId: user.id } });
  logPerf(reqId, "auth:user.findUnique", t1);
  if (!appUser) throw new AuthorizationError("IDENTITY_NOT_LINKED", 403);

  return { authUser: user, appUser };
}

export async function requireVerifiedUser(reqId) {
  const identity = await requireAuthenticatedUser(reqId);
  if (!identity.authUser.email_confirmed_at && identity.authUser.app_metadata?.provider !== "google") throw new AuthorizationError("EMAIL_VERIFICATION_REQUIRED", 403);
  return identity;
}

export async function requireActivatedAccount(reqId) {
  const identity = await requireVerifiedUser(reqId);
  if (identity.appUser.activationStatus === "SUSPENDED" || identity.appUser.status === "SUSPENDED" || identity.appUser.subscriptionStatus === "SUSPENDED") throw new AuthorizationError("ACCOUNT_DENIED", 403);
  if (!isActivatedUser(identity.appUser)) throw new AuthorizationError("ACTIVATION_REQUIRED", 402);
  const workspaceId = identity.appUser.defaultWorkspaceId;
  if (!workspaceId) throw new AuthorizationError("ACCOUNT_DENIED", 403);

  // [PERF] workspace/member/entitlement lookup (runs in parallel)
  const t2 = performance.now();
  const [membership, entitlement] = await Promise.all([
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: identity.appUser.id } } }),
    prisma.entitlement.findFirst({ where: { workspaceId, userId: identity.appUser.id, status: "ACTIVE", endsAt: { gt: new Date() } }, orderBy: { endsAt: "desc" } }),
  ]);
  logPerf(reqId, "auth:workspace+entitlement.findUnique", t2);
  if (!membership || !entitlement) throw new AuthorizationError("ACCOUNT_DENIED", 403);

  return { ...identity, membership, entitlement };
}

export async function requireAdminUser() {
  const identity = await requireAuthenticatedUser();
  if (!identity.appUser.isAdmin) throw new AuthorizationError("ADMIN_ACCESS_DENIED", 403);
  return identity;
}

export async function requireWorkspaceMembership(workspaceId) {
  const identity = await requireActivatedAccount();
  const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: identity.appUser.id } } });
  if (!membership) throw new AuthorizationError("WORKSPACE_ACCESS_DENIED", 403);
  return { ...identity, membership };
}

export async function requireSubscriptionFeature(feature, workspaceId) {
  const identity = workspaceId ? await requireWorkspaceMembership(workspaceId) : await requireActivatedAccount();
  const entitlement = await prisma.entitlement.findFirst({ where: { workspaceId: workspaceId || identity.appUser.defaultWorkspaceId || undefined, status: "ACTIVE", endsAt: { gt: new Date() } }, orderBy: { endsAt: "desc" } });
  if (!entitlement || !(entitlement.featuresJson || "").includes(feature)) throw new AuthorizationError("FEATURE_NOT_ENTITLED", 403);
  return { ...identity, entitlement };
}

export async function requireSufficientCredits(workspaceId, amount) {
  await requireWorkspaceMembership(workspaceId);
  const account = await prisma.creditAccount.findUnique({ where: { workspaceId } });
  if (!account || account.availableCredits < amount) throw new AuthorizationError("INSUFFICIENT_CREDITS", 402);
  return account;
}
