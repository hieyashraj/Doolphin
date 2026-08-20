import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import liveCatalog from "../src/lib/models/catalog/muapi-live-catalog.json" with { type: "json" };
import { grokImagineImage2EditDefinition } from "../src/lib/models/definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "../src/lib/models/definitions/seedance-2.5-spicy-video-extend-480p.js";
import { seedance2OmniReferenceFastDefinition } from "../src/lib/models/definitions/seedance-2-omni-reference-fast.js";

/**
 * CATALOG RECONCILIATION
 *
 * Every price this app can bill must trace back to MuAPI. Not to a docs page
 * someone read, not to a number derived by arithmetic, not to a plausible
 * guess — to MuAPI's own `GET /api/v1/models` response.
 *
 * These tests are the enforcement of that rule. They compare each shipped model
 * definition, field by field, against the live catalog snapshot, so a hand-typed
 * or invented cost cannot reach production without a test failing first.
 *
 * They also lock the two contract invariants the live catalog itself exhibits,
 * because the estimator's whole design depends on them:
 *   - dynamic_pricing === true  <=> an estimate-cost endpoint exists
 *   - dynamic_pricing === false <=> `cost` is exact and estimate_endpoint is null
 *
 * Fully offline. No provider credential, no network, no spend.
 */

const DEFINITIONS = [
  ["grok-imagine-image-2-edit.js", grokImagineImage2EditDefinition],
  ["seedance-2.5-spicy-video-extend-480p.js", seedanceSpicyVideoExtendDefinition],
  ["seedance-2-omni-reference-fast.js", seedance2OmniReferenceFastDefinition],
];

test("the live catalog carries provenance proving where it came from", () => {
  assert.ok(liveCatalog.revision, "catalog must declare a revision");
  const p = liveCatalog.provenance;
  assert.match(p.source, /api\.muapi\.ai\/api\/v1\/models/, "source must be MuAPI's own catalog endpoint");
  assert.ok(p.retrievedAt, "must record when it was retrieved");
  assert.ok(Object.keys(liveCatalog.models).length > 0, "catalog must record models");
});

test("MuAPI's pricing contract holds across the whole catalog", () => {
  // These two invariants are what make the estimator's branching sound. If MuAPI
  // ever violates them, the estimator's assumptions are void and we must know.
  for (const [name, entry] of Object.entries(liveCatalog.models)) {
    assert.equal(
      typeof entry.dynamicPricing,
      "boolean",
      `${name}: dynamicPricing must be an explicit boolean, never inferred`
    );

    if (entry.dynamicPricing === true) {
      assert.ok(
        entry.estimateEndpoint,
        `${name}: a dynamically priced model must expose an estimate-cost endpoint, otherwise its price is unknowable`
      );
    } else {
      assert.equal(
        entry.estimateEndpoint,
        null,
        `${name}: a fixed-price model must have no estimate endpoint (its 'cost' is already exact)`
      );
    }

    assert.ok(
      Number.isFinite(entry.cost) && entry.cost >= 0,
      `${name}: cost must be a finite non-negative number, got ${entry.cost}`
    );
  }
});

test("every shipped model definition's cost matches MuAPI's catalog exactly", () => {
  for (const [file, def] of DEFINITIONS) {
    const id = def.providerSpec.providerModelId;
    const entry = liveCatalog.models[id];

    assert.ok(
      entry,
      `${file}: '${id}' is not present in the live MuAPI catalog. A model whose price cannot be traced to MuAPI must not ship — either it was renamed, or the id is wrong.`
    );

    const declared = def.providerSpec.cost?.amount;
    assert.ok(
      Math.abs(Number(declared) - entry.cost) < 1e-9,
      `${file}: declares $${declared} but MuAPI's catalog says $${entry.cost} for '${id}'. Costs must never be hand-authored or derived.`
    );
  }
});

test("every shipped definition's pricing mode matches MuAPI's catalog", () => {
  // A mismatch here is the highest-severity pricing bug in the system: declaring
  // a dynamic model as fixed makes Doolphin flat-bill a number MuAPI varies per
  // request, and no provider call happens to correct it.
  for (const [file, def] of DEFINITIONS) {
    const id = def.providerSpec.providerModelId;
    const entry = liveCatalog.models[id];
    assert.ok(entry, `${file}: '${id}' missing from catalog`);

    assert.equal(
      Boolean(def.providerSpec.dynamicPricing),
      entry.dynamicPricing,
      `${file}: declares dynamicPricing=${def.providerSpec.dynamicPricing} but MuAPI says ${entry.dynamicPricing} for '${id}'`
    );

    if (entry.dynamicPricing === true) {
      assert.ok(
        def.providerSpec.estimateEndpoint,
        `${file}: '${id}' is dynamically priced, so it MUST declare an estimateEndpoint or it can never be priced`
      );
      assert.match(
        String(def.providerSpec.estimateEndpoint),
        new RegExp(`/models/${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/estimate-cost$`),
        `${file}: estimateEndpoint must point at this exact model's estimate-cost route`
      );
    }
  }
});

test("no model definition declares a per-unit billing rate", () => {
  // MuAPI publishes no per-second, per-minute or per-frame rates. Its
  // `cost_strategy` field is an opaque internal identifier (e.g.
  // "seedance-2.5-4k-video"), not a billing basis. Any per-unit marker in a
  // definition is therefore an invented rate, and inventing rates is exactly how
  // a 6x mispricing ships.
  const dir = new URL("../src/lib/models/definitions/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "expected at least one model definition");

  for (const file of files) {
    // Strip comments first: this asserts on what the code DOES, and the
    // definitions legitimately document the old invented rates in prose so the
    // mistake stays traceable. Only whole-line comments are removed — a naive
    // //.*$ would also truncate any line containing an "https://" URL.
    const code = fs
      .readFileSync(new URL(file, dir), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const match = code.match(/strategy:\s*"(per_second|per_sec|per_minute|per_frame)"/);
    assert.equal(
      match,
      null,
      `${file}: declares an invented per-unit rate (${match?.[1]}). MuAPI prices per call, and varies price server-side via estimate-cost.`
    );
  }
});

test("catalog cost_strategy values are treated as opaque, never parsed as a billing basis", () => {
  // Guard against the specific regression this suite exists to prevent: the
  // estimator must not branch on strategy strings to decide a billing basis.
  const estimateSource = fs.readFileSync(
    new URL("../src/lib/models/execution/estimateCost.js", import.meta.url),
    "utf8"
  );

  assert.ok(
    !/strategy === "per_second"/.test(estimateSource),
    "estimator must not branch on a per_second strategy; MuAPI publishes no per-second rates"
  );
  assert.ok(
    !/unitCostUsd \* durationSeconds/.test(estimateSource),
    "estimator must not reconstruct a duration-scaled price; MuAPI resolves duration pricing server-side"
  );
  assert.match(
    estimateSource,
    /dynamic_pricing is the ONLY valid signal|dynamicPricing \?\? providerSpec\.dynamic_pricing/,
    "estimator must key the billing basis off the dynamic_pricing boolean"
  );
});
