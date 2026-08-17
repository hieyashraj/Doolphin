/**
 * Server-controlled Model Identity Binding Alias Map.
 *
 * Note: the feature-flagged Seedance Model Platform cutover
 * (isSeedanceModelPlatformCutoverEligible, gated by
 * MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED) has been fully retired.
 * MODEL_PLATFORM_V1 is now the sole authoritative dispatch path
 * unconditionally (see src/app/api/preflight/route.js and
 * src/app/api/generations/route.js). validateProviderModelIdentityBinding
 * below remains load-bearing production security logic (Phase 4B.3
 * dispatch-time identity verification) and is unrelated to that retired flag.
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
