/**
 * Narrow Legacy Studio Workflow -> Normalized Invocation Bridge.
 * Maps legacy UGC Studio workflow request fields (assets, avatar, script, instructions, settings, compiledPrompt)
 * into a clean Doolphin normalized model invocation.
 *
 * NOTE: Keeps generic model platform contracts completely decoupled from UGC-specific fields.
 */

export function mapStudioWorkflowToNormalizedInvocation(legacyRequest = {}) {
  const prompt =
    legacyRequest.compiledPrompt ||
    legacyRequest.prompt ||
    legacyRequest.script ||
    legacyRequest.instructions ||
    "";

  const settings = legacyRequest.settings || {};
  const duration = Number(settings.durationSeconds || settings.duration || 5);
  const aspectRatio = settings.aspectRatio || "9:16";
  const generateAudio = settings.generateAudio !== false;

  const images = [];
  if (Array.isArray(legacyRequest.assets)) {
    legacyRequest.assets.forEach((asset) => {
      if (typeof asset === "string") images.push(asset);
      else if (asset?.url) images.push(asset.url);
    });
  }
  if (legacyRequest.avatar?.imageUrl) {
    images.push(legacyRequest.avatar.imageUrl);
  }

  return {
    prompt: String(prompt).trim(),
    duration,
    aspectRatio,
    generateAudio,
    extraInputs: {
      images,
    },
  };
}
