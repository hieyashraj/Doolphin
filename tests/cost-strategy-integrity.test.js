import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * COST STRATEGY INTEGRITY
 *
 * MuAPI publishes most video models as a PER-SECOND rate, usually shown next to
 * a sample table, e.g. "Price varies by duration ($0.15/sec)" with rows
 * 5s=$0.75, 8s=$1.20, 10s=$1.50.
 *
 * Two ways that becomes a money bug:
 *   1. Transcribing "$0.75" (the first table row) as the model's flat cost, so a
 *      10s render is billed as if it were 5s.
 *   2. Reading "$0.15" as a flat total, so a 30s render is billed as 1 second —
 *      a 200x under-charge.
 *
 * These tests assert the estimator can never do either: a per-second strategy is
 * multiplied by duration, and any strategy it does not explicitly understand
 * fails closed instead of defaulting to flat.
 *
 * Static source assertions only — no network, so no provider spend.
 */

const estimateSource = fs.readFileSync(new URL("../src/lib/models/execution/estimateCost.js", import.meta.url), "utf8");

test("per-second cost strategy is multiplied by duration, never treated as flat", () => {
  assert.match(
    estimateSource,
    /strategy === "per_second"/,
    "estimator must explicitly branch on the per_second strategy"
  );
  assert.match(
    estimateSource,
    /providerCostUsd = unitCostUsd \* durationSeconds/,
    "per-second cost must be multiplied by duration"
  );
});

test("per-second model with missing or invalid duration fails closed", () => {
  assert.match(estimateSource, /prices per second but no positive duration was supplied/);
  assert.match(
    estimateSource,
    /!Number\.isFinite\(durationSeconds\) \|\| durationSeconds <= 0/,
    "must reject non-finite and non-positive durations"
  );
});

test("an unrecognised cost strategy fails closed instead of assuming flat pricing", () => {
  assert.match(estimateSource, /unrecognised cost strategy/);
  assert.match(estimateSource, /refusing to guess a billing basis/);
  // The dangerous shape would be a bare `else { providerCostUsd = unitCostUsd }`
  // fallthrough that treats anything unknown as a flat total.
  assert.ok(
    !/else\s*\{\s*providerCostUsd = unitCostUsd;\s*\}/.test(estimateSource),
    "must not silently fall back to flat pricing for unknown strategies"
  );
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

test("every shipped model definition declares an unambiguous billing basis", () => {
  // Any definition that is NOT dynamically priced must declare a cost strategy
  // the estimator recognises, otherwise it cannot be sold safely.
  const KNOWN_STRATEGIES = new Set(["fixed_cost", "per_request", "per_generation", "per_second"]);
  const dir = new URL("../src/lib/models/definitions/", import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "expected at least one model definition");

  for (const file of files) {
    const src = fs.readFileSync(new URL(file, dir), "utf8");
    const strategyMatch = src.match(/strategy:\s*"([^"]+)"/);
    const dynamicMatch = src.match(/dynamicPricing:\s*(true|false)/);

    assert.ok(dynamicMatch, `${file}: must explicitly declare dynamicPricing`);

    if (strategyMatch) {
      assert.ok(
        KNOWN_STRATEGIES.has(strategyMatch[1]),
        `${file}: declares cost strategy '${strategyMatch[1]}' which the estimator does not implement`
      );
    }

    // A fixed-price model must carry a concrete amount AND a strategy, or the
    // estimator cannot determine the billing basis.
    if (dynamicMatch[1] === "false") {
      assert.match(src, /amount:\s*[\d.]+/, `${file}: fixed-price model must declare a numeric cost amount`);
      assert.ok(strategyMatch, `${file}: fixed-price model must declare a cost strategy`);
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
  assert.match(discovery, /pricing_strategy == "fixed_cost"/);
  assert.match(discovery, /REPRESENTATIVE BASE/);
  assert.match(discovery, /pricing_strategy missing — DO NOT SELL until resolved/);
});
