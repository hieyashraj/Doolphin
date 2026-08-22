import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";

const { isAuthenticatedImageDeliveryJob, nativeAudioIsExpected, verificationModelIdsForCapability, buildWebhookDispatchUrl, shouldReplayDeliveryCallback } = await import("../src/lib/generation/deliveryPolicy.js");
const { validateR2SignedDownloadUrl } = await import("../src/lib/storage/r2StorageService.js");
const { deriveVideoMediaRequirements, validateVideoMedia } = await import("../src/lib/generation/videoMediaValidation.js");
const { buildVisionVerificationPrompt, evaluateVisionVerification, parseStrictJsonOutput } = await import("../src/lib/generation/qualityVerification.js");
const { compileCanonicalPrompt } = await import("../src/lib/generation/promptCompiler.js");
const { getCuratedCapabilityDescriptor } = await import("../src/lib/models/capabilityDescriptors.js");
const { createCuratedMuapiPayloadAdapter } = await import("../src/lib/models/curatedMuapiAdapters.js");
const { mapValidatedStudioWorkflowToNormalizedInvocation } = await import("../src/lib/models/bridges/studioWorkflowBridge.js");
const { resolveImmutableRecoveryDispatch } = await import("../src/lib/models/execution/recoveryDispatch.js");

function probe({ width, height, duration = 8, videoCodec = "h264", audioCodec = null }) {
  return {
    streams: [
      { codec_type: "video", codec_name: videoCodec, width, height },
      ...(audioCodec ? [{ codec_type: "audio", codec_name: audioCodec }] : []),
    ],
    format: { duration },
  };
}

test("image delivery classification is snapshot-driven with IMAGE_STUDIO compatibility", () => {
  assert.equal(isAuthenticatedImageDeliveryJob({ variant: { creation: { generationType: "IMAGE_STUDIO" } }, capabilitySnapshot: "{}" }), true);
  assert.equal(isAuthenticatedImageDeliveryJob({ variant: { creation: { generationType: "VIDEO_STUDIO" } }, capabilitySnapshot: JSON.stringify({ completionStrategy: "MUAPI_AUTHENTICATED_ASYNC_IMAGE_V1" }) }), true);
  assert.equal(isAuthenticatedImageDeliveryJob({ variant: { creation: { generationType: "VIDEO_STUDIO" } }, capabilitySnapshot: JSON.stringify({ mediaType: "VIDEO" }) }), false);
});

test("capability-aware media validation accepts advertised ratios, resolutions, and silent models", () => {
  const silent4k = validateVideoMedia({
    probe: probe({ width: 2160, height: 2160, duration: 10 }),
    byteLength: 50_000,
    creation: { aspectRatio: "1:1", resolution: "4k", duration: 10 },
    capabilitySnapshot: { aspectRatios: ["16:9", "9:16", "1:1", "21:9"], resolutions: ["4k"], nativeAudio: { supported: false } },
  });
  assert.equal(silent4k.passed, true);
  assert.equal(silent4k.requireAudio, undefined);
  assert.equal(silent4k.requirements.requireAudio, false);

  const cinematic = validateVideoMedia({
    probe: probe({ width: 1680, height: 720, duration: 8 }),
    byteLength: 50_000,
    creation: { aspectRatio: "21:9", resolution: "720p", duration: 8 },
    capabilitySnapshot: { aspectRatios: ["21:9"], resolutions: ["720p"], nativeAudioRequested: false },
  });
  assert.equal(cinematic.passed, true);

  const adaptive = validateVideoMedia({
    probe: probe({ width: 900, height: 720, duration: 8 }),
    byteLength: 50_000,
    creation: { aspectRatio: "adaptive", resolution: "720p", duration: 8 },
    capabilitySnapshot: { aspectRatios: ["adaptive"], resolutions: ["720p"], nativeAudioRequested: false },
  });
  assert.equal(adaptive.passed, true);
});

test("media validation still rejects missing required audio, corrupt streams, and wrong selections", () => {
  const missingAudio = validateVideoMedia({
    probe: probe({ width: 1080, height: 1920 }),
    byteLength: 50_000,
    creation: { aspectRatio: "9:16", resolution: "1080p", duration: 8 },
    capabilitySnapshot: { aspectRatios: ["9:16"], resolutions: ["1080p"], nativeAudioRequested: true },
  });
  assert.equal(missingAudio.passed, false);
  assert.equal(missingAudio.checks.audioPresent, false);

  const corrupt = validateVideoMedia({ probe: { streams: [], format: {} }, byteLength: 20, creation: {}, capabilitySnapshot: { nativeAudioRequested: false } });
  assert.equal(corrupt.passed, false);
  assert.equal(corrupt.checks.hasDecodableVideo, false);

  const wrongResolution = validateVideoMedia({
    probe: probe({ width: 720, height: 1280, audioCodec: "aac" }),
    byteLength: 50_000,
    creation: { aspectRatio: "9:16", resolution: "1080p", duration: 8 },
    capabilitySnapshot: { aspectRatios: ["9:16"], resolutions: ["1080p"], nativeAudioRequested: true },
  });
  assert.equal(wrongResolution.passed, false);
  assert.equal(wrongResolution.checks.resolution, false);
});

test("native-audio and Studio-specific vision policies are explicit and backward compatible", () => {
  assert.equal(nativeAudioIsExpected({ nativeAudio: { supported: false } }), false);
  assert.deepEqual(verificationModelIdsForCapability({ nativeAudio: { supported: false } }), ["muapi.gemini-2.5-flash-verifier"]);
  assert.equal(nativeAudioIsExpected({ nativeAudioRequested: true, nativeAudio: { supported: true } }), true);
  assert.deepEqual(verificationModelIdsForCapability({ nativeAudioRequested: true }), ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"]);
  assert.match(buildVisionVerificationPrompt("VIDEO_STUDIO", "Demo"), /do not require product, UGC, app, or software/i);
  assert.match(buildVisionVerificationPrompt("PRODUCT_STUDIO", "Demo"), /product advertisement/i);
  assert.match(buildVisionVerificationPrompt("APP_STUDIO", "Demo"), /app, software product/i);

  const oldShape = parseStrictJsonOutput({ outputs: ["```json\n{\"isProductVideo\":true,\"hasDistortion\":false,\"summary\":\"ok\"}\n```"] });
  assert.equal(evaluateVisionVerification("VIDEO_STUDIO", { ...oldShape, isProductVideo: false }).passed, true);
  assert.equal(evaluateVisionVerification("PRODUCT_STUDIO", oldShape).passed, true);
  assert.equal(evaluateVisionVerification("APP_STUDIO", oldShape).passed, true, "in-flight legacy App verifier output remains readable");
  assert.equal(evaluateVisionVerification("APP_STUDIO", { isAppVideo: false, hasDistortion: false }).passed, false);
  assert.throws(() => parseStrictJsonOutput({ output: "{\"hasDistortion\":\"false\"}" }), /invalid distortion verdict/);
});

test("partial workflow settlement source persists PARTIAL_COMPLETED", () => {
  const settlement = fs.readFileSync(new URL("../src/lib/models/execution/workflowSettlement.js", import.meta.url), "utf8");
  assert.match(settlement, /settledStatus: "PARTIAL_COMPLETED"/);
  assert.match(settlement, /settlement\.settledStatus\.includes\("COMPLETED"\)/);
});

test("recovery dispatch returns exact immutable bytes and rejects fingerprint drift", () => {
  const providerPayloadJson = "{\"prompt\":\"byte-for-byte\",\"seed\":7}";
  const providerPayloadHash = crypto.createHash("sha256").update(providerPayloadJson).digest("hex");
  const plan = {
    authorityVersion: "MODEL_PLATFORM_PREPARED_V1",
    canonicalModelId: "provider-model",
    providerModelId: "provider-model",
    providerEndpoint: "https://api.muapi.ai/api/v1/provider-model",
    providerSpecHash: "registry-v1",
    adapterRevision: "adapter-v1",
    capabilityRevision: "capability-v1",
    provenance: { source: "LIVE_PROVIDER", stale: false },
    providerPayloadJson,
    providerPayloadHash,
    workflowPricing: { quotedCredits: 12, outputCount: 1, pricingRevisionId: "pricing-v1" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    model: { adapterVersion: "adapter-v1", capabilityRevision: "capability-v1" },
    webhookUrl: "https://doolphin.example/api/webhooks/muapi?token=signed",
    providerPayloadFingerprint: providerPayloadHash,
    modelPlatformPreparedPlan: plan,
  };
  const quote = {
    id: "quote-1",
    selectedModelId: "provider-model",
    requestSnapshot: JSON.stringify({ settings: { outputCount: 1 } }),
    internalCreditsToReserve: 12,
    pricingRevision: "pricing-v1",
    registryRevision: "registry-v1",
    adapterVersion: "adapter-v1",
  };
  const job = {
    id: "job-1",
    inputFingerprint: providerPayloadHash,
    endpoint: plan.providerEndpoint,
    registryRevision: "registry-v1",
    pricingRevision: "pricing-v1",
    adapterVersion: "adapter-v1",
    routingSnapshot: JSON.stringify(routingSnapshot),
    capabilitySnapshot: JSON.stringify({ adapterRevision: "adapter-v1", capabilityRevision: "capability-v1" }),
    variant: { creation: { quoteId: "quote-1" } },
  };
  const resolved = resolveImmutableRecoveryDispatch({ outboxPayload: { providerJobId: "job-1", quoteId: "quote-1" }, job, quote });
  assert.equal(resolved.providerPayloadJson, providerPayloadJson);
  assert.match(resolved.dispatchUrl, /webhook=/);
  assert.throws(() => resolveImmutableRecoveryDispatch({ outboxPayload: { providerJobId: "job-1", quoteId: "quote-1" }, job: { ...job, inputFingerprint: "tampered" }, quote }), /payload fingerprint/);
});

test("source guards keep image routing before video work, signed composition, all outputs, and cron safety", () => {
  const webhook = fs.readFileSync(new URL("../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.ok(webhook.indexOf("isAuthenticatedImageDeliveryJob(job)") < webhook.indexOf("classifyMuapiProviderStatus(providerPayload)"));
  assert.ok(webhook.indexOf("isAuthenticatedImageDeliveryJob(job)") < webhook.indexOf("runFfprobe(tempPath)"));

  const quality = fs.readFileSync(new URL("../src/lib/generation/qualityPipeline.js", import.meta.url), "utf8");
  assert.match(quality, /const requiredVerifierIds = verificationModelIdsForCapability/);
  assert.match(quality, /if \(requiredVerifierIds\.includes\("muapi\.openai-whisper"\)\)/);
  assert.match(quality, /if \(whisperJob\) await submitVerificationJob\(whisperJob, \{ file: videoUrl \}, webhookUrl\)/);
  assert.match(quality, /submitVerificationJob\(visionJob, \{ prompt: visionPrompt, image: montageSignedUrl, json_mode: true \}, webhookUrl\)/);
  assert.match(quality, /const visionJob = jobs\.find/);
  assert.match(quality, /generateSignedUrl\(\{ storageKey: screenAsset\.storageKey/);
  assert.match(quality, /downloadSignedBuffer\(\{ storageKey: screenAsset\.storageKey, signedUrl: screenSignedUrl \}\)/);
  assert.doesNotMatch(quality, /downloadMediaBufferSsrfSafe\(screenSignedUrl\)/);
  assert.doesNotMatch(quality, /`\/storage\/\$\{screenAsset\.storageKey\}`/);

  const reconcile = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");
  assert.match(reconcile, /body: immutableDispatch\.providerPayloadJson/);
  assert.doesNotMatch(reconcile, /getProviderAdapter|compileCanonicalPrompt/);

  const creations = fs.readFileSync(new URL("../src/app/api/creations/route.js", import.meta.url), "utf8");
  assert.match(creations, /const outputs = await Promise\.all/);
  assert.match(creations, /outputs,\n\s+url,/);

  const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(vercel.crons, undefined, "do not invent a paid-plan minute cron without a documented deployment plan");
  const schedule = fs.readFileSync(new URL("../src/lib/generation/reconciliationSchedule.js", import.meta.url), "utf8");
  assert.match(schedule, /vercel\.json intentionally has no cron/);
});

test("requirement derivation honors persisted creation selection", () => {
  const requirements = deriveVideoMediaRequirements({
    creation: { aspectRatio: "3:2", resolution: "480p", duration: 6 },
    capabilitySnapshot: { aspectRatios: ["2:3", "3:2"], resolutions: ["480p", "720p"], nativeAudio: { supported: false } },
  });
  assert.equal(requirements.requestedRatio, "3:2");
  assert.equal(requirements.requestedResolution, "480p");
  assert.equal(requirements.selectionAdvertised, true);
  assert.equal(requirements.requireAudio, false);
});


test("default Seedance audio survives Video, Product, and App Studio prompt and payload compilation", () => {
  const model = getCuratedCapabilityDescriptor("muapi.seedance2.omni-reference-fast");
  assert.deepEqual(model.nativeAudio, { supported: true, controllable: true, default: true });
  const adapter = createCuratedMuapiPayloadAdapter(model);
  const studioAssets = {
    VIDEO_STUDIO: [],
    PRODUCT_STUDIO: [{ assetId: "product-1", role: "PRIMARY_PRODUCT", alias: "Bottle", groupId: "bottle", url: "https://assets.example.test/product.png" }],
    APP_STUDIO: [{ assetId: "screen-1", role: "APP_PRIMARY_SCREEN", alias: "Dashboard", url: "https://assets.example.test/screen.png", analysis: { deviceType: "desktop" } }],
  };

  for (const studio of ["VIDEO_STUDIO", "PRODUCT_STUDIO", "APP_STUDIO"]) {
    const request = {
      studio,
      script: { text: "The selected model speaks this exact line." },
      instructions: { raw: "Keep the pacing natural.", confirmedDelivery: "AVATAR_DIALOGUE" },
      settings: { durationSeconds: 8, aspectRatio: "9:16", resolution: "720p" },
      assets: [
        { assetId: "actor-1", role: "ACTOR_REFERENCE", alias: "Creator", url: "https://assets.example.test/actor.png" },
        ...studioAssets[studio],
      ],
    };
    const compiled = compileCanonicalPrompt(request, model);
    const normalized = mapValidatedStudioWorkflowToNormalizedInvocation({ request, model, compiledPrompt: compiled.compiledPrompt });
    const providerPayload = adapter.toProviderPayload(normalized);

    assert.match(compiled.compiledPrompt, /DIALOGUE/);
    assert.match(providerPayload.prompt, /speaks this exact line/);
    assert.equal(normalized.generateAudio, true, `${studio} must resolve the model's default audio control`);
    assert.equal(providerPayload.generate_audio, true, `${studio} must request native provider audio`);

    const silentRequest = { ...request, settings: { ...request.settings, nativeAudio: false } };
    const silentCompiled = compileCanonicalPrompt(silentRequest, model);
    const silentNormalized = mapValidatedStudioWorkflowToNormalizedInvocation({ request: silentRequest, model, compiledPrompt: silentCompiled.compiledPrompt });
    const silentPayload = adapter.toProviderPayload(silentNormalized);
    assert.match(silentCompiled.compiledPrompt, /CREATIVE DIRECTION/);
    assert.doesNotMatch(silentCompiled.compiledPrompt, /Generate native speech/);
    assert.equal(silentPayload.generate_audio, false, `${studio} must keep explicit audio opt-out aligned with its prompt`);
  }
});

test("quality verifier callback transport preserves the signed shared webhook URL", () => {
  const callback = "https://doolphin.example/api/webhooks/muapi?token=signed-token";
  const dispatch = new URL(buildWebhookDispatchUrl("https://api.muapi.ai/api/v1/openai-whisper", callback));
  assert.equal(dispatch.origin, "https://api.muapi.ai");
  assert.equal(dispatch.searchParams.get("webhook"), callback);
  assert.throws(() => buildWebhookDispatchUrl("https://api.muapi.ai/api/v1/openai-whisper", "/relative-callback"), /absolute HTTP\(S\)/);
});


test("App recording signed downloads are restricted to the configured R2 object", () => {
  const storageKey = "uploads/workspace/app-recording.mp4";
  const signedUrl = `https://account-123.r2.cloudflarestorage.com/media-bucket/${storageKey}?X-Amz-Signature=test-signature`;
  assert.equal(validateR2SignedDownloadUrl({ signedUrl, storageKey, expectedAccountId: "account-123", expectedBucketName: "media-bucket" }), signedUrl);
  assert.throws(() => validateR2SignedDownloadUrl({ signedUrl: signedUrl.replace("account-123", "attacker"), storageKey, expectedAccountId: "account-123", expectedBucketName: "media-bucket" }), /configured storage account/);
  assert.throws(() => validateR2SignedDownloadUrl({ signedUrl, storageKey: "uploads/workspace/other.mp4", expectedAccountId: "account-123", expectedBucketName: "media-bucket" }), /requested storage object/);
});

test("retried image and verifier callbacks can replay delivery without a scheduler", () => {
  const retryable = { status: "SUCCEEDED", internalModelId: "muapi.gemini-2.5-flash-verifier", variant: { currentStage: "delivery_retry" } };
  assert.equal(shouldReplayDeliveryCallback(retryable), true);
  assert.equal(shouldReplayDeliveryCallback({ ...retryable, internalModelId: "muapi.seedance2.omni-reference-fast" }), false);
  assert.equal(shouldReplayDeliveryCallback({ ...retryable, variant: { currentStage: "delivery" } }), false);
  assert.equal(shouldReplayDeliveryCallback({ ...retryable, status: "FAILED" }), false);

  const imageRetry = {
    status: "PROCESSING",
    internalModelId: "muapi.gpt-image-2-t2i",
    capabilitySnapshot: JSON.stringify({ mediaType: "IMAGE" }),
    variant: { currentStage: "result_processing_retry", creation: { generationType: "IMAGE_STUDIO" } },
  };
  assert.equal(shouldReplayDeliveryCallback(imageRetry), true);
  assert.equal(shouldReplayDeliveryCallback({ ...imageRetry, variant: { ...imageRetry.variant, currentStage: "provider_generation" } }), false);
  assert.equal(shouldReplayDeliveryCallback({ ...imageRetry, status: "FAILED" }), false);

  const webhook = fs.readFileSync(new URL("../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.match(webhook, /duplicateEvent && !shouldReplayDeliveryCallback\(job\)/);
  assert.match(webhook, /\["SUCCEEDED", "FAILED", "CANCELLED"\]\.includes\(job\.status\) && !shouldReplayDeliveryCallback\(job\)/);
});
