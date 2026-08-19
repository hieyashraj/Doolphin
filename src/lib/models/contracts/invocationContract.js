import { z } from "zod";

/**
 * Doolphin Provider-Neutral Model Invocation Contract
 *
 * Canonical input fields use Doolphin provider-neutral names:
 * - prompt
 * - sourceVideo (not "video")
 * - targetLastFrame (not "last_image")
 * - sourceRequestId (not "request_id")
 * - maskIndexes (not "mask_indexs")
 * - aspectRatio (not "aspect_ratio")
 * - generateAudio (not "generate_audio")
 * - duration
 * - seed
 *
 * Provider-specific parameter names exist EXCLUSIVELY inside model-specific toProviderPayload translators.
 * Webhook URL is a transport-level concern, NOT part of the model payload body.
 */

export const DoolphinNormalizedInvocationInputSchema = z.object({
  prompt: z.string().min(1).trim(),
  sourceVideo: z.string().url().or(z.string().min(1)).optional(),
  targetLastFrame: z.string().url().or(z.string().min(1)).optional(),
  sourceRequestId: z.string().min(1).optional(),
  maskIndexes: z.array(z.number().int()).optional(),
  aspectRatio: z.string().optional(),
  generateAudio: z.boolean().optional(),
  duration: z.number().int().positive().optional(),
  // The user-selected output resolution ("480p" | "720p" | "1080p" | "4k").
  //
  // Most MuAPI model families encode resolution in the ENDPOINT rather than in
  // the request body (e.g. `seedance-2.5-spicy-omni-reference-1080p` vs
  // `...-480p` are distinct endpoints). Carrying it here is therefore NOT about
  // forwarding it as a provider parameter — it is so each model definition can
  // ASSERT that the resolution the user was quoted and charged for is the
  // resolution its endpoint actually produces. Previously this field did not
  // exist in the contract at all, so a user could be charged for a resolution
  // the payload never expressed, and silently receive the provider default.
  resolution: z.string().optional(),
  seed: z.number().int().optional(),
  extraInputs: z.record(z.string(), z.unknown()).optional(),
});

export function validateAndTransformInvocationInput(modelDefinition, rawInput) {
  if (!modelDefinition || typeof modelDefinition.toProviderPayload !== "function") {
    throw new Error("[ModelInvocationContract] Invalid model definition supplied; missing toProviderPayload transformer");
  }

  const parsed = DoolphinNormalizedInvocationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "INVALID_NORMALIZED_INPUT",
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }

  try {
    const providerPayload = modelDefinition.toProviderPayload(parsed.data);
    return {
      valid: true,
      normalizedInput: parsed.data,
      providerPayload,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code: "PROVIDER_PAYLOAD_TRANSLATION_FAILED",
          message: error.message,
        },
      ],
    };
  }
}
