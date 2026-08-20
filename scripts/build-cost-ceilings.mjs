#!/usr/bin/env node
/**
 * Distils the parsed pricing document into a compact runtime artifact:
 *   src/lib/models/catalog/muapi-cost-ceilings.json
 *
 * The full muapi-model-docs.json (~264KB) carries overviews, FAQs and
 * implementation guides that the pricing path has no use for. Runtime needs
 * only the price surface, so this emits a stripped file that can be imported by
 * money-critical code without dragging prose into the bundle.
 *
 * Cross-checked against "MUAPI MODELS.json" so the emitted artifact records both
 * the document's ceiling and the provider catalog's default cost, letting the
 * runtime guard notice if the two ever diverge.
 */
import { readFileSync, writeFileSync } from "node:fs";

const docs = JSON.parse(readFileSync("src/lib/models/catalog/muapi-model-docs.json", "utf8"));
const catalog = JSON.parse(readFileSync("MUAPI MODELS.json", "utf8"));
const catalogByName = new Map(catalog.models.map((m) => [m.name, m]));

/** Round to a whole number of microUSD so downstream BigInt math is exact. */
const toMicroUsd = (usd) =>
  usd === null || usd === undefined ? null : Math.ceil(Number(usd) * 1_000_000);

/**
 * Product policy: no single input or reference video may exceed this many
 * seconds.
 *
 * Models billed on user-supplied media duration have no inherent maximum cost.
 * Capping the input length converts that open-ended exposure into an arithmetic
 * bound, which is what makes them sellable at all.
 */
const INPUT_VIDEO_CAP_SECONDS = 15;

/**
 * The published fraction applied to input duration on surcharge-billed models:
 * "an additional 30% surcharge applies per second of combined input video
 * duration". Taken from the document, not assumed.
 */
const PUBLISHED_INPUT_SURCHARGE_FRACTION = 0.3;

/**
 * Worst-case cost for a model billed on user-supplied media duration, once the
 * input cap is applied.
 *
 * Computed per billing shape because the shapes are genuinely different, and
 * applying one formula to all of them mis-prices most:
 *
 *   input-rate           cost = rate x input_duration
 *                        (the tabulated "Duration" IS the input length here)
 *   combined-duration    cost = discounted_rate x (output + sum(input durations))
 *   input-surcharge      cost = rate x output + 0.3 x rate x sum(input durations)
 *   reference-surcharge  cost = rate x output + <UNPUBLISHED surcharge>
 *
 * The last shape returns unboundable: the document says a surcharge applies but
 * never states its size, and inventing a number is exactly what must not happen.
 */
function deriveInputCappedCeiling(doc, referenceClipLimit) {
  const kind = doc.ceiling.unboundedKind;
  const rates = (doc.perSecondRates ?? []).map((r) => r.rateUsdPerSecond);
  const maxRate = rates.length ? Math.max(...rates) : null;
  const referenceRate = doc.ceiling.referenceRateUsdPerSecond ?? null;
  const outputMax = doc.duration?.maxSeconds ?? null;
  const clips = referenceClipLimit || 1;

  if (kind === "input-rate") {
    if (maxRate === null) {
      return { boundable: false, reason: "no per-second rate is published for this model" };
    }
    return {
      boundable: true,
      ceilingUsd: maxRate * INPUT_VIDEO_CAP_SECONDS,
      formula: `$${maxRate}/sec x ${INPUT_VIDEO_CAP_SECONDS}s capped input`,
    };
  }

  if (kind === "combined-duration") {
    const rate = referenceRate ?? maxRate;
    if (rate === null || outputMax === null) {
      return { boundable: false, reason: "no rate or output duration ceiling is published" };
    }
    const billedSeconds = outputMax + clips * INPUT_VIDEO_CAP_SECONDS;
    return {
      boundable: true,
      ceilingUsd: rate * billedSeconds,
      formula: `$${rate}/sec x (${outputMax}s output + ${clips} x ${INPUT_VIDEO_CAP_SECONDS}s capped reference)`,
    };
  }

  if (kind === "input-surcharge") {
    if (maxRate === null || outputMax === null) {
      return { boundable: false, reason: "no output rate or duration ceiling is published" };
    }
    const outputCost = maxRate * outputMax;
    const surcharge =
      PUBLISHED_INPUT_SURCHARGE_FRACTION * maxRate * clips * INPUT_VIDEO_CAP_SECONDS;
    return {
      boundable: true,
      ceilingUsd: outputCost + surcharge,
      formula:
        `$${maxRate}/sec x ${outputMax}s output + ${PUBLISHED_INPUT_SURCHARGE_FRACTION} x $${maxRate}/sec ` +
        `x ${clips} x ${INPUT_VIDEO_CAP_SECONDS}s capped input`,
    };
  }

  if (kind === "reference-surcharge") {
    return {
      boundable: false,
      reason:
        'the document states "a small surcharge per reference video clip" but never states its ' +
        "amount, so no arithmetic bound exists even with an input cap",
    };
  }

  return { boundable: false, reason: `unrecognised billing shape '${kind}'` };
}

const models = {};

for (const doc of docs.models) {
  const cat = catalogByName.get(doc.name) ?? null;
  const ceiling = doc.ceiling;

  /*
   * The provider catalog's `dynamic_pricing` and the document's own price
   * surface must both be considered. Where they disagree about whether price
   * varies, treat it as varying: the cost of being wrong in that direction is
   * an unnecessary estimate-cost call, whereas the opposite mistake bills a
   * static number for a request whose real cost moves.
   */
  const catalogSaysDynamic = cat ? Boolean(cat.dynamic_pricing) : null;
  const docSaysVaries = ceiling.pricingClass !== "flat";
  const priceVaries = catalogSaysDynamic === null ? docSaysVaries : catalogSaysDynamic || docSaysVaries;

  const referenceClipLimit = doc.referenceLimits?.videos ?? null;
  const inputPolicy =
    ceiling.pricingClass === "unbounded"
      ? deriveInputCappedCeiling(doc, referenceClipLimit)
      : { boundable: true, ceilingUsd: ceiling.ceilingUsd, formula: "not billed on input duration" };

  /*
   * Customer-facing availability.
   *
   * COMING_SOON covers two different internal situations that look identical to
   * a user -- "we cannot sell this yet" -- but are recorded separately because
   * the remedies differ:
   *
   *   indeterminate       the model is an unreleased early-access build and the
   *                       document publishes no price surface for it
   *   unboundable input   the model is released, but its surcharge amount is
   *                       never stated, so its cost cannot be bounded
   *
   * Everything else is AVAILABLE, including input-billed models, because the
   * input cap gives them a real ceiling.
   */
  let availability = "AVAILABLE";
  let comingSoonReason = null;
  if (ceiling.pricingClass === "indeterminate") {
    availability = "COMING_SOON";
    comingSoonReason = "UNRELEASED_NO_PUBLISHED_PRICING";
  } else if (ceiling.pricingClass === "unbounded" && !inputPolicy.boundable) {
    availability = "COMING_SOON";
    comingSoonReason = "COST_NOT_BOUNDABLE";
  }

  // The effective ceiling used for billing guards: for input-billed models the
  // capped figure, otherwise the published one.
  const effectiveCeilingUsd =
    ceiling.pricingClass === "unbounded" && inputPolicy.boundable
      ? inputPolicy.ceilingUsd
      : ceiling.ceilingUsd;

  /*
   * Resolutions the model can output, for the UI badge.
   *
   * Two patterns exist and both must be handled: some models take resolution as
   * a request PARAMETER (veo3.1-lite: 720p/1080p/4k on one endpoint), others
   * expose a SEPARATE ENDPOINT PER RESOLUTION (seedance-2.5-*-1080p). Reading
   * only the price table would miss the second kind entirely and label a 4k
   * endpoint as having no resolution.
   */
  const resolutionsFromTable = [];
  for (const table of doc.priceTables ?? []) {
    const idx = table.dimensions.findIndex((d) => /resolution/i.test(d));
    if (idx === -1) continue;
    for (const row of table.rows) {
      const value = row.combination[idx];
      if (value && !resolutionsFromTable.includes(value)) resolutionsFromTable.push(value);
    }
  }
  const suffixResolution = /-(480p|720p|1080p|4k)$/i.exec(doc.name)?.[1] ?? null;
  // Precedence: price table (authoritative, resolution is a priced parameter) ->
  // endpoint name suffix (authoritative, resolution IS the endpoint) -> prose
  // mention (display hint only, for native-resolution endpoints).
  const resolutions = resolutionsFromTable.length
    ? resolutionsFromTable
    : suffixResolution
      ? [suffixResolution]
      : (doc.resolutionMentions ?? []);
  const resolutionSource = resolutionsFromTable.length
    ? "price-table"
    : suffixResolution
      ? "endpoint-name"
      : (doc.resolutionMentions ?? []).length
        ? "prose-hint"
        : "unknown";

  // Human title: the document's heading before the colon
  // ("Omni Reference Fast: AI Image-to-Video Generator" -> "Omni Reference Fast").
  const title = (doc.title || "").split(":")[0].trim() || null;

  models[doc.name] = {
    category: doc.category || null,
    title,
    resolutions,
    resolutionSource,
    /*
     * Whether a request payload can actually be built for this model.
     *
     * Pricing being solved does not make a model dispatchable: the wire-format
     * parameter names are a separate fact, published only in the curl examples.
     * A model priced correctly but dispatched with guessed key names produces a
     * provider-side failure, so this is tracked independently of availability.
     */
    apiPayloadKeys: doc.apiPayloadKeys ?? [],
    payloadContractVerified: (doc.apiPayloadKeys ?? []).length > 0,
    availability,
    comingSoonReason,
    // Seedance 2.5 is the newest family and is surfaced with a NEW tag.
    isNew: /^seedance-2\.5/.test(doc.name),
    // The provider catalog declares the family ("kling-v2.6", "veo3.1",
    // "seedance-2.5"); deriving it from the slug instead produces variant names
    // rather than families, which would fragment the grouped selector.
    family: cat?.family ?? null,
    groupOf: cat?.group_of ?? null,
    inputVideoPolicy: {
      capSeconds: INPUT_VIDEO_CAP_SECONDS,
      applies: ceiling.pricingClass === "unbounded",
      boundable: inputPolicy.boundable,
      reason: inputPolicy.reason ?? null,
      formula: inputPolicy.formula ?? null,
      referenceClipLimit,
      /*
       * The clip count the ceiling formula was actually computed with.
       *
       * Emitted explicitly so the runtime check and the arithmetic cannot drift:
       * a model that documents no reference LIST still takes one input video, and
       * the formula defaults to 1 for it. If the runtime skipped the count check
       * when the document was silent, two capped clips would bill 30s against a
       * ceiling derived from 15s.
       */
      billedClipLimit: ceiling.pricingClass === "unbounded" ? referenceClipLimit || 1 : null,
    },
    effectiveCeilingUsd,
    effectiveCeilingMicroUsd: toMicroUsd(effectiveCeilingUsd),
    // Price at the model's DEFAULT parameters. Never a billing basis.
    defaultCostUsd: doc.defaultCostUsd,
    defaultCostMicroUsd: toMicroUsd(doc.defaultCostUsd),
    // Maximum a single call can cost, per the document.
    ceilingUsd: ceiling.ceilingUsd,
    ceilingMicroUsd: toMicroUsd(ceiling.ceilingUsd),
    ceilingBasis: ceiling.ceilingBasis,
    pricingClass: ceiling.pricingClass,
    staticallyBillable: ceiling.staticallyBillable,
    unbounded: ceiling.unbounded,
    unboundedKind: ceiling.unboundedKind,
    unboundedEvidence: ceiling.unboundedEvidence ?? [],
    costDrivers: doc.costDrivers,
    priceVaries,
    catalogCostUsd: cat ? cat.cost : null,
    catalogDynamicPricing: catalogSaysDynamic,
    estimateEndpoint: cat ? cat.estimate_endpoint : null,
    endpoint: cat ? cat.endpoint : null,
    durationMinSeconds: doc.duration?.minSeconds ?? null,
    durationMaxSeconds: doc.duration?.maxSeconds ?? null,
    referenceLimits: doc.referenceLimits ?? {},
    maxPerSecondRateUsd: doc.perSecondRates?.length
      ? Math.max(...doc.perSecondRates.map((r) => r.rateUsdPerSecond))
      : null,
    // Exact documented prices per parameter combination. Lets the UI show a
    // real credit cost before dispatch without a network round-trip.
    priceTables: doc.priceTables.map((t) => ({
      dimensions: t.dimensions,
      rows: t.rows.map((r) => ({ combination: r.combination, costUsd: r.costUsd })),
    })),
  };
}

const payload = {
  $schema: "doolphin/muapi-cost-ceilings@1",
  revision: "2026-08-documented-cost-ceilings-v1",
  provenance: {
    priceSurface: "Models and their Pricing.docx (founder-supplied, authoritative)",
    catalogCrossCheck: "MUAPI MODELS.json (609-model provider catalog)",
    generatedBy: "scripts/build-cost-ceilings.mjs",
  },
  note:
    "ceilingUsd is the MAXIMUM a single call can cost. defaultCostUsd is the price at default " +
    "parameters and must never be used as a billing basis. pricingClass 'unbounded' means cost " +
    "scales with the duration of user-supplied media and cannot be bounded before dispatch; " +
    "'indeterminate' means the document omits prices for parameters the model accepts.",
  modelCount: Object.keys(models).length,
  models,
};

writeFileSync(
  "src/lib/models/catalog/muapi-cost-ceilings.json",
  JSON.stringify(payload, null, 2) + "\n",
  "utf8",
);

const counts = {};
for (const m of Object.values(models)) counts[m.pricingClass] = (counts[m.pricingClass] ?? 0) + 1;
console.log(
  `wrote src/lib/models/catalog/muapi-cost-ceilings.json — ${payload.modelCount} models`,
  counts,
);
