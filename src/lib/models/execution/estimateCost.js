import { getMuapiApiKey } from "../../generation/muapiCredentials.js";
import { calculateCommercialCreditQuote, parseUsdToMicroUsdConservatively } from "../pricingIntegration.js";
import { canonicalJsonSerialize } from "./prepareExecutionPlan.js";
import { ERROR_CODES } from "../errors.js";

const DEFAULT_ESTIMATE_TIMEOUT_MS = 3000;

export async function estimateAuthoritativeModelCost({
  modelDefinition,
  normalizedInput,
  alreadyPreparedPayload,
  alreadyPreparedPayloadJson,
  fetchImpl = fetch,
  env = process.env,
  timeoutMs = DEFAULT_ESTIMATE_TIMEOUT_MS,
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

    let unitCostUsd;
    try {
      unitCostUsd = Number(rawAmount);
      if (isNaN(unitCostUsd) || unitCostUsd < 0) throw new Error();
    } catch {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' is configured with fixed pricing (dynamic_pricing: false), but has invalid cost metadata`,
      };
    }

    // CRITICAL: the declared cost STRATEGY must be honoured. MuAPI publishes
    // most video models as a PER-SECOND rate (e.g. "$0.15/sec" -> 5s = $0.75,
    // 8s = $1.20, 10s = $1.50). Treating a per-second rate as a flat total was
    // a latent ~30x under-charge on this path: a 30s render priced as if it
    // were 1s. Every strategy must be explicitly handled, and an unrecognised
    // strategy must fail closed rather than silently assume "flat".
    const strategy = String(providerSpec.cost?.strategy || "fixed_cost").toLowerCase();
    let providerCostUsd;

    if (strategy === "fixed_cost" || strategy === "per_request" || strategy === "per_generation") {
      providerCostUsd = unitCostUsd;
    } else if (strategy === "per_second") {
      const durationSeconds = Number(normalizedInput?.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return {
          priced: false,
          code: ERROR_CODES.PRICING_UNAVAILABLE,
          reason: `Model '${modelDefinition.productPolicy.id}' prices per second but no positive duration was supplied; refusing to quote a per-second model as a flat rate`,
        };
      }
      providerCostUsd = unitCostUsd * durationSeconds;
    } else {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `Model '${modelDefinition.productPolicy.id}' declares unrecognised cost strategy '${strategy}'; refusing to guess a billing basis`,
      };
    }

    const quote = calculateCommercialCreditQuote({
      providerCostUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy,
      isDynamic: false,
      modelId: modelDefinition.productPolicy.id,
      providerCostUsd,
      unitCostUsd,
      billedDurationSeconds: strategy === "per_second" ? Number(normalizedInput?.duration) : null,
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

  // Resolve EXACT canonical provider payload JSON body
  let requestBodyString = alreadyPreparedPayloadJson;
  if (!requestBodyString) {
    let payload = alreadyPreparedPayload;
    if (!payload) {
      try {
        payload = modelDefinition.toProviderPayload(normalizedInput);
      } catch (error) {
        return {
          priced: false,
          code: ERROR_CODES.PRICING_UNAVAILABLE,
          reason: `Failed to construct provider payload for cost estimation: ${error.message}`,
        };
      }
    }
    requestBodyString = canonicalJsonSerialize(payload);
  }

  let headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const apiKey = getMuapiApiKey(env);
    if (apiKey && !apiKey.includes("placeholder")) {
      headers["x-api-key"] = apiKey;
    }
  } catch {
    // Credentials optional for public cost estimation endpoints
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(estimateEndpoint, {
      method: "POST",
      headers,
      body: requestBodyString,
      signal: controller.signal,
      redirect: "error",
    });
    clearTimeout(timer);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: `MU API estimate-cost HTTP ${response.status}: ${errorBody.error || errorBody.message || "Unknown pricing error"}`,
      };
    }

    const payload = await response.json();
    const rawCost = payload.cost ?? payload.estimated_cost ?? payload.amount ?? payload.amount_usd;

    if (rawCost === undefined || rawCost === null) {
      return {
        priced: false,
        code: ERROR_CODES.PRICING_UNAVAILABLE,
        reason: "MU API estimate-cost returned missing cost property",
      };
    }

    const providerCostMicroUsd = parseUsdToMicroUsdConservatively(rawCost);
    const providerCostUsd = Number(providerCostMicroUsd) / 1_000_000;

    const quote = calculateCommercialCreditQuote({
      providerCostMicroUsd,
      variableInfraCostMicroUsd: businessPolicy?.variableInfraCostMicroUsd || 0n,
    });

    return {
      ...quote,
      strategy: payload.strategy || "estimate_cost_dynamic",
      isDynamic: true,
      modelId: modelDefinition.productPolicy.id,
      providerCostUsd,
      estimatedAt: new Date().toISOString(),
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      priced: false,
      code: ERROR_CODES.PRICING_UNAVAILABLE,
      reason: error.name === "AbortError" ? `MU API cost estimation timed out after ${timeoutMs}ms` : `Network or estimation exception: ${error.message}`,
    };
  }
}
