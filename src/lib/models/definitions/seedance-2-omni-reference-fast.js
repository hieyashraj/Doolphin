export const seedance2OmniReferenceFastDefinition = {
  providerSpec: {
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
    category: "video-generation",
    description: "ByteDance Seedance 2 Omni Reference Fast (No-Video) model for UGC video ads.",
    cost: {
      amount: 0.04838,
      currency: "USD",
      strategy: "per_second"
    },
    dynamicPricing: true,
    estimateEndpoint: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", maxLength: 5000 },
        images_list: { type: "array", items: { type: "string" }, description: "Actor reference image URLs (max 9)" },
        duration: { type: "integer", minimum: 4, maximum: 15, default: 5 },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:3", "3:4"], default: "9:16" },
        generate_audio: { type: "boolean", default: true }
      }
    }
  },
  productPolicy: {
    id: "muapi.seedance2.omni-reference-fast",
    displayName: "Seedance 2 Omni Reference Fast",
    studios: ["video-studio", "product-studio", "app-studio"],
    generationMode: "text-to-video",
    enabled: true,
    displayOrder: 5,
    badge: "UGC Core",
    description: "Production Seedance 2.0 UGC video generation with reference actors.",
    legacyAliases: ["seedance-2", "seedance2-fast"]
  },
  businessPolicy: {
    targetContributionMarginBps: 3000,
    variableInfraCostMicroUsd: 20000n, // $0.020 infra & verification reserve
    minimumCredits: 10
  },

  /**
   * Model Payload Transformer (Transport-Independent)
   * Transforms normalized Doolphin model inputs into pure provider body payload ONLY.
   */
  toProviderPayload(normalizedInput) {
    if (!normalizedInput?.prompt?.trim()) {
      throw new Error("[Seedance2Omni] prompt is required");
    }

    // Audio-Reference Capability Guard: Fail closed if explicit audio references are passed
    if (
      (Array.isArray(normalizedInput.extraInputs?.audioReferences) && normalizedInput.extraInputs.audioReferences.length > 0) ||
      (Array.isArray(normalizedInput.audioReferences) && normalizedInput.audioReferences.length > 0)
    ) {
      throw new Error("[Seedance2Omni] Model does not support explicit audio reference assets. Use native audio generation (generateAudio: true) instead.");
    }

    const duration = Number(normalizedInput.duration || 5);
    if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
      throw new Error(`[Seedance2Omni] duration must be an integer between 4 and 30 seconds (received ${duration})`);
    }

    const validAspectRatios = ["9:16", "16:9", "1:1", "4:3", "3:4"];
    const aspectRatio = normalizedInput.aspectRatio || "9:16";
    if (!validAspectRatios.includes(aspectRatio)) {
      throw new Error(`[Seedance2Omni] Unsupported aspect ratio '${aspectRatio}'`);
    }

    const imagesInput = normalizedInput.extraInputs?.images || normalizedInput.images || [];
    if (Array.isArray(imagesInput) && imagesInput.length > 9) {
      throw new Error(`[Seedance2Omni] Maximum 9 image references permitted (received ${imagesInput.length})`);
    }

    const payload = {
      prompt: normalizedInput.prompt.trim(),
      duration,
      aspect_ratio: aspectRatio,
      generate_audio: normalizedInput.generateAudio !== undefined ? Boolean(normalizedInput.generateAudio) : true
    };

    if (Array.isArray(imagesInput) && imagesInput.length > 0) {
      payload.images_list = imagesInput.map(String);
    }

    return payload;
  }
};
