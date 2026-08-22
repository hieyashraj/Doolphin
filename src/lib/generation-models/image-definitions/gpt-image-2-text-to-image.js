import { getCuratedCapabilityDescriptor } from "../../models/capabilityDescriptors.js";
import { defineImageModel } from "../image-definition.js";
import { createMuapiImageAdapter } from "../imageAdapterHelpers.js";

const capability = getCuratedCapabilityDescriptor("gpt-image-2-text-to-image");
if (!capability) throw new Error("Curated GPT Image 2 capability descriptor is missing");

export default defineImageModel({
  id: capability.id,
  displayName: "GPT Image 2",
  family: capability.family,
  variant: capability.variant,
  providerModelId: capability.providerId,
  capabilityMetadataRevision: capability.capabilityRevision,
  endpoint: "/api/v1/gpt-image-2-text-to-image",
  estimateCostModelId: capability.providerId,
  adapter: createMuapiImageAdapter(),
  fixedProviderDefaults: { quality: capability.quality.fixed },
  resolutionConstraints: capability.resolutionConstraints,
  providerCapabilities: {
    modes: ["TEXT_TO_IMAGE"],
    references: { min: 0, max: 0, multiple: false },
    aspectRatios: capability.aspectRatios.values,
    outputResolutions: capability.resolutions.values,
    output: { expectedCount: capability.outputCount.max, resultShape: "ASYNC_OUTPUT_URLS" },
  },
  productCapabilities: {
    referenceImages: { visible: false, min: 0, max: 0 },
    aspectRatio: { visible: true, values: capability.aspectRatios.values },
    outputResolution: { visible: true, values: capability.resolutions.values },
    requestedOutputCount: { visible: false, values: [] },
  },
  pricingRevision: "pending-staging-estimate",
  evidence: ["OpenAPI 2026-08-13; curated descriptor is the shared capability authority"],
});
