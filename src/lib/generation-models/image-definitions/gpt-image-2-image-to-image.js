import { getCuratedCapabilityDescriptor } from "../../models/capabilityDescriptors.js";
import { defineImageModel } from "../image-definition.js";
import { createMuapiImageAdapter } from "../imageAdapterHelpers.js";

const capability = getCuratedCapabilityDescriptor("gpt-image-2-text-to-image");
if (!capability) throw new Error("Curated GPT Image 2 capability descriptor is missing");

export default defineImageModel({
  id: "muapi.gpt-image-2-i2i",
  displayName: "GPT Image 2 Edit",
  family: capability.family,
  variant: "Image to Image",
  providerModelId: "gpt-image-2-image-to-image",
  capabilityMetadataRevision: capability.capabilityRevision,
  endpoint: "/api/v1/gpt-image-2-image-to-image",
  estimateCostModelId: "gpt-image-2-image-to-image",
  adapter: createMuapiImageAdapter({ requiredReferences: true }),
  fixedProviderDefaults: { quality: capability.quality.fixed },
  resolutionConstraints: capability.resolutionConstraints,
  providerCapabilities: {
    modes: ["IMAGE_TO_IMAGE"],
    references: { min: 1, max: 16, multiple: true },
    aspectRatios: capability.aspectRatios.values,
    outputResolutions: capability.resolutions.values,
    output: { expectedCount: capability.outputCount.max, resultShape: "ASYNC_OUTPUT_URLS" },
  },
  productCapabilities: {
    referenceImages: { visible: true, min: 1, max: 16 },
    aspectRatio: { visible: true, values: capability.aspectRatios.values },
    outputResolution: { visible: true, values: capability.resolutions.values },
    requestedOutputCount: { visible: false, values: [] },
  },
  pricingRevision: "pending-staging-estimate",
  evidence: ["OpenAPI 2026-08-13", "/api/v1/models/gpt-image-2-image-to-image 2026-08-13"],
});
