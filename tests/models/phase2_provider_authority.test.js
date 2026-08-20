import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchLiveMuapiCatalog,
  syncAndGetProviderCatalog,
  validateProviderCatalogPayload,
  computeCatalogHash,
} from "../../src/lib/models/providerCatalog.js";
import { estimateAuthoritativeModelCost } from "../../src/lib/models/execution/estimateCost.js";
import { grokImagineImage2EditDefinition } from "../../src/lib/models/definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "../../src/lib/models/definitions/seedance-2.5-spicy-video-extend-480p.js";
import { clearCatalogMemoryCache } from "../../src/lib/models/catalogStore.js";

const TEST_ENV_NO_KEYS = {};

test("Phase 2 Provider Authority: Public catalog fetch succeeds without API credentials", async () => {
  const mockFetch = async (url) => {
    assert.equal(url, "https://api.muapi.ai/api/v1/models");
    return {
      ok: true,
      json: async () => ({
        revision: "public-catalog-v1",
        models: [
          {
            providerModelId: "public-test-model",
            endpoint: "https://api.muapi.ai/api/v1/public-test-model",
            category: "image",
            dynamic_pricing: false,
            cost: { amount: 0.05, currency: "USD", strategy: "fixed_cost" },
            inputSchema: { type: "object" },
          },
        ],
      }),
    };
  };

  const result = await fetchLiveMuapiCatalog({ fetchImpl: mockFetch, env: TEST_ENV_NO_KEYS });
  assert.equal(result.success, true);
  assert.equal(result.catalog.models.length, 1);
  assert.equal(result.catalog.provenance.source, "LIVE_PROVIDER");
  assert.equal(result.catalog.provenance.validationStatus, "VALID");
});

test("Phase 2 Provider Authority: Malformed catalog payload fails validation cleanly", () => {
  const invalidPayloads = [
    null,
    {},
    { models: [] },
    { models: [{ providerModelId: "invalid", dynamic_pricing: false }] }, // Fixed pricing without cost metadata
  ];

  for (const payload of invalidPayloads) {
    const res = validateProviderCatalogPayload(payload);
    assert.equal(res.valid, false);
  }
});

test("Phase 2 Provider Authority: Live network failure falls back safely to bootstrap catalog", async () => {
  clearCatalogMemoryCache();
  const mockFailingFetch = async () => {
    throw new Error("Connection refused");
  };

  const result = await syncAndGetProviderCatalog({
    fetchImpl: mockFailingFetch,
    env: TEST_ENV_NO_KEYS,
    forceRefresh: true,
  });

  assert.equal(result.source, "BOOTSTRAP");
  assert.ok(Array.isArray(result.catalog.models));
  assert.equal(result.catalog.models.length, 2);
});

test("Phase 2 Provider Authority: Pricing hash changes between catalog revisions are detectable", () => {
  const modelsV1 = [{ providerModelId: "model-a", dynamic_pricing: false, cost: { amount: 0.05, strategy: "fixed_cost" } }];
  const modelsV2 = [{ providerModelId: "model-a", dynamic_pricing: false, cost: { amount: 0.10, strategy: "fixed_cost" } }];

  const hashV1 = computeCatalogHash(modelsV1);
  const hashV2 = computeCatalogHash(modelsV2);

  assert.notEqual(hashV1, hashV2);
});

/**
 * This test used to assert that grok-imagine-image-2-edit priced through the FIXED
 * path (`isDynamic: false`, a flat 5 credits off its $0.05 constant).
 *
 * That expectation encoded a money bug. MuAPI's own catalog marks this model
 * dynamic_pricing=true, meaning its real price varies per request and is only
 * knowable from its estimate-cost endpoint — so flat-billing $0.05 would charge a
 * number MuAPI never quoted. The model definition was corrected to
 * `dynamicPricing: true`, and src/lib/models/verifiedCosts.js now refuses to
 * flat-bill any model the catalog marks dynamic
 * (PRICING_MODE_CONTRADICTS_CATALOG). Asserting the old behaviour would be
 * asserting the bug.
 *
 * The valuable guarantee here — "a fixed price is taken from MuAPI's catalog, never
 * invented" — is preserved below and now covers BOTH pricing modes explicitly.
 */
test("Phase 2 Provider Authority: a catalog-dynamic model must price from the estimate endpoint, never flat-bill", async () => {
  let estimateCalled = false;
  const mockEstimateFetch = async (url) => {
    estimateCalled = true;
    assert.match(String(url), /estimate-cost/);
    // MuAPI's own published base for this model.
    return { ok: true, status: 200, json: async () => ({ amount_usd: 0.05 }) };
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: grokImagineImage2EditDefinition,
    normalizedInput: {
      prompt: "Add sunny lighting",
      sourceRequestId: "req_prev_999",
    },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, true);
  assert.equal(quote.isDynamic, true, "MuAPI marks this model dynamic_pricing=true");
  assert.equal(estimateCalled, true, "the price must come from the provider, not a local constant");
  assert.equal(quote.providerCostMicroUsd, "50000");
});

test("Phase 2 Provider Authority: flat-billing a catalog-dynamic model fails closed", async () => {
  // The mis-authored shape this defect class produces: dynamicPricing:false plus a
  // plausible-looking constant. It must never price, with or without a fetchImpl.
  const flatBilledGrok = {
    ...grokImagineImage2EditDefinition,
    providerSpec: {
      ...grokImagineImage2EditDefinition.providerSpec,
      dynamicPricing: false,
      cost: { amount: 0.05, currency: "USD" },
    },
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: flatBilledGrok,
    normalizedInput: { prompt: "Add sunny lighting", sourceRequestId: "req_prev_999" },
    fetchImpl: async () => {
      throw new Error("the fixed path must not reach the network");
    },
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, false);
  assert.equal(quote.code, "PRICING_UNAVAILABLE");
  assert.match(quote.reason, /dynamic_pricing=true/);
});

test("Phase 2 Provider Authority: a genuinely fixed-price model bills the catalog's exact price", async () => {
  // seedance-2.1-image-to-video is one MuAPI really does publish as fixed
  // (dynamic_pricing=false, cost $0.40, estimate_endpoint null), so the fixed path
  // is legitimate here and the catalog value is exact.
  const fixedPriceModel = {
    providerSpec: {
      providerModelId: "seedance-2.1-image-to-video",
      endpoint: "https://api.muapi.ai/api/v1/seedance-2.1-image-to-video",
      dynamicPricing: false,
      cost: { amount: 0.4, currency: "USD" },
      inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
    },
    productPolicy: { id: "muapi.seedance-2.1-image-to-video" },
    businessPolicy: { variableInfraCostMicroUsd: 5000n },
    toProviderPayload: (input) => ({ prompt: input.prompt }),
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: fixedPriceModel,
    normalizedInput: { prompt: "A product on a marble counter" },
    fetchImpl: async () => {
      throw new Error("a fixed-price model must not call the estimate endpoint");
    },
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, true);
  assert.equal(quote.isDynamic, false);
  assert.equal(quote.providerCostMicroUsd, "400000", "must bill MuAPI's exact $0.40, not an invented figure");
  assert.equal(quote.catalogCrossChecked, true, "the fixed price must be proven against the catalog");
  assert.equal(quote.catalogCostUsd, 0.4);
});

test("Phase 2 Provider Authority: a fixed price that disagrees with the catalog fails closed", async () => {
  // Understating the cost would silently eat the difference on every call.
  const underpricedModel = {
    providerSpec: {
      providerModelId: "seedance-2.1-image-to-video",
      endpoint: "https://api.muapi.ai/api/v1/seedance-2.1-image-to-video",
      dynamicPricing: false,
      cost: { amount: 0.35, currency: "USD" },
      inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
    },
    productPolicy: { id: "muapi.seedance-2.1-image-to-video" },
    businessPolicy: { variableInfraCostMicroUsd: 5000n },
    toProviderPayload: (input) => ({ prompt: input.prompt }),
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: underpricedModel,
    normalizedInput: { prompt: "A product on a marble counter" },
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, false);
  assert.equal(quote.code, "PRICING_UNAVAILABLE");
  assert.match(quote.reason, /exact fixed price is \$0\.4000/);
});

test("Phase 2 Provider Authority: Contradictory or missing fixed-pricing metadata fails closed", async () => {
  const invalidModelDef = {
    ...grokImagineImage2EditDefinition,
    providerSpec: {
      ...grokImagineImage2EditDefinition.providerSpec,
      dynamicPricing: false,
      cost: null, // Missing cost for non-dynamic model
    },
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: invalidModelDef,
    normalizedInput: {
      prompt: "Test prompt",
      sourceRequestId: "req_123",
    },
  });

  assert.equal(quote.priced, false);
  assert.equal(quote.code, "PRICING_UNAVAILABLE");
});

test("Phase 2 Provider Authority: Cost estimation uses canonical model.toProviderPayload transformer", async () => {
  let capturedBody;
  let capturedUrl;

  const mockEstimateFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      json: async () => ({
        amount_usd: 0.32,
      }),
    };
  };

  const rawInput = {
    prompt: "Extend video by 10 seconds",
    sourceVideo: "https://r2.doolphin.com/source.mp4",
    duration: 10,
    aspectRatio: "16:9",
    generateAudio: true,
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: seedanceSpicyVideoExtendDefinition,
    normalizedInput: rawInput,
    webhookUrl: "https://api.doolphin.com/webhook",
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, true);
  assert.equal(quote.isDynamic, true);
  assert.equal(capturedUrl, "https://api.muapi.ai/api/v1/models/seedance-2.5-spicy-video-extend-480p/estimate-cost");

  // PROVE: Payload sent to /estimate-cost is constructed by modelDefinition.toProviderPayload
  const expectedPayload = seedanceSpicyVideoExtendDefinition.toProviderPayload(rawInput, "https://api.doolphin.com/webhook");
  assert.deepEqual(capturedBody, expectedPayload);

  // Prove provider cost ($0.32) was fed into pricingIntegration.js commercial pricing
  assert.equal(quote.providerCostMicroUsd, "320000");
  // CREDIT UNIT: pricing revision 2026-08-credit-rescale-v2 rescaled the credit from
  // $0.021 to $0.005 of cost allowance, so the same $0.325 fully-loaded cost now
  // quotes 4.2x more credits. Previously asserted 20.
  //   $0.32 provider + $0.005 infra = 325_000 microUSD
  //   ceil(325_000 / 5_000) = 65 -> rounded up to a multiple of 5 = 70 credits
  assert.equal(quote.totalCredits, 70);
  assert.ok(
    quote.totalCredits * 5_000 >= Number(quote.fullyLoadedCostMicroUsd),
    "credits quoted must always cover the fully-loaded cost at the ceiling"
  );
});

test("Phase 2 Provider Authority: Failed /estimate-cost call fails closed with PRICING_UNAVAILABLE", async () => {
  const mockFailingEstimateFetch = async () => {
    return {
      ok: false,
      status: 503,
      json: async () => ({ error: "Provider rate limit" }),
    };
  };

  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: seedanceSpicyVideoExtendDefinition,
    normalizedInput: {
      prompt: "Extend video",
      sourceVideo: "https://r2.doolphin.com/source.mp4",
    },
    fetchImpl: mockFailingEstimateFetch,
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, false);
  assert.equal(quote.code, "PRICING_UNAVAILABLE");
  assert.ok(quote.reason.includes("503"));
});
