#!/usr/bin/env node
/**
 * Reconciles the two founder-supplied sources of truth against each other:
 *
 *   A. "MUAPI MODELS.json"                  -- 609-model provider catalog
 *   B. src/lib/models/catalog/muapi-model-docs.json -- 71-model pricing document
 *
 * Neither is silently preferred. Where they disagree the discrepancy is
 * reported, because a disagreement about price is exactly the kind of thing
 * that must be decided by a human rather than by whichever file happened to
 * load last.
 *
 * Checks:
 *   1. every documented model exists in the catalog
 *   2. catalog `cost` == document default cost (catalog cost is the DEFAULT)
 *   3. catalog `dynamic_pricing` is consistent with the document price surface
 *   4. `estimate_endpoint` presence matches `dynamic_pricing`
 */
import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync("MUAPI MODELS.json", "utf8"));
const docs = JSON.parse(readFileSync("src/lib/models/catalog/muapi-model-docs.json", "utf8"));

const byName = new Map(catalog.models.map((m) => [m.name, m]));

const findings = { missing: [], costMismatch: [], modeMismatch: [], estimateMismatch: [], ok: [] };

/** Money comparison tolerant of representation only, not of real difference. */
const sameMoney = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.0005;

for (const doc of docs.models) {
  const cat = byName.get(doc.name);
  if (!cat) {
    findings.missing.push(doc.name);
    continue;
  }

  if (!sameMoney(cat.cost, doc.defaultCostUsd)) {
    findings.costMismatch.push({
      name: doc.name,
      catalogCost: cat.cost,
      docDefaultCost: doc.defaultCostUsd,
      docCeiling: doc.ceiling.ceilingUsd,
    });
  }

  /*
   * `dynamic_pricing` is the provider's own statement of whether price varies
   * per request. The document's price surface must agree:
   *   dynamic_pricing true  -> something must vary (bounded/unbounded/indeterminate)
   *   dynamic_pricing false -> nothing may vary (flat)
   * A false flag on a varying model is the dangerous direction: it invites
   * billing a single static number for a request whose cost moves.
   */
  const docVaries = doc.ceiling.pricingClass !== "flat";
  if (Boolean(cat.dynamic_pricing) !== docVaries) {
    findings.modeMismatch.push({
      name: doc.name,
      catalogDynamicPricing: Boolean(cat.dynamic_pricing),
      docPricingClass: doc.ceiling.pricingClass,
      docDrivers: doc.costDrivers,
      docDefaultCost: doc.defaultCostUsd,
      docCeiling: doc.ceiling.ceilingUsd,
      dangerous: !cat.dynamic_pricing && docVaries,
    });
  }

  const hasEstimate = Boolean(cat.estimate_endpoint);
  if (hasEstimate !== Boolean(cat.dynamic_pricing)) {
    findings.estimateMismatch.push({
      name: doc.name,
      dynamicPricing: Boolean(cat.dynamic_pricing),
      estimateEndpoint: cat.estimate_endpoint,
    });
  }

  findings.ok.push(doc.name);
}

const pad = (s, n) => String(s).padEnd(n);
const usd = (v) => (v === null || v === undefined ? "-" : `$${Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`);

console.log(`catalog: ${catalog.total} models   document: ${docs.totalModels} models\n`);

console.log(`1. DOCUMENTED MODELS MISSING FROM CATALOG: ${findings.missing.length}`);
for (const n of findings.missing) console.log(`   ! ${n}`);

console.log(`\n2. DEFAULT-COST DISAGREEMENTS: ${findings.costMismatch.length}`);
if (findings.costMismatch.length) {
  console.log(`   ${pad("model", 44)} ${pad("catalog", 10)} ${pad("doc default", 12)} doc ceiling`);
  for (const f of findings.costMismatch) {
    console.log(
      `   ${pad(f.name, 44)} ${pad(usd(f.catalogCost), 10)} ${pad(usd(f.docDefaultCost), 12)} ${usd(f.docCeiling)}`,
    );
  }
}

console.log(`\n3. PRICING-MODE DISAGREEMENTS: ${findings.modeMismatch.length}`);
if (findings.modeMismatch.length) {
  console.log(
    `   ${pad("model", 44)} ${pad("catalog dyn", 12)} ${pad("doc class", 15)} ${pad("default", 9)} ${pad("ceiling", 9)} risk`,
  );
  for (const f of findings.modeMismatch) {
    console.log(
      `   ${pad(f.name, 44)} ${pad(f.catalogDynamicPricing, 12)} ${pad(f.docPricingClass, 15)} ${pad(usd(f.docDefaultCost), 9)} ${pad(usd(f.docCeiling), 9)} ${f.dangerous ? "UNDER-BILLS" : "over-cautious"}`,
    );
  }
}

console.log(`\n4. estimate_endpoint / dynamic_pricing DISAGREEMENTS: ${findings.estimateMismatch.length}`);
for (const f of findings.estimateMismatch) {
  console.log(`   ! ${pad(f.name, 44)} dynamic=${f.dynamicPricing} estimate=${f.estimateEndpoint}`);
}

const clean =
  !findings.missing.length &&
  !findings.costMismatch.length &&
  !findings.modeMismatch.length &&
  !findings.estimateMismatch.length;
console.log(`\n${clean ? "RECONCILED CLEANLY" : "DISCREPANCIES FOUND -- require a human decision"}`);
