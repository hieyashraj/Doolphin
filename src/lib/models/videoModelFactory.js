import catalog from "./catalog/muapi-model-catalog.json" with { type: "json" };
import {
  CURATED_MODEL_PORTFOLIO,
  CURATED_CAPABILITY_DESCRIPTORS,
} from "./capabilityDescriptors.js";
import { createCuratedMuapiPayloadAdapter } from "./curatedMuapiAdapters.js";

/**
 * Curated generation definitions.
 *
 * The checked-in DOCX allowlist is the product boundary; the broader provider
 * export remains pricing/endpoint reconciliation evidence only. Provider field
 * spellings are delegated to curatedMuapiAdapters.js and never inferred here.
 */
export const STUDIO_ASPECT_RATIOS = Object.freeze(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "adaptive", "2:3", "3:2"]);

function infraReserveMicroUsd(entry) {
  return entry.mediaType === "VIDEO" ? 20_000n : 5_000n;
}

function legacyAliases(descriptor) {
  if (descriptor.providerId === "seedance-2-omni-reference-no-video-fast") return ["seedance-2", "seedance2-fast"];
  if (descriptor.providerId === "gpt-image-2-text-to-image") return ["gpt-image-2-text-to-image"];
  return [];
}

function workflowCompatibleStudios(descriptor, entry) {
  if (entry.mediaType !== "VIDEO") return ["image-studio"];
  const imageCapacity = descriptor.slots.sourceImage.max + descriptor.slots.referenceImages.max;
  const studios = [];
  // The current UGC forms always require one actor image. Product and App
  // additionally require at least one provider-consumable workflow image.
  if (imageCapacity >= 1) studios.push("video-studio");
  if (imageCapacity >= 2) studios.push("product-studio", "app-studio");
  return studios;
}

function buildDefinition(descriptor, displayOrder) {
  const entry = catalog.models[descriptor.providerId];
  if (!entry) throw new Error(`[CuratedPortfolio] '${descriptor.providerId}' did not reconcile to the provider catalog`);
  const adapter = createCuratedMuapiPayloadAdapter(descriptor);
  const definition = {
    providerSpec: Object.freeze({
      providerModelId: entry.providerModelId,
      endpoint: entry.endpoint,
      category: entry.mediaType === "VIDEO" ? "video-generation" : "image-generation",
      description: entry.description,
      cost: Object.freeze({ amount: entry.cost, currency: entry.costCurrency }),
      dynamicPricing: entry.dynamicPricing,
      estimateEndpoint: entry.estimateEndpoint,
      // Runtime normalized validation is descriptor-driven. A live provider
      // schema may still replace this metadata in registry.js, but never changes
      // the reviewed canonical-to-provider adapter.
      inputSchema: Object.freeze({ type: "object" }),
    }),
    productPolicy: Object.freeze({
      id: descriptor.id,
      displayName: entry.displayName,
      studios: Object.freeze(workflowCompatibleStudios(descriptor, entry)),
      generationMode: entry.mode,
      normalizedMode: descriptor.mode,
      enabled: descriptor.dispatchable,
      displayOrder,
      description: entry.description,
      legacyAliases: Object.freeze(legacyAliases(descriptor)),
      family: descriptor.family,
      variant: descriptor.variant,
      mediaType: entry.mediaType,
      curated: true,
      studioReady: descriptor.studioReady,
    }),
    businessPolicy: Object.freeze({
      targetContributionMarginBps: 3000,
      variableInfraCostMicroUsd: infraReserveMicroUsd(entry),
      minimumCredits: 1,
    }),
    capabilityDescriptor: descriptor,
    adapter,
    toProviderPayload: adapter.toProviderPayload,
  };
  return Object.freeze(definition);
}

export const CATALOG_REVISION = CURATED_MODEL_PORTFOLIO.revision;

export const GENERATED_MODEL_DEFINITIONS = Object.freeze(
  CURATED_CAPABILITY_DESCRIPTORS.map((descriptor, index) => buildDefinition(descriptor, 100 + index))
);

export const GENERATED_MODELS_BY_ID = Object.freeze(
  Object.fromEntries(GENERATED_MODEL_DEFINITIONS.map((definition) => [definition.productPolicy.id, definition]))
);

export function listGeneratedModelsByStudio(studio) {
  return GENERATED_MODEL_DEFINITIONS.filter(
    (definition) => definition.productPolicy.curated && definition.productPolicy.enabled && definition.productPolicy.studioReady && definition.productPolicy.studios.includes(studio)
  );
}

/** Serializable normalized projection for API clients. */
export function toClientModel(definition) {
  const { productPolicy, providerSpec, capabilityDescriptor: capability } = definition;
  const requiredSlots = Object.entries(capability.slots)
    .filter(([, value]) => value.required)
    .map(([name]) => name);
  if (capability.frames.start.required) requiredSlots.push("startFrame");
  return {
    id: productPolicy.id,
    name: productPolicy.displayName,
    description: productPolicy.description,
    mode: capability.mode,
    generationMode: productPolicy.generationMode,
    mediaType: productPolicy.mediaType,
    family: capability.family,
    variant: capability.variant,
    referenceCostUsd: providerSpec.cost.amount,
    dynamicPricing: providerSpec.dynamicPricing,
    controls: capability.controls,
    slots: capability.slots,
    requiredSlots,
    durationValues: capability.duration.values,
    minDuration: capability.duration.min,
    maxDuration: capability.duration.max,
    aspectRatios: capability.aspectRatios.values,
    resolutions: capability.resolutions.values,
    qualityValues: capability.quality.values,
    nativeAudio: capability.nativeAudio,
    maxReferences: {
      images: capability.slots.referenceImages.max,
      videos: capability.slots.referenceVideos.max,
      audios: capability.slots.referenceAudios.max,
    },
    outputCount: capability.outputCount,
    confidence: capability.confidence,
    adapterRevision: capability.adapterRevision,
    completionStrategy: capability.completionStrategy,
    finalizerStrategy: capability.finalizerStrategy,
    requiresImage: requiredSlots.some((name) => ["sourceImage", "referenceImages", "startFrame"].includes(name)),
    requiresVideo: requiredSlots.includes("sourceVideo"),
  };
}
