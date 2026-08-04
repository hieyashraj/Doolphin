import { listProductionModels } from "../registry/modelRegistry.js";
import { AppError, ERROR_CODES } from "../errors.js";

/**
 * Model Router for Doolphin Platform.
 * Section 8 Compliance.
 */

export class ModelRouter {
  static route(routingInput) {
    const {
      workflowType,
      preset,
      duration = 5,
      aspectRatio = "9:16",
      exactProduct = false,
      exactScript = false,
      appUiFidelity = false,
      preferredModelId = null,
    } = routingInput;

    const availableModels = listProductionModels();
    const eligible = [];
    const rejected = [];

    for (const model of availableModels) {
      const reasons = [];

      // Duration check
      if (!model.capabilities.supportedDurations.includes(Number(duration))) {
        reasons.push(`Duration ${duration}s not supported`);
      }

      // Aspect ratio check
      if (!model.capabilities.supportedAspectRatios.includes(aspectRatio)) {
        reasons.push(`Aspect ratio ${aspectRatio} not supported`);
      }

      // Exact product check
      if (exactProduct && model.capabilities.productFidelity === "PROMPT_ONLY") {
        reasons.push("Exact product fidelity unsupported by model");
      }

      // App UI fidelity check
      if (appUiFidelity && model.capabilities.appUiPolicy === "GENERATIVE_BROLL_ONLY" && workflowType === "APP_STUDIO") {
        // App Studio UI must be preserved deterministically; generative model is used for presenter/b-roll
      }

      if (reasons.length === 0) {
        eligible.push(model);
      } else {
        rejected.push({ modelId: model.internalModelId, reasons });
      }
    }

    if (eligible.length === 0) {
      throw new AppError(
        ERROR_CODES.MODEL_CAPABILITY_UNSUPPORTED,
        "No production-enabled AI video model satisfies the given workflow and fidelity criteria."
      );
    }

    // Preferred model selection or auto ranking
    let selected = eligible[0];
    if (preferredModelId) {
      const match = eligible.find((m) => m.internalModelId === preferredModelId);
      if (match) selected = match;
    }

    return {
      selectedModel: selected,
      eligibleCandidates: eligible.map((m) => m.internalModelId),
      rejectedCandidates: rejected,
      estimatedCostMinMicroUsd: selected.costPerUnitMicroUsd,
      estimatedCostMaxMicroUsd: selected.costPerUnitMicroUsd * BigInt(2),
    };
  }
}
