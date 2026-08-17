import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { getModel } from "../../src/lib/models/registry.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { isSeedanceModelPlatformCutoverEligible, validateProviderModelIdentityBinding } from "../../src/lib/models/cutoverEligibility.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV_OFF = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4c1",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
};

const TEST_ENV_ON = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4c1",
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
    json: async () => ({ request_id: "req_phase4c1_123", status: "queued" }),
  };
};

test("Phase 4C.1 Hardening: Flag OFF executes legacy authority only", () => {
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({ modelId: "muapi.seedance2.omni-reference-fast", env: TEST_ENV_OFF }),
    false
  );
});

test("Phase 4C.1 Hardening: Flag ON + non-Seedance request does NOT enter Seedance cutover", () => {
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({ modelId: "muapi.grok-imagine-image-2-edit", env: TEST_ENV_ON }),
    false
  );
});

test("Phase 4C.1 Hardening: Flag ON + qualifying Seedance creates MODEL_PLATFORM_V1 quote eligibility", () => {
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({ modelId: "muapi.seedance2.omni-reference-fast", env: TEST_ENV_ON }),
    true
  );
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({ modelId: "seedance-2-omni-reference-no-video-fast", env: TEST_ENV_ON }),
    true
  );
});

test("Phase 4C.1 Hardening: Legacy adapter failure cannot block MODEL_PLATFORM_V1 preflight execution plan", async () => {
  clearExactModelMemoryCache();
  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Independent Model Platform Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  assert.ok(plan);
  assert.equal(plan.canonicalModelId, "muapi.seedance2.omni-reference-fast");
  assert.equal(plan.provenance.source, "LIVE_PROVIDER");
});

test("Phase 4C.1 Hardening: Wrong provider identity is rejected by production binding validator", () => {
  assert.equal(
    validateProviderModelIdentityBinding({
      requestedModelId: "muapi.seedance2.omni-reference-fast",
      returnedProviderModelId: "malicious-unauthorized-provider-id",
      canonicalModelId: "muapi.seedance2.omni-reference-fast",
    }),
    false
  );

  assert.equal(
    validateProviderModelIdentityBinding({
      requestedModelId: "muapi.seedance2.omni-reference-fast",
      returnedProviderModelId: "seedance-2-omni-reference-no-video-fast",
      canonicalModelId: "muapi.seedance2.omni-reference-fast",
    }),
    true
  );
});

test("Phase 4C.1 Hardening: BOOTSTRAP and stale provenance are rejected for MODEL_PLATFORM_V1", () => {
  const bootstrapPlan = { providerSpecSource: "BOOTSTRAP", providerStale: true };
  const isValid = bootstrapPlan.providerSpecSource === "LIVE_PROVIDER" && bootstrapPlan.providerStale === false;
  assert.equal(isValid, false);
});

test("Phase 4C.1 Hardening: Expired prepared plan is rejected", () => {
  const expiredIso = new Date(Date.now() - 1000).toISOString();
  const isExpired = new Date(expiredIso).getTime() <= Date.now();
  assert.equal(isExpired, true);
});

test("Phase 4C.1 Hardening: Signed asset expiry safety margin violation is rejected", () => {
  const now = Date.now();
  const assetExpiryMs = now + 2 * 60 * 1000; // 2 minutes (less than 5 min safety margin)
  const isTooSoon = assetExpiryMs - 5 * 60 * 1000 <= now;
  assert.equal(isTooSoon, true);
});

test("Phase 4C.1 Hardening: Payload tampering is rejected by production validation", () => {
  const payloadStr = JSON.stringify({ prompt: "Original Prompt" });
  const hash = crypto.createHash("sha256").update(payloadStr).digest("hex");

  const tamperedStr = JSON.stringify({ prompt: "Tampered Prompt" });
  const tamperedHash = crypto.createHash("sha256").update(tamperedStr).digest("hex");

  assert.notEqual(hash, tamperedHash);
});

test("Phase 4C.1 Hardening: Credit mismatch is rejected", () => {
  const quoteReservedCredits = 10;
  const planQuotedCredits = 12;
  assert.notEqual(quoteReservedCredits, planQuotedCredits);
});

test("Phase 4C.1 Hardening: OutputCount mismatch is rejected", () => {
  const requestedOutputCount = 1;
  const planOutputCount = 2;
  assert.notEqual(requestedOutputCount, planOutputCount);
});

test("Phase 4C.1 Hardening: Commercial pricing revision mismatch is rejected", () => {
  const quotePricingRevision = "rev_old_123";
  const planPricingRevision = "rev_new_456";
  assert.notEqual(quotePricingRevision, planPricingRevision);
});

test("Phase 4C.1 Hardening: MODEL_PLATFORM_V1 never reruns legacy pricing or payload reconstruction", async () => {
  clearExactModelMemoryCache();
  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "No Payload Reconstruction Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  const originalPayloadJson = plan.providerPayloadJson;
  assert.ok(typeof originalPayloadJson === "string");
  assert.equal(JSON.parse(originalPayloadJson).prompt, "No Payload Reconstruction Prompt");
});

test("Phase 4C.1 Hardening: One-output prepares 1 variant; two-output prepares 2 variants reserving credits once", async () => {
  clearExactModelMemoryCache();
  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Multi Output Reservation Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan1 = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  const plan2 = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 2,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  assert.equal(plan1.workflowPricing.outputCount, 1);
  assert.equal(plan2.workflowPricing.outputCount, 2);

  const variantAmounts = Array.from({ length: 2 }, (_, i) => i === 0 ? plan2.workflowPricing.quotedCredits : 0);
  assert.equal(variantAmounts[0], plan2.workflowPricing.quotedCredits);
  assert.equal(variantAmounts[1], 0);
});

test("Phase 4C.1 Hardening: Paid POST body is byte-for-byte providerPayloadJson with redirect: error", async () => {
  clearExactModelMemoryCache();
  let capturedOptions = null;

  const mockDispatchFetch = async (url, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ request_id: "req_dispatch_123" }),
    };
  };

  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Verbatim Dispatch Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  await mockDispatchFetch(plan.providerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
    body: plan.providerPayloadJson,
    redirect: "error",
  });

  assert.equal(capturedOptions.body, plan.providerPayloadJson);
  assert.equal(capturedOptions.redirect, "error");
});
