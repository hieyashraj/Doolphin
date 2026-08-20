import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * COST STRATEGY INTEGRITY
 *
 * ── Correction of an earlier wrong premise ─────────────────────────────────
 * A previous version of this suite asserted that MuAPI publishes video models as
 * PER-SECOND rates, and required the estimator to multiply a unit rate by
 * duration. That premise was wrong and is retracted here.
 *
 * MuAPI's live `GET /api/v1/models` response shows `cost_strategy` is an OPAQUE
 * internal identifier — real values include "seedance-2.5-4k-video",
 * "veo3.1-fast-video" and "creatify-lipsync". It is not a billing-basis enum and
 * carries no arithmetic meaning. The real contract is:
 *
 *   dynamic_pricing === false -> `cost` IS the exact USD price per call,
 *                                and `estimate_endpoint` is null.
 *   dynamic_pricing === true  -> the price varies with the request (duration,
 *                                resolution, ...) and is knowable ONLY from
 *                                POST {estimate_endpoint}.
 *
 * Duration-dependent pricing is therefore real, but MuAPI resolves it
 * server-side. Doolphin must never reconstruct it.
 *
 * ── What these tests protect ───────────────────────────────────────────────
 * The money bugs still being guarded, just with the correct mechanism:
 *   1. Flat-billing a model MuAPI prices dynamically (we eat the difference, or
 *      overcharge the customer, depending on which way the real price moves).
 *   2. Inventing a per-unit rate and multiplying it, producing a price no
 *      provider ever quoted.
 *   3. Treating a failed / missing / timed-out estimate as "free".
 *
 * Static source assertions only — no network, so no provider spend.
 */

const estimateSource = fs.readFileSync(new URL("../src/lib/models/execution/estimateCost.js", import.meta.url), "utf8");

/**
 * Removes comments so assertions inspect what the code DOES, not what it
 * documents — the definitions deliberately describe their old wrong values in
 * prose so the mistake stays traceable.
 *
 * Only whole-line comments are stripped. A naive /\/\/.*$/ would also truncate
 * any line containing an "https://" URL, silently deleting real code such as an
 * estimateEndpoint declaration.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("the billing basis is decided by dynamic_pricing, not by parsing a strategy string", () => {
  assert.match(
    estimateSource,
    /providerSpec\.dynamicPricing \?\? providerSpec\.dynamic_pricing/,
    "the pricing mode must be read from the dynamic_pricing boolean"
  );
  assert.ok(
    !/strategy === "per_second"/.test(estimateSource),
    "must not branch on a per_second strategy: MuAPI publishes no per-second rates"
  );
  assert.ok(
    !/unitCostUsd \* durationSeconds/.test(estimateSource),
    "must not reconstruct a duration-scaled price"
  );
});

test("a duration-scaling marker on a fixed-price model fails closed", () => {
  // Such a marker can only be a mis-authored leftover. Honouring it would
  // multiply an already-total price; ignoring it would risk billing a per-unit
  // rate as a total. Both are wrong, so refuse to price at all.
  assert.match(estimateSource, /DURATION_SCALING_MARKERS/);
  assert.match(estimateSource, /declares a duration-scaling billing basis/);
  assert.match(estimateSource, /per_second["\s,]/, "the marker set must include per_second");
});

test("a fixed cost is cross-checked against MuAPI's catalog before it is billed", () => {
  // The fixed path bills a hardcoded number with no provider call to correct it,
  // so it is the one path where a typo becomes a permanent leak.
  assert.match(estimateSource, /assertStaticCostMatchesCatalog/);
  assert.match(estimateSource, /staticCheck\.ok/, "a failed cross-check must block pricing");
});

test("a dynamically priced model can never be flat-billed", () => {
  const verifiedSource = fs.readFileSync(new URL("../src/lib/models/verifiedCosts.js", import.meta.url), "utf8");
  assert.match(verifiedSource, /PRICING_MODE_CONTRADICTS_CATALOG/);
  assert.match(verifiedSource, /Refusing to flat-bill a dynamically priced model/);
});

test("a fixed cost that disagrees with the catalog is refused", () => {
  const verifiedSource = fs.readFileSync(new URL("../src/lib/models/verifiedCosts.js", import.meta.url), "utf8");
  assert.match(verifiedSource, /STATIC_COST_DISAGREES_WITH_CATALOG/);
  assert.match(verifiedSource, /catalog value is exact/);
});

test("dynamic pricing requires an authoritative estimate endpoint and fails closed without one", () => {
  assert.match(estimateSource, /requires dynamic cost estimation, but no estimateEndpoint is configured/);
  // A failed/missing/timed-out estimate must never be treated as "free".
  assert.match(estimateSource, /MU API estimate-cost returned missing cost property/);
  assert.match(estimateSource, /cost estimation timed out/);
  const pricedFalseCount = (estimateSource.match(/priced: false/g) || []).length;
  assert.ok(pricedFalseCount >= 6, `expected many fail-closed paths, found ${pricedFalseCount}`);
});

test("provider cost is parsed conservatively (never rounded down in Doolphin's favour to a loss)", () => {
  assert.match(estimateSource, /parseUsdToMicroUsdConservatively/);
});

test("every shipped model definition declares an explicit, catalog-consistent billing basis", () => {
  const dir = new URL("../src/lib/models/definitions/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "expected at least one model definition");

  for (const file of files) {
    const code = stripComments(fs.readFileSync(new URL(file, dir), "utf8"));

    const dynamicMatch = code.match(/dynamicPricing:\s*(true|false)/);
    assert.ok(dynamicMatch, `${file}: must explicitly declare dynamicPricing`);

    // Every model needs a concrete numeric amount: billable when fixed, and a
    // cross-check baseline when dynamic.
    assert.match(code, /amount:\s*[\d.]+/, `${file}: must declare a numeric cost amount`);

    if (dynamicMatch[1] === "true") {
      assert.match(
        code,
        /estimateEndpoint:\s*"[^"]*estimate-cost"/,
        `${file}: a dynamically priced model must declare a real estimate-cost endpoint`
      );
    }
  }
});

test("the discovery script uses MuAPI's real catalog/schema/estimate endpoints and refuses production", () => {
  const discovery = fs.readFileSync(new URL("../scripts/discover-muapi-models.mjs", import.meta.url), "utf8");

  // The three endpoints confirmed to exist in MuAPI's OpenAPI document.
  assert.match(discovery, /\$\{API\}\/models/, "must read the public model catalog");
  assert.match(discovery, /\$\{API\}\/models\/\$\{encodeURIComponent\(name\)\}/, "must read per-model schema + pricing");
  assert.match(discovery, /estimate-cost/, "must use the estimate-cost quote endpoint");

  // Environment safety: never production, never a prod credential.
  assert.match(discovery, /VERCEL_ENV === "production" \|\| process\.env\.DOOLPHIN_ENV === "production"/);
  assert.match(discovery, /MUAPI_API_KEY === sandbox/, "must reject identical prod/sandbox keys");
  assert.match(discovery, /MUAPI_API_KEY_SANDBOX is required/);

  // It may POST only to estimate-cost (a pricing quote), never to a generation
  // endpoint. Assert no POST is issued to the bare /api/v1/{model} route.
  assert.ok(
    !/method:\s*"POST",\s*key,\s*body\s*\}\)\s*;?\s*\/\/\s*generation/i.test(discovery),
    "discovery must never POST to a generation endpoint"
  );
  assert.match(discovery, /No generation endpoint \(POST \/api\/v1\/\{name\}\) is ever called/);

  // The critical pricing distinction must be encoded, not assumed.
  assert.match(discovery, /REPRESENTATIVE BASE/);
});
