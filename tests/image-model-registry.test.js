import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_MODELS, getImageModel, listImageModels } from "../src/lib/generation-models/imageRegistry.js";

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
