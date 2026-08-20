export const seedance2OmniReferenceFastDefinition = {
  providerSpec: {
    providerModelId: "seedance-2-omni-reference-no-video-fast",
    endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
    category: "video-generation",
    description: "ByteDance Seedance 2 Omni Reference Fast (No-Video) model for UGC video ads.",
    // Reconciled against MuAPI's live GET /api/v1/models response
    // (src/lib/models/catalog/muapi-live-catalog.json): $0.75, dynamic_pricing=true.
    //
    // This previously declared `amount: 0.04838, strategy: "per_second"`. That
    // per-second rate was not published by MuAPI — MuAPI exposes no per-second
    // rates at all — and the strategy marker risked a duration multiplication on
    // top of an already-total price. This value is a REPRESENTATIVE BASE for
    // cross-check and display only; the billed figure always comes from the
    // estimate-cost endpoint below.
    cost: {
      amount: 0.75,
      currency: "USD"
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
    legacyAliases: ["seedance-2", "seedance2-fast"],
    // The ONLY resolution this specific endpoint produces. Resolution is an
    // endpoint-level property in the MuAPI Seedance family (separate 480p /
    // 1080p / 4K endpoints), never a body parameter — so a resolution the user
    // is quoted for must match this exactly or the request must fail closed.
    nativeResolution: "720p"
  },
  businessPolicy: {
    targetContributionMarginBps: 3000,
    variableInfraCostMicroUsd: 20000n, // $0.020 infra & verification reserve
    // Credit floor, at revision 2026-08-credit-value-v3 ($0.025/credit). Kept
    // below a standard generation's real cost so it never overcharges.
    minimumCredits: 9
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

    // Resolution integrity: this endpoint emits 720p only, and MuAPI exposes no
    // resolution parameter for it. If the caller was quoted any other
    // resolution, fail closed rather than charge for one resolution and deliver
    // another. Higher resolutions must be routed to their own dedicated
    // endpoint definitions (e.g. a `...-1080p` model), not requested here.
    const requestedResolution = normalizedInput.resolution;
    if (requestedResolution && String(requestedResolution).toLowerCase() !== "720p") {
      throw new Error(
        `[Seedance2Omni] This endpoint only produces 720p; '${requestedResolution}' was requested. ` +
        `Route higher resolutions to their dedicated endpoint definition instead of silently downgrading a paid generation.`
      );
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
