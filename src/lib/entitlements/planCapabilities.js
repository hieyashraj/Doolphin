import { PLAN_BY_CODE } from "./plan-catalog.js";

/**
 * PLAN CAPABILITY ENFORCEMENT
 * ===========================
 * `maxResolution` and `maxDurationSeconds` have been declared on every plan since
 * the catalogue was written, and read by nothing. That made the advertised
 * tiering untrue in both directions: a cheaper plan was not prevented from
 * requesting a higher resolution it happened to afford, and a dearer plan
 * advertised capabilities as differentiators that were not actually gated.
 *
 * This is a PRODUCT boundary, not a safety one. The margin invariant never
 * depended on it -- credits are ceiling-divided from real cost, so an expensive
 * render is simply expensive, and a request the buyer cannot afford is already
 * refused at reservation. Enforcing these caps makes the pricing page honest; it
 * does not protect revenue.
 *
 * Enforced at preflight, before any provider call, so a rejected request costs
 * nothing.
 */

/**
 * Resolution ordering, ascending.
 *
 * Compared by rank rather than string so "1080p" vs "720p" cannot be decided
 * lexicographically, which would rank "1080p" below "720p" and silently let a
 * 720p plan request 1080p.
 */
const RESOLUTION_RANK = Object.freeze({
  "480p": 1,
  "540p": 2,
  "720p": 3,
  "1080p": 4,
  "1440p": 5,
  "2k": 5,
  "4k": 6,
});

function rankOf(resolution) {
  if (resolution === null || resolution === undefined) return null;
  const key = String(resolution).trim().toLowerCase();
  return RESOLUTION_RANK[key] ?? null;
}

/** Human list of everything a plan permits, for the upgrade message. */
function allowedResolutionsFor(maxResolution) {
  const cap = rankOf(maxResolution);
  if (cap === null) return [];
  return Object.entries(RESOLUTION_RANK)
    .filter(([, rank]) => rank <= cap)
    // 2k and 1440p share a rank; keep the canonical spellings the UI offers.
    .filter(([label]) => label !== "1440p")
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => (label === "4k" ? "4K" : label === "2k" ? "2K" : label));
}

/**
 * Checks a generation request against the buyer's plan.
 *
 * An UNKNOWN resolution is allowed through rather than refused: the caller has
 * already validated it against the model's own supported list, and a resolution
 * this module has not been taught about is a gap here, not an attempt to cheat.
 * Failing closed on it would break a legitimate request for a newly supported
 * format. The financial guards are elsewhere and unaffected either way.
 *
 * @returns {{ok: true} | {ok: false, code: string, reason: string, ...details}}
 */
export function assertRequestWithinPlan({
  planCode,
  resolution = null,
  durationSeconds = null,
} = {}) {
  const plan = PLAN_BY_CODE[String(planCode || "")];

  // No recognised plan: this module makes no judgement. Entitlement itself is
  // enforced by requireActivatedAccount, which has already run.
  if (!plan) return { ok: true, enforced: false };

  const requested = rankOf(resolution);
  const cap = rankOf(plan.maxResolution);
  if (requested !== null && cap !== null && requested > cap) {
    return {
      ok: false,
      code: "PLAN_RESOLUTION_EXCEEDED",
      reason:
        `Your ${plan.name} plan supports up to ${plan.maxResolution}. ` +
        `Upgrade to render at ${resolution}.`,
      planCode: plan.code,
      planName: plan.name,
      requestedResolution: resolution,
      maxResolution: plan.maxResolution,
      allowedResolutions: allowedResolutionsFor(plan.maxResolution),
    };
  }

  const requestedDuration = Number(durationSeconds);
  if (
    Number.isFinite(requestedDuration) &&
    requestedDuration > 0 &&
    plan.maxDurationSeconds &&
    requestedDuration > plan.maxDurationSeconds
  ) {
    return {
      ok: false,
      code: "PLAN_DURATION_EXCEEDED",
      reason:
        `Your ${plan.name} plan supports videos up to ${plan.maxDurationSeconds} seconds. ` +
        `Upgrade to generate ${requestedDuration} seconds.`,
      planCode: plan.code,
      planName: plan.name,
      requestedDurationSeconds: requestedDuration,
      maxDurationSeconds: plan.maxDurationSeconds,
    };
  }

  return { ok: true, enforced: true, planCode: plan.code };
}

/** The caps for a plan, so the UI can disable options instead of erroring. */
export function planCapabilities(planCode) {
  const plan = PLAN_BY_CODE[String(planCode || "")];
  if (!plan) return null;
  return Object.freeze({
    planCode: plan.code,
    planName: plan.name,
    maxResolution: plan.maxResolution,
    maxDurationSeconds: plan.maxDurationSeconds,
    allowedResolutions: allowedResolutionsFor(plan.maxResolution),
  });
}
