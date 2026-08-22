import { z } from "zod";

export const imageGenerationV1Schema = z.object({
  version: z.literal("image-generation.v1"),
  modelId: z.string().min(1),
  prompt: z.string().trim().min(1).max(20_000),
  referenceAssetIds: z.array(z.string().min(1)).max(16).optional().default([]),
  exploreImageIds: z.array(z.string().min(1)).max(16).optional().default([]),
  aspectRatio: z.string().optional(),
  outputResolution: z.enum(["1K", "2K", "4K"]).optional(),
  requestedOutputCount: z.number().int().min(1).max(4).optional(),
}).strict();

export function validateImageRequest(definition, input) {
  const parsed = imageGenerationV1Schema.safeParse(input);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map((issue) => ({ code: "INVALID_IMAGE_REQUEST", path: issue.path.join("."), message: issue.message })) };
  const request = parsed.data;
  const errors = [];
  if (request.modelId !== definition.id) errors.push({ code: "MODEL_MISMATCH", message: "Request model does not match adapter." });
  const caps = definition.productCapabilities;
  const totalReferences = (request.referenceAssetIds?.length || 0) + (request.exploreImageIds?.length || 0);
  if (!caps.referenceImages.visible && totalReferences > 0) {
    errors.push({ code: "REFERENCE_IMAGES_UNSUPPORTED", message: "This model does not support reference images." });
  } else if (caps.referenceImages.visible && (totalReferences < caps.referenceImages.min || totalReferences > caps.referenceImages.max)) {
    errors.push({ code: "REFERENCE_COUNT_UNSUPPORTED", message: `This model accepts ${caps.referenceImages.min}-${caps.referenceImages.max} reference images.` });
  }
  if (!caps.aspectRatio.visible && request.aspectRatio !== undefined) errors.push({ code: "ASPECT_RATIO_UNSUPPORTED", message: "Aspect ratio is not supported for this model." });
  if (caps.aspectRatio.visible && (!request.aspectRatio || !caps.aspectRatio.values.includes(request.aspectRatio))) errors.push({ code: "ASPECT_RATIO_UNSUPPORTED", message: "Selected aspect ratio is unsupported." });
  if (!caps.outputResolution.visible && request.outputResolution !== undefined) errors.push({ code: "OUTPUT_RESOLUTION_UNSUPPORTED", message: "Output resolution is not supported for this model." });
  if (caps.outputResolution.visible && (!request.outputResolution || !caps.outputResolution.values.includes(request.outputResolution))) errors.push({ code: "OUTPUT_RESOLUTION_UNSUPPORTED", message: "Selected output resolution is unsupported." });
  if (!caps.requestedOutputCount.visible && request.requestedOutputCount !== undefined) errors.push({ code: "OUTPUT_COUNT_UNSUPPORTED", message: "Output count is fixed for this model." });
  if (caps.requestedOutputCount.visible && (!request.requestedOutputCount || !caps.requestedOutputCount.values.includes(request.requestedOutputCount))) errors.push({ code: "OUTPUT_COUNT_UNSUPPORTED", message: "Selected output count is unsupported." });
  const constrainedResolutions = definition.resolutionConstraints?.byAspectRatio?.[request.aspectRatio];
  if (request.outputResolution && constrainedResolutions && !constrainedResolutions.includes(request.outputResolution)) {
    const autoConstraint = request.aspectRatio === "auto";
    errors.push({
      code: autoConstraint ? "AUTO_RATIO_1K_ONLY" : "SQUARE_4K_UNSUPPORTED",
      message: autoConstraint ? "Auto aspect ratio only supports 1K." : "GPT Image 2 does not support 4K at 1:1.",
    });
  } else if (!constrainedResolutions && request.aspectRatio === "auto" && request.outputResolution && request.outputResolution !== "1K") {
    errors.push({ code: "AUTO_RATIO_1K_ONLY", message: "Auto aspect ratio only supports 1K." });
  }
  if (["16:9", "9:16"].includes(request.aspectRatio) && request.outputResolution === "2K" && definition.id === "muapi.seedream-5-pro-t2i") errors.push({ code: "SEEDREAM_PRO_2K_RATIO_UNSUPPORTED", message: "Seedream 5 Pro supports 2K only for non-cinematic aspect ratios." });
  return errors.length ? { valid: false, errors } : { valid: true, request };
}

function extractOutputs(payload) {
  const candidates = [payload?.outputs, payload?.output?.outputs, payload?.data?.outputs];
  const output = candidates.find(Array.isArray);
  if (!output || output.some((value) => typeof value !== "string" || !/^https:\/\//.test(value))) throw new Error("MuAPI authenticated result does not contain valid HTTPS image outputs");
  return output;
}

export function createMuapiImageAdapter({ resolutionCase = "upper", nativeMap = {}, requiredReferences = false } = {}) {
  return Object.freeze({
    validateNormalizedRequest(definition, input) { return validateImageRequest(definition, input); },
    buildProviderPayload(definition, { request, referenceUrls = [], exploreUrls = [], webhookUrl }) {
      const checked = validateImageRequest(definition, request);
      if (!checked.valid) { const error = new Error(checked.errors[0].message); error.code = checked.errors[0].code; throw error; }
      const combinedUrls = [...referenceUrls, ...exploreUrls];
      if (requiredReferences && !combinedUrls.length) throw new Error("This model requires a reference image.");
      const totalExpected = (request.referenceAssetIds?.length || 0) + (request.exploreImageIds?.length || 0);
      if (combinedUrls.length !== totalExpected) throw new Error("Reference URL ownership resolution is incomplete.");
      const payload = { prompt: request.prompt, ...definition.fixedProviderDefaults };
      if (definition.productCapabilities.referenceImages.visible && (combinedUrls.length || requiredReferences)) payload.images_list = combinedUrls;
      if (definition.productCapabilities.aspectRatio.visible) payload.aspect_ratio = request.aspectRatio;
      if (definition.productCapabilities.outputResolution.visible) payload.resolution = resolutionCase === "lower" ? request.outputResolution.toLowerCase() : request.outputResolution;
      if (definition.productCapabilities.requestedOutputCount.visible) payload.num_images = request.requestedOutputCount;
      if (!webhookUrl) delete payload.webhook_url;
      else payload.webhook_url = webhookUrl;
      return Object.freeze(payload);
    },
    buildEstimatePayload(definition, { request, referenceUrls = [], exploreUrls = [], webhookUrl } = {}) {
      const checked = validateImageRequest(definition, request);
      if (!checked.valid) { const error = new Error(checked.errors[0].message); error.code = checked.errors[0].code; throw error; }
      const payload = { prompt: request.prompt, ...definition.fixedProviderDefaults };
      const combinedUrls = [...referenceUrls, ...exploreUrls];
      if (combinedUrls.length) payload.images_list = combinedUrls;
      if (definition.productCapabilities.aspectRatio.visible && request.aspectRatio) payload.aspect_ratio = request.aspectRatio;
      if (definition.productCapabilities.outputResolution.visible && request.outputResolution) payload.resolution = resolutionCase === "lower" ? request.outputResolution.toLowerCase() : request.outputResolution;
      if (definition.productCapabilities.requestedOutputCount.visible && request.requestedOutputCount) payload.num_images = request.requestedOutputCount;
      if (webhookUrl) payload.webhook_url = webhookUrl;
      return Object.freeze(payload);
    },
    parseSubmission(response) {
      if (!response?.request_id || typeof response.request_id !== "string") throw new Error("MuAPI submit response lacks request_id");
      return { providerRequestId: response.request_id, providerStatus: response.status || "queued" };
    },
    parseAuthenticatedResult(response) {
      const status = String(response?.status || "").toLowerCase();
      if (["failed", "error", "cancelled", "canceled"].includes(status) || response?.error) return { terminal: true, succeeded: false, error: String(response?.error || status) };
      if (status !== "completed") return { terminal: false, succeeded: false, providerStatus: status || "processing" };
      return { terminal: true, succeeded: true, outputUrls: extractOutputs(response), actualCost: response?.cost?.amount_usd ?? null };
    },
  });
}
