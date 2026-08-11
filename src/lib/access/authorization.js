import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export class AuthorizationError extends Error { constructor(code, status = 403) { super(code); this.code = code; this.status = status; } }

export async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthorizationError("UNAUTHENTICATED", 401);
  const appUser = await prisma.user.findUnique({ where: { supabaseUserId: user.id } });
  if (!appUser) throw new AuthorizationError("IDENTITY_NOT_LINKED", 403);
  return { authUser: user, appUser };
}

export async function requireVerifiedUser() {
  const identity = await requireAuthenticatedUser();
  if (!identity.authUser.email_confirmed_at && identity.authUser.app_metadata?.provider !== "google") throw new AuthorizationError("EMAIL_VERIFICATION_REQUIRED", 403);
  return identity;
}

export async function requireActivatedAccount() {
  const identity = await requireVerifiedUser();
  if (identity.appUser.activationStatus !== "ACTIVATED") throw new AuthorizationError("ACTIVATION_REQUIRED", 402);
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
