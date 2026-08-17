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

test("Phase 2 Provider Authority: Fixed pricing model uses verified catalog pricing", async () => {
  const quote = await estimateAuthoritativeModelCost({
    modelDefinition: grokImagineImage2EditDefinition,
    normalizedInput: {
      prompt: "Add sunny lighting",
      sourceRequestId: "req_prev_999",
    },
    env: TEST_ENV_NO_KEYS,
  });

  assert.equal(quote.priced, true);
  assert.equal(quote.isDynamic, false);
  assert.equal(quote.totalCredits, 5);
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
  assert.equal(quote.totalCredits, 20);
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
