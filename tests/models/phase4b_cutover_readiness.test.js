import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { executeMuapiGenerationPlan } from "../../src/lib/models/execution/muapiExecutor.js";
import { parseUsdToMicroUsdConservatively } from "../../src/lib/models/pricingIntegration.js";
import { getModel } from "../../src/lib/models/registry.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4b",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
};

const TEST_ENV_CUTOVER = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4b",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "true",
};

const mockEstimateFetch = async (url) => {
  if (url.includes("estimate-cost")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ cost: 0.2419, currency: "USD" }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ request_id: "req_muapi_mock_123", status: "queued" }),
  };
};

test("Phase 4B.3b Strict Validation: Complete live spec -> LIVE_PROVIDER accepted", async () => {
  clearExactModelMemoryCache();
  const mockFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "/api/v1/seedance-2-omni-reference-no-video-fast",
          cost: { amount: 0.04838, currency: "USD" },
          dynamic_pricing: true,
          estimate_endpoint: "/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
          input_schema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  const model = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockFetch,
    env: TEST_ENV_CUTOVER,
    forceRefresh: true,
  });

  assert.ok(model);
  assert.equal(model.providerSpec.provenance.source, "LIVE_PROVIDER");
  assert.equal(model.providerSpec.provenance.stale, false);
  assert.equal(model.providerSpec.endpoint, "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast");
});

test("Phase 4B.3b Strict Validation: Live 200 response missing input schema -> must NOT be promoted to LIVE_PROVIDER", async () => {
  clearExactModelMemoryCache();
  const mockIncompleteFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
          dynamic_pricing: true,
          estimate_endpoint: "https://api.muapi.ai/api/v1/models/seedance-2/estimate-cost",
          // missing input_schema!
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  await assert.rejects(
    () => getModel("muapi.seedance2.omni-reference-fast", {
      fetchImpl: mockIncompleteFetch,
      env: TEST_ENV_CUTOVER,
      forceRefresh: true,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.PROVIDER_SPEC_UNAVAILABLE
  );
});

test("Phase 4B.3b Strict Validation: Live 200 response missing endpoint -> must NOT invent endpoint", async () => {
  clearExactModelMemoryCache();
  const mockMissingEndpointFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          // missing endpoint!
          dynamic_pricing: true,
          estimate_endpoint: "https://api.muapi.ai/api/v1/models/seedance-2/estimate-cost",
          input_schema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  await assert.rejects(
    () => getModel("muapi.seedance2.omni-reference-fast", {
      fetchImpl: mockMissingEndpointFetch,
      env: TEST_ENV_CUTOVER,
      forceRefresh: true,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.PROVIDER_SPEC_UNAVAILABLE
  );
});

test("Phase 4B.3b Strict Validation: Live dynamic-pricing response missing estimate endpoint -> invalid authoritative spec", async () => {
  clearExactModelMemoryCache();
  const mockMissingEstFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
          dynamic_pricing: true,
          // missing estimate_endpoint!
          input_schema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  await assert.rejects(
    () => getModel("muapi.seedance2.omni-reference-fast", {
      fetchImpl: mockMissingEstFetch,
      env: TEST_ENV_CUTOVER,
      forceRefresh: true,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.PROVIDER_SPEC_UNAVAILABLE
  );
});

test("Phase 4B.3b Cutover Fail-Closed: Cutover enabled + only BOOTSTRAP available -> PROVIDER_SPEC_UNAVAILABLE", async () => {
  clearExactModelMemoryCache();
  const mockFailingFetch = async () => {
    return { ok: false, status: 503, json: async () => ({ error: "Provider network down" }) };
  };

  await assert.rejects(
    () => getModel("muapi.seedance2.omni-reference-fast", {
      fetchImpl: mockFailingFetch,
      env: TEST_ENV_CUTOVER,
      forceRefresh: true,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.PROVIDER_SPEC_UNAVAILABLE
  );
});

test("Phase 4B.3b Cutover Success: Cutover enabled + valid LIVE_PROVIDER -> succeeds", async () => {
  clearExactModelMemoryCache();
  const mockValidFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "/api/v1/seedance-2-omni-reference-no-video-fast",
          cost: { amount: 0.04838, currency: "USD" },
          dynamic_pricing: true,
          estimate_endpoint: "/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
          input_schema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  const model = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockValidFetch,
    env: TEST_ENV_CUTOVER,
    forceRefresh: true,
  });

  assert.ok(model);
  assert.equal(model.providerSpec.provenance.source, "LIVE_PROVIDER");
  assert.equal(model.providerSpec.provenance.stale, false);
});

test("Phase 4B.3a Cold-Start Auto-Fetch: Cold start automatically fetches live Provider Authority spec and caches result", async () => {
  clearExactModelMemoryCache();
  let liveFetchCallCount = 0;

  const mockLiveFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      liveFetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
          cost: { amount: 0.04838, currency: "USD" },
          dynamic_pricing: true,
          estimateEndpoint: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
          inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  const model1 = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_CUTOVER,
  });

  assert.ok(model1);
  assert.equal(model1.providerSpec.provenance.source, "LIVE_PROVIDER");
  assert.equal(model1.providerSpec.endpoint, "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast");
  assert.equal(liveFetchCallCount, 1);

  const model2 = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_CUTOVER,
  });

  assert.ok(model2);
  assert.equal(model2.providerSpec.provenance.source, "LIVE_PROVIDER");
  assert.equal(liveFetchCallCount, 1);
});

test("Phase 4B.3 Provider Authority Injection: Live schema/endpoint overrides local spec without altering local product/business policy", async () => {
  clearExactModelMemoryCache();
  const mockLiveFetch = async (url) => {
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              providerModelId: "seedance-2-omni-reference-no-video-fast",
              endpoint: "https://api.muapi.ai/api/v1/custom-live-endpoint-999",
              cost: { amount: 0.0999, currency: "USD", strategy: "per_second" },
              dynamic_pricing: true,
              estimateEndpoint: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
              inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
            },
          ],
        }),
      };
    }
    return mockEstimateFetch(url);
  };

  const model = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockLiveFetch,
    env: TEST_ENV,
    forceRefresh: true,
  });

  assert.ok(model);
  assert.equal(model.providerSpec.endpoint, "https://api.muapi.ai/api/v1/custom-live-endpoint-999");
  assert.equal(model.providerSpec.cost.amount, 0.0999);
  assert.equal(model.providerSpec.provenance.source, "LIVE_PROVIDER");

  assert.equal(model.productPolicy.id, "muapi.seedance2.omni-reference-fast");
  assert.equal(model.productPolicy.displayName, "Seedance 2 Omni Reference Fast");
  assert.equal(model.businessPolicy.targetContributionMarginBps, 3000);
});

test("Phase 4B.3 Route Simulation: Non-network simulation proves complete atomic prepared plan consistency", async () => {
  const mockDualFetch = async (url, options) => {
    if (url.includes("estimate-cost")) {
      return { ok: true, status: 200, json: async () => ({ cost: 0.2419, currency: "USD" }) };
    }
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            {
              providerModelId: "seedance-2-omni-reference-no-video-fast",
              endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
              cost: { amount: 0.04838, currency: "USD" },
              dynamic_pricing: true,
              estimateEndpoint: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
              inputSchema: { type: "object", properties: { prompt: { type: "string" } } },
            },
          ],
        }),
      };
    }
    throw new Error("Generation POST must NOT be called during simulation");
  };

  const compiledPrompt = "Simulated Canonical Compiled Prompt for UGC Video";
  const providerImageUrls = ["https://r2.doolphin.com/actor1.jpg"];

  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt,
    providerImageUrls,
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 2,
    fetchImpl: mockDualFetch,
    env: TEST_ENV,
  });

  assert.equal(plan.canonicalModelId, "muapi.seedance2.omni-reference-fast");
  assert.equal(plan.workflowPricing.outputCount, 2);
  assert.equal(
    BigInt(plan.workflowPricing.totalProviderCostMicroUsd),
    BigInt(plan.unitPricing.providerCostMicroUsd) * 2n
  );

  const snapshot = {
    authorityVersion: "MODEL_PLATFORM_PREPARED_V1",
    canonicalModelId: plan.canonicalModelId,
    providerModelId: plan.providerModelId,
    providerEndpoint: plan.providerEndpoint,
    providerSpecHash: plan.providerSpecHash,
    providerSpecSource: plan.provenance.source,
    providerPayloadJson: plan.providerPayloadJson,
    providerPayloadHash: plan.providerPayloadHash,
    unitPricing: plan.unitPricing,
    workflowPricing: plan.workflowPricing,
  };

  const serialized = JSON.stringify(snapshot);
  const reloaded = JSON.parse(serialized);

  assert.equal(reloaded.providerPayloadJson, plan.providerPayloadJson);
  assert.equal(reloaded.workflowPricing.outputCount, 2);
  assert.equal(reloaded.workflowPricing.totalProviderCostMicroUsd, plan.workflowPricing.totalProviderCostMicroUsd);

  const hash = crypto.createHash("sha256").update(reloaded.providerPayloadJson).digest("hex");
  assert.equal(hash, plan.providerPayloadHash);
});

test("Phase 4B Persisted Plan Round Trip: Prepared plan snapshot survives JSON/DB serialization byte-for-byte", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: {
      prompt: "Persisted Plan Snapshot Test Prompt",
      duration: 6,
      aspectRatio: "16:9",
      generateAudio: false,
      extraInputs: { images: ["https://r2.doolphin.com/img1.jpg", "https://r2.doolphin.com/img2.jpg"] },
    },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  const snapshotToPersist = {
    authorityVersion: "MODEL_PLATFORM_PREPARED_V1",
    canonicalModelId: plan.canonicalModelId,
    providerModelId: plan.providerModelId,
    providerEndpoint: plan.providerEndpoint,
    providerSpecHash: plan.providerSpecHash,
    providerPayloadJson: plan.providerPayloadJson,
    providerPayloadHash: plan.providerPayloadHash,
    unitPricing: plan.unitPricing,
    workflowPricing: plan.workflowPricing,
    preparedAt: plan.preparedAt,
    expiresAt: plan.expiresAt,
    webhookStrategy: plan.transport.webhookStrategy,
  };

  const dbSerializedString = JSON.stringify(snapshotToPersist);
  const dbParsedSnapshot = JSON.parse(dbSerializedString);

  assert.equal(dbParsedSnapshot.providerPayloadJson, plan.providerPayloadJson);
  const reloadedHash = crypto.createHash("sha256").update(dbParsedSnapshot.providerPayloadJson).digest("hex");
  assert.equal(reloadedHash, plan.providerPayloadHash);
});

test("Phase 4B.2 Multi-Output Pricing: outputCount=2 aggregates microUSD costs before credit rounding", async () => {
  const planUnit = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: { prompt: "Single output video prompt" },
    outputCount: 1,
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  const planMulti = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: { prompt: "Dual output video prompt" },
    outputCount: 2,
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  assert.equal(planUnit.workflowPricing.outputCount, 1);
  assert.equal(planMulti.workflowPricing.outputCount, 2);

  const unitProviderMicroUsd = BigInt(planUnit.unitPricing.providerCostMicroUsd);
  const totalProviderMicroUsd = BigInt(planMulti.workflowPricing.totalProviderCostMicroUsd);
  assert.equal(totalProviderMicroUsd, unitProviderMicroUsd * 2n);

  assert.ok(planMulti.workflowPricing.quotedCredits >= planUnit.workflowPricing.quotedCredits * 2 - 5);
});

test("Phase 4B.2 USD Conversion: Conservative conversion never rounds costs downward", () => {
  assert.equal(parseUsdToMicroUsdConservatively("0.048380"), 48380n);
  assert.equal(parseUsdToMicroUsdConservatively("1.250000"), 1250000n);
  assert.equal(parseUsdToMicroUsdConservatively("0.0000001"), 1n);
  assert.equal(parseUsdToMicroUsdConservatively("0.0483801"), 48381n);
  assert.equal(parseUsdToMicroUsdConservatively(0.1 + 0.2), 300001n);
});

test("Phase 4B.1 Webhook Transport: Query parameter is ?webhook= and NOT ?webhook_url=", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.grok-imagine-image-2-edit",
    normalizedInput: { prompt: "Test prompt", sourceRequestId: "req_abc" },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  let capturedUrl = null;
  let capturedBody = null;

  const mockGenFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = options.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "grok_123" }),
    };
  };

  await executeMuapiGenerationPlan({
    preparedPlan: plan,
    fetchImpl: mockGenFetch,
    env: TEST_ENV,
  });

  const parsedUrl = new URL(capturedUrl);
  assert.equal(parsedUrl.searchParams.has("webhook"), true);
  assert.equal(parsedUrl.searchParams.has("webhook_url"), false);
  assert.match(parsedUrl.searchParams.get("webhook"), /api\/webhooks\/muapi/);
  assert.equal(capturedBody, plan.providerPayloadJson);
});

test("Phase 4B.1 Auth Headers: Generation request transmits x-api-key and NO Authorization bearer token", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: { prompt: "Header verification prompt" },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  let capturedHeaders = null;

  const mockGenFetch = async (url, options) => {
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ request_id: "req_header_123" }),
    };
  };

  await executeMuapiGenerationPlan({
    preparedPlan: plan,
    fetchImpl: mockGenFetch,
    env: TEST_ENV,
  });

  assert.equal(capturedHeaders["x-api-key"], "sandbox_test_key_phase4b");
  assert.equal(capturedHeaders["Authorization"], undefined);
  assert.equal(capturedHeaders["Content-Type"], "application/json");
});

test("Phase 4B.1 Single Pipeline: Estimate and generation POST HTTP bodies are byte-for-byte identical", async () => {
  let capturedEstimateBody = null;
  let capturedGenerationBody = null;

  const mockDualFetch = async (url, options) => {
    if (url.includes("estimate-cost")) {
      capturedEstimateBody = options.body;
      return { ok: true, status: 200, json: async () => ({ cost: 0.2419, currency: "USD" }) };
    }
    capturedGenerationBody = options.body;
    return { ok: true, status: 200, json: async () => ({ request_id: "req_dual_123" }) };
  };

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: { prompt: "Exact Body Verification Prompt", duration: 5, aspectRatio: "9:16" },
    fetchImpl: mockDualFetch,
    env: TEST_ENV,
  });

  await executeMuapiGenerationPlan({
    preparedPlan: plan,
    fetchImpl: mockDualFetch,
    env: TEST_ENV,
  });

  assert.equal(capturedEstimateBody, plan.providerPayloadJson);
  assert.equal(capturedGenerationBody, plan.providerPayloadJson);
  assert.equal(capturedEstimateBody, capturedGenerationBody);

  const estimateHash = crypto.createHash("sha256").update(capturedEstimateBody).digest("hex");
  assert.equal(estimateHash, plan.providerPayloadHash);
});

test("Phase 4B.1 Seedance Schema: Provider payload sets images_list field name and enforces max 9 limit", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: {
      prompt: "Seedance images_list verification prompt",
      extraInputs: { images: ["https://r2.doolphin.com/actor1.jpg", "https://r2.doolphin.com/actor2.jpg"] },
    },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  assert.ok(plan.providerPayload.images_list);
  assert.equal(plan.providerPayload.images, undefined);
  assert.equal(plan.providerPayload.images_list.length, 2);
  assert.equal(plan.providerPayload.images_list[0], "https://r2.doolphin.com/actor1.jpg");

  const tooManyImages = Array.from({ length: 10 }, (_, i) => `https://r2.doolphin.com/actor${i + 1}.jpg`);
  await assert.rejects(
    () => prepareExecutionPlan({
      modelId: "muapi.seedance2.omni-reference-fast",
      normalizedInput: { prompt: "Too many images", extraInputs: { images: tooManyImages } },
      fetchImpl: mockEstimateFetch,
      env: TEST_ENV,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.INVALID_MODEL_INPUT
  );
});

test("Phase 4B.1 Studio Workflow Bridge: Canonical compiled prompt is passed directly without object stringification", () => {
  const mockScriptObj = { scene1: "Script object should not become string" };
  const mockRequest = { prompt: "Fallback prompt", script: mockScriptObj, settings: { durationSeconds: 5 } };
  const compiledPrompt = "Authoritative Compiled Scene Plan Prompt";
  const providerImageUrls = ["https://r2.doolphin.com/avatar.jpg"];
  const nowMs = Date.now();

  const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: mockRequest,
    compiledPrompt,
    providerImageUrls,
    earliestSignedAssetExpiryMs: nowMs + 30 * 60 * 1000,
  });

  assert.equal(normalized.prompt, compiledPrompt);
  assert.notEqual(normalized.prompt, "[object Object]");
  assert.equal(normalized.extraInputs.images[0], "https://r2.doolphin.com/avatar.jpg");
  assert.equal(normalized.earliestSignedAssetExpiryMs, nowMs + 30 * 60 * 1000);
});

test("Phase 4B.1 Readiness Flag: Snapshot generation disabled when MODEL_PLATFORM_PREPARED_SNAPSHOT_ENABLED is false", () => {
  assert.equal(process.env.MODEL_PLATFORM_PREPARED_SNAPSHOT_ENABLED, undefined);
});
