export const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

// Prisma is imported lazily so this module can be unit-tested with an injected
// mock db without pulling in the native Prisma client.
async function defaultDb() {
  const { prisma } = await import("../prisma.js");
  return prisma;
}

/**
 * Reconcile the signed-in, email-verified Supabase identity with a Doolphin
 * account, provisioning the workspace scaffolding the access gate depends on.
 *
 * IDENTITY IS THE VERIFIED EMAIL, NOT THE SUPABASE USER ID.
 * The caller only reaches here after the user proved control of their email
 * (isConfirmed via OTP, or a Google-verified address). So if a Doolphin account
 * already exists for that email — whether it was created in earlier testing, or
 * was bound to a Supabase auth user that has since been deleted and recreated
 * with a new id — we RE-BIND it to the current Supabase id rather than refusing.
 *
 * The previous version threw IDENTITY_LINK_CONFLICT whenever the email existed
 * with any other Supabase id, which permanently stranded returning users at
 * "finishing account setup". Re-binding a verified email is the standard,
 * safe behaviour (only the inbox owner can verify it) and is what unblocks sign
 * up / sign in for good.
 */
export async function linkSupabaseIdentity({ supabaseUserId, email, name, isConfirmed = false }, db = null) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error("A verified email address is required");
  if (!isConfirmed) throw new Error("EMAIL_VERIFICATION_REQUIRED");

  const client = db || (await defaultDb());
  return client.$transaction(async (tx) => {
    // Fast path: already fully provisioned for this exact Supabase identity.
    const bySupabase = await tx.user.findUnique({ where: { supabaseUserId } });
    if (bySupabase?.defaultWorkspaceId) return bySupabase;

    // Any prior Doolphin account for this verified email.
    const priorByEmail = await tx.user.findFirst({
      where: { OR: [{ normalizedEmail }, { email: normalizedEmail }] },
    });
    const prior = bySupabase || priorByEmail;

    let user;
    if (prior) {
      user = await tx.user.update({
        where: { id: prior.id },
        data: {
          supabaseUserId,
          normalizedEmail,
          name: prior.name || name || null,
          // Never downgrade an already-activated (paid) account; only promote a
          // brand-new/unverified one to verified.
          ...(prior.activationStatus === "UNVERIFIED" ? { activationStatus: "VERIFIED_PAYWALLED" } : {}),
        },
      });
    } else {
      user = await tx.user.create({
        data: {
          email: normalizedEmail,
          normalizedEmail,
          supabaseUserId,
          name: name || null,
          activationStatus: "VERIFIED_PAYWALLED",
        },
      });
    }

    // Guarantee workspace + membership + credit account exist (idempotent). The
    // access gate requires all three, so provisioning them here is what makes a
    // freshly verified account immediately usable — and repairs any older account
    // that never got them.
    if (!user.defaultWorkspaceId) {
      const workspace = await tx.workspace.create({
        data: { name: `${user.name || name || "Doolphin"}'s Workspace`, ownerUserId: user.id, billingPlan: "unactivated" },
      });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } });
      await tx.creditAccount.create({ data: { workspaceId: workspace.id, availableCredits: 0, reservedCredits: 0, lifetimeIssuedCredits: 0 } });
      user = await tx.user.update({ where: { id: user.id }, data: { defaultWorkspaceId: workspace.id } });
    }
    return user;
  });
}
