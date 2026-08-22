import { GENERATED_MODEL_DEFINITIONS } from "../models/videoModelFactory.js";
import { APP_STUDIO_MODELS } from "../app-studio/config.js";

/**
 * Client/request-contract projection of the authoritative curated model root.
 * Capability values are never independently defaulted here.
 */
function buildEntry(definition) {
  const capability = definition.capabilityDescriptor;
  const requiredSlots = Object.entries(capability.slots)
    .filter(([, slot]) => slot.required)
    .map(([name]) => name);
  if (capability.frames.start.required) requiredSlots.push("startFrame");
  const legacyIds = definition.productPolicy.legacyAliases || [];
  const providerImageCapacity = Math.max(
    capability.slots.sourceImage.max + capability.slots.referenceImages.max,
    capability.frames.start.supported ? 2 : 0,
  );

  return Object.freeze({
    id: definition.productPolicy.id,
    legacyIds: Object.freeze([...legacyIds]),
    displayName: definition.productPolicy.displayName,
    provider: "MUAPI",
    providerModelId: definition.providerSpec.providerModelId,
    endpoint: definition.providerSpec.endpoint,
    adapterVersion: capability.adapterRevision,
    capabilityRevision: capability.capabilityRevision,
    pricingRevision: "2026-08-credit-value-v3",
    generationMode: definition.productPolicy.generationMode,
    studios: definition.productPolicy.studios,
    mode: capability.mode,
    mediaType: capability.mediaType,
    family: capability.family,
    variant: capability.variant,
    referenceCostUsd: definition.providerSpec.cost.amount,
    controls: capability.controls,
    slots: capability.slots,
    requiredSlots: Object.freeze(requiredSlots),
    durationValues: capability.duration.values,
    resolutions: capability.resolutions.values,
    aspectRatios: capability.aspectRatios.values,
    qualityValues: capability.quality.values,
    minDuration: capability.duration.min,
    maxDuration: capability.duration.max,
    // Current UGC workflows count every provider-bound image, including the
    // mandatory actor. Definitions unable to consume that actor are excluded
    // from Studio discovery below.
    maxImages: Math.max(1, providerImageCapacity),
    maxReferences: Object.freeze({
      images: capability.slots.referenceImages.max,
      videos: capability.slots.referenceVideos.max,
      audios: capability.slots.referenceAudios.max,
    }),
    maxAudioReferences: capability.slots.referenceAudios.max,
    supportsNativeAudio: capability.nativeAudio.supported,
    nativeAudio: capability.nativeAudio,
    supportsVideoReferences: capability.slots.referenceVideos.supported,
    outputCount: capability.outputCount,
    confidence: capability.confidence,
    completionStrategy: capability.completionStrategy,
    finalizerStrategy: capability.finalizerStrategy,
    requiresImage: requiredSlots.some((name) => ["sourceImage", "referenceImages", "startFrame"].includes(name)),
    requiresVideo: requiredSlots.includes("sourceVideo"),
  });
}

const VIDEO_DEFINITIONS = GENERATED_MODEL_DEFINITIONS.filter(
  (definition) => definition.productPolicy.mediaType === "VIDEO" &&
    definition.productPolicy.curated &&
    definition.productPolicy.studioReady &&
    definition.productPolicy.studios.includes("video-studio") &&
    definition.capabilityDescriptor?.dispatchable
);

export const GENERATION_MODELS = Object.freeze(
  Object.fromEntries(VIDEO_DEFINITIONS.map(buildEntry).map((entry) => [entry.id, entry]))
);

export function getGenerationModel(modelId) {
  if (GENERATION_MODELS[modelId]) return GENERATION_MODELS[modelId];
  return Object.values(GENERATION_MODELS).find(
    (model) => model.providerModelId === modelId || model.legacyIds.includes(modelId)
  ) || null;
}

export function listAppStudioGenerationModels() {
  return APP_STUDIO_MODELS.map((configured) => {
    const model = getGenerationModel(configured.id);
    if (!model || !model.studios.includes("app-studio")) return null;
    return {
      id: model.id,
      name: configured.name,
      description: configured.description,
      provider: model.provider,
      providerModelId: model.providerModelId,
      generationMode: model.generationMode,
      studios: model.studios,
      mode: model.mode,
      family: model.family,
      variant: model.variant,
      referenceCostUsd: model.referenceCostUsd,
      controls: model.controls,
      slots: model.slots,
      requiredSlots: model.requiredSlots,
      durationValues: model.durationValues,
      resolutions: model.resolutions,
      aspectRatios: model.aspectRatios,
      qualityValues: model.qualityValues,
      minDuration: model.minDuration,
      maxDuration: model.maxDuration,
      maxImages: model.maxImages,
      maxReferences: model.maxReferences,
      nativeAudio: model.nativeAudio,
      outputCount: model.outputCount,
      confidence: model.confidence,
      requiresImage: model.requiresImage,
      requiresVideo: model.requiresVideo,
    };
  }).filter(Boolean);
}

export function listGenerationModels() {
  return Object.values(GENERATION_MODELS).map((model) => ({
    id: model.id,
    name: model.displayName,
    description: `${model.family} · ${model.variant}`,
    provider: model.provider,
    providerModelId: model.providerModelId,
    generationMode: model.generationMode,
    studios: model.studios,
    mode: model.mode,
    family: model.family,
    variant: model.variant,
    referenceCostUsd: model.referenceCostUsd,
    controls: model.controls,
    slots: model.slots,
    requiredSlots: model.requiredSlots,
    durationValues: model.durationValues,
    resolutions: model.resolutions,
    aspectRatios: model.aspectRatios,
    qualityValues: model.qualityValues,
    minDuration: model.minDuration,
    maxDuration: model.maxDuration,
    maxImages: model.maxImages,
    maxReferences: model.maxReferences,
    nativeAudio: model.nativeAudio,
    outputCount: model.outputCount,
    confidence: model.confidence,
    requiresImage: model.requiresImage,
    requiresVideo: model.requiresVideo,
  }));
}
