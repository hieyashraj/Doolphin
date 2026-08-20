export const grokImagineImage2EditDefinition = {
  providerSpec: {
    providerModelId: "grok-imagine-image-2-edit",
    endpoint: "/api/v1/grok-imagine-image-2-edit",
    category: "image-edit",
    description: "Grok Imagine 2.0 image editing operation requiring a prior request_id.",
    // Cost and pricing mode reconciled against MuAPI's live GET /api/v1/models
    // response (see src/lib/models/catalog/muapi-live-catalog.json). The catalog
    // marks this model dynamic_pricing=true, so $0.05 is a REPRESENTATIVE BASE
    // for display/cross-check only and is never billed. The exact charge comes
    // from the estimate-cost endpoint.
    //
    // This previously declared dynamicPricing:false, which meant Doolphin
    // flat-billed $0.05 for a model whose real price MuAPI varies per request.
    cost: {
      amount: 0.05,
      currency: "USD"
    },
    dynamicPricing: true,
    estimateEndpoint: "https://api.muapi.ai/api/v1/models/grok-imagine-image-2-edit/estimate-cost",
    inputSchema: {
      type: "object",
      required: ["prompt", "request_id"],
      properties: {
        prompt: { type: "string", maxLength: 5000 },
        request_id: { type: "string" },
        mask_indexs: { type: "array", items: { type: "integer" } }
      }
    }
  },
  productPolicy: {
    id: "muapi.grok-imagine-image-2-edit",
    displayName: "Grok Imagine Image 2 Edit",
    studios: ["image-studio"],
    generationMode: "image-edit",
    enabled: true,
    displayOrder: 10,
    badge: "Image Edit",
    description: "Edit prior Grok Imagine generations using instructions and segment masks.",
    legacyAliases: ["grok-edit", "grok-imagine-edit"]
  },
  businessPolicy: {
    targetContributionMarginBps: 3000,
    variableInfraCostMicroUsd: 5000n, // $0.005 storage/bandwidth reserve
    minimumCredits: 5
  },

  /**
   * Model Payload Transformer (Transport-Independent)
   * Transforms normalized Doolphin inputs into pure provider body payload ONLY.
   */
  toProviderPayload(normalizedInput) {
    if (!normalizedInput?.prompt?.trim()) {
      throw new Error("[GrokEdit] prompt is required");
    }
    if (!normalizedInput?.sourceRequestId) {
      throw new Error("[GrokEdit] sourceRequestId is required (must reference a prior Grok Imagine 2.0 request_id)");
    }

    const payload = {
      prompt: normalizedInput.prompt.trim(),
      request_id: normalizedInput.sourceRequestId
    };

    if (Array.isArray(normalizedInput.maskIndexes) && normalizedInput.maskIndexes.length > 0) {
      payload.mask_indexs = normalizedInput.maskIndexes.map(Number);
    }

    return payload;
  }
};
