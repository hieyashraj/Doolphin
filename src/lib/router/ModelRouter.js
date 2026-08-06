import { MODEL_CAPABILITIES, validateModelForWorkflow } from "../capabilityMatrix.js";
import { AppError, ERROR_CODES } from "../errors.js";

/**
 * Intelligent Model Router for Doolphin Platform.
 * Enforces native capability rules, automatic model recommendation/substitution, and model locking.
 */
export class ModelRouter {
  static route(routingInput) {
    const {
      workflowType = "PRODUCT_AD",
      preset = "product",
      productType = "handheld",
      duration = 12,
      aspectRatio = "9:16",
      requireNativeIntegration = true,
      preferredModelId = null,
      isModelLocked = false,
    } = routingInput;

    const requestedModelId = preferredModelId || "seedance-2";
    const requestedCap = MODEL_CAPABILITIES[requestedModelId];

    let selectedModelId = requestedModelId;
    let autoSubstituted = false;
    let substitutionReason = null;

    // Check capability of requested model
    const validation = validateModelForWorkflow({
      modelId: requestedModelId,
      workflowType,
      productType,
      requireNativeIntegration
    });

    if (!validation.valid) {
      if (isModelLocked) {
        // User explicitly locked model: Do not auto-substitute! Throw pre-generation validation error.
        throw new AppError(
          ERROR_CODES.MODEL_CAPABILITY_UNSUPPORTED,
          `Locked Model '${requestedCap?.name || requestedModelId}' cannot satisfy the requested workflow: ${validation.error} Recommended alternatives: ${validation.recommendedModels?.join(", ")}`
        );
      }

      // Selection is unlocked: Auto-recommend / auto-substitute highest capable model
      const recommendedModelId = validation.recommendedModels?.[0] || "seedance-2";
      const recommendedCap = MODEL_CAPABILITIES[recommendedModelId];

      selectedModelId = recommendedModelId;
      autoSubstituted = true;
      substitutionReason = `Automatically upgraded model from '${requestedCap?.name || requestedModelId}' to '${recommendedCap?.name || recommendedModelId}' to support native integration and ${productType} product capabilities.`;
    }

    const selectedCap = MODEL_CAPABILITIES[selectedModelId] || MODEL_CAPABILITIES["seedance-2"];

    return {
      selectedModel: {
        internalModelId: selectedModelId,
        provider: selectedCap.provider,
        name: selectedCap.name,
        endpoint: selectedCap.provider === "FAL" ? "fal-ai/video-generation" : "https://api.muapi.ai/v1/video/generate"
      },
      capability: selectedCap,
      autoSubstituted,
      substitutionReason,
      isModelLocked,
      estimatedCostMinMicroUsd: BigInt(250000),
      estimatedCostMaxMicroUsd: BigInt(500000)
    };
  }
}

