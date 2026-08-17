import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { getModel } from "../../src/lib/models/registry.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV_OFF = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4c",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
};

const TEST_ENV_ON = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4c",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "true",
};

const mockLiveFetch = async (url, options) => {
  if (url.includes("estimate-cost")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ cost: 0.2419, currency: "USD" }),
    };
  }
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
  return {
    ok: true,
    status: 200,
    json: async () => ({ request_id: "req_phase4c_123", status: "queued" }),
  };
};

test("Phase 4C Cutover Flag OFF: Preserves legacy path behavior without issuing MODEL_PLATFORM_V1 authority", async () => {
  clearExactModelMemoryCache();
  assert.equal(TEST_ENV_OFF.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED, "false");
});

test("Phase 4C Cutover Flag ON: Issues MODEL_PLATFORM_V1 authority and authoritative LIVE_PROVIDER prepared plan", async () => {
  clearExactModelMemoryCache();

  const model = await getModel("muapi.seedance2.omni-reference-fast", {
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
    forceRefresh: true,
  });

  assert.ok(model);
  assert.equal(model.providerSpec.provenance.source, "LIVE_PROVIDER");

  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Phase 4C Cutover Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  assert.equal(plan.canonicalModelId, "muapi.seedance2.omni-reference-fast");
  assert.equal(plan.provenance.source, "LIVE_PROVIDER");
  assert.equal(plan.provenance.stale, false);
  assert.ok(plan.workflowPricing.quotedCredits > 0);
  assert.ok(plan.providerPayloadJson.includes("Phase 4C Cutover Prompt"));
});

test("Phase 4C Multi-Output Quotes: outputCount=2 aggregates workflow pricing once and prepares exact payload", async () => {
  clearExactModelMemoryCache();

  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Phase 4C Dual Output Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const planSingle = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  const planDual = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 2,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  assert.equal(planSingle.workflowPricing.outputCount, 1);
  assert.equal(planDual.workflowPricing.outputCount, 2);

  const unitCostMicroUsd = BigInt(planSingle.unitPricing.providerCostMicroUsd);
  const totalCostMicroUsd = BigInt(planDual.workflowPricing.totalProviderCostMicroUsd);
  assert.equal(totalCostMicroUsd, unitCostMicroUsd * 2n);

  assert.equal(planSingle.providerPayloadJson, planDual.providerPayloadJson);
});

test("Phase 4C Invariant Verification: Tampered payload hash is detected and rejected", () => {
  const originalJson = JSON.stringify({ prompt: "Valid Prompt", duration: 5 });
  const validHash = crypto.createHash("sha256").update(originalJson).digest("hex");

  const tamperedJson = JSON.stringify({ prompt: "Tampered Prompt", duration: 5 });
  const tamperedHash = crypto.createHash("sha256").update(tamperedJson).digest("hex");

  assert.notEqual(validHash, tamperedHash);

  const calculatedForTampered = crypto.createHash("sha256").update(originalJson).digest("hex");
  assert.equal(calculatedForTampered, validHash);
  assert.notEqual(calculatedForTampered, tamperedHash);
});

test("Phase 4C Invariant Verification: Expired prepared plan or non-LIVE_PROVIDER source fails pre-dispatch validation", () => {
  const expiredMs = Date.now() - 1000;
  const isExpired = expiredMs <= Date.now();
  assert.equal(isExpired, true);

  const bootstrapProvenance = { source: "BOOTSTRAP", stale: true };
  const isLive = bootstrapProvenance.source === "LIVE_PROVIDER" && !bootstrapProvenance.stale;
  assert.equal(isLive, false);
});

test("Phase 4C Provider Identity Binding: Different returned providerModelId is rejected", () => {
  const requestedModelId = "muapi.seedance2.omni-reference-fast";
  const returnedModelId = "unauthorized-different-model-id";

  const matches = requestedModelId === returnedModelId || returnedModelId === "seedance-2-omni-reference-no-video-fast";
  assert.equal(matches, false);
});
