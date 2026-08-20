import { RESTRICTED_MODEL_FAMILIES } from "./plan-catalog.js";

/**
 * PER-PLAN MODEL ACCESS.
 *
 * Doolphin's deliberate product position is that every PAID plan can use every
 * model, at any resolution and any clip length the model itself supports. There
 * is no 4K upsell and no duration upsell, because gating quality behind price is
 * what makes competitors' entry tiers feel like a demo.
 *
 * Exactly one restriction exists: the $2.99 Explorer trial excludes the Seedance
 * 2.5 family. Its cheapest tier costs 190 credits against the trial's 220, so a
 * single click could consume the whole trial and leave a first-time user with
 * nothing — a worse introduction than the model it replaces.
 *
 * Enforced here, server-side, rather than by hiding options in the UI. A hidden
 * option is not a rule; a request can always name the model directly.
 */

const FALLBACK_RESTRICTED_FAMILIES = Object.freeze(["seedance-2.5"]);

/**
 * Families denied to a plan. An unrecognised plan code fails CLOSED to the
 * trial's restrictions: if we cannot prove which plan is paying, we must not
 * hand over the most expensive model family on the bench.
 */
export function restrictedFamiliesForPlan(planCode) {
  const configured = RESTRICTED_MODEL_FAMILIES[planCode];
  return configured ?? FALLBACK_RESTRICTED_FAMILIES;
}

/**
 * Whether a model belongs to a restricted family.
 *
 * Matches on the provider model id prefix as well as an explicit family value,
 * because the catalog's `family` field is not present on every code path and the
 * provider ids are reliably prefixed (`seedance-2.5-spicy-video-extend-480p`).
 * Note `seedance-2-...` must NOT match `seedance-2.5` — the boundary character
 * check below is what keeps Seedance 2 available to the trial.
 */
function matchesFamily(family, { providerModelId, modelFamily }) {
  if (modelFamily && String(modelFamily).toLowerCase() === family) return true;

  // Segment-boundary match so it works on both a bare provider id
  // ("seedance-2.5-spicy-video-extend-480p") and a namespaced internal id
  // ("muapi.seedance-2.5-spicy-video-extend-480p"), while ensuring the
  // Seedance *2* family — which the trial keeps — can never match "seedance-2.5".
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[./])${escaped}(-|$)`).test(String(providerModelId || "").toLowerCase());
}

/**
 * Throws when the plan may not use the model. Shape matches the other
 * entitlement guards so API routes can map `error.code` / `error.status`
 * directly.
 */
export function assertModelAllowedForPlan({ planCode, providerModelId, modelFamily = null, modelName = null }) {
  const restricted = restrictedFamiliesForPlan(planCode);
  for (const family of restricted) {
    if (matchesFamily(family, { providerModelId, modelFamily })) {
      const error = new Error(
        `${modelName || providerModelId} is not included in the Explorer trial. Every paid plan includes it.`
      );
      error.code = "MODEL_NOT_IN_PLAN";
      error.status = 403;
      error.family = family;
      error.upgradeRequired = true;
      throw error;
    }
  }
}

/** Non-throwing form, for rendering a model picker. */
export function isModelAllowedForPlan({ planCode, providerModelId, modelFamily = null }) {
  try {
    assertModelAllowedForPlan({ planCode, providerModelId, modelFamily });
    return true;
  } catch {
    return false;
  }
}
