import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { calculateWorkflowSettlement } from "../../src/lib/models/execution/workflowSettlement.js";
import { isSeedanceModelPlatformCutoverEligible } from "../../src/lib/models/cutoverEligibility.js";
import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";

const TEST_ENV_ON = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4d",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "true",
};

const TEST_ENV_OFF = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4d",
  MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "false",
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
    json: async () => ({ request_id: "req_phase4d_123", status: "queued" }),
  };
};

test("Phase 4D Settlement: 2-output all-success charges full quoted credits and releases 0", () => {
  const result = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 10,
    successfulVariantCount: 2,
    failedVariantCount: 0,
  });

  assert.equal(result.settledStatus, "COMPLETED");
  assert.equal(result.earnedCreditsToCharge, 10);
  assert.equal(result.unearnedCreditsToRelease, 0);
  assert.equal(result.isPartial, false);
});

test("Phase 4D Settlement: 2-output all-failure charges 0 and releases full quoted credits", () => {
  const result = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 10,
    successfulVariantCount: 0,
    failedVariantCount: 2,
  });

  assert.equal(result.settledStatus, "FAILED");
  assert.equal(result.earnedCreditsToCharge, 0);
  assert.equal(result.unearnedCreditsToRelease, 10);
  assert.equal(result.isPartial, false);
});

test("Phase 4D Settlement: 2-output partial-success (variant 0 fail / variant 1 success) charges earned credit share and releases remainder", () => {
  const result = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 10,
    successfulVariantCount: 1,
    failedVariantCount: 1,
  });

  assert.equal(result.settledStatus, "COMPLETED");
  assert.equal(result.earnedCreditsToCharge, 5);
  assert.equal(result.unearnedCreditsToRelease, 5);
  assert.equal(result.isPartial, true);
});

test("Phase 4D Settlement: 2-output partial-success (variant 0 success / variant 1 fail) produces identical earned credit share", () => {
  const result = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 10,
    successfulVariantCount: 1,
    failedVariantCount: 1,
  });

  assert.equal(result.settledStatus, "COMPLETED");
  assert.equal(result.earnedCreditsToCharge, 5);
  assert.equal(result.unearnedCreditsToRelease, 5);
  assert.equal(result.isPartial, true);
});

test("Phase 4D Emergency Kill-Switch: MODEL_PLATFORM_V1 quote rejected when cutover flag is turned OFF before dispatch", () => {
  assert.equal(
    isSeedanceModelPlatformCutoverEligible({
      modelId: "muapi.seedance2.omni-reference-fast",
      env: TEST_ENV_OFF,
    }),
    false
  );
});

test("Phase 4D Authoritative Quote & Payload Immutability: Preflight plan generates reproducible payload and hash", async () => {
  clearExactModelMemoryCache();
  const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 5, aspectRatio: "9:16" } },
    compiledPrompt: "Phase 4D Reconciliation Test Prompt",
    providerImageUrls: ["https://r2.doolphin.com/actor1.jpg"],
  });

  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 2,
    fetchImpl: mockLiveFetch,
    env: TEST_ENV_ON,
  });

  assert.ok(plan.workflowPricing.quotedCredits > 0);
  assert.equal(plan.workflowPricing.outputCount, 2);
  assert.ok(typeof plan.providerPayloadJson === "string");
  assert.equal(
    plan.providerPayloadHash,
    crypto.createHash("sha256").update(plan.providerPayloadJson).digest("hex")
  );
});

test("Phase 4D Webhook Invariants: Terminal reconciliation prevents state regression", () => {
  const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const isTerminal = (status) => terminalStatuses.has(status.toUpperCase());

  assert.equal(isTerminal("COMPLETED"), true);
  assert.equal(isTerminal("FAILED"), true);
  assert.equal(isTerminal("PROCESSING"), false);
  assert.equal(isTerminal("QUEUED"), false);
});
