import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderAssetUrl, mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";

test("Asset Origin Resolution: absolute signed R2 URL unchanged", () => {
  const absoluteUrl = "https://r2.doolphin.com/assets/video_12345.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abcdef";
  const resolved = resolveProviderAssetUrl(absoluteUrl, { applicationOrigin: "http://localhost:3000" });
  assert.equal(resolved, absoluteUrl);

  const resolvedNoOrigin = resolveProviderAssetUrl(absoluteUrl);
  assert.equal(resolvedNoOrigin, absoluteUrl);
});

test("Asset Origin Resolution: relative avatar + explicit origin resolves correctly", () => {
  const relativeAvatarUrl = "/avatars/Andrew%20E1.png";
  const originLocal = "http://localhost:3009";
  const resolvedLocal = resolveProviderAssetUrl(relativeAvatarUrl, { applicationOrigin: originLocal });
  assert.equal(resolvedLocal, "http://localhost:3009/avatars/Andrew%20E1.png");

  const originStaging = "https://doolphin-staging.vercel.app";
  const resolvedStaging = resolveProviderAssetUrl(relativeAvatarUrl, { applicationOrigin: originStaging });
  assert.equal(resolvedStaging, "https://doolphin-staging.vercel.app/avatars/Andrew%20E1.png");
});

test("Asset Origin Resolution: relative URL without origin fails closed", () => {
  const relativeUrl = "/avatars/Andrew%20E1.png";
  const resolvedNoOrigin = resolveProviderAssetUrl(relativeUrl);
  assert.equal(resolvedNoOrigin, null);

  const resolvedNullOrigin = resolveProviderAssetUrl(relativeUrl, { applicationOrigin: null });
  assert.equal(resolvedNullOrigin, null);

  const resolvedEmptyOrigin = resolveProviderAssetUrl(relativeUrl, { applicationOrigin: "" });
  assert.equal(resolvedEmptyOrigin, null);

  assert.throws(
    () => mapValidatedStudioWorkflowToNormalizedInvocation({
      compiledPrompt: "Test prompt",
      providerImageUrls: ["/avatars/Andrew%20E1.png"],
      applicationOrigin: null,
    }),
    (err) => err instanceof Error && err.message.includes("Cannot resolve asset URL")
  );
});

test("Asset Origin Resolution: staging origin never becomes doolphin.ai", () => {
  const relativeAvatarUrl = "/avatars/Andrew%20E1.png";
  const stagingOrigin = "https://doolphin-staging.vercel.app";
  const resolved = resolveProviderAssetUrl(relativeAvatarUrl, { applicationOrigin: stagingOrigin });

  assert.equal(resolved.startsWith("https://doolphin-staging.vercel.app"), true);
  assert.equal(resolved.includes("doolphin.ai"), false);
});
