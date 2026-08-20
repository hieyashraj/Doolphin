import ceilings from "./catalog/muapi-cost-ceilings.json" with { type: "json" };

/**
 * THE DOCUMENTED COST SURFACE
 * ===========================
 * Founder-supplied pricing document ("Models and their Pricing"), distilled by
 * scripts/build-cost-ceilings.mjs. This is the offline authority on WHAT A CALL
 * CAN COST AT MOST.
 *
 * ------------------------- THE DISTINCTION THAT MATTERS ----------------------
 * A provider catalog's `cost` field is the price at a model's DEFAULT
 * parameters. It is not the maximum. The document shows the gap is large and
 * entirely under user control:
 *
 *   veo3.1-lite-image-to-video     $0.30 (720p default)  ->  $1.50 (4k)      5x
 *   grok-imagine-image-to-video    $0.15 (6s default)    ->  $1.50 (30s)    10x
 *   seedance-2.5-text-to-video-4k  $8.50 (5s default)    ->  $51.00 (30s)    6x
 *   kling-v2.6-pro-motion-control  $0.145 (catalog)      ->  $8.70 (60s)    60x
 *
 * Treating a default cost as a ceiling under-bills by these multiples on every
 * non-default request. Nothing here is ever used as a billing amount — billing
 * comes from the provider's own estimate-cost endpoint. These figures serve two
 * purposes:
 *
 *   1. a CROSS-CHECK BAND for the live estimate, wide enough not to reject
 *      legitimate expensive requests but tight enough to catch a units bug
 *   2. a WORST-CASE INPUT to the plan margin proofs, so plan economics are
 *      verified against what a call can really cost rather than its default
 *
 * ------------------------------ PRICING CLASSES ------------------------------
 *   flat           one price, explicitly declared "Flat rate per run"
 *   bounded        whole price surface derivable; ceiling is trustworthy
 *   unbounded      cost scales with the duration of USER-SUPPLIED media, which
 *                  is not present in the request payload -- no static ceiling
 *                  can exist, so these must be gated, not estimated
 *   indeterminate  the model exposes price-varying parameters but the document
 *                  omits their prices; the ceiling is a lower bound, not a max
 *
 * `unbounded` and `indeterminate` both mean "do not trust a static number here".
 * They are distinguished because the remedies differ: unbounded needs an input
 * duration policy, indeterminate needs the document filled in.
 */
export const DOCUMENTED_COST_REVISION = ceilings.revision;
export const DOCUMENTED_COST_PROVENANCE = Object.freeze({ ...ceilings.provenance });

const MODELS = ceilings.models;

const key = (providerModelId) => String(providerModelId || "");

/** Raw documented entry, or null when the model is not in the document. */
export function getDocumentedEntry(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return entry ? Object.freeze({ ...entry }) : null;
}

export function listDocumentedModelIds() {
  return Object.keys(MODELS);
}

/**
 * Maximum USD a single call can cost, per the document.
 *
 * Returns null when the model is undocumented. Null means "unknown", never
 * "free" — callers must not coerce it to 0.
 */
export function getDocumentedCeilingUsd(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return entry && entry.ceilingUsd !== null && entry.ceilingUsd !== undefined
    ? entry.ceilingUsd
    : null;
}

/** As above, in whole microUSD, for exact BigInt arithmetic. */
export function getDocumentedCeilingMicroUsd(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return entry && entry.ceilingMicroUsd !== null && entry.ceilingMicroUsd !== undefined
    ? BigInt(entry.ceilingMicroUsd)
    : null;
}

/**
 * Price at the model's DEFAULT parameters.
 *
 * Exposed for diagnostics and drift reporting only. Deliberately NOT usable as
 * a billing basis -- that is the mistake this module exists to prevent.
 */
export function getDocumentedDefaultCostUsd(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return entry && entry.defaultCostUsd !== null && entry.defaultCostUsd !== undefined
    ? entry.defaultCostUsd
    : null;
}

/** 'flat' | 'bounded' | 'unbounded' | 'indeterminate' | null (undocumented). */
export function getDocumentedPricingClass(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return entry ? entry.pricingClass : null;
}

/** True when the document proves price cannot vary for this model. */
export function isDocumentedFlatPrice(providerModelId) {
  const entry = MODELS[key(providerModelId)];
  return Boolean(entry) && entry.pricingClass === "flat" && entry.priceVaries === false;
}

/**
 * Fail-closed admission check: may this model be dispatched at all?
 *
 * `unbounded` models are refused because their cost is a function of the length
 * of a video behind a user-supplied URL. Nothing in the request bounds it: a
 * caller can point at a 10-minute file and multiply the bill arbitrarily. That
 * is a user-controllable spend amplifier, so it is blocked at admission rather
 * than mitigated downstream.
 *
 * `indeterminate` models are refused because the document does not state prices
 * for settings they accept, so no cross-check band can be constructed. Billing
 * them would mean trusting an un-cross-checkable provider number.
 *
 * Undocumented models are ALLOWED through: the document covers a curated subset,
 * and other models still price via the live estimate with the snapshot band.
 * Absence of documentation is not evidence of danger.
 *
 * @returns {{ok: true, pricingClass: string|null}
 *          | {ok: false, code: string, reason: string, pricingClass: string, evidence?: Array}}
 */
export function assertModelCostIsBoundable({ providerModelId } = {}) {
  const entry = MODELS[key(providerModelId)];
  if (!entry) return { ok: true, pricingClass: null, documented: false };

  if (entry.pricingClass === "unbounded") {
    const quotes = (entry.unboundedEvidence ?? []).map((e) => `"${e.quote}"`).join("; ");
    return {
      ok: false,
      code: "MODEL_COST_UNBOUNDED",
      reason:
        `'${providerModelId}' is billed on the duration of user-supplied media (${entry.unboundedKind}), ` +
        `so a single call has no cost ceiling derivable from the request. Documented evidence: ${quotes}. ` +
        `Refusing to dispatch a generation whose maximum cost cannot be bounded before it runs.`,
      pricingClass: entry.pricingClass,
      evidence: entry.unboundedEvidence ?? [],
      documented: true,
    };
  }

  if (entry.pricingClass === "indeterminate") {
    return {
      ok: false,
      code: "MODEL_COST_INDETERMINATE",
      reason:
        `'${providerModelId}' accepts price-varying parameters (${entry.costDrivers.join(", ") || "unknown"}) ` +
        `but the pricing document does not state their prices, so the provider's figure cannot be ` +
        `cross-checked. Refusing to bill an unverifiable amount.`,
      pricingClass: entry.pricingClass,
      documented: true,
    };
  }

  return { ok: true, pricingClass: entry.pricingClass, documented: true };
}

/** Normalises a price-table cell or user value for comparison. */
function normaliseToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Extracts a leading number from cells like `10s` or `1080p`. */
function numericToken(value) {
  const m = /^([0-9]+(?:\.[0-9]+)?)/.exec(String(value ?? "").trim());
  return m ? Number(m[1]) : null;
}

/**
 * Maps a price-table dimension name onto the caller's request parameters.
 * Returns undefined when the caller supplied nothing for that dimension.
 */
function valueForDimension(dimension, params) {
  const d = normaliseToken(dimension);
  if (d.includes("duration")) return params.durationSeconds;
  if (d.includes("resolution")) return params.resolution;
  if (d.includes("quality")) return params.quality;
  if (d.includes("videoreference")) return params.hasVideoReference ? "Yes" : "No";
  if (d.includes("audio")) return params.audio;
  if (d.includes("extend")) return params.extendCount;
  return undefined;
}

/**
 * The exact documented cost for one parameter combination, or null when the
 * document does not pin that combination down.
 *
 * Purpose is pre-dispatch display: showing a real credit cost on the Generate
 * button without a network round-trip. A null result means "ask the provider",
 * not "free".
 *
 * Duration cells are matched numerically (`10s` == 10) so a caller passing a
 * number matches a table written with a unit suffix. Every dimension the table
 * declares must match; a partial match returns null rather than guessing.
 */
export function resolveDocumentedCostUsd({
  providerModelId,
  resolution = undefined,
  quality = undefined,
  durationSeconds = undefined,
  hasVideoReference = undefined,
  audio = undefined,
  extendCount = undefined,
} = {}) {
  const entry = MODELS[key(providerModelId)];
  if (!entry) return null;

  if (entry.pricingClass === "flat") {
    return entry.ceilingUsd ?? entry.defaultCostUsd ?? null;
  }

  const params = { resolution, quality, durationSeconds, hasVideoReference, audio, extendCount };

  for (const table of entry.priceTables ?? []) {
    for (const row of table.rows ?? []) {
      let matched = true;
      for (let i = 0; i < table.dimensions.length; i += 1) {
        const supplied = valueForDimension(table.dimensions[i], params);
        if (supplied === undefined || supplied === null) {
          matched = false;
          break;
        }
        const cell = row.combination[i];
        const cellNum = numericToken(cell);
        const suppliedNum = numericToken(supplied);
        const numericDimension = normaliseToken(table.dimensions[i]).includes("duration");
        if (numericDimension && cellNum !== null && suppliedNum !== null) {
          if (cellNum !== suppliedNum) {
            matched = false;
            break;
          }
        } else if (normaliseToken(cell) !== normaliseToken(supplied)) {
          matched = false;
          break;
        }
      }
      if (matched && row.costUsd !== null && row.costUsd !== undefined) return row.costUsd;
    }
  }

  return null;
}

/**
 * The cross-check band for a live provider quote.
 *
 * The documented ceiling replaces the "default cost x flat multiple" heuristic.
 * That heuristic is wrong in both directions: it rejects a legitimate 4k render
 * costing 5x its 720p default, while accepting an absurd figure on a model whose
 * real price surface is narrow.
 *
 * `toleranceMultiple` above the documented ceiling absorbs provider rounding and
 * small genuine price rises without re-deriving the document.
 *
 * Returns null when the model is undocumented, meaning the caller should fall
 * back to its snapshot-based band.
 */
export const CEILING_TOLERANCE_MULTIPLE = 1.25;

export function getDocumentedCostBand(providerModelId, { toleranceMultiple = CEILING_TOLERANCE_MULTIPLE } = {}) {
  const entry = MODELS[key(providerModelId)];
  if (!entry || entry.ceilingUsd === null || entry.ceilingUsd === undefined) return null;

  // An indeterminate ceiling is a lower bound, not a maximum, so it must not be
  // used to reject a higher live quote.
  const trustworthyMaximum = entry.pricingClass === "flat" || entry.pricingClass === "bounded";

  return Object.freeze({
    providerModelId: key(providerModelId),
    pricingClass: entry.pricingClass,
    defaultCostUsd: entry.defaultCostUsd,
    ceilingUsd: entry.ceilingUsd,
    maxAcceptableUsd: trustworthyMaximum ? entry.ceilingUsd * toleranceMultiple : null,
    trustworthyMaximum,
    toleranceMultiple,
  });
}

/**
 * Cross-checks a live provider quote against the documented price surface.
 *
 * Only the ABOVE-CEILING direction is judged here. Under-charging is caught by
 * the existing snapshot band in verifiedCosts.js; duplicating that logic against
 * a different baseline would create two disagreeing lower bounds.
 *
 * @returns {{ok: true, checked: boolean, ceilingUsd: number|null}
 *          | {ok: false, code: string, reason: string, liveCostUsd: number, ceilingUsd: number}}
 */
export function assertLiveCostWithinDocumentedCeiling({
  providerModelId,
  liveCostUsd,
  toleranceMultiple = CEILING_TOLERANCE_MULTIPLE,
} = {}) {
  const band = getDocumentedCostBand(providerModelId, { toleranceMultiple });
  if (!band) return { ok: true, checked: false, ceilingUsd: null };
  if (!band.trustworthyMaximum) return { ok: true, checked: false, ceilingUsd: band.ceilingUsd };

  const live = Number(liveCostUsd);
  if (!Number.isFinite(live)) {
    // Plausibility of the value itself is verifiedCosts.js's responsibility.
    return { ok: true, checked: false, ceilingUsd: band.ceilingUsd };
  }

  if (live > band.maxAcceptableUsd) {
    return {
      ok: false,
      code: "PROVIDER_COST_EXCEEDS_DOCUMENTED_CEILING",
      reason:
        `Provider quoted $${live.toFixed(4)} for '${providerModelId}', above the documented maximum of ` +
        `$${band.ceilingUsd.toFixed(4)} (+${Math.round((toleranceMultiple - 1) * 100)}% tolerance = ` +
        `$${band.maxAcceptableUsd.toFixed(4)}). Either MuAPI raised prices or the request exceeds the ` +
        `documented parameter range. Refusing to charge beyond the verified price surface until the ` +
        `pricing document is refreshed.`,
      liveCostUsd: live,
      ceilingUsd: band.ceilingUsd,
    };
  }

  return { ok: true, checked: true, ceilingUsd: band.ceilingUsd };
}
