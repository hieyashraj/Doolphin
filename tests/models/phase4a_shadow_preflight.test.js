import test from "node:test";
import assert from "node:assert/strict";

import { prepareExecutionPlan, canonicalJsonSerialize, validateJsonSafe, validateSignedAssetExpiry } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { getModel } from "../../src/lib/models/registry.js";
import { getProviderCatalog, clearCatalogMemoryCache } from "../../src/lib/models/catalogStore.js";
import { computeCatalogHash } from "../../src/lib/models/providerCatalog.js";
import { mapStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { recordShadowPreflightTelemetry, runShadowWithSingleTelemetry } from "../../src/lib/models/telemetry/shadowTelemetry.js";
import { ModelPlatformError, ERROR_CODES } from "../../src/lib/models/errors.js";

const TEST_ENV = {
  DOOLPHIN_ENV: "staging",
  MUAPI_API_KEY_SANDBOX: "sandbox_test_key_phase4a",
  MODEL_PLATFORM_PREFLIGHT_SHADOW_ENABLED: "false",
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

test("Phase 4A.2 Provenance: Bootstrap metadata cannot masquerade as fresh live provider metadata", async () => {
  clearCatalogMemoryCache();
  const result = await getProviderCatalog({ forceRefresh: false });

  assert.equal(result.source, "BOOTSTRAP");
  assert.equal(result.catalog.provenance.source, "BOOTSTRAP");
  assert.equal(result.catalog.provenance.stale, true);
  assert.equal(result.catalog.provenance.providerFetchedAt, null);
});

test("Phase 4A.2 Provenance: Provider-spec hash is mechanically calculated and reproducible", async () => {
  const model = await getModel("muapi.grok-imagine-image-2-edit", { fetchImpl: offlineProviderFetch });
  assert.ok(model);

  const plan = await prepareExecutionPlan({
    modelId: "muapi.grok-imagine-image-2-edit",
    normalizedInput: { prompt: "Test prompt", sourceRequestId: "req_123" },
    env: TEST_ENV,
    fetchImpl: offlineProviderFetch,
  });

  const expectedHash = computeCatalogHash(model.providerSpec);
  assert.equal(plan.providerSpecHash, expectedHash);
});

test("Phase 4A.2 Audio References: Unresolved explicit audio references fail closed instead of disappearing", async () => {
  const normalizedInputWithAudio = {
    prompt: "Generate UGC video with custom voiceover asset",
    extraInputs: {
      audioReferences: ["https://r2.doolphin.com/voiceover.mp3"],
    },
  };

  await assert.rejects(
    async () => prepareExecutionPlan({
      modelId: "muapi.veo-4-text-to-video",
      normalizedInput: normalizedInputWithAudio,
      env: TEST_ENV,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.INVALID_MODEL_INPUT
  );
});

test("Phase 4A.2 Transport Security: Webhook secret token is absent from prepared plan transport", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "muapi.grok-imagine-image-2-edit",
    normalizedInput: { prompt: "Test edit", sourceRequestId: "req_edit_01" },
    env: TEST_ENV,
    fetchImpl: offlineProviderFetch,
  });

  assert.equal(plan.transport.webhookUrl, undefined);
  assert.equal(plan.transport.webhookStrategy, "DOOLPHIN_MUAPI_V1");
});

test("Phase 4A.2 Signed Asset Expiry: Fails closed when signed asset URL expires before plan expiration safety margin", async () => {
  const nowMs = Date.now();

  // Expiring in 10 minutes (too soon when required safety margin + 15m plan TTL needs 20m)
  const expiringTooSoonMs = nowMs + 10 * 60 * 1000;

  assert.throws(
    () => validateSignedAssetExpiry({
      earliestSignedAssetExpiryMs: expiringTooSoonMs,
      preparedPlanExpiresAtMs: nowMs + 15 * 60 * 1000,
      safetyMarginMs: 5 * 60 * 1000,
    }),
    (err) => err instanceof ModelPlatformError && err.code === ERROR_CODES.INVALID_MODEL_INPUT
  );

  // Expiring in 60 minutes (valid)
  assert.doesNotThrow(() => validateSignedAssetExpiry({
    earliestSignedAssetExpiryMs: nowMs + 60 * 60 * 1000,
    preparedPlanExpiresAtMs: nowMs + 15 * 60 * 1000,
    safetyMarginMs: 5 * 60 * 1000,
  }));
});

test("Phase 4A.2 Feature Flag: Phase 4B feature flag remains OFF during Phase 4A.2", () => {
  assert.equal(process.env.MODEL_PLATFORM_PREFLIGHT_SHADOW_ENABLED, undefined);
  assert.equal(TEST_ENV.MODEL_PLATFORM_PREFLIGHT_SHADOW_ENABLED, "false");
});

test("Phase 3.3 Canonical JSON & Immutability: Key insertion order produces identical hash, array order is preserved", () => {
  const objA = { z: 10, a: "hello", b: [1, 2, 3], nested: { y: true, x: false } };
  const objB = { nested: { x: false, y: true }, b: [1, 2, 3], a: "hello", z: 10 };

  const jsonA = canonicalJsonSerialize(objA);
  const jsonB = canonicalJsonSerialize(objB);

  assert.equal(jsonA, jsonB);
  assert.notEqual(canonicalJsonSerialize(objA), canonicalJsonSerialize({ b: [3, 2, 1] }));
});

test("Phase 4A.2 Shadow Race: shadow success before timeout emits exactly one SUCCESS event and zero timeout events", async () => {
  const events = [];
  await runShadowWithSingleTelemetry({
    shadowFn: async () => ({ canonicalModelId: "muapi.seedance2.omni-reference-fast" }),
    timeoutMs: 100,
    telemetryRecorder: (evt) => events.push(evt),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "SUCCESS");
  assert.equal(events[0].shadowTimedOut, false);
});

test("Phase 4A.2 Shadow Race: shadow failure before timeout emits exactly one SHADOW_FAILED event and zero timeout events", async () => {
  const events = [];
  await runShadowWithSingleTelemetry({
    shadowFn: async () => { throw new Error("Shadow error"); },
    timeoutMs: 100,
    telemetryRecorder: (evt) => events.push(evt),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "SHADOW_FAILED");
  assert.equal(events[0].shadowTimedOut, false);
});

test("Phase 4A.2 Shadow Race: timeout before late successful shadow emits exactly one SHADOW_TIMEOUT event and no later SUCCESS", async () => {
  const events = [];
  await runShadowWithSingleTelemetry({
    shadowFn: () => new Promise((resolve) => setTimeout(() => resolve({ canonicalModelId: "late" }), 150)),
    timeoutMs: 30,
    telemetryRecorder: (evt) => events.push(evt),
  });

  // Wait for late shadow promise to complete
  await new Promise((res) => setTimeout(res, 200));

  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "SHADOW_TIMEOUT");
  assert.equal(events[0].shadowTimedOut, true);
});

test("Phase 4A.2 Shadow Race: timeout before late failure emits exactly one SHADOW_TIMEOUT event and no later SHADOW_FAILED", async () => {
  const events = [];
  await runShadowWithSingleTelemetry({
    shadowFn: () => new Promise((_, reject) => setTimeout(() => reject(new Error("Late error")), 150)),
    timeoutMs: 30,
    telemetryRecorder: (evt) => events.push(evt),
  });

  // Wait for late shadow promise rejection to complete
  await new Promise((res) => setTimeout(res, 200));

  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "SHADOW_TIMEOUT");
  assert.equal(events[0].shadowTimedOut, true);
});
