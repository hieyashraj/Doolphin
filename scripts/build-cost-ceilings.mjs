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

  models[doc.name] = {
    category: doc.category || null,
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
