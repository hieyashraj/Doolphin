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

/**
 * Single-Emission Shadow Execution Race Guard.
 * Guarantees exactly one terminal telemetry event per shadow invocation.
 */
export async function runShadowWithSingleTelemetry({
  shadowFn,
  legacyStartTimestamp = Date.now(),
  legacyModel,
  legacyQuoteBreakdown,
  legacyPayloadFingerprint,
  timeoutMs = 250,
  telemetryRecorder = recordShadowPreflightTelemetry,
}) {
  const shadowStart = Date.now();
  const legacyPreflightDurationMs = shadowStart - legacyStartTimestamp;

  let isFinalized = false;
  let timerId = null;

  const emitTelemetryOnce = (data) => {
    if (isFinalized) return;
    isFinalized = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    telemetryRecorder(data);
  };

  const shadowPromise = (async () => {
    try {
      const plan = await shadowFn();
      if (isFinalized) return;

      const shadowDurationMs = Date.now() - shadowStart;
      emitTelemetryOnce({
        canonicalModelId: plan?.canonicalModelId || legacyModel?.id || "unknown",
        providerModelId: plan?.providerModelId || "unknown",
        legacyEndpoint: legacyModel?.endpoint || null,
        newEndpoint: plan?.providerEndpoint || null,
        legacyPayloadHash: legacyPayloadFingerprint,
        newPayloadHash: plan?.providerPayloadHash || null,
        providerSpecHash: plan?.providerSpecHash || null,
        legacyCostUsd: Number(legacyQuoteBreakdown?.components?.providerGeneration || 0) / 1_000_000,
        authoritativeMuapiCostUsd: Number(plan?.pricing?.providerCostMicroUsd || 0) / 1_000_000,
        legacyQuotedCredits: legacyQuoteBreakdown?.totalCredits || 0,
        newQuotedCredits: plan?.pricing?.quotedCredits || 0,
        legacyPreflightDurationMs,
        shadowDurationMs,
        shadowTimedOut: false,
        shadowStatus: "SUCCESS",
      });
    } catch (error) {
      if (isFinalized) return;

      const shadowDurationMs = Date.now() - shadowStart;
      console.warn("[ShadowPreflight] Isolated shadow exception:", error.message);
      emitTelemetryOnce({
        canonicalModelId: legacyModel?.id || "unknown",
        legacyEndpoint: legacyModel?.endpoint || null,
        legacyPreflightDurationMs,
        shadowDurationMs,
        shadowTimedOut: false,
        shadowStatus: "SHADOW_FAILED",
        shadowErrorCode: error.code || "SHADOW_EXCEPTION",
      });
    }
  })();

  const timeoutPromise = new Promise((resolve) => {
    timerId = setTimeout(() => {
      if (!isFinalized) {
        const shadowDurationMs = Date.now() - shadowStart;
        emitTelemetryOnce({
          canonicalModelId: legacyModel?.id || "unknown",
          legacyEndpoint: legacyModel?.endpoint || null,
          legacyPreflightDurationMs,
          shadowDurationMs,
          shadowTimedOut: true,
          shadowStatus: "SHADOW_TIMEOUT",
          shadowErrorCode: "SHADOW_TIMEOUT",
        });
      }
      resolve();
    }, timeoutMs);
  });

  await Promise.race([shadowPromise, timeoutPromise]);
}
