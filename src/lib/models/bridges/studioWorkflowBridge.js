/**
 * Legacy Studio Workflow -> Normalized Invocation Bridge.
 * Maps validated UGC Studio request and compiled prompt/assets into a Doolphin normalized model invocation.
 *
 * Invariant: Authoritative input comes from already validated/normalized request and canonical compiled prompt.
 */

export function mapValidatedStudioWorkflowToNormalizedInvocation({
  request = {},
  compiledPrompt = "",
  providerImageUrls = [],
  earliestSignedAssetExpiryMs = null,
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://doolphin.ai";
  const images = Array.isArray(providerImageUrls)
    ? providerImageUrls.map((urlStr) => {
        const str = String(urlStr || "");
        return str.startsWith("/") ? `${baseUrl}${str}` : str;
      })
    : [];

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

export function mapStudioWorkflowToNormalizedInvocation(legacyRequest = {}) {
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://doolphin.ai";
  const images = [];
  if (Array.isArray(legacyRequest.assets)) {
    legacyRequest.assets.forEach((asset) => {
      let u = null;
      if (typeof asset === "string") u = asset;
      else if (asset?.url && asset?.role !== "SCREEN_RECORDING") u = asset.url;
      if (u) {
        images.push(u.startsWith("/") ? `${baseUrl}${u}` : u);
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
