import { GENERATED_MODEL_DEFINITIONS, STUDIO_ASPECT_RATIOS } from "../models/videoModelFactory.js";

/**
 * THE MODEL BENCH THE STUDIO UI AND THE REQUEST CONTRACT SHARE.
 *
 * src/lib/generation/contract.js validates every submission against the entry it
 * finds here (resolution, aspect ratio, duration, image count), and CreationHub
 * renders its model picker from listGenerationModels(). Those two facts make this
 * the single place that decides which models a user can actually pick and submit.
 *
 * It used to contain exactly ONE hardcoded model, which is why the Video Studio
 * offered a single option while the app claimed a "world-class creative bench".
 * It is now derived from the provider's own catalog export (see
 * scripts/generate-model-catalog.mjs and ../models/videoModelFactory.js), so the
 * full video bench is selectable and every entry resolves to a real, priceable,
 * dispatchable model definition.
 *
 * CAPABILITY VALUES: the provider export publishes no per-model resolution,
 * duration or reference limits. Rather than invent per-model numbers, generated
 * entries carry conservative platform-wide defaults, and any model whose real
 * limits we have verified is overridden explicitly in HAND_VERIFIED below.
 * Conservative here means "the studio will not offer a setting we cannot stand
 * behind" — the provider still validates, and pricing always comes from the live
 * estimate, so an over-permissive default could waste a paid generation.
 */

/** Platform defaults for a generated video entry. Deliberately conservative. */
const DEFAULT_VIDEO_CAPABILITIES = Object.freeze({
  resolutions: Object.freeze(["720p"]),
  aspectRatios: Object.freeze([...STUDIO_ASPECT_RATIOS]),
  minDuration: 4,
  maxDuration: 10,
  maxImages: 1,
  maxAudioReferences: 0,
  supportsNativeAudio: false,
  supportsVideoReferences: false,
});

/**
 * Models whose real capabilities are verified, so they may exceed the defaults.
 * Keyed by provider model id. Seedance 2 Omni's values come from its hand-authored
 * definition (720p-only endpoint, 9 image references, native audio, 4-15s).
 */
const HAND_VERIFIED = Object.freeze({
  "seedance-2-omni-reference-no-video-fast": {
    id: "muapi.seedance2.omni-reference-fast",
    legacyIds: ["seedance-2", "seedance2-fast"],
    resolutions: ["720p"],
    aspectRatios: ["9:16", "16:9", "3:4", "4:3"],
    minDuration: 4,
    maxDuration: 15,
    maxImages: 9,
    maxAudioReferences: 3,
    supportsNativeAudio: true,
    supportsVideoReferences: false,
  },
  "seedance-2.5-spicy-video-extend-480p": {
    id: "muapi.seedance-2.5-spicy-video-extend-480p",
    legacyIds: ["seedance-extend", "seedance-2.5-spicy"],
    resolutions: ["480p"],
    minDuration: 4,
    maxDuration: 30,
    supportsVideoReferences: true,
  },
});

/** A model whose mode needs a source image can accept at least one reference. */
function imageCapacityFor(definition) {
  const mode = definition.productPolicy.generationMode;
  if (mode === "image-to-video") return 2; // one avatar/subject plus one reference
  return DEFAULT_VIDEO_CAPABILITIES.maxImages;
}

function buildEntry(definition) {
  const providerModelId = definition.providerSpec.providerModelId;
  const override = HAND_VERIFIED[providerModelId] || {};
  return Object.freeze({
    id: override.id || definition.productPolicy.id,
    legacyIds: Object.freeze(override.legacyIds || []),
    displayName: definition.productPolicy.displayName,
    provider: "MUAPI",
    endpoint: definition.providerSpec.endpoint,
    adapterVersion: "2.0.0",
    capabilityRevision: "2026-08-catalog-v1",
    pricingRevision: "2026-08-credit-value-v3",
    generationMode: definition.productPolicy.generationMode,
    mediaType: definition.productPolicy.mediaType,
    family: definition.productPolicy.family,
    referenceCostUsd: definition.providerSpec.cost.amount,
    resolutions: Object.freeze(override.resolutions || [...DEFAULT_VIDEO_CAPABILITIES.resolutions]),
    aspectRatios: Object.freeze(override.aspectRatios || [...DEFAULT_VIDEO_CAPABILITIES.aspectRatios]),
    minDuration: override.minDuration ?? DEFAULT_VIDEO_CAPABILITIES.minDuration,
    maxDuration: override.maxDuration ?? DEFAULT_VIDEO_CAPABILITIES.maxDuration,
    maxImages: override.maxImages ?? imageCapacityFor(definition),
    maxAudioReferences: override.maxAudioReferences ?? DEFAULT_VIDEO_CAPABILITIES.maxAudioReferences,
    supportsNativeAudio: override.supportsNativeAudio ?? DEFAULT_VIDEO_CAPABILITIES.supportsNativeAudio,
    supportsVideoReferences: override.supportsVideoReferences ?? DEFAULT_VIDEO_CAPABILITIES.supportsVideoReferences,
    requiresImage: definition.productPolicy.generationMode === "image-to-video",
    requiresVideo: definition.productPolicy.generationMode === "video-extend",
  });
}

const VIDEO_DEFINITIONS = GENERATED_MODEL_DEFINITIONS.filter(
  (definition) => definition.productPolicy.mediaType === "VIDEO"
);

export const GENERATION_MODELS = Object.freeze(
  Object.fromEntries(VIDEO_DEFINITIONS.map(buildEntry).map((entry) => [entry.id, entry]))
);

export function getGenerationModel(modelId) {
  if (GENERATION_MODELS[modelId]) return GENERATION_MODELS[modelId];
  return Object.values(GENERATION_MODELS).find((model) => model.legacyIds.includes(modelId)) || null;
}

export function listGenerationModels() {
  return Object.values(GENERATION_MODELS).map((model) => ({
    id: model.id,
    name: model.displayName,
    description: model.family ? `${model.family} · ${model.generationMode.replace(/-/g, " ")}` : model.generationMode.replace(/-/g, " "),
    provider: model.provider,
    generationMode: model.generationMode,
    family: model.family,
    referenceCostUsd: model.referenceCostUsd,
    resolutions: model.resolutions,
    aspectRatios: model.aspectRatios,
    minDuration: model.minDuration,
    maxDuration: model.maxDuration,
    maxImages: model.maxImages,
    requiresImage: model.requiresImage,
    requiresVideo: model.requiresVideo,
  }));
}
