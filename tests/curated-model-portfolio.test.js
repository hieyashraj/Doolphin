import test from "node:test";
import assert from "node:assert/strict";
import sourceCatalog from "../MUAPI MODELS.json" with { type: "json" };
import portfolio from "../src/lib/models/catalog/curated-generation-portfolio.json" with { type: "json" };
import {
  CURATED_CAPABILITY_DESCRIPTORS,
  getCuratedCapabilityDescriptor,
} from "../src/lib/models/capabilityDescriptors.js";
import {
  GENERATED_MODEL_DEFINITIONS,
  listGeneratedModelsByStudio,
  toClientModel,
} from "../src/lib/models/videoModelFactory.js";
import { listGenerationModels } from "../src/lib/generation/modelRegistry.js";
import { validateAndTransformInvocationInput } from "../src/lib/models/contracts/invocationContract.js";
import { getImageModel, listImageModels } from "../src/lib/generation-models/imageRegistry.js";

const byProviderId = new Map(GENERATED_MODEL_DEFINITIONS.map((definition) => [definition.providerSpec.providerModelId, definition]));
const definition = (providerModelId) => {
  const result = byProviderId.get(providerModelId);
  assert.ok(result, `missing definition for ${providerModelId}`);
  return result;
};

const URLS = {
  image: "https://assets.example.test/source.png",
  image2: "https://assets.example.test/reference.png",
  video: "https://assets.example.test/source.mp4",
  video2: "https://assets.example.test/reference.mp4",
  audio: "https://assets.example.test/reference.wav",
  start: "https://assets.example.test/start.png",
  end: "https://assets.example.test/end.png",
};

test("curated allowlist is exactly the 71 DOCX sections with reconciled provider IDs", () => {
  assert.equal(portfolio.revision, "2026-08-docx-curated-v1");
  assert.equal(portfolio.provenance.source, "Models and their Pricing.docx");
  assert.equal(portfolio.provenance.sha256, "f7983c9b151ea1a1ea8e3ca9a3fcf8032b59f497f97f004efa40ec9dc892d4e2");
  assert.deepEqual(portfolio.counts.families, {
    seedance: 35, veo: 15, kling: 11, sora: 5, grok: 4, "gpt-image-2": 1,
  });
  const selected = Object.values(portfolio.families).flat();
  assert.equal(selected.length, 71);
  assert.equal(new Set(selected.map((item) => item.providerModelId)).size, 71);
  const providerIds = new Set(sourceCatalog.models.map((item) => item.name));
  for (const item of selected) assert.ok(providerIds.has(item.providerModelId), item.providerModelId);
  assert.equal(GENERATED_MODEL_DEFINITIONS.length, 71);
});

test("capability descriptors have the immutable provider-neutral shape", () => {
  assert.equal(CURATED_CAPABILITY_DESCRIPTORS.length, 71);
  for (const descriptor of CURATED_CAPABILITY_DESCRIPTORS) {
    assert.equal(Object.isFrozen(descriptor), true, descriptor.providerId);
    assert.equal(Object.isFrozen(descriptor.slots), true, descriptor.providerId);
    assert.equal(Object.isFrozen(descriptor.slots.referenceImages), true, descriptor.providerId);
    for (const key of ["id", "family", "variant", "mediaType", "mode", "controls", "slots", "frames", "duration", "aspectRatios", "resolutions", "resolutionConstraints", "quality", "nativeAudio", "cameraMotion", "modelParameters", "outputCount", "providerId", "adapterRevision", "completionStrategy", "finalizerStrategy", "confidence"]) {
      assert.ok(key in descriptor, `${descriptor.providerId} missing ${key}`);
    }
    for (const slotName of ["sourceImage", "sourceVideo", "referenceImages", "referenceVideos", "referenceAudios"]) {
      const slot = descriptor.slots[slotName];
      assert.ok(["IMAGE", "VIDEO", "AUDIO"].includes(slot.type));
      assert.equal(typeof slot.supported, "boolean");
      assert.equal(typeof slot.required, "boolean");
      assert.equal(typeof slot.min, "number");
      assert.equal(typeof slot.max, "number");
      assert.equal(typeof slot.semanticRole, "string");
    }
  }
  const seedance = getCuratedCapabilityDescriptor("seedance-2-omni-reference");
  assert.throws(() => { seedance.slots.referenceImages.max = 100; }, TypeError);
  assert.equal(seedance.slots.referenceImages.max, 9);
});

test("Studio production listing contains only reviewed adapters supported by the current form", () => {
  const allowedVideoIds = new Set(Object.entries(portfolio.families)
    .filter(([family]) => family !== "gpt-image-2")
    .flatMap(([, variants]) => variants.map((item) => item.providerModelId)));
  const rootListing = listGeneratedModelsByStudio("video-studio");
  const generationListing = listGenerationModels();
  assert.equal(rootListing.length, 5);
  assert.equal(generationListing.length, 5);
  assert.equal(listGeneratedModelsByStudio("image-studio").length, 1);
  assert.equal(listGeneratedModelsByStudio("product-studio").length, 4);
  assert.equal(listGeneratedModelsByStudio("app-studio").length, 4);
  for (const item of generationListing) {
    assert.ok(allowedVideoIds.has(item.providerModelId), item.providerModelId);
    for (const key of ["family", "variant", "controls", "slots", "requiredSlots", "durationValues", "aspectRatios", "resolutions", "nativeAudio", "maxReferences", "confidence"]) {
      assert.ok(key in item, `${item.id} missing client projection ${key}`);
    }
  }
  assert.equal(generationListing.some((item) => /hailuo|flux/i.test(item.providerModelId)), false);
});

const matrix = [
  ["seedance-2-omni-reference-no-video-fast", {
    prompt: "fast", referenceImages: [URLS.image], referenceAudios: [URLS.audio], duration: 5, aspectRatio: "16:9", resolution: "720p",
  }, { prompt: "fast", images_list: [URLS.image], audio_files: [URLS.audio], duration: 5, aspect_ratio: "16:9", generate_audio: true }],
  ["seedance-2-omni-reference", {
    prompt: "omni", referenceImages: [URLS.image], referenceVideos: [URLS.video2], referenceAudios: [URLS.audio], quality: "basic", duration: 8, aspectRatio: "21:9",
  }, { prompt: "omni", images_list: [URLS.image], video_files: [URLS.video2], audio_files: [URLS.audio], duration: 8, aspect_ratio: "21:9", quality: "basic", generate_audio: true }],
  ["seedance-2-first-last-frame", {
    prompt: "transition", startFrame: URLS.start, endFrame: URLS.end, duration: 5, aspectRatio: "adaptive", resolution: "2K",
  }, { prompt: "transition", images_list: [URLS.start, URLS.end], duration: 5, aspect_ratio: "adaptive" }],
  ["seedance-2.5-text-to-video-4k", {
    prompt: "cinematic", duration: 10, aspectRatio: "16:9", resolution: "4K", seed: 42,
  }, { prompt: "cinematic", duration: 10, aspect_ratio: "16:9", seed: 42 }],
  ["seedance-2.5-video-edit", {
    prompt: "relight", sourceVideo: URLS.video, referenceImages: [URLS.image2], referenceAudios: [URLS.audio], duration: 5, aspectRatio: "16:9", resolution: "720p", generateAudio: false, seed: 0,
  }, { prompt: "relight", video: URLS.video, images_list: [URLS.image2], audios_list: [URLS.audio], duration: 5, aspect_ratio: "16:9", generate_audio: false, seed: 0 }],
  ["veo-4-text-to-video", {
    prompt: "aerial", duration: 8, aspectRatio: "16:9", resolution: "1080p",
  }, { prompt: "aerial", duration: 8, aspect_ratio: "16:9" }],
  ["veo-4-image-to-video", {
    prompt: "pan left", sourceImage: URLS.image, duration: 8, aspectRatio: "9:16", resolution: "1080p",
  }, { prompt: "pan left", images_list: [URLS.image], duration: 8, aspect_ratio: "9:16" }],
  ["veo3.1-fast-text-to-video", {
    prompt: "fast veo", duration: 8, aspectRatio: "9:16", resolution: "1080p",
  }, { prompt: "fast veo", duration: 8, aspect_ratio: "9:16", resolution: "1080p" }],
  ["veo3.1-reference-to-video", {
    prompt: "consistent fox", referenceImages: [URLS.image, URLS.image2], duration: 8, resolution: "720p", generateAudio: true,
  }, { prompt: "consistent fox", images_list: [URLS.image, URLS.image2], duration: 8, resolution: "720p", generate_audio: true }],
  ["veo3.1-extend-video", {
    prompt: "continue", sourceRequestId: "task-original-123", duration: 8, aspectRatio: "16:9", resolution: "720p",
  }, { prompt: "continue", request_id: "task-original-123", duration: 8, aspect_ratio: "16:9", resolution: "720p" }],
  ["kling-v3.0-omni-4k-image-to-video", {
    prompt: "train", referenceImages: [URLS.image, URLS.image2], duration: 5, aspectRatio: "16:9", resolution: "4K",
  }, { prompt: "train", images_list: [URLS.image, URLS.image2], duration: 5, aspect_ratio: "16:9" }],
  ["openai-sora-2-pro-storyboard", {
    storyboard: [{ description: "Opening", duration: 4 }, { description: "Reveal", duration: 6 }], referenceImages: [URLS.image], duration: 10, aspectRatio: "9:16", resolution: "720p",
  }, { shots: [{ scene: "Opening", duration: 4 }, { scene: "Reveal", duration: 6 }], images_list: [URLS.image], duration: 10, aspect_ratio: "9:16" }],
  ["grok-imagine-text-to-video", {
    prompt: "cyber city", duration: 6, aspectRatio: "2:3", resolution: "480p", modelParameters: { mode: "fun" },
  }, { prompt: "cyber city", duration: 6, aspect_ratio: "2:3", resolution: "480p", mode: "fun" }],
];

for (const [providerModelId, canonical, expected] of matrix) {
  test(`matrix payload: ${providerModelId}`, () => {
    const model = definition(providerModelId);
    const result = validateAndTransformInvocationInput(model, canonical);
    assert.equal(result.valid, true, result.errors?.[0]?.message);
    assert.deepEqual(result.providerPayload, expected);
  });
}

test("strict normalized contract and adapters fail closed instead of silently stripping fields", () => {
  const veo = definition("veo-4-text-to-video");
  const unknown = validateAndTransformInvocationInput(veo, { prompt: "x", provider_magic: true });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors[0].code, "UNKNOWN_NORMALIZED_INPUT");
  assert.match(unknown.errors[0].message, /provider_magic/);

  const unsupportedReference = validateAndTransformInvocationInput(veo, { prompt: "x", referenceImages: [URLS.image] });
  assert.equal(unsupportedReference.valid, false);
  assert.match(unsupportedReference.errors[0].message, /referenceImages is unsupported/);

  const grok = definition("grok-imagine-text-to-video");
  const unknownParameter = validateAndTransformInvocationInput(grok, { prompt: "x", modelParameters: { creativity: 2 } });
  assert.equal(unknownParameter.valid, false);
  assert.match(unknownParameter.errors[0].message, /not allowlisted/);

  const conflict = validateAndTransformInvocationInput(definition("seedance-2.5-video-edit"), {
    prompt: "x", sourceVideo: URLS.video, nativeAudio: true, generateAudio: false,
  });
  assert.equal(conflict.valid, false);
  assert.match(conflict.errors[0].message, /conflict/);
});

test("client projection retains every supported rich control with no silent field loss", () => {
  for (const [providerModelId, canonical, expected] of matrix) {
    const model = definition(providerModelId);
    const client = toClientModel(model);
    assert.equal(client.adapterRevision, model.capabilityDescriptor.adapterRevision);
    const translated = validateAndTransformInvocationInput(model, canonical);
    assert.equal(translated.valid, true, providerModelId);
    assert.deepEqual(translated.providerPayload, expected, providerModelId);
  }
});

test("GPT Image 2 curated family metadata reconciles to the existing Image Studio definition", () => {
  const descriptor = getCuratedCapabilityDescriptor("gpt-image-2-text-to-image");
  const model = getImageModel("muapi.gpt-image-2-t2i");
  assert.ok(descriptor);
  assert.ok(model);
  assert.equal(descriptor.id, model.id);
  assert.equal(descriptor.family, model.family);
  assert.equal(descriptor.variant, model.variant);
  assert.equal(descriptor.providerId, model.providerModelId);
  assert.deepEqual(descriptor.resolutions.values, model.productCapabilities.outputResolution.values);
  assert.equal(descriptor.quality.supported, false);
  assert.equal(descriptor.quality.fixed, "high");
  assert.equal(model.fixedProviderDefaults.quality, descriptor.quality.fixed);

  const canonicalPayload = definition("gpt-image-2-text-to-image").toProviderPayload({
    prompt: "A studio portrait",
    aspectRatio: "16:9",
    resolution: "2K",
  });
  const imageStudioPayload = model.adapter.buildProviderPayload(model, {
    request: {
      version: "image-generation.v1",
      modelId: model.id,
      prompt: "A studio portrait",
      aspectRatio: "16:9",
      outputResolution: "2K",
    },
  });
  assert.deepEqual(canonicalPayload, imageStudioPayload);
  assert.throws(
    () => definition("gpt-image-2-text-to-image").toProviderPayload({ prompt: "x", aspectRatio: "1:1", resolution: "4K" }),
    /does not support 4K at 1:1/
  );
  assert.throws(
    () => definition("gpt-image-2-text-to-image").toProviderPayload({ prompt: "x", aspectRatio: "auto", resolution: "2K" }),
    /does not support 2K at auto/
  );
  const imageStudioAutoValidation = model.adapter.validateNormalizedRequest(model, {
    version: "image-generation.v1",
    modelId: model.id,
    prompt: "x",
    aspectRatio: "auto",
    outputResolution: "2K",
  });
  assert.equal(imageStudioAutoValidation.valid, false);
  assert.equal(imageStudioAutoValidation.errors[0].code, "AUTO_RATIO_1K_ONLY");

  const listed = listImageModels({ VERCEL_ENV: "production" }).find((item) => item.id === model.id);
  assert.equal(listed.family, "gpt-image-2");
  assert.equal(listed.providerModelId, "gpt-image-2-text-to-image");
});
