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

  const images = Array.isArray(providerImageUrls) ? providerImageUrls.map(String) : [];

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

  const images = [];
  if (Array.isArray(legacyRequest.assets)) {
    legacyRequest.assets.forEach((asset) => {
      if (typeof asset === "string") images.push(asset);
      else if (asset?.url && asset?.role !== "SCREEN_RECORDING") images.push(asset.url);
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
