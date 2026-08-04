/**
 * Model Registry for Doolphin Platform.
 * Section 7 Compliance: Fact verification, schemas, pricing status, and capabilities.
 */

export const MODEL_REGISTRY = [
  {
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

export function getModelById(internalModelId) {
  return MODEL_REGISTRY.find((m) => m.internalModelId === internalModelId) || null;
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
