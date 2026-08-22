import { MODEL_ADAPTER_REVISION } from "./capabilityDescriptors.js";

/*
 * Provider spellings intentionally live in this mapping module only. Descriptors,
 * bridges, request contracts, and clients use provider-neutral canonical names.
 */
const MATRIX_MAPPINGS = Object.freeze({
  "seedance-2.5-omni-reference": {
    prompt: "prompt", referenceImages: "images_list", referenceVideos: "videos_list", referenceAudios: "audios_list",
    aspectRatio: "aspect_ratio", duration: "duration", generateAudio: "generate_audio", seed: "seed", defaultSeed: -1,
  },
  "seedance-2-omni-reference-no-video-fast": {
    prompt: "prompt", referenceImages: "images_list", referenceAudios: "audio_files",
    aspectRatio: "aspect_ratio", duration: "duration", generateAudio: "generate_audio",
  },
  "seedance-2-omni-reference": {
    prompt: "prompt", referenceImages: "images_list", referenceVideos: "video_files", referenceAudios: "audio_files",
    aspectRatio: "aspect_ratio", quality: "quality", duration: "duration", generateAudio: "generate_audio",
  },
  "seedance-2-first-last-frame": {
    prompt: "prompt", frames: "images_list", aspectRatio: "aspect_ratio", duration: "duration",
  },
  "seedance-2.5-text-to-video-4k": {
    prompt: "prompt", duration: "duration", aspectRatio: "aspect_ratio", seed: "seed",
  },
  "seedance-2.5-video-edit": {
    prompt: "prompt", sourceVideo: "video", referenceImages: "images_list", referenceAudios: "audios_list",
    duration: "duration", aspectRatio: "aspect_ratio", generateAudio: "generate_audio", seed: "seed",
  },
  "veo-4-text-to-video": {
    prompt: "prompt", aspectRatio: "aspect_ratio", duration: "duration",
  },
  "veo-4-image-to-video": {
    prompt: "prompt", sourceImageList: "images_list", aspectRatio: "aspect_ratio", duration: "duration",
  },
  "veo3.1-fast-text-to-video": {
    prompt: "prompt", aspectRatio: "aspect_ratio", duration: "duration", resolution: "resolution",
  },
  "veo3.1-reference-to-video": {
    prompt: "prompt", referenceImages: "images_list", resolution: "resolution", duration: "duration", generateAudio: "generate_audio",
  },
  "veo3.1-extend-video": {
    prompt: "prompt", sourceRequestId: "request_id", aspectRatio: "aspect_ratio", duration: "duration", resolution: "resolution",
  },
  "kling-v3.0-omni-4k-image-to-video": {
    prompt: "prompt", referenceImages: "images_list", aspectRatio: "aspect_ratio", duration: "duration",
  },
  "openai-sora-2-pro-storyboard": {
    storyboard: "shots", referenceImages: "images_list", duration: "duration", aspectRatio: "aspect_ratio",
  },
  "grok-imagine-text-to-video": {
    prompt: "prompt", aspectRatio: "aspect_ratio", resolution: "resolution", duration: "duration",
    modelParameters: { mode: "mode" },
  },
});

const ARRAY_SOURCE_IMAGE_IDS = new Set([
  "veo-4-image-to-video", "veo3-fast-image-to-video", "veo3-image-to-video",
  "openai-sora-2-pro-image-to-video", "grok-imagine-video-1-5-preview", "grok-imagine-image-to-video",
]);
const SINGULAR_SOURCE_IMAGE_IDS = new Set([
  "seedance-2.5-image-to-video", "seedance-2.5-image-to-video-480p", "seedance-2.5-image-to-video-1080p",
  "seedance-2.5-image-to-video-4k", "seedance-2.5-intl-image-to-video", "seedance-2.5-spicy-image-to-video",
  "seedance-2.5-intl-image-to-video-1080p", "seedance-2.5-spicy-image-to-video-1080p",
  "veo3.1-lite-image-to-video", "veo3.1-fast-image-to-video", "veo3.1-image-to-video",
  "kling-v3-turbo-pro-image-to-video", "kling-v3-turbo-standard-image-to-video", "kling-v2.5-turbo-std-i2v",
]);

function genericMapping(descriptor) {
  const id = descriptor.providerId;
  const mapping = {
    prompt: "prompt",
    duration: "duration",
    aspectRatio: "aspect_ratio",
    quality: "quality",
    seed: "seed",
    sourceRequestId: "request_id",
    referenceImages: "images_list",
    referenceVideos: id.startsWith("seedance-2.5") ? "videos_list" : "video_files",
    referenceAudios: id.startsWith("seedance-2.5") ? "audios_list" : "audio_files",
    frames: "images_list",
    generateAudio: "generate_audio",
    resolution: descriptor.resolutions.endpointFixed ? null : "resolution",
  };
  if (ARRAY_SOURCE_IMAGE_IDS.has(id)) mapping.sourceImageList = "images_list";
  else if (SINGULAR_SOURCE_IMAGE_IDS.has(id)) mapping.sourceImage = "image_url";
  else if (descriptor.slots.sourceImage.supported) mapping.sourceImage = "image_url";
  if (id === "seedance-2-video-edit") mapping.sourceVideoList = "video_urls";
  else if (descriptor.slots.sourceVideo.supported) mapping.sourceVideo = "video_url";
  if (descriptor.mode === "storyboard-to-video") mapping.storyboard = "shots";
  return mapping;
}

function fail(descriptor, message) {
  throw new Error(`[${descriptor.providerId}] ${message}`);
}

function has(value) {
  return value !== undefined && value !== null;
}

function canonicalReferences(input) {
  return {
    images: input.referenceImages ?? input.extraInputs?.images ?? [],
    videos: input.referenceVideos ?? input.extraInputs?.videoReferences ?? [],
    audios: input.referenceAudios ?? input.extraInputs?.audioReferences ?? [],
  };
}

function validateSlot(descriptor, name, value) {
  const spec = descriptor.slots[name];
  const values = Array.isArray(value) ? value : has(value) ? [value] : [];
  if (!spec.supported && values.length) fail(descriptor, `${name} is unsupported`);
  if (spec.required && values.length < spec.min) fail(descriptor, `${name} requires at least ${spec.min} value(s)`);
  if (values.length > spec.max) fail(descriptor, `${name} accepts at most ${spec.max} value(s); received ${values.length}`);
  return values;
}

function validateScalarCapabilities(descriptor, input) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (descriptor.controls.prompt.required && !prompt) fail(descriptor, "prompt is required");
  if (!descriptor.controls.prompt.supported && prompt) fail(descriptor, "prompt is unsupported; use storyboard/scenes for this model");
  if (prompt.length > descriptor.controls.prompt.maxLength) fail(descriptor, `prompt exceeds ${descriptor.controls.prompt.maxLength} characters`);
  if (has(input.script) && !descriptor.controls.script.supported) fail(descriptor, "script is unsupported");
  if (has(input.additionalInstructions) && !descriptor.controls.additionalInstructions.supported) fail(descriptor, "additionalInstructions is unsupported");
  if (has(input.sourceRequestId) && !descriptor.controls.sourceRequestId.supported) fail(descriptor, "sourceRequestId is unsupported");
  if (descriptor.controls.sourceRequestId.required && !input.sourceRequestId) fail(descriptor, "sourceRequestId is required");
  if (has(input.seed) && !descriptor.controls.seed.supported) fail(descriptor, "seed is unsupported");

  if (has(input.duration)) {
    if (!descriptor.duration.supported) fail(descriptor, "duration is unsupported");
    if (descriptor.duration.values.length && !descriptor.duration.values.includes(input.duration)) {
      fail(descriptor, `duration must be one of: ${descriptor.duration.values.join(", ")}`);
    }
    if (descriptor.duration.min !== null && (input.duration < descriptor.duration.min || input.duration > descriptor.duration.max)) {
      fail(descriptor, `duration must be between ${descriptor.duration.min} and ${descriptor.duration.max} seconds`);
    }
  }
  if (has(input.aspectRatio)) {
    if (!descriptor.aspectRatios.supported || !descriptor.aspectRatios.values.includes(input.aspectRatio)) {
      fail(descriptor, `aspectRatio '${input.aspectRatio}' is unsupported; expected: ${descriptor.aspectRatios.values.join(", ") || "none"}`);
    }
  }
  if (has(input.resolution)) {
    if (!descriptor.resolutions.supported || !descriptor.resolutions.values.map(String).some((item) => item.toLowerCase() === String(input.resolution).toLowerCase())) {
      fail(descriptor, `resolution '${input.resolution}' is unsupported; expected: ${descriptor.resolutions.values.join(", ") || "none"}`);
    }
  }
  if (has(input.quality)) {
    if (!descriptor.quality.supported || !descriptor.quality.values.includes(input.quality)) {
      fail(descriptor, `quality '${input.quality}' is unsupported; expected: ${descriptor.quality.values.join(", ") || "none"}`);
    }
  }
  if (descriptor.providerId === "gpt-image-2-text-to-image") {
    if (!has(input.aspectRatio)) fail(descriptor, "aspectRatio is required");
    if (!has(input.resolution)) fail(descriptor, "resolution is required");
  }
  const constrainedResolutions = descriptor.resolutionConstraints?.byAspectRatio?.[input.aspectRatio];
  if (has(input.resolution) && constrainedResolutions && !constrainedResolutions.some((value) => value.toLowerCase() === String(input.resolution).toLowerCase())) {
    fail(descriptor, `${descriptor.family === "gpt-image-2" ? "GPT Image 2" : descriptor.providerId} does not support ${input.resolution} at ${input.aspectRatio}`);
  }
  const audioControl = has(input.generateAudio) ? input.generateAudio : input.nativeAudio;
  if (has(input.generateAudio) && has(input.nativeAudio) && input.generateAudio !== input.nativeAudio) {
    fail(descriptor, "nativeAudio and generateAudio conflict");
  }
  if (has(audioControl) && (!descriptor.nativeAudio.supported || !descriptor.nativeAudio.controllable)) {
    fail(descriptor, "native audio generation is not user-controllable for this model");
  }
  if ((has(input.camera) || has(input.motion)) && !descriptor.cameraMotion.supported) {
    fail(descriptor, "structured camera/motion controls are unsupported; express them in the prompt");
  }
  const resolvedAudioControl = has(audioControl)
    ? audioControl
    : descriptor.nativeAudio.supported && descriptor.nativeAudio.controllable && typeof descriptor.nativeAudio.default === "boolean"
    ? descriptor.nativeAudio.default
    : undefined;
  return { prompt, audioControl: resolvedAudioControl };
}

function append(payload, field, value) {
  if (field && has(value)) payload[field] = value;
}

function mapStoryboard(descriptor, scenes) {
  if (!Array.isArray(scenes)) fail(descriptor, "storyboard/scenes must be an array");
  const spec = descriptor.controls.storyboard;
  if (!spec.supported) fail(descriptor, "storyboard/scenes are unsupported");
  if (scenes.length < spec.minScenes || scenes.length > spec.maxScenes) {
    fail(descriptor, `storyboard requires ${spec.minScenes}-${spec.maxScenes} scenes`);
  }
  return scenes.map((scene, index) => {
    const description = String(scene?.description ?? scene?.scene ?? "").trim();
    if (!description) fail(descriptor, `storyboard scene ${index + 1} needs a description`);
    if (!(Number(scene?.duration) > 0)) fail(descriptor, `storyboard scene ${index + 1} needs a positive duration`);
    return { scene: description, duration: Number(scene.duration) };
  });
}

function mapModelParameters(descriptor, mapping, parameters) {
  if (!has(parameters)) return null;
  if (!descriptor.modelParameters.supported || typeof parameters !== "object" || Array.isArray(parameters)) {
    fail(descriptor, "modelParameters are unsupported");
  }
  const result = {};
  for (const [name, value] of Object.entries(parameters)) {
    const rule = descriptor.modelParameters.allowlist[name];
    const providerField = mapping.modelParameters?.[name];
    if (!rule || !providerField) fail(descriptor, `modelParameters.${name} is not allowlisted`);
    if (rule.type === "enum" && !rule.values.includes(value)) {
      fail(descriptor, `modelParameters.${name} must be one of: ${rule.values.join(", ")}`);
    }
    result[providerField] = value;
  }
  return result;
}

export function createCuratedMuapiPayloadAdapter(descriptor) {
  if (!descriptor?.providerId) throw new Error("A capability descriptor is required");
  const mapping = MATRIX_MAPPINGS[descriptor.providerId] || genericMapping(descriptor);

  return Object.freeze({
    revision: MODEL_ADAPTER_REVISION,
    mappingConfidence: MATRIX_MAPPINGS[descriptor.providerId] ? "VERIFIED" : descriptor.confidence,
    toProviderPayload(input = {}) {
      const { prompt, audioControl } = validateScalarCapabilities(descriptor, input);
      const references = canonicalReferences(input);
      const referenceImages = validateSlot(descriptor, "referenceImages", references.images);
      const referenceVideos = validateSlot(descriptor, "referenceVideos", references.videos);
      const referenceAudios = validateSlot(descriptor, "referenceAudios", references.audios);
      validateSlot(descriptor, "sourceImage", input.sourceImage);
      validateSlot(descriptor, "sourceVideo", input.sourceVideo);

      const startFrame = input.startFrame ?? null;
      const endFrame = input.endFrame ?? input.targetLastFrame ?? null;
      if (startFrame && !descriptor.frames.start.supported) fail(descriptor, "startFrame is unsupported");
      if (descriptor.frames.start.required && !startFrame) fail(descriptor, "startFrame is required");
      if (endFrame && !descriptor.frames.end.supported) fail(descriptor, "endFrame is unsupported");

      const scenes = input.storyboard ?? input.scenes;
      if (has(input.storyboard) && has(input.scenes)) fail(descriptor, "provide storyboard or scenes, not both");
      if (descriptor.controls.storyboard.required && !scenes) fail(descriptor, "storyboard/scenes are required");

      const payload = {};
      append(payload, mapping.prompt, prompt || undefined);
      append(payload, mapping.sourceImage, input.sourceImage);
      append(payload, mapping.sourceImageList, has(input.sourceImage) ? [input.sourceImage] : undefined);
      append(payload, mapping.sourceVideo, input.sourceVideo);
      append(payload, mapping.sourceVideoList, has(input.sourceVideo) ? [input.sourceVideo] : undefined);
      append(payload, mapping.sourceRequestId, input.sourceRequestId);
      append(payload, mapping.referenceImages, referenceImages.length ? referenceImages.map(String) : undefined);
      append(payload, mapping.referenceVideos, referenceVideos.length ? referenceVideos.map(String) : undefined);
      append(payload, mapping.referenceAudios, referenceAudios.length ? referenceAudios.map(String) : undefined);
      append(payload, mapping.frames, startFrame ? [String(startFrame), ...(endFrame ? [String(endFrame)] : [])] : undefined);
      append(payload, mapping.duration, input.duration);
      append(payload, mapping.aspectRatio, input.aspectRatio);
      append(payload, mapping.resolution, input.resolution);
      append(payload, mapping.quality, input.quality ?? descriptor.quality.fixed);
      append(payload, mapping.generateAudio, audioControl);
      append(payload, mapping.seed, input.seed ?? mapping.defaultSeed);
      append(payload, mapping.storyboard, has(scenes) ? mapStoryboard(descriptor, scenes) : undefined);
      Object.assign(payload, mapModelParameters(descriptor, mapping, input.modelParameters) || {});
      return payload;
    },
  });
}
