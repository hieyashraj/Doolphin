import { EXPLORE_IMAGES, getExploreImageById } from "../explore-images-data.js";
import { R2StorageService } from "../storage/r2StorageService.js";

/**
 * Validates array of exploreImageIds against authoritative manifest.
 * Prevents unknown IDs, null/undefined, and path traversal attempts.
 */
export function validateExploreImageIds(exploreImageIds) {
  if (!Array.isArray(exploreImageIds)) return [];
  const valid = [];
  const seen = new Set();

  for (const rawId of exploreImageIds) {
    if (typeof rawId !== "string" || !rawId.trim()) continue;
    const id = rawId.trim();
    if (seen.has(id)) continue;
    
    const item = getExploreImageById(id);
    if (item) {
      seen.add(id);
      valid.push(item);
    }
  }

  return valid;
}

/**
 * Just-in-time resolution of curated explore image IDs to provider-accessible signed URLs.
 * Generated at server-side preflight/generation submission time.
 */
export async function resolveCuratedSignedUrls(exploreImageIds) {
  const items = validateExploreImageIds(exploreImageIds);
  if (!items.length) return [];

  const urls = await Promise.all(
    items.map(async (item) => {
      if (R2StorageService.isConfigured()) {
        return R2StorageService.generateSignedUrl({ storageKey: item.storageKey, expiresInSeconds: 3600 });
      }
      // Local fallback for local development environment
      return item.localUrl || item.thumbUrl;
    })
  );

  return urls;
}
