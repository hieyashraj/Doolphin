import crypto from "node:crypto";

/**
 * Server-Side Shadow Preflight Telemetry Logger.
 * Strictly redacts prompts, signed asset URLs, API keys, and webhook secrets.
 */

export function hashString(str) {
  if (!str || typeof str !== "string") return null;
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, 16);
}

export function recordShadowPreflightTelemetry({
  canonicalModelId,
  providerModelId,
  legacyEndpoint,
  newEndpoint,
  legacyPayloadHash,
  newPayloadHash,
  providerSpecHash,
  legacyCostUsd,
  authoritativeMuapiCostUsd,
  legacyQuotedCredits,
  newQuotedCredits,
  legacyPreflightDurationMs = 0,
  shadowDurationMs = 0,
  shadowTimedOut = false,
  shadowStatus = "SUCCESS",
  shadowErrorCode = null,
} = {}) {
  const legacyCredits = Number(legacyQuotedCredits || 0);
  const newCredits = Number(newQuotedCredits || 0);
  const absoluteCreditVariance = Math.abs(newCredits - legacyCredits);

  const legacyCost = Number(legacyCostUsd || 0);
  const newCost = Number(authoritativeMuapiCostUsd || 0);
  const percentageCostVariance = legacyCost > 0 ? Math.round(Math.abs(newCost - legacyCost) / legacyCost * 10000) / 100 : 0;

  const telemetryEvent = {
    event: "model_platform_shadow_preflight",
    timestamp: new Date().toISOString(),
    canonicalModelId: canonicalModelId || "unknown",
    providerModelId: providerModelId || "unknown",
    legacyEndpoint: legacyEndpoint || null,
    newEndpoint: newEndpoint || null,
    legacyPayloadHash: hashString(legacyPayloadHash),
    newPayloadHash: hashString(newPayloadHash),
    providerSpecHash: hashString(providerSpecHash),
    legacyCostUsd: legacyCost,
    authoritativeMuapiCostUsd: newCost,
    legacyQuotedCredits: legacyCredits,
    newQuotedCredits: newCredits,
    absoluteCreditVariance,
    percentageCostVariance,
    legacyPreflightDurationMs: Math.round(legacyPreflightDurationMs),
    shadowDurationMs: Math.round(shadowDurationMs),
    shadowTimedOut: Boolean(shadowTimedOut),
    shadowStatus,
    shadowErrorCode,
  };

  console.log("[ShadowPreflight]", JSON.stringify(telemetryEvent));
  return telemetryEvent;
}
