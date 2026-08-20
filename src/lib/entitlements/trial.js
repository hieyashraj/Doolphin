import { TRIAL_PLAN_CODE } from "./plan-catalog.js";
import { findActiveEntitlement } from "../access/entitlement.js";

/**
 * ELIGIBILITY FOR THE $2.99 EXPLORER TRIAL.
 *
 * Explorer is a one-time, non-renewing credit grant used to let a hesitant
 * signup see real output before paying $29. It is therefore not a public SKU and
 * not something an account may hold twice.
 *
 * This is a PRE-CHECK, not the enforcement boundary. The real guarantee is in
 * the database: the `Explorer_one_per_user` / `Explorer_one_per_workspace`
 * unique indexes plus the unique `User.explorerOrderId`, which make a duplicate
 * grant impossible even if two checkouts race or a webhook is replayed. This
 * function exists so we refuse *before* taking someone's money and creating a
 * refund obligation, and so the pricing page can decide whether to show the
 * trial link at all.
 *
 * Reasons are returned rather than a bare boolean because the caller needs to
 * say something specific: "you already used your trial" and "you are already on
 * a paid plan" are very different messages to a customer.
 */
export const TRIAL_INELIGIBLE = Object.freeze({
  ALREADY_CLAIMED: "TRIAL_ALREADY_CLAIMED",
  ALREADY_SUBSCRIBED: "TRIAL_PLAN_ALREADY_ACTIVE",
});

export async function evaluateTrialEligibility(db, appUser) {
  if (!appUser) return { eligible: false, reason: TRIAL_INELIGIBLE.ALREADY_CLAIMED };

  // A claimed Explorer is permanent and identity-scoped: the credits were already
  // granted once, so a second grant would be free money regardless of whether the
  // resulting entitlement has since expired.
  if (appUser.explorerClaimedAt || appUser.explorerOrderId) {
    return { eligible: false, reason: TRIAL_INELIGIBLE.ALREADY_CLAIMED };
  }

  // Someone already inside the product does not need a trial, and selling them
  // 200 credits at $2.99 while they hold a 7,000-credit plan is pure confusion.
  const active = await findActiveEntitlement(db, {
    workspaceId: appUser.defaultWorkspaceId,
    userId: appUser.id,
  });
  if (active) return { eligible: false, reason: TRIAL_INELIGIBLE.ALREADY_SUBSCRIBED };

  return { eligible: true, reason: null, planCode: TRIAL_PLAN_CODE };
}
