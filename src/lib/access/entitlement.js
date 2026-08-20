/**
 * THE SINGLE DEFINITION OF "THIS ACCOUNT HAS A PLAN".
 *
 * Access to the product is gated on three mandatory steps, in order:
 *   1. authenticated (Supabase session)
 *   2. email verified
 *   3. a plan purchased  <-- this file
 *
 * Step 3 was previously expressed as an inline Prisma predicate duplicated in
 * two places inside authorization.js. Duplicating it meant the middleware, the
 * layout gate, and the feature check could silently disagree about who has
 * paid, which is the kind of drift that either locks out paying customers or
 * lets unpaid ones in. There is now exactly one predicate and every caller
 * derives from it.
 *
 * WHY CANCEL_AT_PERIOD_END COUNTS AS ACTIVE:
 * A user who cancels has paid through the end of the current period. Polar's
 * lifecycle keeps the entitlement row alive with status CANCEL_AT_PERIOD_END and
 * an unchanged `endsAt`, and polarWebhookProcessor itself treats
 * ["ACTIVE","CANCEL_AT_PERIOD_END"] as the live set when applying renewals.
 * Excluding it here revoked access the instant someone clicked cancel while
 * still holding their money — a refund request and a support ticket in one. The
 * `endsAt > now` clause is what actually ends access, for both statuses.
 *
 * REVOKED / EXPIRED / PENDING_REVIEW never count: refunds and chargebacks land
 * on REVOKED, and PENDING_REVIEW exists precisely because the payment is not
 * trusted yet.
 */
export const ACTIVE_ENTITLEMENT_STATUSES = Object.freeze(["ACTIVE", "CANCEL_AT_PERIOD_END"]);

/**
 * Prisma `where` clause selecting the entitlements that currently grant access.
 *
 * `userId` is optional so workspace-scoped checks (feature gating) can reuse the
 * exact same status/expiry semantics as identity-scoped checks.
 */
export function activeEntitlementWhere({ workspaceId, userId, now = new Date() } = {}) {
  const where = { status: { in: [...ACTIVE_ENTITLEMENT_STATUSES] }, endsAt: { gt: now } };
  if (workspaceId) where.workspaceId = workspaceId;
  if (userId) where.userId = userId;
  return where;
}

/**
 * The entitlement that currently grants access, or null.
 *
 * Ordered by `endsAt` desc so that when a user holds both a one-time Explorer
 * grant (10-year `endsAt`) and a real subscription, the longest-lived row wins
 * deterministically rather than depending on insertion order.
 *
 * Accepts a Prisma client or transaction client so callers inside a transaction
 * see their own uncommitted writes, matching the `tx` pass-through convention
 * used throughout CreditEscrowService.
 */
export async function findActiveEntitlement(db, { workspaceId, userId, now = new Date() }) {
  if (!workspaceId) return null;
  return db.entitlement.findFirst({
    where: activeEntitlementWhere({ workspaceId, userId, now }),
    orderBy: { endsAt: "desc" },
  });
}
