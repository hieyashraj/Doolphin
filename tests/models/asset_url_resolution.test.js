import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderAssetUrl, mapStudioWorkflowToNormalizedInvocation, mapValidatedStudioWorkflowToNormalizedInvocation } from "../../src/lib/models/bridges/studioWorkflowBridge.js";
import { getGenerationModel } from "../../src/lib/generation/modelRegistry.js";

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


test("Studio Workflow Bridge: omitted or Auto duration resolves from a fixed-duration model", () => {
  const model = getGenerationModel("veo3.1-reference-to-video");
  assert.ok(model, "Veo 3.1 Reference to Video must remain in the generation registry");
  assert.deepEqual(model.durationValues, [8]);

  for (const settings of [{}, { duration: "Auto" }]) {
    const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
      request: { settings },
      model,
      compiledPrompt: "Keep this character visually consistent.",
      providerImageUrls: ["https://assets.example.test/reference.png"],
    });
    assert.equal(normalized.duration, 8);
  }
});


test("Studio Workflow Bridge: app recordings map to reference videos without becoming source videos", () => {
  const model = {
    minDuration: 8,
    durationValues: [8],
    controls: { prompt: { supported: true } },
    slots: {
      sourceImage: { supported: false },
      referenceImages: { supported: false },
      sourceVideo: { supported: true },
      referenceVideos: { supported: true },
      referenceAudios: { supported: false },
    },
  };
  const sourceUrl = "https://assets.example.test/source.mp4";
  const referenceUrl = "https://assets.example.test/reference.mp4";
  const recordingUrl = "https://assets.example.test/app-recording.mp4";
  const assets = [
    { role: "SOURCE_VIDEO", url: sourceUrl, mimeType: "video/mp4" },
    { role: "REFERENCE_VIDEO", url: referenceUrl, mimeType: "video/mp4" },
    { role: "APP_SCREEN_RECORDING", url: recordingUrl, mimeType: "video/mp4" },
  ];

  const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: { settings: { durationSeconds: 8 }, assets },
    model,
    compiledPrompt: "Show the app workflow.",
  });
  assert.equal(normalized.sourceVideo, sourceUrl);
  assert.deepEqual(normalized.referenceVideos, [referenceUrl, recordingUrl]);
  assert.equal(normalized.referenceVideos.includes(recordingUrl), true);

  const appOnly = mapStudioWorkflowToNormalizedInvocation(
    { settings: { durationSeconds: 8 }, assets: [assets[2]] },
    { model },
  );
  assert.equal("sourceVideo" in appOnly, false);
  assert.deepEqual(appOnly.referenceVideos, [recordingUrl]);
});
