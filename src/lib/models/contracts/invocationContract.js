import { z } from "zod";

/**
 * Provider-neutral invocation contract. Provider spellings are confined to
 * model adapter/mapping code. Strict objects prevent silent field stripping.
 */
const assetReferenceSchema = z.string().min(1);
const sceneSchema = z.object({
  description: z.string().trim().min(1).optional(),
  // `scene` is retained as a canonical compatibility alias for saved drafts.
  scene: z.string().trim().min(1).optional(),
  duration: z.number().positive(),
}).strict().refine((value) => Boolean(value.description || value.scene), {
  message: "A scene requires description",
});

const legacyExtraInputsSchema = z.object({
  images: z.array(assetReferenceSchema).optional(),
  videoReferences: z.array(assetReferenceSchema).optional(),
  audioReferences: z.array(assetReferenceSchema).optional(),
}).strict();

export const DoolphinNormalizedInvocationInputSchema = z.object({
  prompt: z.string().trim().optional(),
  script: z.string().trim().min(1).optional(),
  additionalInstructions: z.string().trim().min(1).optional(),
  sourceImage: assetReferenceSchema.optional(),
  sourceVideo: assetReferenceSchema.optional(),
  referenceImages: z.array(assetReferenceSchema).optional(),
  referenceVideos: z.array(assetReferenceSchema).optional(),
  referenceAudios: z.array(assetReferenceSchema).optional(),
  startFrame: assetReferenceSchema.optional(),
  endFrame: assetReferenceSchema.optional(),
  // Legacy normalized aliases retained for prepared-draft compatibility.
  targetLastFrame: assetReferenceSchema.optional(),
  sourceRequestId: z.string().trim().min(1).optional(),
  maskIndexes: z.array(z.number().int()).optional(),
  aspectRatio: z.string().trim().min(1).optional(),
  quality: z.string().trim().min(1).optional(),
  nativeAudio: z.boolean().optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().positive().optional(),
  resolution: z.string().trim().min(1).optional(),
  seed: z.number().int().optional(),
  camera: z.record(z.string(), z.unknown()).optional(),
  motion: z.record(z.string(), z.unknown()).optional(),
  storyboard: z.array(sceneSchema).optional(),
  scenes: z.array(sceneSchema).optional(),
  modelParameters: z.record(z.string(), z.unknown()).optional(),
  earliestSignedAssetExpiryMs: z.number().finite().positive().nullable().optional(),
  extraInputs: legacyExtraInputsSchema.optional(),
}).strict();

export function validateAndTransformInvocationInput(modelDefinition, rawInput) {
  if (!modelDefinition || typeof modelDefinition.toProviderPayload !== "function") {
    throw new Error("[ModelInvocationContract] Invalid model definition supplied; missing toProviderPayload transformer");
  }

  const parsed = DoolphinNormalizedInvocationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: issue.code === "unrecognized_keys" ? "UNKNOWN_NORMALIZED_INPUT" : "INVALID_NORMALIZED_INPUT",
        message: issue.code === "unrecognized_keys"
          ? `Unknown normalized input field(s): ${issue.keys.join(", ")}`
          : issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  try {
    // Exactly one adapter invocation. The resulting object is the object whose
    // canonical bytes are priced, hashed, persisted, and later dispatched.
    const providerPayload = modelDefinition.toProviderPayload(parsed.data);
    return {
      valid: true,
      normalizedInput: parsed.data,
      providerPayload,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [{
        code: "PROVIDER_PAYLOAD_TRANSLATION_FAILED",
        message: error.message,
      }],
    };
  }
}
