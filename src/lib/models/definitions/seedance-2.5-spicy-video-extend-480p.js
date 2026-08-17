export const seedanceSpicyVideoExtendDefinition = {
  providerSpec: {
    providerModelId: "seedance-2.5-spicy-video-extend-480p",
    endpoint: "/api/v1/seedance-2.5-spicy-video-extend-480p",
    category: "video-extend",
    description: "ByteDance Seedance 2.5 Spicy 480p video continuation & extension model.",
    cost: {
      amount: 0.08,
      currency: "USD",
      strategy: "per_second"
    },
    dynamicPricing: true,
    estimateEndpoint: "https://api.muapi.ai/api/v1/models/seedance-2.5-spicy-video-extend-480p/estimate-cost",
    inputSchema: {
      type: "object",
      required: ["prompt", "video"],
      properties: {
        prompt: { type: "string", maxLength: 2000 },
        video: { type: "string" },
        last_image: { type: "string" },
        duration: { type: "integer", minimum: 4, maximum: 30, default: 5 },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "9:21"], default: "9:16" },
        generate_audio: { type: "boolean", default: true },
        seed: { type: "integer" }
      }
    }
  },
  productPolicy: {
    id: "muapi.seedance-2.5-spicy-video-extend-480p",
    displayName: "Seedance 2.5 Spicy Video Extend (480p)",
    studios: ["video-studio"],
    generationMode: "video-extend",
    enabled: true,
    displayOrder: 20,
    badge: "Video Extend",
    description: "Extend existing videos seamlessly with continuation prompts and camera movement.",
    legacyAliases: ["seedance-extend", "seedance-2.5-spicy"]
  },
  businessPolicy: {
    targetContributionMarginBps: 3000,
    variableInfraCostMicroUsd: 10000n, // $0.010 infra allowance
    minimumCredits: 10
  },

  /**
   * Model Payload Transformer (Transport-Independent)
   * Transforms normalized Doolphin inputs into pure provider body payload ONLY.
   */
  toProviderPayload(normalizedInput) {
    if (!normalizedInput?.prompt?.trim()) {
      throw new Error("[SeedanceExtend] prompt is required");
    }
    if (!normalizedInput?.sourceVideo) {
      throw new Error("[SeedanceExtend] sourceVideo is required");
    }

    const duration = Number(normalizedInput.duration || 5);
    if (!Number.isInteger(duration) || duration < 4 || duration > 30) {
      throw new Error(`[SeedanceExtend] duration must be an integer between 4 and 30 seconds (received ${duration})`);
    }

    const validAspectRatios = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "9:21"];
    const aspectRatio = normalizedInput.aspectRatio || "9:16";
    if (!validAspectRatios.includes(aspectRatio)) {
      throw new Error(`[SeedanceExtend] Unsupported aspect ratio '${aspectRatio}'`);
    }

    const payload = {
      prompt: normalizedInput.prompt.trim(),
      video: normalizedInput.sourceVideo,
      duration,
      aspect_ratio: aspectRatio,
      generate_audio: normalizedInput.generateAudio !== undefined ? Boolean(normalizedInput.generateAudio) : true
    };

    if (normalizedInput.targetLastFrame) {
      payload.last_image = normalizedInput.targetLastFrame;
    }

    if (normalizedInput.seed !== undefined && normalizedInput.seed !== null) {
      payload.seed = Number(normalizedInput.seed);
    }

    return payload;
  }
};
