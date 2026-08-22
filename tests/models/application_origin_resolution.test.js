import test from "node:test";
import assert from "node:assert/strict";
import { resolveTrustedApplicationOrigin } from "../../src/lib/models/bridges/applicationOrigin.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation, resolveProviderAssetUrl } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
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

// The two tests below previously asserted the OPPOSITE of what the resolver now
// does. They were written against a rule that commit 7758eb4 deliberately
// deleted: "non-production + localhost/127.0.0.1 request origin -> trust it".
//
// That rule minted absolute-but-unfetchable asset URLs such as
// http://localhost:3009/avatars/Andrew%20E1.png and handed them to MuAPI, which
// fetches references from ITS OWN servers. MuAPI does not error on an
// unfetchable reference — it silently generates from the prompt text alone and
// still bills us, producing a fully-charged video that ignores the user's avatar
// and uploaded imagery.
//
// So these are now negative tests. They pin the fail-closed behaviour on the
// paid path, and they are the executable partner of the source-level regression
// guard in tests/pricing-profit-invariant.test.js ("the removed localhost rule
// cannot silently return"). Restoring the old expectations would require
// re-introducing the money-losing rule, so the assertions are inverted rather
// than the source being reverted.
//
// Note these cases are already fully hermetic: resolveTrustedApplicationOrigin
// is a pure function and every input is passed explicitly here, so no PORT /
// APP_BASE_URL / NODE_ENV environment variable participates in the outcome.

test("Application Origin Money Safety: localhost request origin is refused even in development", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: "http://localhost:3009",
    nodeEnv: "development",
  });
  assert.equal(origin, null, "a localhost origin is not fetchable by the provider and must never be trusted");
});

test("Application Origin Money Safety: 127.0.0.1 request origin is refused even in development", () => {
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: null,
    nextAuthUrl: null,
    requestOrigin: "http://127.0.0.1:3009",
    nodeEnv: "development",
  });
  assert.equal(origin, null, "a loopback origin is not fetchable by the provider and must never be trusted");
});

test("Application Origin Development: the supported local dev path is a public HTTPS tunnel in APP_BASE_URL", () => {
  // Replaces the coverage the two inverted tests used to provide: development
  // CAN still resolve an origin, it just has to be one the provider can
  // actually reach over the internet.
  const origin = resolveTrustedApplicationOrigin({
    appBaseUrl: "https://doolphin-dev.ngrok-free.app",
    nextAuthUrl: null,
    requestOrigin: "http://localhost:3009",
    nodeEnv: "development",
  });
  assert.equal(origin, "https://doolphin-dev.ngrok-free.app");
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

test("App Studio bridge: a screenshot is the explicit image-to-video source, not the avatar", () => {
  const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: {
      settings: { durationSeconds: 5, aspectRatio: "9:16", resolution: "720p" },
      assets: [
        { role: "ACTOR_REFERENCE", url: "https://cdn.example/avatar.png" },
        { role: "APP_PRIMARY_SCREEN", assetId: "screen-1", alias: "Dashboard", url: "https://cdn.example/dashboard.png" },
      ],
    },
    compiledPrompt: "Show the dashboard.",
    providerImageUrls: ["https://cdn.example/avatar.png", "https://cdn.example/dashboard.png"],
  });

  assert.equal(normalized.imageUrl, "https://cdn.example/dashboard.png");
  assert.equal(normalized.extraInputs.images[0], "https://cdn.example/avatar.png");
});

test("App Studio bridge: a screen recording is mapped to the provider-neutral sourceVideo field", () => {
  const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: {
      settings: { durationSeconds: 5, aspectRatio: "9:16", resolution: "720p" },
      assets: [
        { role: "APP_SCREEN_RECORDING", assetId: "recording-1", alias: "Onboarding", url: "https://cdn.example/onboarding.mp4" },
      ],
    },
    compiledPrompt: "Continue the onboarding walk-through.",
    providerImageUrls: [],
  });

  assert.equal(normalized.sourceVideo, "https://cdn.example/onboarding.mp4");
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
