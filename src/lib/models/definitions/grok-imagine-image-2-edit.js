export const grokImagineImage2EditDefinition = {
  providerSpec: {
    providerModelId: "grok-imagine-image-2-edit",
    endpoint: "/api/v1/grok-imagine-image-2-edit",
    category: "image-edit",
    description: "Grok Imagine 2.0 image editing operation requiring a prior request_id.",
    cost: {
      amount: 0.05,
      currency: "USD",
      strategy: "fixed_cost"
    },
    dynamicPricing: false,
    estimateEndpoint: null,
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
