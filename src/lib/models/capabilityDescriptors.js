import portfolio from "./catalog/curated-generation-portfolio.json" with { type: "json" };
import catalog from "./catalog/muapi-model-catalog.json" with { type: "json" };

export const CAPABILITY_DESCRIPTOR_REVISION = "2026-08-capabilities-v1";
export const MODEL_ADAPTER_REVISION = "2026-08-muapi-adapters-v1";

const RATIOS_STANDARD = ["16:9", "9:16", "1:1"];
const RATIOS_EXTENDED = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function slot(type, { supported = false, required = false, min = 0, max = 0, semanticRole = "UNSUPPORTED" } = {}) {
  return { type, supported, required, min, max, semanticRole };
}

function fixedResolution(providerModelId) {
  if (providerModelId.includes("-4k")) return ["4k"];
  if (providerModelId.includes("-1080p")) return ["1080p"];
  if (providerModelId.includes("-480p")) return ["480p"];
  return [];
}

function familyDefaults(family, providerModelId) {
  if (family === "seedance") {
    const is25 = providerModelId.startsWith("seedance-2.5");
    const fixed = fixedResolution(providerModelId);
    return {
      duration: { supported: true, values: [], min: 4, max: is25 ? 30 : 15, unit: "SECONDS" },
      aspectRatios: RATIOS_EXTENDED,
      resolutions: fixed.length ? fixed : ["720p"],
    };
  }
  if (family === "veo") {
    const is4 = providerModelId.startsWith("veo-4");
    const fixed = fixedResolution(providerModelId);
    return {
      duration: is4
        ? { supported: true, values: [], min: 5, max: 30, unit: "SECONDS" }
        : { supported: true, values: [8], min: 8, max: 8, unit: "SECONDS" },
      aspectRatios: is4 ? RATIOS_STANDARD : ["16:9", "9:16"],
      resolutions: fixed.length ? fixed : ["720p"],
    };
  }
  if (family === "kling") {
    const fixed = fixedResolution(providerModelId);
    return {
      duration: { supported: true, values: [], min: 3, max: 15, unit: "SECONDS" },
      aspectRatios: RATIOS_STANDARD,
      resolutions: fixed.length ? fixed : ["720p"],
    };
  }
  if (family === "sora") {
    return {
      duration: { supported: true, values: [10, 15], min: 10, max: 15, unit: "SECONDS" },
      aspectRatios: ["16:9", "9:16"],
      resolutions: ["720p"],
    };
  }
  if (family === "grok") {
    return {
      duration: { supported: true, values: [], min: 6, max: 30, unit: "SECONDS" },
      aspectRatios: ["2:3", "3:2", "1:1", "16:9", "9:16"],
      resolutions: ["480p", "720p"],
    };
  }
  return {
    duration: { supported: false, values: [], min: null, max: null, unit: "SECONDS" },
    aspectRatios: [],
    resolutions: [],
  };
}

function normalizedMode(entry, providerModelId) {
  if (providerModelId.includes("storyboard")) return "storyboard-to-video";
  if (providerModelId.includes("first-last-frame")) return "first-last-frame-to-video";
  if (providerModelId.includes("motion-control")) return "motion-control";
  if (providerModelId.includes("video-edit")) return "video-edit";
  if (providerModelId.includes("extend")) return "video-extend";
  if (providerModelId.includes("reference") || providerModelId.includes("omni")) return "reference-to-video";
  return entry.mode;
}

function canonicalId(providerModelId) {
  if (providerModelId === "seedance-2-omni-reference-no-video-fast") return "muapi.seedance2.omni-reference-fast";
  if (providerModelId === "gpt-image-2-text-to-image") return "muapi.gpt-image-2-t2i";
  return `muapi.${providerModelId}`;
}

function baseDescriptor(family, selected, entry) {
  const providerModelId = selected.providerModelId;
  const mode = normalizedMode(entry, providerModelId);
  const defaults = familyDefaults(family, providerModelId);
  const imageMode = entry.mode === "image-to-video";
  const videoEdit = mode === "video-edit";
  const videoExtend = mode === "video-extend";
  const motionControl = mode === "motion-control";
  const firstLast = mode === "first-last-frame-to-video";
  const multiReference = mode === "reference-to-video" || providerModelId.includes("omni");
  const sourceImageRequired = imageMode && !firstLast && !multiReference;
  const extensionReferences = videoExtend && family === "seedance";
  const referenceImagesMax = extensionReferences
    ? 8
    : multiReference
    ? (family === "seedance" ? 9 : family === "kling" ? 4 : 3)
    : 0;
  const resolutionValues = defaults.resolutions.length ? defaults.resolutions : [];

  return {
    id: canonicalId(providerModelId),
    family,
    variant: selected.variant,
    mediaType: entry.mediaType,
    mode,
    generationMode: entry.mode,
    controls: {
      prompt: { supported: mode !== "storyboard-to-video", required: !imageMode || family !== "veo", maxLength: family === "gpt-image-2" ? 20000 : 5000 },
      script: { supported: false, required: false },
      additionalInstructions: { supported: false, required: false },
      sourceRequestId: { supported: videoExtend, required: videoExtend },
      seed: { supported: providerModelId.startsWith("seedance-2.5"), required: false },
      storyboard: { supported: mode === "storyboard-to-video", required: mode === "storyboard-to-video", minScenes: mode === "storyboard-to-video" ? 1 : 0, maxScenes: mode === "storyboard-to-video" ? 30 : 0 },
    },
    slots: {
      sourceImage: slot("IMAGE", { supported: sourceImageRequired || motionControl, required: sourceImageRequired || motionControl, min: sourceImageRequired || motionControl ? 1 : 0, max: sourceImageRequired || motionControl ? 1 : 0, semanticRole: sourceImageRequired || motionControl ? "SOURCE_FRAME" : "UNSUPPORTED" }),
      sourceVideo: slot("VIDEO", { supported: videoEdit || motionControl, required: videoEdit || motionControl, min: videoEdit || motionControl ? 1 : 0, max: videoEdit || motionControl ? 1 : 0, semanticRole: videoEdit ? "EDIT_SOURCE" : motionControl ? "MOTION_SOURCE" : "UNSUPPORTED" }),
      referenceImages: slot("IMAGE", { supported: referenceImagesMax > 0, required: referenceImagesMax > 0 && family !== "seedance", min: referenceImagesMax > 0 && family !== "seedance" ? 1 : 0, max: referenceImagesMax, semanticRole: referenceImagesMax ? "VISUAL_REFERENCE" : "UNSUPPORTED" }),
      referenceVideos: slot("VIDEO", { supported: extensionReferences, required: false, min: 0, max: extensionReferences ? 3 : 0, semanticRole: extensionReferences ? "MOTION_REFERENCE" : "UNSUPPORTED" }),
      referenceAudios: slot("AUDIO", { supported: extensionReferences, required: false, min: 0, max: extensionReferences ? 3 : 0, semanticRole: extensionReferences ? "AUDIO_REFERENCE" : "UNSUPPORTED" }),
    },
    frames: {
      start: { supported: firstLast, required: firstLast, semanticRole: firstLast ? "FIRST_FRAME" : "UNSUPPORTED" },
      end: { supported: firstLast, required: false, semanticRole: firstLast ? "LAST_FRAME" : "UNSUPPORTED" },
    },
    duration: defaults.duration,
    aspectRatios: { supported: defaults.aspectRatios.length > 0, values: defaults.aspectRatios },
    resolutions: { supported: resolutionValues.length > 0, values: resolutionValues, endpointFixed: resolutionValues.length === 1 },
    resolutionConstraints: { byAspectRatio: {} },
    quality: { supported: false, values: [], fixed: null },
    nativeAudio: { supported: false, controllable: false, default: null },
    cameraMotion: { supported: false, mode: "PROMPT_ONLY", controls: [] },
    modelParameters: { supported: false, allowlist: {} },
    outputCount: { min: 1, max: entry.mediaType === "VIDEO" ? 2 : 1 },
    providerId: providerModelId,
    adapterRevision: MODEL_ADAPTER_REVISION,
    capabilityRevision: CAPABILITY_DESCRIPTOR_REVISION,
    completionStrategy: entry.mediaType === "VIDEO" ? "MUAPI_AUTHENTICATED_ASYNC_VIDEO_V1" : "MUAPI_AUTHENTICATED_ASYNC_IMAGE_V1",
    finalizerStrategy: entry.mediaType === "VIDEO" ? "DOOLPHIN_VIDEO_QUALITY_PIPELINE_V1" : "DOOLPHIN_IMAGE_ATOMIC_V1",
    confidence: "DERIVED",
    // A derived descriptor is useful for grouping and product planning, but it
    // must not authorize a paid provider call. Only models with a reviewed
    // provider mapping in VERIFIED become dispatchable below.
    dispatchable: false,
    studioReady: false,
  };
}

const VERIFIED = {
  "seedance-2.5-omni-reference": {
    slots: {
      referenceImages: slot("IMAGE", { supported: true, min: 0, max: 30, semanticRole: "VISUAL_REFERENCE" }),
      referenceVideos: slot("VIDEO", { supported: true, min: 0, max: 10, semanticRole: "MOTION_REFERENCE" }),
      referenceAudios: slot("AUDIO", { supported: true, min: 0, max: 10, semanticRole: "AUDIO_REFERENCE" }),
    },
    duration: { supported: true, values: [], min: 4, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"] },
    resolutions: { supported: true, values: ["720p"], endpointFixed: true },
    nativeAudio: { supported: true, controllable: true, default: true },
  },
  "seedance-2-omni-reference-no-video-fast": {
    slots: {
      referenceImages: slot("IMAGE", { supported: true, min: 0, max: 9, semanticRole: "VISUAL_REFERENCE" }),
      referenceAudios: slot("AUDIO", { supported: true, min: 0, max: 3, semanticRole: "AUDIO_REFERENCE" }),
    },
    duration: { supported: true, values: [], min: 4, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "4:3", "3:4"] },
    resolutions: { supported: true, values: ["720p"], endpointFixed: true },
    nativeAudio: { supported: true, controllable: true, default: true },
  },
  "seedance-2-omni-reference": {
    slots: {
      referenceImages: slot("IMAGE", { supported: true, min: 0, max: 9, semanticRole: "VISUAL_REFERENCE" }),
      referenceVideos: slot("VIDEO", { supported: true, min: 0, max: 3, semanticRole: "MOTION_REFERENCE" }),
      referenceAudios: slot("AUDIO", { supported: true, min: 0, max: 3, semanticRole: "AUDIO_REFERENCE" }),
    },
    duration: { supported: true, values: [], min: 4, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] },
    quality: { supported: true, values: ["basic", "high"], fixed: "high" },
    nativeAudio: { supported: true, controllable: true, default: true },
  },
  "seedance-2-first-last-frame": {
    studioReady: false,
    controls: { prompt: { supported: true, required: true, maxLength: 5000 } },
    slots: { referenceImages: slot("IMAGE") },
    frames: {
      start: { supported: true, required: true, semanticRole: "FIRST_FRAME" },
      end: { supported: true, required: false, semanticRole: "LAST_FRAME" },
    },
    duration: { supported: true, values: [], min: 4, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] },
    resolutions: { supported: true, values: ["2k"], endpointFixed: true },
  },
  "seedance-2.5-text-to-video-4k": {
    controls: { seed: { supported: true, required: false } },
    duration: { supported: true, values: [], min: 1, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] },
    resolutions: { supported: true, values: ["4k"], endpointFixed: true },
    modelParameters: { supported: false, allowlist: {} },
  },
  "seedance-2.5-video-edit": {
    studioReady: false,
    controls: { seed: { supported: true, required: false } },
    slots: {
      sourceVideo: slot("VIDEO", { supported: true, required: true, min: 1, max: 1, semanticRole: "EDIT_SOURCE" }),
      referenceImages: slot("IMAGE", { supported: true, min: 0, max: 30, semanticRole: "VISUAL_REFERENCE" }),
      referenceAudios: slot("AUDIO", { supported: true, min: 0, max: 10, semanticRole: "AUDIO_REFERENCE" }),
    },
    duration: { supported: true, values: [], min: 4, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] },
    resolutions: { supported: true, values: ["720p"], endpointFixed: true },
    nativeAudio: { supported: true, controllable: true, default: true },
  },
  "veo-4-text-to-video": {
    duration: { supported: true, values: [], min: 5, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1"] },
    resolutions: { supported: true, values: ["1080p"], endpointFixed: true },
    cameraMotion: { supported: false, mode: "PROMPT_ONLY", controls: [] },
  },
  "veo-4-image-to-video": {
    controls: { prompt: { supported: true, required: false, maxLength: 5000 } },
    slots: { sourceImage: slot("IMAGE", { supported: true, required: true, min: 1, max: 1, semanticRole: "SOURCE_FRAME" }) },
    duration: { supported: true, values: [], min: 5, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1"] },
    resolutions: { supported: true, values: ["1080p"], endpointFixed: true },
    cameraMotion: { supported: false, mode: "PROMPT_ONLY", controls: [] },
  },
  "veo3.1-fast-text-to-video": {
    duration: { supported: true, values: [8], min: 8, max: 8, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16"] },
    resolutions: { supported: true, values: ["720p", "1080p"], endpointFixed: false },
  },
  "veo3.1-reference-to-video": {
    slots: { referenceImages: slot("IMAGE", { supported: true, required: true, min: 1, max: 3, semanticRole: "VISUAL_REFERENCE" }) },
    duration: { supported: true, values: [8], min: 8, max: 8, unit: "SECONDS" },
    aspectRatios: { supported: false, values: [] },
    resolutions: { supported: true, values: ["720p", "1080p"], endpointFixed: false },
    nativeAudio: { supported: true, controllable: true, default: true },
  },
  "veo3.1-extend-video": {
    studioReady: false,
    controls: {
      prompt: { supported: true, required: true, maxLength: 5000 },
      sourceRequestId: { supported: true, required: true },
    },
    slots: { sourceVideo: slot("VIDEO") },
    duration: { supported: true, values: [], min: 1, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16"] },
    resolutions: { supported: true, values: ["720p", "1080p"], endpointFixed: false },
  },
  "kling-v3.0-omni-4k-image-to-video": {
    slots: {
      sourceImage: slot("IMAGE"),
      referenceImages: slot("IMAGE", { supported: true, required: true, min: 1, max: 4, semanticRole: "VISUAL_REFERENCE" }),
    },
    duration: { supported: true, values: [], min: 3, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16", "1:1"] },
    resolutions: { supported: true, values: ["4k"], endpointFixed: true },
    nativeAudio: { supported: true, controllable: false, default: true },
  },
  "openai-sora-2-pro-storyboard": {
    studioReady: false,
    controls: {
      prompt: { supported: false, required: false, maxLength: 0 },
      storyboard: { supported: true, required: true, minScenes: 1, maxScenes: 30 },
    },
    slots: { referenceImages: slot("IMAGE", { supported: true, required: false, min: 0, max: 1, semanticRole: "STORYBOARD_REFERENCE" }) },
    duration: { supported: true, values: [10, 15], min: 10, max: 15, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["16:9", "9:16"] },
  },
  "grok-imagine-text-to-video": {
    duration: { supported: true, values: [], min: 6, max: 30, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["2:3", "3:2", "1:1", "16:9", "9:16"] },
    resolutions: { supported: true, values: ["480p", "720p"], endpointFixed: false },
    nativeAudio: { supported: true, controllable: false, default: true },
    modelParameters: {
      supported: true,
      allowlist: {
        mode: { type: "enum", values: ["normal", "fun", "spicy"] },
      },
    },
  },
  "gpt-image-2-text-to-image": {
    duration: { supported: false, values: [], min: null, max: null, unit: "SECONDS" },
    aspectRatios: { supported: true, values: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] },
    resolutions: { supported: true, values: ["1K", "2K", "4K"], endpointFixed: false },
    resolutionConstraints: { byAspectRatio: { auto: ["1K"], "1:1": ["1K", "2K"] } },
    quality: { supported: false, values: [], fixed: "high" },
    outputCount: { min: 1, max: 1 },
  },
};

function mergeDescriptor(base, override) {
  return {
    ...base,
    ...(override || {}),
    controls: { ...base.controls, ...(override?.controls || {}) },
    slots: { ...base.slots, ...(override?.slots || {}) },
    frames: { ...base.frames, ...(override?.frames || {}) },
    confidence: override ? "VERIFIED" : base.confidence,
    dispatchable: Boolean(override),
    studioReady: Boolean(override) && override.studioReady !== false,
  };
}

const descriptors = [];
for (const [family, variants] of Object.entries(portfolio.families)) {
  for (const selected of variants) {
    const entry = catalog.models[selected.providerModelId];
    if (!entry) throw new Error(`[CuratedPortfolio] Provider model '${selected.providerModelId}' is missing from the reconciled catalog`);
    const override = VERIFIED[selected.providerModelId];
    descriptors.push(deepFreeze(mergeDescriptor(baseDescriptor(family, selected, entry), override)));
  }
}

export const CURATED_MODEL_PORTFOLIO = deepFreeze(portfolio);
export const CURATED_CAPABILITY_DESCRIPTORS = Object.freeze(descriptors);
export const CURATED_CAPABILITIES_BY_PROVIDER_ID = Object.freeze(Object.fromEntries(descriptors.map((item) => [item.providerId, item])));
export const CURATED_CAPABILITIES_BY_ID = Object.freeze(Object.fromEntries(descriptors.map((item) => [item.id, item])));

export function getCuratedCapabilityDescriptor(modelId) {
  if (!modelId) return null;
  return CURATED_CAPABILITIES_BY_ID[modelId] || CURATED_CAPABILITIES_BY_PROVIDER_ID[modelId] ||
    descriptors.find((item) => item.providerId === modelId || (item.providerId === "seedance-2-omni-reference-no-video-fast" && ["seedance-2", "seedance2-fast"].includes(modelId))) || null;
}
