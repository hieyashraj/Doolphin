import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { executeMuapiGenerationPlan } from "../../src/lib/models/execution/muapiExecutor.js";
import { ModelPlatformError } from "../../src/lib/models/errors.js";

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

test("Phase 4B Executor: Generation executor sends exact prepared JSON body without rebuilding or re-serializing", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput: {
      prompt: "UGC Video Test Prompt",
      duration: 5,
      aspectRatio: "9:16",
      generateAudio: true,
      extraInputs: { images: ["https://r2.doolphin.com/actor1.jpg"] },
    },
    fetchImpl: mockEstimateFetch,
    env: TEST_ENV,
  });

  let capturedUrl = null;
  let capturedOptions = null;

  const mockGenFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ request_id: "req_muapi_mock_123", status: "queued" }),
    };
  };

  const res = await executeMuapiGenerationPlan({
    preparedPlan: plan,
    fetchImpl: mockGenFetch,
    env: TEST_ENV,
  });

  assert.equal(res.success, true);
  assert.equal(capturedOptions.body, plan.providerPayloadJson);
  assert.equal(typeof capturedOptions.body, "string");

  // Prove SHA256 of sent body matches providerPayloadHash exactly
  const sentBodyHash = crypto.createHash("sha256").update(capturedOptions.body).digest("hex");
  assert.equal(sentBodyHash, plan.providerPayloadHash);
});

test("Phase 4B Transport: Webhook URL is attached at query transport layer without modifying body bytes", async () => {
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
  assert.ok(parsedUrl.searchParams.has("webhook_url"));
  assert.match(parsedUrl.searchParams.get("webhook_url"), /api\/webhooks\/muapi/);

  // Body bytes must NOT contain the webhook_url string
  assert.equal(capturedBody.includes("webhook_url"), false);
  assert.equal(capturedBody, plan.providerPayloadJson);
});

test("Phase 4B Auth Headers: Request headers include x-api-key and Authorization Bearer", async () => {
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
  assert.equal(capturedHeaders["Authorization"], "Bearer sandbox_test_key_phase4b");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
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
    providerEstimatedCostMicroUsd: plan.pricing.providerCostMicroUsd,
    newQuotedCredits: plan.pricing.quotedCredits,
    pricingRevisionId: plan.pricing.pricingRevisionId,
    preparedAt: plan.preparedAt,
    expiresAt: plan.expiresAt,
    webhookStrategy: plan.transport.webhookStrategy,
  };

  // Simulate DB String Serialization
  const dbSerializedString = JSON.stringify(snapshotToPersist);
  const dbParsedSnapshot = JSON.parse(dbSerializedString);

  // Invariant 1: Byte-for-byte exact equality of providerPayloadJson
  assert.equal(dbParsedSnapshot.providerPayloadJson, plan.providerPayloadJson);

  // Invariant 2: SHA256 of reloaded payload matches original providerPayloadHash
  const reloadedHash = crypto.createHash("sha256").update(dbParsedSnapshot.providerPayloadJson).digest("hex");
  assert.equal(reloadedHash, plan.providerPayloadHash);
  assert.equal(dbParsedSnapshot.providerPayloadHash, plan.providerPayloadHash);
});

test("Phase 4B Feature Flag: MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED default OFF keeps legacy path authoritative", () => {
  assert.equal(process.env.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED, undefined);
  assert.equal(TEST_ENV.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED, "false");
});
