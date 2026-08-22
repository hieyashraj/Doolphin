/**
 * Browser-safe initial model choices for CreationHub.
 *
 * Keep this file deliberately small and dependency-free.  CreationHub is a
 * client component, whereas the complete provider catalog is server-only
 * implementation data (it includes a large JSON import and provider payload
 * transformers).  Loading that catalog in the initial browser render made a
 * failure there take down every studio at once.
 *
 * The authenticated /api/models request replaces this video fallback with the
 * plan-eligible catalog after the workspace has mounted.  This fallback is a
 * real, registered MuAPI model, not a placeholder, so the Video Studio remains
 * usable while that request is in flight or temporarily unavailable.
 */
export const INITIAL_VIDEO_MODELS = Object.freeze([
  Object.freeze({
    id: "muapi.seedance2.omni-reference-fast",
    name: "Seedance 2 Omni Reference Fast",
    description: "Fast 720p reference video",
    provider: "MUAPI",
    generationMode: "image-to-video",
    family: "seedance",
    resolutions: Object.freeze(["720p"]),
    aspectRatios: Object.freeze(["9:16", "16:9", "3:4", "4:3"]),
    minDuration: 4,
    maxDuration: 15,
    maxImages: 9,
    maxVideoReferences: 0,
    requiresImage: true,
    requiresVideo: false,
  }),
]);

/** Normalise the server's serialisable catalog for the existing form contract. */
export function normaliseVideoModels(models) {
  if (!Array.isArray(models)) return INITIAL_VIDEO_MODELS;
  const valid = models
    .filter((model) => model && typeof model.id === "string" && model.id)
    .map((model) => ({
      ...model,
      resolutions: Array.isArray(model.resolutions) && model.resolutions.length ? model.resolutions : ["720p"],
      aspectRatios: Array.isArray(model.aspectRatios) && model.aspectRatios.length ? model.aspectRatios : ["9:16", "16:9"],
      minDuration: Number.isFinite(model.minDuration) ? model.minDuration : 4,
      maxDuration: Number.isFinite(model.maxDuration) ? model.maxDuration : 10,
      maxImages: Number.isFinite(model.maxImages) ? model.maxImages : 1,
      maxVideoReferences: Number.isFinite(model.maxVideoReferences) ? model.maxVideoReferences : 0,
    }));
  return valid.length ? valid : INITIAL_VIDEO_MODELS;
}
