import test from "node:test";
import assert from "node:assert/strict";

import { prepareExecutionPlan, deepFreeze, resolveServerWebhookUrl } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { executeMuapiGenerationPlan, validateProviderEndpointOrigin, resolveTrustedExecutionUrl } from "../../src/lib/models/execution/muapiExecutor.js";
import { normalizeMuapiResponse } from "../../src/lib/models/execution/responseNormalizer.js";
import { reconcileExecutionCost } from "../../src/lib/models/execution/reconcileCost.js";
import { grokImagineImage2EditDefinition } from "../../src/lib/models/definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "../../src/lib/models/definitions/seedance-2.5-spicy-video-extend-480p.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV_SANDBOX = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase3",
  DOOLPHIN_WEBHOOK_URL: "https://api.doolphin.com/api/webhooks/muapi",
};

/**
 * OFFLINE PROVIDER MOCK.
 *
 * grok-imagine-image-2-edit is dynamically priced (MuAPI's own catalog says
 * dynamic_pricing=true), so preparing a plan for it REQUIRES an estimate-cost call.
 * These tests previously passed no fetchImpl, which meant the default global fetch —
 * i.e. a real network call to MuAPI on a billable endpoint. That must never happen
 * from a test run, so an explicit offline mock is injected.
 *
 * Catalog lookups deliberately answer 404 so provider-spec resolution falls through
 * to the shipped bootstrap catalog, which is the BOOTSTRAP provenance these tests
 * assert. The estimate answers MuAPI's own published base for this model ($0.05),
 * keeping the fixture inside the verified-cost drift band in
 * src/lib/models/verifiedCosts.js.
 */
const OFFLINE_GROK_ESTIMATE_USD = 0.05;

const offlineProviderFetch = async (url) => {
  if (String(url).includes("estimate-cost")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ cost: OFFLINE_GROK_ESTIMATE_USD, currency: "USD" }),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

test("Phase 3.2 Deep Immutability: Mutating top-level scalar, nested object, nested array, or Grok mask_indexs fails cleanly without altering payload or hash", async () => {
  const rawInput = {
    prompt: "Add studio lights",
    sourceRequestId: "grok_req_001",
    maskIndexes: [2, 5, 8],
  };

  const plan = await prepareExecutionPlan({
    modelId: "muapi.grok-imagine-image-2-edit",
    normalizedInput: rawInput,
    env: TEST_ENV_SANDBOX,
    fetchImpl: offlineProviderFetch,
  });

  const originalHash = plan.providerPayloadHash;
  const originalPrompt = plan.providerPayload.prompt;
  const originalMask0 = plan.providerPayload.mask_indexs[0];

  // 1. Attempt top-level scalar mutation
  assert.throws(() => {
    plan.canonicalModelId = "HACKED_MODEL";
  }, TypeError);

  // 2. Attempt nested object mutation
  assert.throws(() => {
    plan.pricing.quotedCredits = 99999;
  }, TypeError);

  // 3. Attempt nested array mutation on Grok mask_indexs
  assert.throws(() => {
    plan.providerPayload.mask_indexs[0] = 999;
  }, TypeError);

  // 4. Attempt adding new key to providerPayload
  assert.throws(() => {
    plan.providerPayload.malicious_field = "hacked";
  }, TypeError);

  // Prove payload integrity and payload hash remain completely unchanged
  assert.equal(plan.providerPayloadHash, originalHash);
  assert.equal(plan.providerPayload.prompt, originalPrompt);
  assert.equal(plan.providerPayload.mask_indexs[0], originalMask0);
});

test("Phase 3.2 Server-Controlled Webhook Transport: Webhook URL is strictly server-controlled and rejects user input", async () => {
  const maliciousInput = {
    prompt: "Edit image",
    sourceRequestId: "req_999",
    webhookUrl: "https://evil-attacker.com/steal-webhooks",
  };

  await assert.rejects(
    () => prepareExecutionPlan({
      modelId: "muapi.grok-imagine-image-2-edit",
      normalizedInput: maliciousInput,
      env: TEST_ENV_SANDBOX,
      fetchImpl: offlineProviderFetch,
    }),
    (error) => error instanceof ModelPlatformError && error.code === ERROR_CODES.INVALID_MODEL_INPUT,
  );

  const plan = await prepareExecutionPlan({
    modelId: "muapi.grok-imagine-image-2-edit",
    normalizedInput: { prompt: "Edit image", sourceRequestId: "req_999" },
    env: TEST_ENV_SANDBOX,
    fetchImpl: offlineProviderFetch,
  });

  assert.equal(plan.transport.webhookUrl, undefined);
  assert.equal(plan.transport.webhookStrategy, "DOOLPHIN_MUAPI_V1");
});

test("Phase 3.2 Terminal Reconciliation Semantics: Intermediate QUEUED/PENDING/PROCESSING states remain non-finalized", () => {
  const plan = { pricing: { providerCostMicroUsd: "100000" } };

  // Intermediate Non-Terminal States
  const resQueued = reconcileExecutionCost({ preparedPlan: plan, normalizedResult: { status: "QUEUED" } });
  assert.equal(resQueued.classification, "IN_FLIGHT_NON_TERMINAL");
  assert.equal(resQueued.isFinalized, false);

  const resPending = reconcileExecutionCost({ preparedPlan: plan, normalizedResult: { status: "PENDING" } });
  assert.equal(resPending.classification, "IN_FLIGHT_NON_TERMINAL");
  assert.equal(resPending.isFinalized, false);

  const resProcessing = reconcileExecutionCost({ preparedPlan: plan, normalizedResult: { status: "PROCESSING" } });
  assert.equal(resProcessing.classification, "IN_FLIGHT_NON_TERMINAL");
  assert.equal(resProcessing.isFinalized, false);

  // Terminal States
  const resCompleted = reconcileExecutionCost({
    preparedPlan: plan,
    normalizedResult: { status: "COMPLETED", actualCostMicroUsd: "100000" },
  });
  assert.equal(resCompleted.classification, "EXACT");
  assert.equal(resCompleted.isFinalized, true);

  const resFailedRefunded = reconcileExecutionCost({
    preparedPlan: plan,
    normalizedResult: { status: "FAILED", isRefunded: true, refundState: "REFUNDED" },
  });
  assert.equal(resFailedRefunded.classification, "REFUNDED");
  assert.equal(resFailedRefunded.isFinalized, true);
});

test("Phase 3.1 Security: Strict origin validation rejects https://muapi.ai and accepts only https://api.muapi.ai/api/v1/...", () => {
  assert.equal(validateProviderEndpointOrigin("https://muapi.ai/api/v1/test"), false);
  assert.equal(validateProviderEndpointOrigin("https://evil-attacker.com/steal-keys"), false);
  assert.equal(validateProviderEndpointOrigin("//api.muapi.ai/api/v1/test"), false);
  assert.equal(validateProviderEndpointOrigin("https://api.muapi.ai/api/v1/../../secret"), false);
  assert.equal(validateProviderEndpointOrigin("http://api.muapi.ai/api/v1/test"), false);
  assert.equal(validateProviderEndpointOrigin("https://api.muapi.ai/health"), false);

  assert.equal(validateProviderEndpointOrigin("/api/v1/grok-imagine-image-2-edit"), true);
  assert.equal(validateProviderEndpointOrigin("https://api.muapi.ai/api/v1/seedance-2.5-spicy-video-extend-480p"), true);

  assert.equal(
    resolveTrustedExecutionUrl("/api/v1/grok-imagine-image-2-edit"),
    "https://api.muapi.ai/api/v1/grok-imagine-image-2-edit"
  );
});

test("Phase 3.1 Architecture: Estimate body DEEP-EQUALS generation body in all model parameters", async () => {
  let estimateBody;
  let generationBody;

  const mockEstimate = async (url, options) => {
    estimateBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ amount_usd: 0.25 }) };
  };

  let executionRawBody;
  const mockExecution = async (url, options) => {
    executionRawBody = options.body;
    return { ok: true, json: async () => ({ request_id: "job_999", status: "queued" }) };
  };

  const rawInput = {
    prompt: "Extend camera track",
    sourceVideo: "https://r2.doolphin.com/in.mp4",
    duration: 5,
  };

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance-2.5-spicy-video-extend-480p",
    normalizedInput: rawInput,
    fetchImpl: mockEstimate,
    env: TEST_ENV_SANDBOX,
  });

  await executeMuapiGenerationPlan({
    preparedPlan: plan,
    fetchImpl: mockExecution,
    env: TEST_ENV_SANDBOX,
  });

  assert.equal(executionRawBody, plan.providerPayloadJson);
  assert.deepEqual(estimateBody, plan.providerPayload);
});

test("Phase 3.1 Lifecycle: Preserves all 6 provider statuses and rawProviderStatus without collapsing", () => {
  const statusesToTest = [
    { raw: "queued", expectedCanonical: "QUEUED" },
    { raw: "pending", expectedCanonical: "PENDING" },
    { raw: "processing", expectedCanonical: "PROCESSING" },
    { raw: "completed", expectedCanonical: "COMPLETED" },
    { raw: "failed", expectedCanonical: "FAILED" },
    { raw: "cancelled", expectedCanonical: "CANCELLED" },
  ];

  for (const { raw, expectedCanonical } of statusesToTest) {
    const normalized = normalizeMuapiResponse(
      { rawResponse: { request_id: "req_123", status: raw } },
      { canonicalModelId: "test-model" }
    );

    assert.equal(normalized.rawProviderStatus, raw);
    assert.equal(normalized.status, expectedCanonical);
  }
});
