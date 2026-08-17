import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustedApplicationOrigin } from "../../src/lib/models/bridges/applicationOrigin.js";
import { resolveProviderAssetUrl } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { prepareExecutionPlan } from "../../src/lib/models/execution/prepareExecutionPlan.js";
import { clearExactModelMemoryCache } from "../../src/lib/models/providerCatalog.js";

test("Application Origin Precedence: APP_BASE_URL HTTPS wins over NEXTAUTH_URL", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "https://doolphin-app-base.com/path",
    nextAuthUrl: "https://doolphin-next-auth.com",
    requestOrigin: "http://localhost:3000",
    nodeEnv: "development",
  });
  assert.equal(origin, "https://doolphin-app-base.com");
});

test("Application Origin Precedence: NEXTAUTH_URL HTTPS works when APP_BASE_URL is absent", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: "https://doolphin-next-auth.com/auth",
    requestOrigin: "http://localhost:3000",
    nodeEnv: "development",
  });
  assert.equal(origin, "https://doolphin-next-auth.com");
});

test("Application Origin Security: WEBHOOK_URL is irrelevant and cannot change asset origin", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "https://doolphin-app-base.com",
    nextAuthUrl: null,
    requestOrigin: null,
    nodeEnv: "production",
  });
  assert.equal(origin, "https://doolphin-app-base.com");
  assert.equal(origin.includes("webhook"), false);
});

test("Application Origin Localhost: localhost request origin works in development", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: "http://localhost:3009",
    nodeEnv: "development",
  });
  assert.equal(origin, "http://localhost:3009");
});

test("Application Origin Localhost: 127.0.0.1 request origin works in development", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: "http://127.0.0.1:3009",
    nodeEnv: "development",
  });
  assert.equal(origin, "http://127.0.0.1:3009");
});

test("Application Origin Security: Production HTTP APP_BASE_URL rejects", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "http://doolphin.ai",
    nextAuthUrl: null,
    requestOrigin: null,
    nodeEnv: "production",
  });
  assert.equal(origin, null);
});

test("Application Origin Security: Production localhost fallback rejects", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: "http://localhost:3000",
    nodeEnv: "production",
  });
  assert.equal(origin, null);
});

test("Application Origin Security: Malformed configured URL rejects", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "not-a-valid-url",
    nextAuthUrl: "://bad",
    requestOrigin: null,
    nodeEnv: "production",
  });
  assert.equal(origin, null);
});

test("Application Origin Security: Missing trusted origin rejects", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: null,
    nodeEnv: "production",
  });
  assert.equal(origin, null);
});

test("Asset URL Resolution: Absolute provider asset URL remains unchanged", () => {
  const absoluteUrl = "https://r2.doolphin.com/assets/video123.mp4";
  const resolved = resolveProviderAssetUrl(absoluteUrl, { applicationOrigin: "http://localhost:3009" });
  assert.equal(resolved, absoluteUrl);
});

test("Asset URL Resolution: Relative avatar + explicit resolved origin becomes correct absolute URL", () => {
  const relativeAvatar = "/avatars/Andrew%20E1.png";
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "https://staging.doolphin.app",
    nodeEnv: "staging",
  });
  const resolved = resolveProviderAssetUrl(relativeAvatar, { applicationOrigin: origin });
  assert.equal(resolved, "https://staging.doolphin.app/avatars/Andrew%20E1.png");
});

test("Preflight Output Count Harness: prepareExecutionPlan receives outputCount 1 and 2 correctly", async () => {
  clearExactModelMemoryCache();
  const mockEstimateFetch = async (url) => {
    if (url.includes("estimate-cost")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cost: 0.10,
        }),
      };
    }
    if (url.includes("/api/v1/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          providerModelId: "seedance-2-omni-reference-no-video-fast",
          endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
          dynamic_pricing: true,
          estimate_endpoint: "https://api.muapi.ai/api/v1/models/seedance-2/estimate-cost",
          input_schema: { type: "object", properties: { prompt: { type: "string" } } },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const env = { MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED: "true" };
  const normalizedInput = { prompt: "Test prompt", extraInputs: { images: ["https://r2.doolphin.com/actor.jpg"] } };

  const plan1 = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 1,
    fetchImpl: mockEstimateFetch,
    env,
  });
  assert.equal(plan1.workflowPricing.outputCount, 1);

  clearExactModelMemoryCache();
  const plan2 = await prepareExecutionPlan({
    modelId: "muapi.seedance2.omni-reference-fast",
    normalizedInput,
    outputCount: 2,
    fetchImpl: mockEstimateFetch,
    env,
  });
  assert.equal(plan2.workflowPricing.outputCount, 2);
});
