import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../src/lib/models/catalog/muapi-model-catalog.json" with { type: "json" };
import {
  GENERATED_MODEL_DEFINITIONS,
  GENERATED_MODELS_BY_ID,
  listGeneratedModelsByStudio,
  toClientModel,
  STUDIO_ASPECT_RATIOS,
} from "../src/lib/models/videoModelFactory.js";
import { listGenerationModels, getGenerationModel, GENERATION_MODELS } from "../src/lib/generation/modelRegistry.js";
import { calculateRequiredCredits, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";

const VIDEO_MODES = ["text-to-video", "image-to-video", "video-extend"];

// --- The bench actually exists ----------------------------------------------

test("bench: the full video bench is registered, not a 1-model placeholder list", () => {
  // The studio picker previously listed ONE model while the app advertised a
  // "world-class creative bench", and CreationHub separately rendered a hardcoded
  // array of names ("grok-video", "veo-3-1", …) that resolved to nothing.
  const picker = listGenerationModels();
  assert.ok(picker.length >= 300, `expected 300+ selectable video models, got ${picker.length}`);
  assert.equal(picker.length, listGeneratedModelsByStudio("video-studio").length, "picker and registry must agree");
});

test("bench: video and image models are split into the right studios", () => {
  const video = listGeneratedModelsByStudio("video-studio");
  const image = listGeneratedModelsByStudio("image-studio");
  assert.ok(video.length >= 300, `video-studio: ${video.length}`);
  assert.ok(image.length >= 130, `image-studio: ${image.length}`);
  for (const definition of video) assert.ok(VIDEO_MODES.includes(definition.productPolicy.generationMode));
  for (const definition of image) assert.ok(["text-to-image", "image-to-image"].includes(definition.productPolicy.generationMode));
  // Product and App studio share the video bench.
  assert.equal(listGeneratedModelsByStudio("product-studio").length, video.length);
  assert.equal(listGeneratedModelsByStudio("app-studio").length, video.length);
});

test("bench: every model came from the supplied provider export, none invented", () => {
  const source = new Set(Object.keys(catalog.models));
  assert.ok(source.size >= 450, `catalog should hold the full export, got ${source.size}`);
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    assert.ok(
      source.has(definition.providerSpec.providerModelId),
      `${definition.providerSpec.providerModelId} is not in the provider export`
    );
  }
});

// --- Every model is dispatchable and priceable ------------------------------

test("bench: every model has a real generation endpoint (none is a dead dropdown entry)", () => {
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const { endpoint, providerModelId } = definition.providerSpec;
    assert.ok(endpoint && endpoint.startsWith("https://api.muapi.ai/api/v1/"), `${providerModelId} has no usable endpoint`);
    assert.equal(typeof definition.toProviderPayload, "function", `${providerModelId} has no payload transformer`);
  }
});

test("bench: pricing is resolvable for EVERY model — dynamic models have an estimate endpoint, fixed models a real price", () => {
  // This is the invariant that makes the bench safe to offer: a model that cannot
  // be priced would either fail at preflight or, worse, be under-charged.
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const { dynamicPricing, estimateEndpoint, cost, providerModelId } = definition.providerSpec;
    assert.ok(cost.amount > 0, `${providerModelId} has no published cost basis`);
    if (dynamicPricing) {
      assert.ok(estimateEndpoint?.includes("/estimate-cost"), `${providerModelId} is dynamic but has no estimate endpoint`);
    } else {
      assert.equal(estimateEndpoint, null, `${providerModelId} is fixed-price so it must not claim an estimate endpoint`);
    }
  }
});

test("bench: every model yields a positive credit charge that covers its cost", () => {
  const ceiling = Number(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd);
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const providerMicroUsd = BigInt(Math.round(definition.providerSpec.cost.amount * 1e6));
    const infra = definition.businessPolicy.variableInfraCostMicroUsd;
    const quote = calculateRequiredCredits({ provider: providerMicroUsd, infra });
    assert.ok(quote.quotedCredits > 0n, `${definition.providerSpec.providerModelId} quoted 0 credits`);
    assert.ok(
      Number(quote.quotedCredits) * ceiling >= Number(providerMicroUsd + infra),
      `${definition.providerSpec.providerModelId} would be under-charged`
    );
  }
});

test("bench: credit costs stay in believable 2-3 digit territory", () => {
  // The v3 credit unit exists so users never see 4-5 digit costs.
  let max = 0;
  let worst = null;
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const providerMicroUsd = BigInt(Math.round(definition.providerSpec.cost.amount * 1e6));
    const credits = Number(calculateRequiredCredits({ provider: providerMicroUsd, infra: definition.businessPolicy.variableInfraCostMicroUsd }).quotedCredits);
    if (credits > max) { max = credits; worst = definition.providerSpec.providerModelId; }
  }
  assert.ok(max < 500, `most expensive model costs ${max} credits (${worst}); expected under 500`);
});

// --- Payload transformers behave --------------------------------------------

test("payload: a text-to-video model emits prompt and only the settings supplied", () => {
  const definition = GENERATED_MODEL_DEFINITIONS.find((d) => d.productPolicy.generationMode === "text-to-video");
  assert.deepEqual(definition.toProviderPayload({ prompt: "  a cat  " }), { prompt: "a cat" });
  assert.deepEqual(
    definition.toProviderPayload({ prompt: "a cat", duration: 5, aspectRatio: "9:16", resolution: "720P" }),
    { prompt: "a cat", duration: 5, aspect_ratio: "9:16", resolution: "720p" }
  );
});

test("payload: an image-to-video model fails closed without a source image", () => {
  const definition = GENERATED_MODEL_DEFINITIONS.find((d) => d.productPolicy.generationMode === "image-to-video");
  assert.throws(() => definition.toProviderPayload({ prompt: "x" }), /needs a source image/);
  assert.deepEqual(
    definition.toProviderPayload({ prompt: "x", imageUrl: "https://cdn.example/a.png" }),
    { prompt: "x", image_url: "https://cdn.example/a.png" }
  );
});

test("payload: a video-extend model fails closed without a source video", () => {
  const definition = GENERATED_MODEL_DEFINITIONS.find((d) => d.productPolicy.generationMode === "video-extend");
  assert.throws(() => definition.toProviderPayload({ prompt: "x" }), /needs a source video/);
});

test("payload: invalid prompt, duration and aspect ratio are all refused", () => {
  const definition = GENERATED_MODEL_DEFINITIONS.find((d) => d.productPolicy.generationMode === "text-to-video");
  assert.throws(() => definition.toProviderPayload({ prompt: "   " }), /prompt is required/);
  assert.throws(() => definition.toProviderPayload({ prompt: "x", duration: 0 }), /duration/);
  assert.throws(() => definition.toProviderPayload({ prompt: "x", duration: 900 }), /duration/);
  assert.throws(() => definition.toProviderPayload({ prompt: "x", duration: 5.5 }), /duration/);
  assert.throws(() => definition.toProviderPayload({ prompt: "x", aspectRatio: "7:3" }), /aspect ratio/);
});

test("payload: no speculative provider parameters are ever sent", () => {
  const definition = GENERATED_MODEL_DEFINITIONS.find((d) => d.productPolicy.generationMode === "text-to-video");
  const payload = definition.toProviderPayload({ prompt: "x", somethingWeInvented: true, seed: 42 });
  assert.deepEqual(Object.keys(payload), ["prompt"], "only supplied, known fields may be forwarded");
});

// --- The contract validator agrees with the picker --------------------------

test("contract: every model the picker offers is resolvable by the request validator", () => {
  // contract.js calls getGenerationModel(request.modelId) and rejects the
  // submission when it returns null, so a picker entry that does not resolve here
  // is an unsubmittable option.
  for (const listed of listGenerationModels()) {
    const resolved = getGenerationModel(listed.id);
    assert.ok(resolved, `${listed.id} is offered but does not resolve in the contract validator`);
    assert.ok(resolved.resolutions.length > 0, `${listed.id} exposes no resolution`);
    assert.ok(resolved.aspectRatios.length > 0, `${listed.id} exposes no aspect ratio`);
    assert.ok(resolved.maxDuration >= resolved.minDuration, `${listed.id} has an inverted duration range`);
    assert.ok(resolved.maxImages >= 1, `${listed.id} must accept at least one image slot`);
  }
});

test("contract: the hand-verified Seedance capabilities survive generation", () => {
  // The generated default is deliberately conservative (720p, 10s, 1 image). The
  // hand-authored Seedance definition carries verified real limits and must win,
  // or a paying user would lose access to capability they previously had.
  const seedance = getGenerationModel("muapi.seedance2.omni-reference-fast");
  assert.ok(seedance, "Seedance 2 Omni must be registered");
  assert.equal(seedance.maxImages, 9);
  assert.equal(seedance.minDuration, 4);
  assert.equal(seedance.maxDuration, 15);
  assert.equal(seedance.supportsNativeAudio, true);
  assert.deepEqual(seedance.resolutions, ["720p"]);
  // Legacy alias still resolves so saved drafts keep working.
  assert.equal(getGenerationModel("seedance-2").id, "muapi.seedance2.omni-reference-fast");
});

test("contract: generated defaults never exceed what we can stand behind", () => {
  for (const model of Object.values(GENERATION_MODELS)) {
    assert.ok(model.maxDuration <= 30, `${model.id} claims ${model.maxDuration}s`);
    for (const ratio of model.aspectRatios) assert.ok(STUDIO_ASPECT_RATIOS.includes(ratio), `${model.id} offers ${ratio}`);
  }
});

// --- Registry wiring --------------------------------------------------------

test("registry: ids are unique and namespaced, and the client shape is serializable", () => {
  const ids = GENERATED_MODEL_DEFINITIONS.map((d) => d.productPolicy.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate model ids");
  for (const id of ids) assert.match(id, /^muapi\./);
  assert.equal(Object.keys(GENERATED_MODELS_BY_ID).length, ids.length);

  const client = toClientModel(GENERATED_MODEL_DEFINITIONS[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), client, "client model must be JSON-safe");
  for (const key of ["id", "name", "mode", "referenceCostUsd", "aspectRatios", "requiresImage"]) {
    assert.ok(key in client, `client model missing ${key}`);
  }
});
