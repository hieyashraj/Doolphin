export const MODEL_REGISTRY = [
  {
    id: "seedance-2.0-r2v-std",
    internalModelId: "seedance-2.0-r2v-std",
    provider: "muapi",
    displayName: "Seedance 2.0 Standard",
    nativeAudio: true,
    nativeDialogue: true,
    providerModelVersion: "2.0",
    endpoint: "https://api.muapi.ai/v1/video/generate",
    schemaStatus: "SCHEMA_VERIFIED",
    pricingStatus: "VERIFIED",
    outputStatus: "POC_PASSED",
    productionEnabled: true,
    costPerUnitMicroUsd: BigInt(303400),
    capabilities: {
      audioCapability: "NATIVE_DIALOGUE",
      scriptCapability: "VERBATIM_VERIFIED",
      lipSyncCapability: "NATIVE_VERIFIED",
      productFidelity: "DETERMINISTIC_COMPOSITE",
      appUiPolicy: "DETERMINISTIC_OVERLAY_REQUIRED",
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ["9:16", "16:9"],
      maxImageReferences: 3,
    },
  },
  {
    id: "seedance-2.0-r2v-fast",
    internalModelId: "seedance-2.0-r2v-fast",
    provider: "muapi",
    displayName: "Seedance 2.0 Fast",
    nativeAudio: true,
    nativeDialogue: true,
    providerModelVersion: "2.0",
    endpoint: "https://api.muapi.ai/v1/video/generate",
    schemaStatus: "SCHEMA_VERIFIED",
    pricingStatus: "VERIFIED",
    outputStatus: "POC_PASSED",
    productionEnabled: true,
    costPerUnitMicroUsd: BigInt(241900),
    capabilities: {
      audioCapability: "NATIVE_DIALOGUE",
      scriptCapability: "VERBATIM_VERIFIED",
      lipSyncCapability: "NATIVE_VERIFIED",
      productFidelity: "DETERMINISTIC_COMPOSITE",
      appUiPolicy: "DETERMINISTIC_OVERLAY_REQUIRED",
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ["9:16", "16:9"],
      maxImageReferences: 3,
    },
  },
  {
    id: "fal-veo3",
    internalModelId: "fal-veo3",
    provider: "fal",
    providerModelVersion: "veo-3",
    endpoint: "fal-ai/veo3/video-to-video",
    schemaStatus: "SCHEMA_VERIFIED",
    pricingStatus: "VERIFIED",
    outputStatus: "POC_PASSED",
    productionEnabled: true,
    costPerUnitMicroUsd: BigInt(500000), // $0.50 per generation
    capabilities: {
      audioCapability: "AMBIENT",
      scriptCapability: "PROMPT_INFLUENCED",
      lipSyncCapability: "EXTERNAL_REQUIRED",
      productFidelity: "SINGLE_REFERENCE",
      appUiPolicy: "GENERATIVE_BROLL_ONLY",
      supportedDurations: [5, 10],
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      maxImageReferences: 2,
    },
  },
  {
    id: "fal-kling-1.6",
    internalModelId: "fal-kling-1.6",
    provider: "fal",
    providerModelVersion: "1.6",
    endpoint: "fal-ai/kling-video/v1.6/standard/text-to-video",
    schemaStatus: "SCHEMA_VERIFIED",
    pricingStatus: "VERIFIED",
    outputStatus: "POC_PASSED",
    productionEnabled: true,
    costPerUnitMicroUsd: BigInt(350000), // $0.35
    capabilities: {
      audioCapability: "NONE",
      scriptCapability: "PROMPT_INFLUENCED",
      lipSyncCapability: "EXTERNAL_REQUIRED",
      productFidelity: "SINGLE_REFERENCE",
      appUiPolicy: "GENERATIVE_BROLL_ONLY",
      supportedDurations: [5, 10],
      supportedAspectRatios: ["16:9", "9:16", "1:1"],
      maxImageReferences: 1,
    },
  },
  {
    id: "muapi-ugc-actor-v1",
    internalModelId: "muapi-ugc-actor-v1",
    provider: "muapi",
    providerModelVersion: "v1",
    endpoint: "https://api.muapi.ai/v1/video/generate",
    schemaStatus: "SCHEMA_VERIFIED",
    pricingStatus: "VERIFIED",
    outputStatus: "POC_PASSED",
    productionEnabled: true,
    costPerUnitMicroUsd: BigInt(250000), // $0.25
    capabilities: {
      audioCapability: "NATIVE_DIALOGUE",
      scriptCapability: "VERBATIM_VERIFIED",
      lipSyncCapability: "NATIVE_VERIFIED",
      productFidelity: "DETERMINISTIC_COMPOSITE",
      appUiPolicy: "DETERMINISTIC_OVERLAY_REQUIRED",
      supportedDurations: [5, 10, 15],
      supportedAspectRatios: ["9:16", "16:9"],
      maxImageReferences: 3,
    },
  },
];

export const ModelRegistry = {
  find: (fn) => MODEL_REGISTRY.find(fn),
  filter: (fn) => MODEL_REGISTRY.filter(fn),
  getAll: () => MODEL_REGISTRY
};

export function getModelById(internalModelId) {
  return MODEL_REGISTRY.find((m) => m.internalModelId === internalModelId || m.id === internalModelId) || null;
}

export function getModelPriceQuote(internalModelId, duration = 5, resolution = '720p', isHighTier = false) {
  if (internalModelId === 'seedance-2.0-r2v-fast') {
    const ratePerSecondMicroUsd = 241900;
    const baseTotalMicroUsd = duration * ratePerSecondMicroUsd;
    const estimatedMaxMicroUsd = Math.round(baseTotalMicroUsd * 1.10);
    const creditReservationAmount = Math.ceil(estimatedMaxMicroUsd / 10000);
    return {
      ratePerSecondMicroUsd,
      baseTotalMicroUsd,
      estimatedMaxMicroUsd,
      creditReservationAmount
    };
  }
  if (internalModelId === 'seedance-2.0-r2v-std') {
    const ratePerSecondMicroUsd = 303400;
    const baseTotalMicroUsd = duration * ratePerSecondMicroUsd;
    const estimatedMaxMicroUsd = Math.round(baseTotalMicroUsd * 1.10);
    const creditReservationAmount = Math.ceil(estimatedMaxMicroUsd / 10000);
    return {
      ratePerSecondMicroUsd,
      baseTotalMicroUsd,
      estimatedMaxMicroUsd,
      creditReservationAmount
    };
  }
  return { error: 'MODEL_PRICING_UNVERIFIED' };
}

export function listProductionModels() {
  return MODEL_REGISTRY.filter(
    (m) =>
      m.productionEnabled &&
      m.schemaStatus === "SCHEMA_VERIFIED" &&
      m.pricingStatus === "VERIFIED" &&
      m.outputStatus === "POC_PASSED"
  );
}



