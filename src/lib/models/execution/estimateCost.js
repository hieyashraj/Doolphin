import { getMuapiApiKey } from "../../generation/muapiCredentials.js";
import { calculateCommercialCreditQuote } from "../pricingIntegration.js";
import { ERROR_CODES } from "../errors.js";

/**
 * Dynamic Provider Cost Estimator Core.
 * Calls MU API POST /api/v1/models/{model}/estimate-cost.
 *
 * NOTE: MU API's /estimate-cost endpoint is public and does not strictly require credentials.
 * Credentials are optional for estimation calls, but required for actual generation calls.
 *
 * Fixed-Pricing Rules:
 * - Uses dynamic_pricing boolean as the primary provider pricing-mode signal.
 * - If dynamic_pricing === false and a valid provider cost exists, it is treated as fixed provider cost.
 * - If dynamic_pricing metadata is contradictory or incomplete, fails closed with PRICING_UNAVAILABLE.
 */

export async function estimateAuthoritativeModelCost({
  modelDefinition,
  normalizedInput,
  alreadyPreparedPayload,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  if (!modelDefinition) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: "Model definition is required for cost estimation",
    };
  }

  const { providerSpec, businessPolicy } = modelDefinition;

  // Primary pricing-mode signal: dynamic_pricing boolean
  const isDynamic = Boolean(providerSpec.dynamicPricing ?? providerSpec.dynamic_pricing);

  // 1. Fixed-Price Strategy: dynamic_pricing === false with valid provider cost
  if (!isDynamic) {
    const rawAmount = providerSpec.cost?.amount ?? providerSpec.cost?.cost ?? providerSpec.cost;

    if (rawAmount === null || rawAmount === undefined) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' is configured with fixed pricing (dynamic_pricing: false), but has missing cost metadata`,
      };
    }

    const providerCostUsd = Number(rawAmount);
    if (isNaN(providerCostUsd) || providerCostUsd < 0) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' is configured with fixed pricing (dynamic_pricing: false), but has invalid cost metadata`,
      };
    }

    const quote = calculateCommercialCreditQuote({
      providerCostUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy: providerSpec.cost?.strategy || "fixed_cost",
      isDynamic: false,
      modelId: modelDefinition.productPolicy.id,
      estimatedAt: new Date().toISOString(),
    };
  }

  // 2. Dynamic-Pricing Strategy: Require authoritative MU API estimate endpoint
  const estimateEndpoint = providerSpec.estimateEndpoint;
  if (!estimateEndpoint) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: `Model '${modelDefinition.productPolicy.id}' requires dynamic cost estimation, but no estimateEndpoint is configured`,
    };
  }

  // Consume already-prepared payload OR build pure model payload ONCE
  let providerPayload = alreadyPreparedPayload;
  if (!providerPayload) {
    try {
      providerPayload = modelDefinition.toProviderPayload(normalizedInput);
    } catch (error) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Failed to construct provider payload for cost estimation: ${error.message}`,
      };
    }
  }

  // Optional credential resolution
  let headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  try {
    const apiKey = getMuapiApiKey(env);
    if (apiKey && !apiKey.includes("placeholder")) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  } catch {
    // Credentials optional for public estimation endpoints
  }

  try {
    const response = await fetchImpl(estimateEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(providerPayload),
    });

    if (!response.ok) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `MU API estimate endpoint returned HTTP ${response.status}`,
      };
    }

    const result = await response.json();
    const costUsd = Number(result?.amount_usd ?? result?.cost_usd ?? result?.amount ?? result?.cost);

    if (isNaN(costUsd) || costUsd < 0) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: "MU API estimate endpoint returned an invalid or non-numeric cost amount",
      };
    }

    const quote = calculateCommercialCreditQuote({
      providerCostUsd: costUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy: providerSpec.cost?.strategy || "dynamic_cost",
      isDynamic: true,
      modelId: modelDefinition.productPolicy.id,
      providerEstimateResult: result,
      estimatedPayload: providerPayload,
      estimatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: `Network or estimation exception: ${error.message}`,
    };
  }
}
