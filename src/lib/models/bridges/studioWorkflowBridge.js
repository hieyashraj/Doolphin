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

  return {
    prompt: promptStr.trim(),
    duration,
    aspectRatio,
    generateAudio,
    earliestSignedAssetExpiryMs: earliestSignedAssetExpiryMs ? Number(earliestSignedAssetExpiryMs) : null,
    extraInputs: {
      images,
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
