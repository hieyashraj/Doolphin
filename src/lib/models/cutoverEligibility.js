/**
 * Explicit Seedance Model Platform Cutover Eligibility Helper (Phase 4C.1).
 */
const APPROVED_SEEDANCE_MODEL_IDS = new Set([
  "muapi.seedance2.omni-reference-fast",
  "seedance-2-omni-reference-no-video-fast",
  "seedance-2",
]);

export function isSeedanceModelPlatformCutoverEligible({ modelId, env = process.env } = {}) {
  if (env.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED !== "true") {
    return false;
  }
  if (!modelId || typeof modelId !== "string") {
    return false;
  }
  return APPROVED_SEEDANCE_MODEL_IDS.has(modelId);
}

/**
 * Server-controlled Model Identity Binding Alias Map.
 */
const SERVER_CONTROLLED_MODEL_ALIAS_MAP = new Map([
  ["muapi.seedance2.omni-reference-fast", "seedance-2-omni-reference-no-video-fast"],
  ["seedance-2", "seedance-2-omni-reference-no-video-fast"],
  ["seedance-2-omni-reference-no-video-fast", "seedance-2-omni-reference-no-video-fast"],
  ["muapi.grok-imagine-image-2-edit", "grok-imagine-image-2-edit"],
  ["grok-imagine-image-2-edit", "grok-imagine-image-2-edit"],
]);

export function validateProviderModelIdentityBinding({ requestedModelId, returnedProviderModelId, canonicalModelId } = {}) {
  if (!returnedProviderModelId || typeof returnedProviderModelId !== "string") {
    return false;
  }

  // Exact match
  if (returnedProviderModelId === requestedModelId || (canonicalModelId && returnedProviderModelId === canonicalModelId)) {
    return true;
  }

  // Declared server-controlled alias map
  const allowedAlias = SERVER_CONTROLLED_MODEL_ALIAS_MAP.get(requestedModelId) || (canonicalModelId ? SERVER_CONTROLLED_MODEL_ALIAS_MAP.get(canonicalModelId) : null);
  if (allowedAlias && returnedProviderModelId === allowedAlias) {
    return true;
  }

  return false;
}
