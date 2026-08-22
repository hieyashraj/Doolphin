import test from "node:test";
import assert from "node:assert/strict";
import portfolio from "../src/lib/models/catalog/curated-generation-portfolio.json" with { type: "json" };
import {
  GENERATED_MODEL_DEFINITIONS,
  GENERATED_MODELS_BY_ID,
  listGeneratedModelsByStudio,
  toClientModel,
  STUDIO_ASPECT_RATIOS,
} from "../src/lib/models/videoModelFactory.js";
import { listGenerationModels, getGenerationModel, GENERATION_MODELS } from "../src/lib/generation/modelRegistry.js";
import { calculateRequiredCredits, PRICING_REVISION } from "../src/lib/entitlements/pricing.js";
import { validateProviderModelIdentityBinding } from "../src/lib/models/cutoverEligibility.js";

const VIDEO_MODES = ["text-to-video", "image-to-video", "video-extend"];

test("bench: the checked-in curated portfolio is the complete production boundary", () => {
  assert.equal(GENERATED_MODEL_DEFINITIONS.length, 71);
  assert.equal(listGeneratedModelsByStudio("video-studio").length, 5);
  assert.equal(listGeneratedModelsByStudio("image-studio").length, 1);
  assert.equal(listGenerationModels().length, 5);
  assert.equal(Object.values(portfolio.families).flat().length, 71);
});

test("bench: media models are split into the right studios", () => {
  const video = listGeneratedModelsByStudio("video-studio");
  const image = listGeneratedModelsByStudio("image-studio");
  for (const definition of video) assert.ok(VIDEO_MODES.includes(definition.productPolicy.generationMode));
  for (const definition of image) assert.equal(definition.productPolicy.generationMode, "text-to-image");
  assert.equal(listGeneratedModelsByStudio("product-studio").length, 4);
  assert.equal(listGeneratedModelsByStudio("app-studio").length, 4);
});

test("bench: every curated model has an adapter and priceable endpoint, but only reviewed mappings dispatch", () => {
  let dispatchable = 0;
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const { endpoint, providerModelId, dynamicPricing, estimateEndpoint, cost } = definition.providerSpec;
    assert.match(endpoint, /^https:\/\/api\.muapi\.ai\/api\/v1\//, providerModelId);
    assert.equal(typeof definition.toProviderPayload, "function", providerModelId);
    if (definition.capabilityDescriptor.dispatchable) dispatchable += 1;
    assert.ok(cost.amount > 0, providerModelId);
    if (dynamicPricing) assert.match(estimateEndpoint, /\/estimate-cost$/, providerModelId);
  }
  assert.equal(dispatchable, 14, "13 reviewed video mappings plus GPT Image 2 may dispatch");
});

test("bench: every model yields a positive credit charge covering published basis plus infra", () => {
  const ceiling = Number(PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd);
  for (const definition of GENERATED_MODEL_DEFINITIONS) {
    const providerMicroUsd = BigInt(Math.round(definition.providerSpec.cost.amount * 1e6));
    const infra = definition.businessPolicy.variableInfraCostMicroUsd;
    const quote = calculateRequiredCredits({ provider: providerMicroUsd, infra });
    assert.ok(quote.quotedCredits > 0n, definition.providerSpec.providerModelId);
    assert.ok(Number(quote.quotedCredits) * ceiling >= Number(providerMicroUsd + infra), definition.providerSpec.providerModelId);
  }
});

test("contract: every listed model resolves with descriptor-derived capabilities", () => {
  for (const listed of listGenerationModels()) {
    const resolved = getGenerationModel(listed.id);
    assert.ok(resolved, listed.id);
    assert.deepEqual(resolved.resolutions, listed.resolutions);
    assert.deepEqual(resolved.aspectRatios, listed.aspectRatios);
    assert.ok(resolved.maxDuration >= resolved.minDuration, listed.id);
    assert.ok(resolved.maxImages >= 1, listed.id);
    for (const ratio of resolved.aspectRatios) assert.ok(STUDIO_ASPECT_RATIOS.includes(ratio), `${listed.id}:${ratio}`);
  }
});

test("contract: verified Seedance metadata and legacy IDs survive projection", () => {
  const seedance = getGenerationModel("muapi.seedance2.omni-reference-fast");
  assert.ok(seedance);
  assert.equal(seedance.maxReferences.images, 9);
  assert.equal(seedance.maxReferences.audios, 3);
  assert.equal(seedance.minDuration, 4);
  assert.equal(seedance.maxDuration, 15);
  assert.deepEqual(seedance.resolutions, ["720p"]);
  assert.equal(getGenerationModel("seedance-2").id, seedance.id);
  assert.equal(getGenerationModel("seedance-2-omni-reference-no-video-fast").id, seedance.id);
});

test("registry: IDs are unique/namespaced and normalized client shapes are serializable", () => {
  const ids = GENERATED_MODEL_DEFINITIONS.map((definition) => definition.productPolicy.id);
  assert.equal(new Set(ids).size, 71);
  assert.equal(Object.keys(GENERATED_MODELS_BY_ID).length, 71);
  for (const id of ids) assert.match(id, /^muapi\./);
  const client = toClientModel(GENERATED_MODEL_DEFINITIONS[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(client)), client);
  for (const key of ["id", "name", "family", "variant", "controls", "slots", "requiredSlots", "durationValues", "aspectRatios", "resolutions", "nativeAudio", "maxReferences", "confidence"]) {
    assert.ok(key in client, key);
  }
});

test("generated compatibility export contains no non-curated model", () => {
  for (const model of Object.values(GENERATION_MODELS)) assert.equal(model.confidence === "VERIFIED" || model.confidence === "DERIVED", true);
  assert.equal(Object.values(GENERATION_MODELS).some((model) => /hailuo|flux/i.test(model.providerModelId)), false);
});


test("dispatch identity binding covers every client-listed curated model", () => {
  for (const listed of listGenerationModels()) {
    assert.equal(
      validateProviderModelIdentityBinding({
        requestedModelId: listed.id,
        canonicalModelId: listed.id,
        returnedProviderModelId: listed.providerModelId,
      }),
      true,
      listed.id,
    );
  }
});
