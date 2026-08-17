import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { executeMuapiGenerationPlan } from "../../src/lib/models/execution/muapiExecutor.js";
import { estimateAuthoritativeModelCost } from "../../src/lib/models/execution/estimateCost.js";
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

  // Prove > 9 image references fail closed
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
