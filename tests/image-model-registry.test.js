import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_GENERATION_MODEL_ID,
  IMAGE_MODELS,
  assertModelAllowedForAvatarGeneration,
  getAvatarGenerationModel,
  getImageModel,
  listImageModels,
} from "../src/lib/generation-models/imageRegistry.js";

test("eleven contract-proven image models are staging-only and provider-contract failures stay disabled", () => {
  assert.equal(IMAGE_MODELS.length, 13);
  assert.equal(new Set(IMAGE_MODELS.map((model) => model.id)).size, 13);
  for (const model of IMAGE_MODELS) {
    assert.equal(model.mediaType, "IMAGE");
    assert.equal(model.provider, "MUAPI");
    assert.equal(model.deployments.production, "DISABLED");
    assert.equal(model.settlementMode, "ATOMIC_JOB");
    assert.equal(model.qaProfile.derivativeFailureIsNonTerminal, true);
  }
  assert.ok(getImageModel("muapi.gpt-image-2-t2i"));
  assert.equal(getImageModel("muapi.seedream-5-pro-t2i").endpoint, null);
  assert.equal(getImageModel("muapi.grok-imagine-t2i").providerCapabilities.output.expectedCount, 1);
  const staging = listImageModels({ DOOLPHIN_ENV: "staging", VERCEL_ENV: "preview" });

  // Image generation is restricted to the ONE image model the pricing document
  // covers: OpenAI GPT Image 2 text-to-image. Every other definition stays in the
  // registry so its id still resolves (a disabled model must report "not enabled"
  // rather than "unknown"), but only the documented one may spend money.
  // The image studio offers a broad catalogue so users have real choice.
  assert.equal(staging.filter((model) => model.available).length, 11);
  assert.equal(staging.find((model) => model.id === "muapi.seedream-5-pro-t2i").available, false);
  assert.equal(staging.find((model) => model.id === "muapi.grok-imagine-image-2").available, false);
  assert.equal(listImageModels({ VERCEL_ENV: "preview" }).every((model) => model.available === false), true);
  assert.equal(listImageModels({ DOOLPHIN_ENV: "staging", VERCEL_ENV: "production" }).every((model) => model.available === false), true);
});

test("payload builders enforce product capability contracts and explicit native defaults", () => {
  const model = getImageModel("muapi.nano-banana-2-t2i");
  const request = { version:"image-generation.v1", modelId:model.id, prompt:"A product photograph", referenceAssetIds:[], aspectRatio:"1:1", outputResolution:"2K" };
  const payload = model.adapter.buildProviderPayload(model, { request, webhookUrl:"https://staging.example.test/webhook" });
  assert.deepEqual(payload, { prompt:"A product photograph", google_search:false, output_format:"jpg", aspect_ratio:"1:1", resolution:"2k", webhook_url:"https://staging.example.test/webhook" });
  const unsupported = model.adapter.validateNormalizedRequest(model, { ...request, referenceAssetIds:["asset_1"] });
  assert.equal(unsupported.valid, false);
  const gpt = getImageModel("muapi.gpt-image-2-t2i");
  assert.equal(gpt.adapter.validateNormalizedRequest(gpt, { version:"image-generation.v1", modelId:gpt.id, prompt:"x", referenceAssetIds:[], aspectRatio:"1:1", outputResolution:"4K" }).valid, false);
});

test("every image definition validates a registry-derived valid request and builds no implicit provider values", () => {
  for (const model of IMAGE_MODELS) {
    const caps = model.productCapabilities;
    const request = {
      version: "image-generation.v1", modelId: model.id, prompt: "A verified staging contract test image", referenceAssetIds: caps.referenceImages.min ? ["asset_1"] : [],
      ...(caps.aspectRatio.visible ? { aspectRatio: caps.aspectRatio.values[0] } : {}),
      ...(caps.outputResolution.visible ? { outputResolution: caps.outputResolution.values[0] } : {}),
      ...(caps.requestedOutputCount.visible ? { requestedOutputCount: caps.requestedOutputCount.values[0] } : {}),
    };
    const validation = model.adapter.validateNormalizedRequest(model, request);
    assert.equal(validation.valid, true, model.id);
    const payload = model.adapter.buildEstimatePayload(model, { request, referenceUrls: request.referenceAssetIds.map(() => "https://staging.example.test/reference.png"), webhookUrl: "https://staging.example.test/webhook" });
    assert.equal(payload.prompt, request.prompt, model.id);
    assert.equal(payload.webhook_url, "https://staging.example.test/webhook", model.id);
    for (const [key, value] of Object.entries(model.fixedProviderDefaults)) assert.deepEqual(payload[key], value, `${model.id}:${key}`);
  }
});

test("image result parsing remains authenticated-result only and rejects malformed output URLs", () => {
  const model = getImageModel("muapi.grok-imagine-t2i");
  assert.deepEqual(model.adapter.parseAuthenticatedResult({ status:"processing" }), { terminal:false, succeeded:false, providerStatus:"processing" });
  assert.throws(() => model.adapter.parseAuthenticatedResult({ status:"completed", outputs:["not-a-url"] }));
  assert.deepEqual(model.adapter.parseAuthenticatedResult({ status:"completed", outputs:["https://provider.example/a.png"], cost:{ amount_usd:0.05 } }), { terminal:true, succeeded:true, outputUrls:["https://provider.example/a.png"], actualCost:0.05 });
});


test("avatar generation is pinned to GPT Image 2 and is not user-selectable", () => {
  // Avatar likeness must stay consistent across a user's library. A face
  // generated by one model and re-generated by another will not match, and the
  // mismatch is permanent, so the model is pinned rather than defaulted.
  assert.equal(AVATAR_GENERATION_MODEL_ID, "muapi.gpt-image-2-t2i");

  const env = { DOOLPHIN_ENV: "staging", VERCEL_ENV: "preview" };
  assert.equal(getAvatarGenerationModel(env).id, "muapi.gpt-image-2-t2i");

  // Passing the pinned id (or nothing) is fine; anything else is refused rather
  // than silently substituted.
  assert.equal(assertModelAllowedForAvatarGeneration(undefined), "muapi.gpt-image-2-t2i");
  assert.equal(
    assertModelAllowedForAvatarGeneration("muapi.gpt-image-2-t2i"),
    "muapi.gpt-image-2-t2i",
  );
  assert.throws(
    () => assertModelAllowedForAvatarGeneration("muapi.nano-banana-2-t2i"),
    (error) => error.code === "AVATAR_MODEL_NOT_SELECTABLE" && error.statusCode === 422,
    "requesting a different avatar model must be refused",
  );

  // Refuses rather than falling back when the pinned model is unavailable: a
  // fallback would produce a mismatched face, which is worse than an error.
  assert.throws(
    () => getAvatarGenerationModel({ VERCEL_ENV: "production" }),
    /Refusing to render an avatar with a different model/,
  );
});
