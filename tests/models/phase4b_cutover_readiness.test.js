import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { executeMuapiGenerationPlan } from "../../src/lib/models/execution/muapiExecutor.js";
import { parseUsdToMicroUsdConservatively } from "../../src/lib/models/pricingIntegration.js";
import { getModel } from "../../src/lib/models/registry.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4b",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
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

test("Phase 4B.3 Provider Authority Injection: Live schema/endpoint overrides local spec without altering local product/business policy", async () => {
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
  // Provider facts updated dynamically from live fetch
  assert.equal(model.providerSpec.endpoint, "https://api.muapi.ai/api/v1/custom-live-endpoint-999");
  assert.equal(model.providerSpec.cost.amount, 0.0999);
  assert.equal(model.providerSpec.provenance.source, "LIVE_PROVIDER");

  // Local Doolphin policies preserved unchanged
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

  // Assert snapshot round-trip consistency
  const serialized = JSON.stringify(snapshot);
  const reloaded = JSON.parse(serialized);

  assert.equal(reloaded.providerPayloadJson, plan.providerPayloadJson);
  assert.equal(reloaded.workflowPricing.outputCount, 2);
  assert.equal(reloaded.workflowPricing.totalProviderCostMicroUsd, plan.workflowPricing.totalProviderCostMicroUsd);

  // SHA256 of payload string matches providerPayloadHash exactly
  const hash = crypto.createHash("sha256").update(reloaded.providerPayloadJson).digest("hex");
  assert.equal(hash, plan.providerPayloadHash);
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
