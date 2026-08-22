/**
 * Legacy Studio Workflow -> Normalized Invocation Bridge.
 * Maps validated UGC Studio request and compiled prompt/assets into a Doolphin normalized model invocation.
 *
 * Invariant: Authoritative input comes from already validated/normalized request and canonical compiled prompt.
 */

/**
 * Resolves a raw asset URL to an absolute provider-fetchable URL.
 *
 * Rules:
 * 1. Absolute HTTPS/HTTP URLs are preserved exactly.
 * 2. Relative URLs (starting with '/') require an explicit, valid trusted applicationOrigin.
 * 3. Relative URLs without an explicit applicationOrigin FAIL CLOSED (return null).
 * 4. Invalid URLs, unsupported schemes, or bad origins FAIL CLOSED (return null).
 *
 * Note: Never infer production ("https://doolphin.ai") or read global env inside this pure helper.
 */
export function resolveProviderAssetUrl(rawUrl, { applicationOrigin } = {}) {
  const urlStr = String(rawUrl || "").trim();
  if (!urlStr) return null;

  // 1. Absolute HTTPS / HTTP URLs are preserved exactly
  if (urlStr.startsWith("https://") || urlStr.startsWith("http://")) {
    try {
      const parsed = new URL(urlStr);
      return parsed.toString();
    } catch {
      return null;
    }
  }

  // 2. Relative URLs require an explicit trusted applicationOrigin
  if (urlStr.startsWith("/")) {
    if (!applicationOrigin || typeof applicationOrigin !== "string") {
      return null;
    }

    try {
      const parsedOrigin = new URL(applicationOrigin.trim());
      return new URL(urlStr, parsedOrigin.origin).toString();
    } catch {
      return null;
    }
  }

  // Fail closed for any unhandled or invalid format
  return null;
}

export function mapValidatedStudioWorkflowToNormalizedInvocation({
  request = {},
  compiledPrompt = "",
  providerImageUrls = [],
  earliestSignedAssetExpiryMs = null,
  applicationOrigin = null,
} = {}) {
  let promptStr = compiledPrompt;
  if (!promptStr && typeof request.prompt === "string") {
    promptStr = request.prompt;
  }

  // Safety guard against object stringification (e.g. script object)
  if (typeof promptStr !== "string") {
    promptStr = "";
  }

  const settings = request.settings || {};
  const duration = Number(settings.durationSeconds || settings.duration || 5);
  const aspectRatio = settings.aspectRatio || "9:16";
  const generateAudio = settings.generateAudio !== false;
  // Carried so the model definition can assert the quoted resolution matches
  // what its endpoint actually produces. Previously dropped here entirely,
  // which let a user pay for a resolution the payload never expressed.
  const resolution = settings.resolution || null;

  const images = [];
  if (Array.isArray(providerImageUrls)) {
    for (const urlStr of providerImageUrls) {
      const resolved = resolveProviderAssetUrl(urlStr, { applicationOrigin });
      if (!resolved) {
        throw new Error(`[ModelPlatformBridge] Cannot resolve asset URL '${urlStr}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
      }
      images.push(resolved);
    }
  }
  const videos = [];
  for (const asset of request.assets || []) {
    if (!["APP_SCREEN_RECORDING", "PRODUCT_MOTION_REFERENCE"].includes(asset?.role) || !asset.url) continue;
    const resolved = resolveProviderAssetUrl(asset.url, { applicationOrigin });
    if (!resolved) {
      throw new Error(`[ModelPlatformBridge] Cannot resolve screen recording '${asset.alias || asset.assetId}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
    }
    videos.push(resolved);
  }

  // A generic image-to-video transformer accepts one explicit source image.
  // The old bridge supplied the complete reference list only, which meant the
  // first item (normally the avatar) became the source and an App Studio
  // screenshot was ignored.  Preserve the full list for multi-reference
  // models, while explicitly choosing the studio's primary deliverable for
  // single-source models.
  const primaryImageAsset = request.assets?.find((asset) => asset?.role === "APP_PRIMARY_SCREEN")
    || request.assets?.find((asset) => asset?.role === "PRIMARY_PRODUCT")
    || request.assets?.find((asset) => asset?.role === "STYLE_REFERENCE")
    || null;
  const sourceVideoAsset = request.assets?.find((asset) => asset?.role === "APP_SCREEN_RECORDING" || asset?.role === "PRODUCT_MOTION_REFERENCE") || null;
  const imageUrl = primaryImageAsset?.url
    ? resolveProviderAssetUrl(primaryImageAsset.url, { applicationOrigin })
    : null;
  const sourceVideo = sourceVideoAsset?.url
    ? resolveProviderAssetUrl(sourceVideoAsset.url, { applicationOrigin })
    : null;

  if (primaryImageAsset?.url && !imageUrl) {
    throw new Error(`[ModelPlatformBridge] Cannot resolve primary image asset '${primaryImageAsset.alias || primaryImageAsset.assetId}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
  }
  if (sourceVideoAsset?.url && !sourceVideo) {
    throw new Error(`[ModelPlatformBridge] Cannot resolve screen recording '${sourceVideoAsset.alias || sourceVideoAsset.assetId}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
  }

  const audios = [];
  for (const asset of request.assets || []) {
    if (asset?.role !== "PRODUCT_AUDIO_REFERENCE" || !asset.url) continue;
    const resolved = resolveProviderAssetUrl(asset.url, { applicationOrigin });
    if (!resolved) throw new Error(`[ModelPlatformBridge] Cannot resolve product audio reference '${asset.alias || asset.assetId}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
    audios.push(resolved);
  }

  return {
    prompt: promptStr.trim(),
    duration,
    aspectRatio,
    generateAudio,
    ...(resolution ? { resolution } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(sourceVideo ? { sourceVideo } : {}),
    earliestSignedAssetExpiryMs: earliestSignedAssetExpiryMs ? Number(earliestSignedAssetExpiryMs) : null,
    extraInputs: {
      images,
      videos,
      audios,
    },
  };
}

export function mapStudioWorkflowToNormalizedInvocation(legacyRequest = {}, options = {}) {
  const applicationOrigin = typeof options === "string" ? options : options?.applicationOrigin;
  const promptStr = typeof legacyRequest.compiledPrompt === "string"
    ? legacyRequest.compiledPrompt
    : typeof legacyRequest.prompt === "string"
    ? legacyRequest.prompt
    : typeof legacyRequest.script === "string"
    ? legacyRequest.script
    : "";

  const settings = legacyRequest.settings || {};
  const duration = Number(settings.durationSeconds || settings.duration || 5);
  const aspectRatio = settings.aspectRatio || "9:16";
  const generateAudio = settings.generateAudio !== false;

  const images = [];
  if (Array.isArray(legacyRequest.assets)) {
    legacyRequest.assets.forEach((asset) => {
      let u = null;
      if (typeof asset === "string") u = asset;
      else if (asset?.url && asset?.role !== "SCREEN_RECORDING") u = asset.url;
      if (u) {
        const resolved = resolveProviderAssetUrl(u, { applicationOrigin });
        if (resolved) images.push(resolved);
      }
    });
  }

  return {
    prompt: promptStr.trim(),
    duration,
    aspectRatio,
    generateAudio,
    extraInputs: {
      images,
    },
  };
}
