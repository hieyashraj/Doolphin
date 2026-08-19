import verifiedCatalog from "./catalog/muapi-verified-costs.json" with { type: "json" };

/**
 * VERIFIED COST CROSS-CHECK & DRIFT GUARD
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Runtime pricing authority is, and must remain, MuAPI's own estimate-cost
 * endpoint: it prices the exact payload being run, so Doolphin never authors a
 * price and can never be "wrong" about one. But a single source of truth with no
 * cross-check has two silent failure modes that both cost real money:
 *
 *   1. The provider returns a WRONG or malformed-but-parseable number (an API
 *      regression, a units change, a $0.00 for a paid model). Trusting it blindly
 *      means under-charging on every generation until someone notices manually.
 *   2. A model is onboarded with a hand-typed fallback cost that was mis-read
 *      from a docs page — exactly the "$0.15/sec transcribed as $0.15 flat"
 *      class of error.
 *
 * This module holds an INDEPENDENTLY SOURCED cost snapshot (from MuAPI's own
 * published CLI package, which in turn is generated from MuAPI's internal
 * schema_data.json) and compares the live quote against it. Large divergence
 * fails closed rather than billing a number nobody has validated.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is NOT the price used for billing. It is a guard rail. The snapshot is
 * point-in-time and WILL go stale as MuAPI changes prices; that is expected and
 * is exactly why the tolerance band below is wide, and why exceeding it produces
 * a "verify and refresh" signal rather than a hard permanent block.
 *
 * Costs in the snapshot are USD PER GENERATION (not per second) — evidenced by
 * the upstream generator's own comment, recorded in the JSON provenance block.
 */

export const VERIFIED_COST_REVISION = verifiedCatalog.revision;
export const VERIFIED_COST_PROVENANCE = Object.freeze({ ...verifiedCatalog.provenance });

/**
 * Tolerance band for live-vs-snapshot divergence.
 *
 * Deliberately asymmetric and generous:
 *  - UPPER 4x: a live price far ABOVE the snapshot is usually legitimate (a
 *    longer duration, a higher resolution tier, or a genuine MuAPI price rise).
 *    We still cap it, because an absurd value (e.g. a units bug turning dollars
 *    into cents-as-dollars) must not silently drain a customer's balance.
 *  - LOWER 10x: a live price far BELOW the snapshot is the dangerous direction —
 *    it means we would UNDER-charge and eat the difference on every call.
 */
export const DRIFT_UPPER_MULTIPLE = 4;
export const DRIFT_LOWER_DIVISOR = 10;

export function getVerifiedProviderCostUsd(providerModelId) {
  const entry = verifiedCatalog.models[String(providerModelId || "")];
  return entry ? entry.costUsdPerGeneration : null;
}

export function getVerifiedModelEntry(providerModelId) {
  const entry = verifiedCatalog.models[String(providerModelId || "")];
  return entry ? Object.freeze({ ...entry }) : null;
}

export function listVerifiedModelIds() {
  return Object.keys(verifiedCatalog.models);
}

/**
 * Compares a live provider-reported cost against the verified snapshot.
 *
 * @returns {{ok: true, checked: boolean, verifiedCostUsd: number|null}
 *          | {ok: false, code: string, reason: string, liveCostUsd: number, verifiedCostUsd: number}}
 */
export function assertLiveCostWithinVerifiedBand({ providerModelId, liveCostUsd } = {}) {
  // Reject absent values BEFORE numeric coercion. `Number(null)` is 0 and
  // `Number("")` is 0, which would misreport a MISSING price as a genuine
  // "zero cost" reading. Both outcomes fail closed, but the distinction matters
  // for diagnosing whether the provider said "free" or said nothing at all.
  if (liveCostUsd === null || liveCostUsd === undefined || liveCostUsd === "") {
    return {
      ok: false,
      code: "PROVIDER_COST_IMPLAUSIBLE",
      reason: `Provider returned no usable cost value (${String(liveCostUsd)}); refusing to bill an unvalidated figure.`,
      liveCostUsd: NaN,
      verifiedCostUsd: getVerifiedProviderCostUsd(providerModelId) ?? 0,
    };
  }

  const live = Number(liveCostUsd);

  if (!Number.isFinite(live) || live < 0) {
    return {
      ok: false,
      code: "PROVIDER_COST_IMPLAUSIBLE",
      reason: `Provider reported a non-finite or negative cost (${liveCostUsd}); refusing to bill an unvalidated figure.`,
      liveCostUsd: live,
      verifiedCostUsd: getVerifiedProviderCostUsd(providerModelId) ?? 0,
    };
  }

  const verified = getVerifiedProviderCostUsd(providerModelId);

  // No snapshot entry: cannot cross-check. This is allowed (new models appear
  // faster than snapshots refresh) but is reported so the caller can log it.
  if (verified === null || verified === undefined) {
    return { ok: true, checked: false, verifiedCostUsd: null };
  }

  // A model the snapshot says is free may legitimately report a real cost, and
  // vice versa; a zero baseline makes ratio checks meaningless, so skip them.
  if (verified === 0) {
    return { ok: true, checked: false, verifiedCostUsd: 0 };
  }

  // A live cost of exactly zero for a model known to be paid is the single most
  // dangerous reading: it would make the generation free to the customer and
  // fully absorbed by us.
  if (live === 0) {
    return {
      ok: false,
      code: "PROVIDER_COST_ZERO_FOR_PAID_MODEL",
      reason: `Provider reported $0.00 for '${providerModelId}', which is independently verified at $${verified.toFixed(4)} per generation. Refusing to sell a paid generation for free.`,
      liveCostUsd: live,
      verifiedCostUsd: verified,
    };
  }

  if (live > verified * DRIFT_UPPER_MULTIPLE) {
    return {
      ok: false,
      code: "PROVIDER_COST_DRIFT_HIGH",
      reason: `Provider reported $${live.toFixed(4)} for '${providerModelId}', more than ${DRIFT_UPPER_MULTIPLE}x the independently verified $${verified.toFixed(4)}. Refusing to charge a customer an unvalidated amount; re-verify MuAPI pricing and refresh the cost snapshot.`,
      liveCostUsd: live,
      verifiedCostUsd: verified,
    };
  }

  if (live < verified / DRIFT_LOWER_DIVISOR) {
    return {
      ok: false,
      code: "PROVIDER_COST_DRIFT_LOW",
      reason: `Provider reported $${live.toFixed(4)} for '${providerModelId}', less than 1/${DRIFT_LOWER_DIVISOR} of the independently verified $${verified.toFixed(4)}. Refusing to under-charge; re-verify MuAPI pricing and refresh the cost snapshot.`,
      liveCostUsd: live,
      verifiedCostUsd: verified,
    };
  }

  return { ok: true, checked: true, verifiedCostUsd: verified };
}
