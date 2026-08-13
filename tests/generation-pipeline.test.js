import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAndValidateGenerationRequest, calculateGenerationQuote } from "../src/lib/generation/contract.js";
import { compileCanonicalPrompt } from "../src/lib/generation/promptCompiler.js";
import { getGenerationModel } from "../src/lib/generation/modelRegistry.js";
import { MuapiSeedanceAdapter } from "../src/lib/adapters/MuapiOtherAdapters.js";
import { transcriptPasses } from "../src/lib/generation/qualityVerification.js";
import { validateSsrfTargetUrl } from "../src/lib/downloader.js";

const modelId = "muapi.seedance2.omni-reference-fast";
const image = (assetId, role, alias, groupId = null, analysis = {}) => ({ assetId, role, alias, groupId, url: `https://cdn.muapi.ai/tests/${assetId}.png`, checksumSha256: `sha-${assetId}`, analysis: { confirmed: true, ...analysis } });

function scenarioRequest(studio, primaryState, deliveryState, referenceState, outputCount) {
  const assets = primaryState === "invalid" ? [] : [image("naomi", "ACTOR_REFERENCE", "Naomi")];
  if (studio === "PRODUCT_STUDIO") {
    if (primaryState === "one") assets.push(image("serum-front", "PRIMARY_PRODUCT", "front", "Glow Serum"));
    if (primaryState === "multiple_views") assets.push(image("serum-front", "PRIMARY_PRODUCT", "front", "Glow Serum"), image("serum-back", "PRODUCT_PACKAGING", "back", "Glow Serum"));
    if (primaryState === "multiple_groups") assets.push(image("serum-front", "PRIMARY_PRODUCT", "front", "Glow Serum"), image("cream-front", "PRIMARY_PRODUCT", "front", "Night Cream"));
  } else if (studio === "APP_STUDIO") {
    if (primaryState === "one") assets.push(image("dashboard", "APP_PRIMARY_SCREEN", "Dashboard", "app_flow", { deviceType: "mobile" }));
    if (primaryState === "multiple_views") assets.push(image("dashboard", "APP_PRIMARY_SCREEN", "Dashboard", "app_flow", { deviceType: "mobile" }), image("schedule", "APP_PRIMARY_SCREEN", "Schedule", "app_flow", { deviceType: "mobile" }));
    if (primaryState === "multiple_groups") assets.push(image("mobile", "APP_PRIMARY_SCREEN", "Mobile", "mobile_flow", { deviceType: "mobile" }), image("desktop", "APP_PRIMARY_SCREEN", "Desktop", "desktop_flow", { deviceType: "desktop" }));
  } else if (primaryState === "multiple_views") assets.push(image("camera", "STYLE_REFERENCE", "Camera style"));
  else if (primaryState === "multiple_groups") assets.push(image("camera", "STYLE_REFERENCE", "Camera style"), image("lighting", "STYLE_REFERENCE", "Lighting style"));

  if (referenceState === "person-free") assets.push(image("ref-object", "STYLE_REFERENCE", "Object-only style", null, { peoplePresent: 0 }));
  if (referenceState === "person-containing") assets.push(image("ref-person", "STYLE_REFERENCE", "Person-containing style", null, { peoplePresent: 1 }));
  if (referenceState === "multiple-conflicting") assets.push(image("ref-a", "STYLE_REFERENCE", "Bright style"), image("ref-b", "STYLE_REFERENCE", "Dark style"));

  const instructions = {
    avatar_dialogue: "Natural creator speaking to camera.",
    voiceover: "Voiceover only over exact B-roll.",
    mixed: "Creator speaks, then add B-roll in a mixed delivery.",
    conflicting: "Voiceover only, but also speak to the camera."
  }[deliveryState];
  return {
    version: "1",
    studio,
    modelId,
    modelLocked: true,
    script: { text: "This workflow keeps my campaign simple.", language: "auto", maxCharacters: 300 },
    instructions: { raw: instructions },
    settings: { durationMode: "AUTO", resolution: "720p", aspectRatio: "9:16", outputCount },
    assets
  };
}

test("permanent semantic matrix covers all 384 studio/input combinations", () => {
  const studios = ["VIDEO_STUDIO", "PRODUCT_STUDIO", "APP_STUDIO"];
  const primaryStates = ["one", "multiple_views", "multiple_groups", "invalid"];
  const deliveryStates = ["avatar_dialogue", "voiceover", "mixed", "conflicting"];
  const referenceStates = ["none", "person-free", "person-containing", "multiple-conflicting"];
  const outputCounts = [1, 2];
  let count = 0;
  for (const studio of studios) for (const primary of primaryStates) for (const delivery of deliveryStates) for (const references of referenceStates) for (const outputs of outputCounts) {
    count += 1;
    const input = scenarioRequest(studio, primary, delivery, references, outputs);
    const validation = normalizeAndValidateGenerationRequest(input);
    const shouldReject = primary === "invalid" || delivery === "conflicting";
    assert.equal(validation.valid, !shouldReject, `${studio}/${primary}/${delivery}/${references}/${outputs}`);
    if (!validation.valid) continue;
    assert.equal(validation.request.studio, studio);
    assert.equal(validation.request.settings.outputCount, outputs);
    assert.equal(validation.request.assets[0].role, "ACTOR_REFERENCE");
    const compiled = compileCanonicalPrompt(validation.request);
    assert.match(compiled.compiledPrompt, /IDENTITY LOCK/);
    assert.match(compiled.compiledPrompt, /says exactly/);
    assert.match(compiled.compiledPrompt, /This workflow keeps my campaign simple/);
    assert.equal(compiled.roleMap[0].tag, "@image1");
    const payload = new MuapiSeedanceAdapter().formatPayload({ prompt: compiled.compiledPrompt, images: compiled.imageUrls, webhookUrl: "https://app.example.com/api/webhooks/muapi?token=test", settings: { duration: validation.request.settings.durationSeconds, resolution: "720p", aspect_ratio: "9:16" } });
    assert.deepEqual(Object.keys(payload).sort(), ["aspect_ratio", "duration", "images_list", "prompt", "webhook_url"].sort());
    assert.equal(payload.images_list.length, compiled.roleMap.length);
    assert.equal("audio_files" in payload, false);
    assert.equal("resolution" in payload, false);
    assert.equal("generate_audio" in payload, false);
  }
  assert.equal(count, 384);
});

test("three target dry runs preserve deterministic role maps and plans", () => {
  const video = scenarioRequest("VIDEO_STUDIO", "one", "mixed", "person-containing", 2);
  video.script.text = "I stopped wasting hours editing ads when I found this workflow.";
  video.instructions.raw = "Natural bedroom selfie, warm morning light, add one short desk B-roll cut.";
  const videoValid = normalizeAndValidateGenerationRequest(video);
  assert.equal(videoValid.valid, true);
  assert.deepEqual(compileCanonicalPrompt(videoValid.request).roleMap.map((item) => item.tag), ["@image1", "@image2"]);

  const product = scenarioRequest("PRODUCT_STUDIO", "multiple_groups", "avatar_dialogue", "none", 1);
  product.script.text = "This serum handles my morning routine, and the night cream keeps it simple before bed.";
  product.instructions.raw = "";
  const productValid = normalizeAndValidateGenerationRequest(product);
  assert.equal(productValid.valid, true);
  const productPrompt = compileCanonicalPrompt(productValid.request).compiledPrompt;
  assert.match(productPrompt, /Glow Serum/);
  assert.match(productPrompt, /Night Cream/);
  assert.match(productPrompt, /every selected product group/);

  const app = scenarioRequest("APP_STUDIO", "multiple_views", "mixed", "none", 1);
  app.assets.push({ assetId: "recording", role: "APP_SCREEN_RECORDING", alias: "Scheduling flow", groupId: "app_flow", url: "https://cdn.muapi.ai/tests/flow.mp4", mimeType: "video/mp4", analysis: { confirmed: true, deviceType: "mobile" } });
  app.instructions.raw = "Start with me holding the phone, then show the scheduling flow.";
  const appValid = normalizeAndValidateGenerationRequest(app);
  assert.equal(appValid.valid, true);
  const appCompiled = compileCanonicalPrompt(appValid.request);
  assert.equal(appCompiled.imageUrls.length, 3);
  assert.equal(appCompiled.compositionAssets.some((asset) => asset.role === "APP_SCREEN_RECORDING"), true);
  assert.match(appCompiled.compiledPrompt, /phone/);
});

test("auto duration grows with scene complexity across studios", () => {
  const simpleVideo = scenarioRequest("VIDEO_STUDIO", "one", "avatar_dialogue", "none", 1);
  simpleVideo.instructions.raw = "Natural selfie intro.";
  const simpleVideoValid = normalizeAndValidateGenerationRequest(simpleVideo);
  assert.equal(simpleVideoValid.valid, true);

  const complexProduct = scenarioRequest("PRODUCT_STUDIO", "multiple_groups", "mixed", "person-free", 1);
  complexProduct.instructions.raw = "Show both products, add a quick b-roll cut, and keep the pacing clean.";
  const complexProductValid = normalizeAndValidateGenerationRequest(complexProduct);
  assert.equal(complexProductValid.valid, true);

  const complexApp = scenarioRequest("APP_STUDIO", "multiple_groups", "mixed", "none", 1);
  complexApp.assets.push(image("recording", "APP_SCREEN_RECORDING", "Scheduling flow", "app_flow", { deviceType: "mobile" }));
  complexApp.instructions.raw = "Start with the phone, then show the full scheduling flow and finish with a CTA.";
  const complexAppValid = normalizeAndValidateGenerationRequest(complexApp);
  assert.equal(complexAppValid.valid, true);

  assert(simpleVideoValid.request.settings.durationSeconds >= 4 && simpleVideoValid.request.settings.durationSeconds <= 15);
  assert(complexProductValid.request.settings.durationSeconds > simpleVideoValid.request.settings.durationSeconds);
  assert(complexAppValid.request.settings.durationSeconds > simpleVideoValid.request.settings.durationSeconds);
});

test("boundary, quote, transcript, and SSRF checks fail closed", () => {
  const tooLong = scenarioRequest("VIDEO_STUDIO", "one", "avatar_dialogue", "none", 1);
  tooLong.script.text = Array(60).fill("word").join(" ");
  assert.equal(normalizeAndValidateGenerationRequest(tooLong).valid, false);

  const unsupported = scenarioRequest("VIDEO_STUDIO", "one", "avatar_dialogue", "none", 1);
  unsupported.settings.resolution = "1080p";
  assert.equal(normalizeAndValidateGenerationRequest(unsupported).valid, false);

  const valid = normalizeAndValidateGenerationRequest(scenarioRequest("VIDEO_STUDIO", "one", "avatar_dialogue", "none", 2));
  const quote = calculateGenerationQuote(valid.request, getGenerationModel(modelId));
  assert.equal(quote.priced, false);
  assert.equal(quote.code, "GENERATION_CONFIGURATION_UNPRICED");
  assert.equal(transcriptPasses("Hello, world!", "hello world").passed, true);
  assert.equal(transcriptPasses("Use only this script", "penguins are surfing").passed, false);
  assert.equal(validateSsrfTargetUrl("http://127.0.0.1/admin").safe, false);
  assert.equal(validateSsrfTargetUrl("https://cdn.muapi.ai/video.mp4").safe, true);
});

test("null delivery mode is treated as omitted and inferred", () => {
  const request = scenarioRequest("VIDEO_STUDIO", "one", "avatar_dialogue", "none", 1);
  request.instructions.confirmedDelivery = null;
  const validation = normalizeAndValidateGenerationRequest(request);
  assert.equal(validation.valid, true);
  assert.equal(validation.request.instructions.confirmedDelivery, "AVATAR_DIALOGUE");

  // Preflight persists this normalized snapshot, then the submission endpoint
  // normalizes it again. That round trip must remain valid and deterministic.
  const persistedSnapshot = JSON.parse(JSON.stringify(validation.request));
  const resubmission = normalizeAndValidateGenerationRequest(persistedSnapshot);
  assert.equal(resubmission.valid, true);
  assert.deepEqual(resubmission.request, validation.request);
});
