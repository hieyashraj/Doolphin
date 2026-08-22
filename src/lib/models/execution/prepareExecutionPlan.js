import crypto from "node:crypto";
import { getModel } from "../registry.js";
import { validateAndTransformInvocationInput } from "../contracts/invocationContract.js";
import { estimateAuthoritativeModelCost } from "./estimateCost.js";
import { calculateWorkflowCommercialQuote } from "../pricingIntegration.js";
import { computeCatalogHash } from "../providerCatalog.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minute safety margin

export function resolveServerWebhookUrl(env = process.env) {
  const configuredBase = env.DOOLPHIN_WEBHOOK_URL || env.NEXT_PUBLIC_APP_URL || "https://api.doolphin.com";
  let baseUrl;
  try {
    const parsed = new URL(configuredBase);
    baseUrl = parsed.origin;
  } catch {
    baseUrl = "https://api.doolphin.com";
  }
  return `${baseUrl}/api/webhooks/muapi`;
}

export function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const prop of Object.getOwnPropertyNames(obj)) {
    const val = obj[prop];
    if (val !== null && (typeof val === "object" || typeof val === "function") && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

export function validateJsonSafe(val, path = "payload", seen = new WeakSet()) {
  if (val === null || val === undefined) return;

  const type = typeof val;
  if (type === "function" || type === "symbol" || type === "bigint") {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_MODEL_INPUT,
      `Non-JSON-safe type '${type}' detected at '${path}'`
    );
  }

  if (type === "number") {
    if (!Number.isFinite(val)) {
      throw new ModelPlatformError(
        ERROR_CODES.INVALID_MODEL_INPUT,
        `Non-finite number '${val}' detected at '${path}'`
      );
    }
    return;
  }

  if (type === "object") {
    if (seen.has(val)) {
      throw new ModelPlatformError(
        ERROR_CODES.INVALID_MODEL_INPUT,
        `Cyclic structure detected at '${path}'`
      );
    }
    seen.add(val);

    if (Array.isArray(val)) {
      val.forEach((item, idx) => validateJsonSafe(item, `${path}[${idx}]`, seen));
    } else {
      for (const [key, propVal] of Object.entries(val)) {
        if (propVal === undefined) {
          throw new ModelPlatformError(
            ERROR_CODES.INVALID_MODEL_INPUT,
            `Undefined property value at '${path}.${key}'`
          );
        }
        validateJsonSafe(propVal, `${path}.${key}`, seen);
      }
    }
  }
}

export function canonicalJsonSerialize(val) {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    const items = val.map((item) => canonicalJsonSerialize(item));
    return `[${items.join(",")}]`;
  }

  const sortedKeys = Object.keys(val).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJsonSerialize(val[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Validates signed asset URL expiration against prepared plan expiration.
 * Invariant: preparedPlanExpiresAt < earliestSignedAssetExpiry - safetyMargin
 */
export function validateSignedAssetExpiry({
  earliestSignedAssetExpiryMs,
  preparedPlanExpiresAtMs,
  safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS,
}) {
  if (!earliestSignedAssetExpiryMs) return;

  const minRequiredExpiry = preparedPlanExpiresAtMs + safetyMarginMs;
  if (earliestSignedAssetExpiryMs < minRequiredExpiry) {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_MODEL_INPUT,
      `Signed asset URL expires too soon for prepared plan execution (expires at ${new Date(earliestSignedAssetExpiryMs).toISOString()}, minimum required is ${new Date(minRequiredExpiry).toISOString()})`
    );
  }
}

/**
 * Server-Only Prepared Execution Plan Core (Phase 4B.2).
 */
export async function prepareExecutionPlan({
  modelId,
  normalizedInput,
  outputCount = 1,
  fetchImpl = fetch,
  env = process.env,
  planTtlMs = 15 * 60 * 1000,
  safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS,
} = {}) {
  // 1. Resolve Model with Authoritative Provider Authority spec
  const modelDefinition = await getModel(modelId, { fetchImpl, env });
  if (!modelDefinition) {
    throw new ModelPlatformError(
      ERROR_CODES.MODEL_NOT_FOUND,
      `Model '${modelId}' is not registered in the platform registry`
    );
  }

  if (!modelDefinition.productPolicy.enabled) {
    throw new ModelPlatformError(
      ERROR_CODES.MODEL_DISABLED,
      `Model '${modelDefinition.productPolicy.id}' is disabled`
    );
  }

  const outputBounds = modelDefinition.capabilityDescriptor?.outputCount;
  if (outputBounds && (!Number.isInteger(outputCount) || outputCount < outputBounds.min || outputCount > outputBounds.max)) {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_MODEL_INPUT,
      `Model '${modelDefinition.productPolicy.id}' supports outputCount ${outputBounds.min}-${outputBounds.max}; received ${outputCount}`
    );
  }

  // 2. Validate & Transform to Pure Provider Payload EXACTLY ONCE
  const validation = validateAndTransformInvocationInput(
    modelDefinition,
    normalizedInput
  );

  if (!validation.valid) {
    throw new ModelPlatformError(
      ERROR_CODES.INVALID_MODEL_INPUT,
      `Validation failed for model '${modelDefinition.productPolicy.id}': ${validation.errors[0]?.message}`,
      { errors: validation.errors }
    );
  }

  // 3. Expiry Protection Guard for Signed Asset URLs
  const nowMs = Date.now();
  const preparedPlanExpiresAtMs = nowMs + planTtlMs;
  if (normalizedInput?.earliestSignedAssetExpiryMs) {
    validateSignedAssetExpiry({
      earliestSignedAssetExpiryMs: Number(normalizedInput.earliestSignedAssetExpiryMs),
      preparedPlanExpiresAtMs,
      safetyMarginMs,
    });
  }

  // 4. Defensive Deep Clone & JSON-Safety Validation
  const rawPayload = structuredClone(validation.providerPayload);
  validateJsonSafe(rawPayload, "providerPayload");

  // 5. Recursive Deep Freeze
  const providerPayload = deepFreeze(rawPayload);

  // 6. Canonical Serialization & SHA-256 Hash
  const providerPayloadJson = canonicalJsonSerialize(providerPayload);
  const providerPayloadHash = crypto
    .createHash("sha256")
    .update(providerPayloadJson)
    .digest("hex");

  const providerSpecHash = computeCatalogHash(modelDefinition.providerSpec);

  // 7. Obtain Authoritative Unit Cost using ALREADY PREPARED CANONICAL PAYLOAD JSON BYTES
  const unitPricingQuote = await estimateAuthoritativeModelCost({
    modelDefinition,
    alreadyPreparedPayload: providerPayload,
    alreadyPreparedPayloadJson: providerPayloadJson,
    fetchImpl,
    env,
  });

  if (!unitPricingQuote.priced) {
    throw new ModelPlatformError(
      ERROR_CODES.PRICING_UNAVAILABLE,
      `Authoritative pricing unavailable for model '${modelDefinition.productPolicy.id}': ${unitPricingQuote.reason}`,
      { reason: unitPricingQuote.reason, code: unitPricingQuote.code }
    );
  }

  // 8. Calculate Studio Multi-Output Commercial Pricing (outputCount)
  const workflowQuote = calculateWorkflowCommercialQuote({
    preparedUnitPlan: { pricing: unitPricingQuote },
    outputCount,
    perOutputCosts: {
      infra: modelDefinition.businessPolicy?.variableInfraCostMicroUsd || 0n,
    },
  });

  const provenance = modelDefinition.providerSpec?.provenance || {
    source: "BOOTSTRAP",
    loadedAt: new Date(nowMs).toISOString(),
    providerFetchedAt: null,
    stale: true,
  };

  // 9. Construct Secret-Free Prepared Execution Plan with Full Commercial Provenance
  const plan = {
    canonicalModelId: modelDefinition.productPolicy.id,
    providerModelId: modelDefinition.providerSpec.providerModelId,
    providerEndpoint: modelDefinition.providerSpec.endpoint,
    providerSpecHash,
    adapterRevision: modelDefinition.capabilityDescriptor?.adapterRevision || modelDefinition.adapter?.revision || null,
    capabilityRevision: modelDefinition.capabilityDescriptor?.capabilityRevision || null,
    provenance,
    providerPayload,
    providerPayloadJson,
    providerPayloadHash,
    earliestSignedAssetExpiry: normalizedInput?.earliestSignedAssetExpiryMs
      ? new Date(Number(normalizedInput.earliestSignedAssetExpiryMs)).toISOString()
      : null,
    transport: Object.freeze({
      webhookStrategy: "DOOLPHIN_MUAPI_V1",
    }),
    unitPricing: Object.freeze({
      pricingSource: unitPricingQuote.isDynamic ? "ESTIMATE_COST_DYNAMIC" : "CATALOG_FIXED",
      providerCostMicroUsd: unitPricingQuote.providerCostMicroUsd,
      fullyLoadedCostMicroUsd: unitPricingQuote.fullyLoadedCostMicroUsd,
      quotedCredits: unitPricingQuote.totalCredits,
      pricingRevisionId: unitPricingQuote.pricingRevisionId,
      contributionMarginBps: unitPricingQuote.contributionMarginBps,
      costComponents: unitPricingQuote.costComponents,
      estimatedAt: unitPricingQuote.estimatedAt || new Date(nowMs).toISOString(),
    }),
    workflowPricing: Object.freeze({
      outputCount: workflowQuote.outputCount,
      totalProviderCostMicroUsd: workflowQuote.totalProviderCostMicroUsd,
      fullyLoadedCostMicroUsd: workflowQuote.fullyLoadedCostMicroUsd,
      quotedCredits: workflowQuote.quotedCredits,
      pricingRevisionId: workflowQuote.pricingRevisionId,
      costComponents: workflowQuote.costComponents,
      settlementSchedule: workflowQuote.settlementSchedule,
    }),

    // Legacy Compatibility Proxy Properties
    pricing: Object.freeze({
      source: unitPricingQuote.isDynamic ? "ESTIMATE_COST_DYNAMIC" : "CATALOG_FIXED",
      providerCostMicroUsd: unitPricingQuote.providerCostMicroUsd,
      fullyLoadedCostMicroUsd: workflowQuote.fullyLoadedCostMicroUsd,
      quotedCredits: workflowQuote.quotedCredits,
      pricingRevisionId: workflowQuote.pricingRevisionId,
      estimatedAt: unitPricingQuote.estimatedAt || new Date(nowMs).toISOString(),
    }),

    preparedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(preparedPlanExpiresAtMs).toISOString(),
  };

  return deepFreeze(plan);
}
