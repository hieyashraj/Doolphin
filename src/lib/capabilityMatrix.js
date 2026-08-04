export const MODEL_CAPABILITIES = {
  "grok-video": {
    provider: "MUAPI",
    name: "Grok Video",
    category: "Visual Motion Video",
    aspectRatios: ["9:16", "16:9", "2:3", "3:2", "1:1"],
    minDuration: 3,
    maxDuration: 15,
    resolutions: ["480p", "720p"],
    supportedInteractionTypes: ["handheld", "accessory", "digital_screen", "furniture_large"],
    supportsImageReference: true,
    supportsVirtualTryOn: false,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "prompt_only"
  },
  "veo-3-1": {
    provider: "MUAPI",
    name: "Veo 3.1",
    category: "High-Fidelity Visual Motion",
    aspectRatios: ["9:16", "16:9"],
    minDuration: 8,
    maxDuration: 15,
    resolutions: ["720p", "1080p", "4k"],
    supportedInteractionTypes: ["handheld", "accessory", "furniture_large"],
    supportsImageReference: true,
    supportsVirtualTryOn: false,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "prompt_only"
  },
  "happy-horse": {
    provider: "MUAPI",
    name: "Happy Horse 1",
    category: "Visual Animation",
    aspectRatios: ["9:16", "16:9", "1:1", "4:3", "3:4"],
    minDuration: 3,
    maxDuration: 15,
    resolutions: ["720p"],
    supportedInteractionTypes: ["handheld", "accessory"],
    supportsImageReference: true,
    supportsVirtualTryOn: false,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "prompt_only"
  },
  "seedance-2": {
    provider: "MUAPI",
    name: "Seedance 2",
    category: "Multi-Asset Character Animation",
    aspectRatios: ["9:16", "16:9", "4:3", "1:1", "3:4"],
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["720p", "1080p"],
    supportedInteractionTypes: ["handheld", "wearable", "accessory", "digital_screen", "furniture_large"],
    supportsImageReference: true,
    supportsVirtualTryOn: true,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "dual_image"
  },
  "fal-bytedance-seedance-v2": {
    provider: "FAL",
    name: "Seedance 2 (Fal.ai)",
    category: "Multi-Asset Character Animation",
    aspectRatios: ["9:16", "16:9", "1:1"],
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["720p", "1080p"],
    supportedInteractionTypes: ["handheld", "wearable", "accessory", "digital_screen", "furniture_large"],
    supportsImageReference: true,
    supportsVirtualTryOn: true,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "dual_image"
  },
  "fal-kling-3-std": {
    provider: "FAL",
    name: "Kling 3.0 Standard (Fal.ai)",
    category: "Visual Motion & Ambient Sound (Fal.ai)",
    aspectRatios: ["9:16", "16:9", "1:1"],
    minDuration: 5,
    maxDuration: 15,
    resolutions: ["720p", "1080p"],
    supportedInteractionTypes: ["handheld", "wearable", "accessory", "digital_screen"],
    supportsImageReference: true,
    supportsVirtualTryOn: true,
    supportsGenerateAudio: true, // Native ambient audio via generate_audio: true
    supportsNativeLipSync: false, // Scripted TTS lip-sync requires external TTS pipeline
    productReferenceMode: "prompt_only" // Avatar passed as image_url; product described in prompt
  },
  "fal-luma-ray-v2": {
    provider: "FAL",
    name: "Luma Ray 2 (Fal.ai)",
    category: "Visual Motion Video",
    aspectRatios: ["9:16", "16:9"],
    minDuration: 5,
    maxDuration: 15,
    resolutions: ["720p"],
    supportedInteractionTypes: ["handheld", "accessory", "digital_screen"],
    supportsImageReference: true,
    supportsVirtualTryOn: false,
    supportsGenerateAudio: false,
    supportsNativeLipSync: false,
    productReferenceMode: "prompt_only"
  }
};

/**
 * Validates request parameters and product interaction types against verified model capability matrix
 */
export function validateModelCapability(modelId, settings = {}, productType = "handheld") {
  const cap = MODEL_CAPABILITIES[modelId];

  if (!cap) {
    return {
      valid: false,
      code: "INVALID_MODEL",
      error: `Model ID '${modelId}' is not recognized in the provider capability matrix.`
    };
  }

  // Duration Validation: Strict max 15s
  const duration = typeof settings.duration === "number" ? settings.duration : 5;
  if (duration < cap.minDuration || duration > 15) {
    return {
      valid: false,
      code: "INVALID_DURATION",
      error: `Duration of ${duration}s is invalid. Model '${cap.name}' requires duration between ${cap.minDuration}s and 15s.`
    };
  }

  // Aspect Ratio Validation
  const aspect = settings.aspect_ratio || "9:16";
  if (!cap.aspectRatios.includes(aspect)) {
    return {
      valid: false,
      code: "UNSUPPORTED_ASPECT_RATIO",
      error: `Aspect ratio '${aspect}' is not supported by model '${cap.name}'. Supported options: ${cap.aspectRatios.join(", ")}.`
    };
  }

  // Product Interaction Capability Check
  if (productType === "wearable" && !cap.supportsVirtualTryOn) {
    return {
      valid: false,
      code: "UNSUPPORTED_CAPABILITY",
      error: `Selected model '${cap.name}' does not support virtual try-on / wearable apparel integration. Please select Seedance 2 or Kling 3.0.`
    };
  }

  if (!cap.supportedInteractionTypes.includes(productType)) {
    return {
      valid: false,
      code: "UNSUPPORTED_CAPABILITY",
      error: `Model '${cap.name}' cannot handle '${productType}' interaction. Supported interaction types: ${cap.supportedInteractionTypes.join(", ")}.`
    };
  }

  return { valid: true, capability: cap };
}
