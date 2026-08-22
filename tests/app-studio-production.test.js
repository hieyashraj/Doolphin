import test from "node:test";
import assert from "node:assert/strict";
import { APP_STUDIO_MAX_DURATION, APP_STUDIO_MODELS, APP_STUDIO_PRESETS, buildAppStudioAutoScript } from "../src/lib/app-studio/config.js";
import { getGenerationModel, listAppStudioGenerationModels } from "../src/lib/generation/modelRegistry.js";
import { normalizeAndValidateGenerationRequest } from "../src/lib/generation/contract.js";
import { compileCanonicalPrompt } from "../src/lib/generation/promptCompiler.js";
import { getModel } from "../src/lib/models/registry.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../src/lib/models/bridges/studioWorkflowBridge.js";

const actor = { assetId: "andrew", role: "ACTOR_REFERENCE", alias: "Andrew", url: "https://cdn.example/andrew.png", analysis: { confirmed: true } };
const app = { assetId: "app-screen", role: "APP_PRIMARY_SCREEN", alias: "Doolphin dashboard", url: "https://cdn.example/dashboard.png", analysis: { confirmed: true, deviceType: "desktop", suggestedName: "Doolphin Dashboard", visibleText: ["Create a video"] } };
const recording = { assetId: "app-recording", role: "APP_SCREEN_RECORDING", alias: "Onboarding", url: "https://cdn.example/onboarding.mp4", mimeType: "video/mp4", analysis: { confirmed: true, deviceType: "mobile" } };

function request(modelId, extras = {}) {
  return {
    version: "1",
    studio: "APP_STUDIO",
    presetId: "app-pip-demo",
    modelId,
    modelLocked: true,
    script: { text: "Here is how I use this app to keep the next step clear.", language: "auto", maxCharacters: 300 },
    instructions: { raw: "Natural handheld creator recommendation.", confirmedScenePlanId: null },
    settings: { durationMode: "EXPLICIT", durationSeconds: 8, resolution: "720p", aspectRatio: "9:16", outputCount: 1 },
    assets: [actor, app, ...(extras.assets || [])],
  };
}

test("App Studio exposes exactly the curated Seedance 2.5 and 2.0 choices", () => {
  const models = listAppStudioGenerationModels({ hasScreenshot: true, hasRecording: true });
  assert.deepEqual(models.map((model) => model.id), APP_STUDIO_MODELS.map((model) => model.id));
  assert.deepEqual(models.map((model) => model.name), ["Seedance 2.5", "Seedance 2.0"]);
  assert.ok(models.every((model) => model.resolutions.length === 1 && model.resolutions[0] === "720p"));
});

test("App Studio rejects generic and retired no-video models plus durations above the product maximum", () => {
  const generic = normalizeAndValidateGenerationRequest(request("muapi.veo-4-text-to-video"));
  assert.equal(generic.valid, false);
  assert.ok(generic.errors.some((error) => error.code === "APP_STUDIO_MODEL_REQUIRED"));

  const retired = normalizeAndValidateGenerationRequest(request("muapi.seedance2.omni-reference-fast"));
  assert.equal(retired.valid, false);
  assert.ok(retired.errors.some((error) => error.code === "APP_STUDIO_MODEL_REQUIRED"));

  const overlong = normalizeAndValidateGenerationRequest({ ...request(APP_STUDIO_MODELS[0].id), settings: { durationMode: "EXPLICIT", durationSeconds: APP_STUDIO_MAX_DURATION + 1, resolution: "720p", aspectRatio: "9:16", outputCount: 1 } });
  assert.equal(overlong.valid, false);
  assert.ok(overlong.errors.some((error) => error.code === "INVALID_REQUEST" || error.code === "APP_STUDIO_DURATION_EXCEEDED"));
});

test("App Studio prompt carries the selected preset and deterministic app presentation constraint", () => {
  const validated = normalizeAndValidateGenerationRequest(request(APP_STUDIO_MODELS[0].id, { assets: [recording] }));
  assert.equal(validated.valid, true);
  const prompt = compileCanonicalPrompt(validated.request).compiledPrompt;
  assert.match(prompt, /APP STUDIO PRESET: App PiP Demo/);
  assert.match(prompt, /final compositor preserves app pixels/);
  assert.match(prompt, /@image1 is the selected AI avatar/);
  assert.match(prompt, /@image2 is a confirmed desktop interface screen/);
  assert.match(prompt, /@video1 is the confirmed "Onboarding" app screen recording/);
});

test("compiled recording semantics survive the canonical bridge into the paid provider payload", async () => {
  const validated = normalizeAndValidateGenerationRequest(request(APP_STUDIO_MODELS[0].id, { assets: [recording] }));
  assert.equal(validated.valid, true);
  const compiled = compileCanonicalPrompt(validated.request, validated.model);
  const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({
    request: validated.request,
    model: validated.model,
    compiledPrompt: compiled.compiledPrompt,
    providerImageUrls: compiled.imageUrls,
    providerVideoUrls: [recording.url],
  });
  const resolved = await getModel(APP_STUDIO_MODELS[0].id, {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    env: {},
  });
  const payload = resolved.toProviderPayload(normalized);
  assert.match(payload.prompt, /@video1 is the confirmed "Onboarding" app screen recording/);
  assert.deepEqual(payload.videos_list, [recording.url]);
  assert.deepEqual(payload.images_list, [actor.url, app.url]);
});

test("Seedance 2.5 and 2.0 receive their reviewed multi-reference provider schemas", async () => {
  const input = {
    prompt: "@image1 is the presenter and @image2 is the app.",
    duration: 8,
    aspectRatio: "9:16",
    referenceImages: [actor.url, app.url],
    referenceVideos: [recording.url],
  };
  const [v25, v20] = await Promise.all(APP_STUDIO_MODELS.map((model) => getModel(model.id, {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    env: {},
  })));
  assert.deepEqual(v25.toProviderPayload(input), {
    prompt: input.prompt,
    images_list: [actor.url, app.url],
    videos_list: [recording.url],
    duration: 8,
    aspect_ratio: "9:16",
    generate_audio: true,
    seed: -1,
  });
  assert.deepEqual(v20.toProviderPayload(input), {
    prompt: input.prompt,
    images_list: [actor.url, app.url],
    video_files: [recording.url],
    duration: 8,
    aspect_ratio: "9:16",
    quality: "high",
    generate_audio: true,
  });
  assert.ok(APP_STUDIO_MODELS.every((model) => getGenerationModel(model.id)?.confidence === "VERIFIED"));
});

test("blank-script fallback is app-informed, preset-aware, neutral, and within contract", () => {
  const script = buildAppStudioAutoScript({ appAnalysis: app.analysis, presetId: APP_STUDIO_PRESETS[2].id });
  assert.ok(script.length > 20 && script.length <= 300);
  assert.match(script, /Doolphin Dashboard/);
  assert.match(script, /Create a video/);
  assert.match(script, /keep the interface visible/);
  assert.doesNotMatch(script, /I have been trying|makes this part of my day|easy to find/);
});

test("recording-only App Studio requires an explicit user script", () => {
  const recordingOnlyRequest = request(APP_STUDIO_MODELS[0].id);
  recordingOnlyRequest.script.text = "";
  recordingOnlyRequest.assets = [actor, recording];
  const validation = normalizeAndValidateGenerationRequest(recordingOnlyRequest);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "APP_SCRIPT_REQUIRED_FOR_RECORDING"));
});

test("App Studio rejects more exact app inserts than the selected duration can display", () => {
  const extraScreens = Array.from({ length: 5 }, (_, index) => ({
    ...app,
    assetId: `app-screen-${index + 2}`,
    alias: `Screen ${index + 2}`,
    url: `https://cdn.example/screen-${index + 2}.png`,
  }));
  const validation = normalizeAndValidateGenerationRequest({
    ...request(APP_STUDIO_MODELS[0].id, { assets: extraScreens }),
    settings: { durationMode: "EXPLICIT", durationSeconds: 4, resolution: "720p", aspectRatio: "9:16", outputCount: 1 },
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "APP_ASSET_TIMING_EXCEEDED"));
});
