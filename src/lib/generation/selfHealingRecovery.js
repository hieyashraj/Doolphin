import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { reconciliationEligibleVariantWhere } from "@/lib/generation/reconciliationEligibility";

/**
 * SELF-HEALING RECOVERY
 * =====================
 * Every recovery guarantee in this system runs through /api/internal/reconcile,
 * which nothing inside the repository schedules. It is driven by an external
 * cron, so if that schedule lapses -- a changed URL, a rotated secret, an expired
 * free tier -- a generation whose provider webhook was lost stays PROCESSING
 * forever, its credits stay reserved, and the workspace's concurrency slot stays
 * consumed. The user sees a permanently spinning card and a balance short by
 * credits they never spent.
 *
 * This removes that single point of failure for the case that matters most:
 * releasing credits held by a generation that can no longer finish. An active
 * user's own ordinary traffic recovers their own stuck work.
 *
 * Deliberately narrow:
 *   - scoped to ONE workspace, so a user can never trigger work for anyone else
 *   - only variants already PAST their timeoutAt, so nothing in flight is touched
 *   - hard row limit, so a pathological account cannot turn a page load into a
 *     long transaction
 *   - no provider calls, so it cannot spend money or block on a third party
 *
 * It is a safety net, not a replacement for the cron: the cron additionally polls
 * providers and drains the submission outbox, neither of which belongs on a user
 * request path.
 */

/** Never process more than this many variants in one opportunistic pass. */
const MAX_VARIANTS_PER_PASS = 5;

/**
 * Roll a creation up to a terminal status once none of its variants are active.
 *
 * Mirrors the reconciler's own rollup so a creation recovered here is
 * indistinguishable from one recovered by the cron: a partially successful
 * creation stays PARTIAL_COMPLETED rather than being flattened to failed, which
 * would discard outputs the user can still use and has already been charged for.
 */
async function rollUpCreation(creationId) {
  const variants = await prisma.creationVariant.findMany({
    where: { creationId },
    select: { status: true, errorCode: true },
  });
  if (!variants.length) return;
  if (variants.some((variant) => ["QUEUED", "PROCESSING"].includes(variant.status))) return;

  const completed = variants.filter((variant) => variant.status === "COMPLETED").length;
  const quarantined = variants.some((variant) => variant.status === "QUARANTINED");
  const failed = variants.find((variant) =>
    ["FAILED", "TIMED_OUT", "CANCELLED"].includes(variant.status),
  );
  const status = completed
    ? "PARTIAL_COMPLETED"
    : quarantined
      ? "QUARANTINED"
      : failed
        ? "FAILED"
        : "TIMED_OUT";
  const errorCode = failed?.errorCode || (status === "TIMED_OUT" ? "WORKFLOW_TIMEOUT" : null);

  await prisma.creation.update({
    where: { id: creationId },
    data: {
      status,
      completedAt: new Date(),
      currentStage: status === "PARTIAL_COMPLETED" ? "delivery" : "quality_verification",
      progressValue: variants.length ? (completed / variants.length) * 100 : 0,
      errorCode,
      safeError: errorCode ? userFacingGenerationMessage(status, errorCode) : null,
    },
  });
}

/**
 * Release credits held by this workspace's generations that have passed their
 * timeout and can no longer complete.
 *
 * Safe to call on any authenticated request. Never throws: a recovery failure
 * must not turn a working page into an error, since the cron remains the primary
 * mechanism and will retry.
 *
 * @returns {Promise<{recovered: number, variantIds: string[]}>}
 */
export async function recoverTimedOutVariantsForWorkspace(
  workspaceId,
  { limit = MAX_VARIANTS_PER_PASS } = {},
) {
  if (!workspaceId) return { recovered: 0, variantIds: [] };

  try {
    const timedOut = await prisma.creationVariant.findMany({
      where: {
        ...reconciliationEligibleVariantWhere(),
        status: { in: ["QUEUED", "PROCESSING"] },
        timeoutAt: { lt: new Date() },
        // Scope to the caller's own workspace. Without this an ordinary page load
        // would perform global recovery work on behalf of every account.
        creation: { is: { workspaceId } },
      },
      select: { id: true, creationId: true },
      take: Math.max(1, Math.min(limit, MAX_VARIANTS_PER_PASS)),
    });

    if (!timedOut.length) return { recovered: 0, variantIds: [] };

    const variantIds = [];
    for (const variant of timedOut) {
      /*
       * Release first, then mark terminal.
       *
       * releaseVariantReservations is idempotent on reservation state, so if this
       * pass dies between the two steps the next pass -- or the cron -- releases
       * nothing extra and still completes the transition. The reverse order could
       * mark a variant terminal while its credits stayed reserved, and a terminal
       * variant is no longer picked up by this query, so the hold would become
       * permanent.
       */
      await CreditEscrowService.releaseVariantReservations(variant.id, "WORKFLOW_TIMEOUT");

      await prisma.providerJob.updateMany({
        where: {
          creationVariantId: variant.id,
          status: { in: ["PREPARED", "QUEUED", "PROCESSING"] },
        },
        data: {
          status: "TIMED_OUT",
          errorCode: "WORKFLOW_TIMEOUT",
          safeError: "Workflow timed out before completion.",
        },
      });

      // Guarded on status so a webhook that lands between the query and this
      // write is not overwritten: a genuinely completed generation must not be
      // marked timed out.
      const claimed = await prisma.creationVariant.updateMany({
        where: { id: variant.id, status: { in: ["QUEUED", "PROCESSING"] } },
        data: {
          status: "TIMED_OUT",
          errorCode: "WORKFLOW_TIMEOUT",
          safeError: userFacingGenerationMessage("TIMED_OUT", "WORKFLOW_TIMEOUT"),
        },
      });
      if (claimed.count !== 1) continue;

      await rollUpCreation(variant.creationId);
      variantIds.push(variant.id);
    }

    return { recovered: variantIds.length, variantIds };
  } catch (error) {
    // Never surface a recovery failure to the user. The scheduled reconciler is
    // still responsible for this work and will retry.
    console.error("[SELF_HEALING_RECOVERY_FAILED]", error);
    return { recovered: 0, variantIds: [] };
  }
}
