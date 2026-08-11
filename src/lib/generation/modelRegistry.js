export const GENERATION_MODELS = Object.freeze({
  "muapi.seedance2.omni-reference-fast": Object.freeze({
    id: "muapi.seedance2.omni-reference-fast",
    legacyIds: ["seedance-2"],
    displayName: "Seedance 2 Omni Reference Fast",
    provider: "MUAPI",
    endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
    adapterVersion: "2.0.0",
    capabilityRevision: "2026-08-08",
    pricingRevision: "2026-08-08",
    resolutions: ["720p"],
    aspectRatios: ["9:16", "16:9", "3:4", "4:3"],
    minDuration: 4,
    maxDuration: 15,
    maxImages: 9,
    maxAudioReferences: 3,
    supportsNativeAudio: true,
    supportsVideoReferences: false,
    flatGenerationCredits: 75,
    analysisCreditsPerAsset: 1,
    verificationCreditsPerVariant: 2,
  }),
});

export function getGenerationModel(modelId) {
  if (GENERATION_MODELS[modelId]) return GENERATION_MODELS[modelId];
  return Object.values(GENERATION_MODELS).find((model) => model.legacyIds.includes(modelId)) || null;
}

export function listGenerationModels() {
  return Object.values(GENERATION_MODELS).map((model) => ({
    id: model.id,
    name: model.displayName,
    provider: model.provider,
    resolutions: model.resolutions,
    aspectRatios: model.aspectRatios,
    minDuration: model.minDuration,
    maxDuration: model.maxDuration,
    maxImages: model.maxImages,
  }));
}
