import crypto from "node:crypto";
import { getModel } from "../registry.js";
import { validateAndTransformInvocationInput } from "../contracts/invocationContract.js";
import { estimateAuthoritativeModelCost } from "./estimateCost.js";
import { computeCatalogHash } from "../providerCatalog.js";
import { ModelPlatformError, ERROR_CODES } from "../errors.js";

const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minute safety margin

export function resolveServerWebhookUrl(env = process.env) {
  const configuredBase = env.DOOLPHIN_WEBHOOK_URL || env.NEXT_PUBLIC_APP_URL || "https://api.doolphin.com";
  let baseUrl;
  try {
    const parsed = new URL(configuredBase);
    baseUrl = parsed.protocol === "https:" ? parsed.origin : "https://api.doolphin.com";
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
 * Server-Only Prepared Execution Plan Core (Phase 4A.2).
 */

export async function prepareExecutionPlan({
  modelId,
  normalizedInput,
  fetchImpl = fetch,
  env = process.env,
  planTtlMs = 15 * 60 * 1000,
  safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS,
} = {}) {
  // 1. Resolve Model
  const modelDefinition = await getModel(modelId);
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

  // 7. Obtain Authoritative Cost using ALREADY PREPARED CANONICAL PAYLOAD JSON BYTES
  const pricingQuote = await estimateAuthoritativeModelCost({
    modelDefinition,
    alreadyPreparedPayload: providerPayload,
    alreadyPreparedPayloadJson: providerPayloadJson,
    fetchImpl,
    env,
  });

  if (!pricingQuote.priced) {
    throw new ModelPlatformError(
      ERROR_CODES.PRICING_UNAVAILABLE,
      `Authoritative pricing unavailable for model '${modelDefinition.productPolicy.id}': ${pricingQuote.reason}`,
      { reason: pricingQuote.reason, code: pricingQuote.code }
    );
  }

  // 8. Construct Secret-Free Prepared Execution Plan
  const plan = {
    canonicalModelId: modelDefinition.productPolicy.id,
    providerModelId: modelDefinition.providerSpec.providerModelId,
    providerEndpoint: modelDefinition.providerSpec.endpoint,
    providerSpecHash,
    providerPayload,
    providerPayloadJson,
    providerPayloadHash,
    transport: Object.freeze({
      webhookStrategy: "DOOLPHIN_MUAPI_V1",
    }),
    pricing: Object.freeze({
      source: pricingQuote.isDynamic ? "ESTIMATE_COST_DYNAMIC" : "CATALOG_FIXED",
      providerCostMicroUsd: pricingQuote.providerCostMicroUsd,
      fullyLoadedCostMicroUsd: pricingQuote.fullyLoadedCostMicroUsd,
      quotedCredits: pricingQuote.totalCredits,
      pricingRevisionId: pricingQuote.pricingRevisionId,
      contributionMarginBps: pricingQuote.contributionMarginBps,
      costComponents: pricingQuote.costComponents,
      estimatedAt: pricingQuote.estimatedAt || new Date(nowMs).toISOString(),
    }),
    preparedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(preparedPlanExpiresAtMs).toISOString(),
  };

  return deepFreeze(plan);
}
