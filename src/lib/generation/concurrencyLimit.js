import { PLAN_BY_CODE } from "../entitlements/plan-catalog.js";

/**
 * PER-PLAN CONCURRENT VIDEO GENERATION LIMITS.
 *
 * Explorer and Starter may have ONE video in flight. Growth and Agency may have
 * FOUR. Submitting past the ceiling is refused until an in-flight generation
 * finishes — which is precisely when it becomes playable in the library, so the
 * rule the user experiences ("wait for one to appear in your library") and the
 * rule the server enforces are the same rule, not two approximations of it.
 *
 * WHY A SLOT IS A VARIANT, NOT A REQUEST:
 * One submission can request several outputs (`settings.outputCount`), and each
 * output is a separate CreationVariant that occupies a separate provider job. If
 * slots counted submissions, a Starter user could ask for 4 videos in one request
 * and consume 4x the throughput the plan pays for. Counting variants makes "4
 * videos at once" mean the same thing whether it arrives as one request for four
 * or four requests for one.
 *
 * WHY IT IS RACE-SAFE:
 * The count and the subsequent inserts run in the same Serializable transaction
 * as the credit reservation. Two submissions that would jointly exceed the
 * ceiling cannot both observe a stale count and commit: Postgres aborts one with
 * a serialization failure. This follows the codebase convention of Serializable
 * isolation plus optimistic version guards rather than advisory locks — do not
 * "optimise" this into a pre-transaction check, which is exactly the double-spend
 * shape this avoids.
 */

/**
 * Statuses that occupy a slot. A slot is held from submission until the variant
 * reaches ANY terminal status — COMPLETED, PARTIAL_COMPLETED, FAILED, CANCELLED,
 * TIMED_OUT or QUARANTINED all release it. This matches the in-flight definition
 * used by the reconciler (src/app/api/internal/reconcile/route.js) and by the
 * library's notion of a finished video.
 */
export const IN_FLIGHT_VARIANT_STATUSES = Object.freeze(["QUEUED", "PROCESSING"]);

/**
 * Generation types that consume a VIDEO slot.
 *
 * IMAGE_STUDIO is excluded. The previous hard-coded limit counted every variant
 * in the workspace, so an in-flight image generation silently stole a video slot
 * and a Starter user with one image rendering could not start a video at all.
 * Images are cheap, fast, and not what this limit exists to ration.
 *
 * LEGACY is also excluded: those rows predate the current engine and cannot be
 * re-driven, so a stuck legacy row must not permanently consume a paying user's
 * only slot.
 */
export const VIDEO_GENERATION_TYPES = Object.freeze([
  "VIDEO_STUDIO",
  "PRODUCT_STUDIO",
  "APP_STUDIO",
  "PRODUCT_AD",
]);

/**
 * Slots for an unrecognised or absent plan code.
 *
 * Fails to the most restrictive value on purpose. An unknown plan code means our
 * understanding of this account is wrong, and the safe reaction to that is to
 * ration throughput, not to hand out the maximum. Callers reach this path only
 * through requireActivatedAccount(), which guarantees an entitlement exists, so
 * in practice this covers a plan retired from the catalog while still held by a
 * live customer.
 */
export const FALLBACK_VIDEO_SLOTS = 1;

export function videoSlotsForPlan(planCode) {
  const slots = PLAN_BY_CODE[planCode]?.videoSlots;
  return Number.isInteger(slots) && slots > 0 ? slots : FALLBACK_VIDEO_SLOTS;
}

/**
 * How many video slots the workspace is currently using.
 *
 * Workspace-scoped rather than user-scoped because slots are a property of the
 * plan, and the plan is what the workspace pays for. Growth buys 3 seats and 4
 * slots; making the limit per-user would silently turn that into 12.
 */
export function countInFlightVideoVariants(db, workspaceId) {
  return db.creationVariant.count({
    where: {
      creation: {
        workspaceId,
        generationType: { in: [...VIDEO_GENERATION_TYPES] },
      },
      status: { in: [...IN_FLIGHT_VARIANT_STATUSES] },
    },
  });
}

function describeLimit({ limit, inFlight, requested }) {
  const waitingOn = limit === 1 ? "your video" : "one of your videos";
  if (limit === 1) {
    return requested > 1
      ? `Your plan generates one video at a time, so you cannot start ${requested} at once. Generate them one after another, or upgrade to Growth for 4 at a time.`
      : `You already have a video being created. Wait for it to finish and appear in your library, then start the next one — or upgrade to Growth to generate 4 at a time.`;
  }
  if (requested > limit) {
    return `Your plan generates up to ${limit} videos at a time, so you cannot start ${requested} at once.`;
  }
  const available = Math.max(0, limit - inFlight);
  return available === 0
    ? `All ${limit} of your generation slots are in use. Wait for ${waitingOn} to finish and appear in your library, then submit the next one.`
    : `You have ${available} of ${limit} generation slots free, which is not enough for ${requested} more videos. Submit ${available} now, or wait for ${waitingOn} to finish.`;
}

/**
 * Reserve capacity for `requestedCount` more videos, or throw.
 *
 * MUST be called with `tx` — the transaction that also creates the variants — so
 * the observation and the insert are atomic.
 *
 * Throws an Error carrying BOTH `code` and `statusCode`. That shape is load
 * bearing: the submission route's outer catch only re-surfaces an error's own
 * status when both fields are present, and otherwise flattens it into a generic
 * 503. A dropped field here turns a clear "wait for your video" into
 * "submission unavailable".
 */
export async function assertVideoSlotAvailable({ tx, workspaceId, requestedCount, planCode }) {
  const limit = videoSlotsForPlan(planCode);
  const inFlight = await countInFlightVideoVariants(tx, workspaceId);

  if (inFlight + requestedCount > limit) {
    const error = new Error(describeLimit({ limit, inFlight, requested: requestedCount }));
    error.code = "ACTIVE_VIDEO_LIMIT";
    error.statusCode = 429;
    error.details = { limit, inFlight, requested: requestedCount, planCode };
    throw error;
  }

  return { limit, inFlight, available: limit - inFlight - requestedCount };
}

/**
 * Slot usage for display. Read outside any transaction; advisory only, since the
 * authoritative check is assertVideoSlotAvailable at submission time.
 */
export async function getVideoSlotUsage(db, { workspaceId, planCode }) {
  const limit = videoSlotsForPlan(planCode);
  const inFlight = workspaceId ? await countInFlightVideoVariants(db, workspaceId) : 0;
  return { limit, inFlight, available: Math.max(0, limit - inFlight) };
}
