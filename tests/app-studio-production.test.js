import test from "node:test";
import assert from "node:assert/strict";
import { APP_STUDIO_MAX_DURATION, APP_STUDIO_MODELS, APP_STUDIO_PRESETS, buildAppStudioAutoScript } from "../src/lib/app-studio/config.js";
import { getGenerationModel, listAppStudioGenerationModels } from "../src/lib/generation/modelRegistry.js";
import { normalizeAndValidateGenerationRequest } from "../src/lib/generation/contract.js";
import { compileCanonicalPrompt } from "../src/lib/generation/promptCompiler.js";
import { getModel } from "../src/lib/models/registry.js";

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
    assets: [actor, app, ...extras.assets || []],
  };
}

test("App Studio exposes exactly the curated Seedance 2.5 and 2.0 choices", () => {
  const models = listAppStudioGenerationModels({ hasScreenshot: true, hasRecording: true });
  assert.deepEqual(models.map((model) => model.id), APP_STUDIO_MODELS.map((model) => model.id));
  assert.deepEqual(models.map((model) => model.name), ["Seedance 2.5", "Seedance 2.0"]);
  assert.ok(models.every((model) => model.resolutions.length === 1 && model.resolutions[0] === "720p"));
});

test("App Studio rejects a generic full-bench model and durations above the product maximum", () => {
  const generic = normalizeAndValidateGenerationRequest(request("muapi.wan2.2-5b-fast-t2v"));
  assert.equal(generic.valid, false);
  assert.ok(generic.errors.some((error) => error.code === "APP_STUDIO_MODEL_REQUIRED"));

  const overlong = normalizeAndValidateGenerationRequest({ ...request(APP_STUDIO_MODELS[0].id), settings: { durationMode: "EXPLICIT", durationSeconds: APP_STUDIO_MAX_DURATION + 1, resolution: "720p", aspectRatio: "9:16", outputCount: 1 } });
  assert.equal(overlong.valid, false);
  assert.ok(overlong.errors.some((error) => error.code === "INVALID_REQUEST" || error.code === "APP_STUDIO_DURATION_EXCEEDED"));
});

test("App Studio prompt carries the selected preset and deterministic app presentation constraint", () => {
  const validated = normalizeAndValidateGenerationRequest(request(APP_STUDIO_MODELS[0].id));
  assert.equal(validated.valid, true);
  const prompt = compileCanonicalPrompt(validated.request).compiledPrompt;
  assert.match(prompt, /APP STUDIO PRESET: App PiP Demo/);
  assert.match(prompt, /final compositor preserves app pixels/);
  assert.match(prompt, /@image1 is the selected AI avatar/);
  assert.match(prompt, /@image2 is a confirmed desktop interface screen/);
});

test("Seedance 2.5 and 2.0 receive their respective real multi-reference schemas", async () => {
  const input = {
    prompt: "@image1 is the presenter and @image2 is the app.",
    duration: 8,
    aspectRatio: "9:16",
    extraInputs: { images: [actor.url, app.url], videos: [recording.url] },
  };
  const [v25, v20] = await Promise.all(APP_STUDIO_MODELS.map((model) => getModel(model.id, {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    env: {},
  })));
  assert.deepEqual(v25.toProviderPayload(input), { prompt: input.prompt, images_list: [actor.url, app.url], videos_list: [recording.url], duration: 8, aspect_ratio: "9:16", seed: -1 });
  assert.deepEqual(v20.toProviderPayload(input), { prompt: input.prompt, images_list: [actor.url, app.url], video_files: [recording.url], duration: 8, aspect_ratio: "9:16", quality: "high" });
});

test("blank-script fallback is app-informed, safe, and stored within the 300-character contract", () => {
  const script = buildAppStudioAutoScript({ appAnalysis: app.analysis, presetId: APP_STUDIO_PRESETS[2].id });
  assert.ok(script.length > 20 && script.length <= 300);
  assert.match(script, /Doolphin Dashboard/);
  assert.match(script, /Create a video/);
});
