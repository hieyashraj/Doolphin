import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_STUDIO_MAX_DURATION, PRODUCT_STUDIO_MODELS, PRODUCT_STUDIO_PRESETS } from "../src/lib/product-studio/config.js";
import { planProductInteraction } from "../src/lib/product-studio/interactionPlanner.js";
import { getGenerationModel, listProductStudioGenerationModels } from "../src/lib/generation/modelRegistry.js";
import { normalizeAndValidateGenerationRequest } from "../src/lib/generation/contract.js";
import { compileCanonicalPrompt } from "../src/lib/generation/promptCompiler.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "../src/lib/models/bridges/studioWorkflowBridge.js";
import { getModel } from "../src/lib/models/registry.js";

const actor = { assetId: "actor", role: "ACTOR_REFERENCE", alias: "Mira", url: "https://cdn.example/actor.png", analysis: { confirmed: true } };
const product = { assetId: "bottle", role: "PRIMARY_PRODUCT", alias: "front", groupId: "Glow Serum", url: "https://cdn.example/serum.png", analysis: { confirmed: true, category: "skincare serum", topical: true, visibleText: ["GLOW"] } };
const motion = { assetId: "motion", role: "PRODUCT_MOTION_REFERENCE", alias: "pour reference", url: "https://cdn.example/motion.mp4", mimeType: "video/mp4", analysis: { confirmed: true } };
const audio = { assetId: "audio", role: "PRODUCT_AUDIO_REFERENCE", alias: "music", url: "https://cdn.example/music.mp3", mimeType: "audio/mpeg", analysis: { confirmed: true } };

function request(modelId = PRODUCT_STUDIO_MODELS[0].id, extras = {}) {
  return {
    version: "1",
    studio: "PRODUCT_STUDIO",
    presetId: "product-demo",
    modelId,
    modelLocked: true,
    script: { text: extras.script ?? "This serum keeps my routine simple.", language: "auto", maxCharacters: 300 },
    instructions: { raw: extras.instructions || "Natural creator setup with a clear label-facing hero moment." },
    settings: { durationMode: "EXPLICIT", durationSeconds: 8, resolution: "720p", aspectRatio: "9:16", outputCount: 1 },
    assets: [actor, product, ...(extras.assets || [])],
  };
}

test("Product Studio exposes only real Seedance Omni models and enforces its 15-second policy", () => {
  const models = listProductStudioGenerationModels();
  assert.deepEqual(models.map((model) => model.id), PRODUCT_STUDIO_MODELS.map((model) => model.id));
  assert.deepEqual(models.map((model) => model.name), ["Seedance 2.5", "Seedance 2.0"]);
  assert.equal(normalizeAndValidateGenerationRequest(request("muapi.wan2.2-5b-fast-t2v")).valid, false);
  const long = request(); long.settings.durationSeconds = PRODUCT_STUDIO_MAX_DURATION + 1;
  assert.equal(normalizeAndValidateGenerationRequest(long).valid, false);
});

test("product analysis selects sensible interactions and explicit instructions win", () => {
  assert.deepEqual(planProductInteraction({ analysis: { category: "cotton t-shirt" }, presetId: "product-demo" }).modes.slice(0, 1), ["wear"]);
  assert.ok(planProductInteraction({ analysis: { category: "skincare serum" }, presetId: "product-demo" }).modes.includes("apply"));
  assert.ok(planProductInteraction({ analysis: { category: "beverage bottle" }, presetId: "product-demo" }).modes.includes("drink"));
  assert.deepEqual(planProductInteraction({ analysis: { category: "beverage bottle" }, instructions: "Do not drink it. Only hold the bottle beside your face.", presetId: "product-demo" }).modes, ["hold", "show_to_camera"]);
});

test("Product Studio supports a genuinely optional script and compiles product fidelity instructions", () => {
  const validated = normalizeAndValidateGenerationRequest(request(undefined, { script: "" }));
  assert.equal(validated.valid, true);
  assert.equal(validated.request.settings.durationSeconds >= 4, true);
  const prompt = compileCanonicalPrompt(validated.request).compiledPrompt;
  assert.match(prompt, /No dialogue was supplied/);
  assert.match(prompt, /Product analysis: skincare serum/);
  assert.match(prompt, /actual logo, packaging, typography/);
  assert.match(prompt, /hold → open → apply/);
});

test("Seedance payloads preserve actor, product, motion and audio references with their verified schemas", async () => {
  for (const model of PRODUCT_STUDIO_MODELS) {
    const validated = normalizeAndValidateGenerationRequest(request(model.id, { assets: [motion, audio] }));
    assert.equal(validated.valid, true, model.id);
    const compiled = compileCanonicalPrompt(validated.request);
    const invocation = mapValidatedStudioWorkflowToNormalizedInvocation({ request: validated.request, compiledPrompt: compiled.compiledPrompt, providerImageUrls: compiled.imageUrls });
    assert.deepEqual(invocation.extraInputs.images, [actor.url, product.url]);
    assert.deepEqual(invocation.extraInputs.videos, [motion.url]);
    assert.deepEqual(invocation.extraInputs.audios, [audio.url]);
    const registryModel = await getModel(model.id, { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), env: {} });
    const payload = registryModel.toProviderPayload(invocation);
    assert.equal(payload.images_list[0], actor.url);
    assert.equal(payload.images_list[1], product.url);
    assert.equal(payload.duration, 8);
    assert.equal(payload.aspect_ratio, "9:16");
    if (model.id.includes("2.5")) {
      assert.deepEqual(payload.videos_list, [motion.url]);
      assert.deepEqual(payload.audios_list, [audio.url]);
      assert.equal(payload.seed, -1);
    } else {
      assert.deepEqual(payload.video_files, [motion.url]);
      assert.deepEqual(payload.audio_files, [audio.url]);
      assert.equal(payload.quality, "high");
    }
  }
});

test("product presets are typed behavior rather than a raw prompt-only menu", () => {
  assert.ok(PRODUCT_STUDIO_PRESETS.every((preset) => preset.id && preset.direction && preset.interaction.length));
  assert.equal(getGenerationModel(PRODUCT_STUDIO_MODELS[0].id).maxDuration, PRODUCT_STUDIO_MAX_DURATION);
});
