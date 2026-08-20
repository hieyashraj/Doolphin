import verifiedCatalog from "./catalog/muapi-verified-costs.json" with { type: "json" };
import liveCatalog from "./catalog/muapi-live-catalog.json" with { type: "json" };

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
 *
 * ── Two layered sources, in priority order ─────────────────────────────────
 * 1. PRIMARY: `muapi-live-catalog.json` — the founder's own paste of the live
 *    `GET /api/v1/models` response. This is the highest-authority offline
 *    source we have: it came from MuAPI itself, on a known date, and it also
 *    carries each model's `dynamic_pricing` flag, which is the ONLY valid
 *    billing-basis signal (see `getCatalogPricingMode`).
 * 2. SECONDARY: `muapi-verified-costs.json` — an independently sourced
 *    third-party snapshot, retained as a fallback for models the primary
 *    subset does not yet record, and as a genuinely independent second opinion.
 *
 * A live quote is checked against the primary when present, else the secondary.
 */

export const VERIFIED_COST_REVISION = verifiedCatalog.revision;
export const VERIFIED_COST_PROVENANCE = Object.freeze({ ...verifiedCatalog.provenance });
export const LIVE_CATALOG_REVISION = liveCatalog.revision;
export const LIVE_CATALOG_PROVENANCE = Object.freeze({ ...liveCatalog.provenance });

/**
 * MuAPI's declared pricing mode for a model, straight from the live catalog.
 *
 * @returns {boolean|null} `true` = dynamically priced, exact cost MUST come from
 *   the estimate-cost endpoint. `false` = `cost` is the exact price per call.
 *   `null` = this model is not recorded in the live catalog subset, so no claim
 *   can be made either way.
 */
export function getCatalogPricingMode(providerModelId) {
  const entry = liveCatalog.models[String(providerModelId || "")];
  if (!entry) return null;
  return entry.dynamicPricing === true;
}

/**
 * The live catalog's recorded cost for a model.
 *
 * For a NON-dynamic model this is the exact USD price per call. For a dynamic
 * model it is a REPRESENTATIVE BASE at an unspecified duration/setting and must
 * never be billed — it is only a cross-check baseline.
 */
export function getLiveCatalogCostUsd(providerModelId) {
  const entry = liveCatalog.models[String(providerModelId || "")];
  return entry ? entry.cost : null;
}

export function getLiveCatalogEntry(providerModelId) {
  const entry = liveCatalog.models[String(providerModelId || "")];
  return entry ? Object.freeze({ ...entry }) : null;
}

export function listLiveCatalogModelIds() {
  return Object.keys(liveCatalog.models);
}

/**
 * Asserts that a STATIC (non-dynamic) cost a model definition intends to bill
 * agrees with MuAPI's own catalog.
 *
 * This closes two distinct money bugs that static definitions are prone to:
 *
 *   1. PRICING-MODE CONTRADICTION — the definition says `dynamicPricing: false`
 *      (so it will flat-bill a hardcoded number) while MuAPI says the model is
 *      dynamically priced. Whatever that hardcoded number is, it is not the
 *      price, and the real charge can move with duration or resolution. This
 *      must fail closed, not bill a plausible-looking constant.
 *   2. TRANSCRIPTION DRIFT — the number was hand-typed and does not match the
 *      catalog. For a genuinely fixed-price model MuAPI's `cost` is exact, so
 *      any disagreement is an authoring error, and equality is the right check.
 */
export function assertStaticCostMatchesCatalog({ providerModelId, staticCostUsd } = {}) {
  const mode = getCatalogPricingMode(providerModelId);

  if (mode === null) {
    // Not recorded in the live subset. We cannot confirm the pricing mode, so we
    // cannot prove flat-billing is safe — but neither can we prove it is wrong.
    // Report "unchecked" so the caller decides, rather than silently passing.
    return { ok: true, checked: false, catalogCostUsd: null, catalogPricingMode: null };
  }

  if (mode === true) {
    return {
      ok: false,
      code: "PRICING_MODE_CONTRADICTS_CATALOG",
      reason:
        `Model '${providerModelId}' is configured to bill a fixed $${Number(staticCostUsd).toFixed(4)}, ` +
        `but MuAPI's own catalog marks it dynamic_pricing=true, meaning its real price varies with the ` +
        `request (duration, resolution) and is only knowable from its estimate-cost endpoint. ` +
        `Refusing to flat-bill a dynamically priced model.`,
      catalogCostUsd: getLiveCatalogCostUsd(providerModelId),
      catalogPricingMode: true,
    };
  }

  const catalogCost = getLiveCatalogCostUsd(providerModelId);
  const staticCost = Number(staticCostUsd);

  if (Number.isFinite(catalogCost) && Math.abs(staticCost - catalogCost) > 1e-9) {
    return {
      ok: false,
      code: "STATIC_COST_DISAGREES_WITH_CATALOG",
      reason:
        `Model '${providerModelId}' is configured to bill $${staticCost.toFixed(4)} per call, but MuAPI's ` +
        `catalog states the exact fixed price is $${catalogCost.toFixed(4)}. For a fixed-price model the ` +
        `catalog value is exact, so this is an authoring error. Refusing to bill a figure that contradicts ` +
        `the provider.`,
      catalogCostUsd: catalogCost,
      catalogPricingMode: false,
    };
  }

  return { ok: true, checked: true, catalogCostUsd: catalogCost, catalogPricingMode: false };
}

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

/**
 * The cross-check baseline for a model, preferring the live catalog (MuAPI's own
 * response) over the third-party snapshot. Returns `null` when neither source
 * records the model, which means "cannot cross-check" — not "free".
 */
export function getVerifiedProviderCostUsd(providerModelId) {
  const live = getLiveCatalogCostUsd(providerModelId);
  if (live !== null && live !== undefined) return live;
  const entry = verifiedCatalog.models[String(providerModelId || "")];
  return entry ? entry.costUsdPerGeneration : null;
}

/** Which source supplied the baseline, for auditability in drift messages. */
export function getVerifiedCostSource(providerModelId) {
  if (getLiveCatalogCostUsd(providerModelId) !== null) return "muapi-live-catalog";
  if (verifiedCatalog.models[String(providerModelId || "")]) return "third-party-snapshot";
  return null;
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
export function assertLiveCostWithinVerifiedBand({
  providerModelId,
  liveCostUsd,
  requestedDurationSeconds = null,
  referenceDurationSeconds = null,
} = {}) {
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

  // DURATION-AWARE UPPER BOUND.
  //
  // For a dynamically priced model the baseline is a REPRESENTATIVE BASE at an
  // unspecified duration — MuAPI does not publish which duration it corresponds
  // to. A flat 4x ceiling would therefore reject perfectly legitimate long
  // renders: a model based at ~5s that supports 30s can legitimately cost ~6x
  // the base. Blocking that is fail-closed (so it never costs us money) but it
  // would break a paid feature, which is its own kind of defect.
  //
  // So when we know both the requested duration and the model's own reference
  // (minimum/default) duration from its schema, the ceiling scales with that
  // ratio. Without both, it stays at the flat multiple.
  let upperMultiple = DRIFT_UPPER_MULTIPLE;
  const requested = Number(requestedDurationSeconds);
  const reference = Number(referenceDurationSeconds);
  if (Number.isFinite(requested) && requested > 0 && Number.isFinite(reference) && reference > 0) {
    upperMultiple = DRIFT_UPPER_MULTIPLE * Math.max(1, requested / reference);
  }

  if (live > verified * upperMultiple) {
    return {
      ok: false,
      code: "PROVIDER_COST_DRIFT_HIGH",
      reason: `Provider reported $${live.toFixed(4)} for '${providerModelId}', more than ${upperMultiple.toFixed(2)}x the independently verified $${verified.toFixed(4)} (source: ${getVerifiedCostSource(providerModelId)}). Refusing to charge a customer an unvalidated amount; re-verify MuAPI pricing and refresh the cost snapshot.`,
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
