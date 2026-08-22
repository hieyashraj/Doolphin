/**
 * Studio workflow -> provider-neutral invocation bridge.
 * Authoritative input comes from the validated request and compiled prompt.
 */
export function resolveProviderAssetUrl(rawUrl, { applicationOrigin } = {}) {
  const urlStr = String(rawUrl || "").trim();
  if (!urlStr) return null;
  if (urlStr.startsWith("https://") || urlStr.startsWith("http://")) {
    try { return new URL(urlStr).toString(); } catch { return null; }
  }
  if (urlStr.startsWith("/")) {
    if (!applicationOrigin || typeof applicationOrigin !== "string") return null;
    try {
      const parsedOrigin = new URL(applicationOrigin.trim());
      return new URL(urlStr, parsedOrigin.origin).toString();
    } catch { return null; }
  }
  return null;
}

function resolveAsset(rawUrl, applicationOrigin) {
  const resolved = resolveProviderAssetUrl(rawUrl, { applicationOrigin });
  if (!resolved) {
    throw new Error(`[ModelPlatformBridge] Cannot resolve asset URL '${rawUrl}' to an absolute provider-fetchable URL without an explicit applicationOrigin`);
  }
  return resolved;
}

function resolveMany(values, applicationOrigin) {
  return Array.isArray(values) ? values.map((value) => resolveAsset(value, applicationOrigin)) : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function resolveModelDuration(settings, model) {
  const supplied = firstDefined(settings.durationSeconds, settings.duration);
  const suppliedIsAuto = typeof supplied === "string" && supplied.trim().toLowerCase() === "auto";
  if (supplied !== undefined && supplied !== null && supplied !== "" && !suppliedIsAuto) {
    const numeric = Number(supplied);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
    throw new Error(`[ModelPlatformBridge] Invalid supplied duration '${supplied}'`);
  }

  const descriptorValues = model?.durationValues || model?.duration?.values || [];
  if (descriptorValues.length === 1) {
    const fixedDuration = Number(descriptorValues[0]);
    if (Number.isInteger(fixedDuration) && fixedDuration > 0) return fixedDuration;
  }

  const minimumDuration = Number(firstDefined(model?.minDuration, model?.duration?.min));
  if (Number.isInteger(minimumDuration) && minimumDuration > 0) return minimumDuration;

  throw new Error("[ModelPlatformBridge] Cannot resolve an omitted duration without a valid model duration descriptor");
}

export function mapValidatedStudioWorkflowToNormalizedInvocation({
  request = {},
  model = null,
  compiledPrompt = "",
  providerImageUrls = [],
  providerVideoUrls = [],
  providerAudioUrls = [],
  earliestSignedAssetExpiryMs = null,
  applicationOrigin = null,
} = {}) {
  let prompt = compiledPrompt || (typeof request.prompt === "string" ? request.prompt : "");
  if (typeof prompt !== "string") prompt = "";

  const settings = request.settings || {};
  const images = resolveMany(providerImageUrls, applicationOrigin);
  const videos = resolveMany(providerVideoUrls, applicationOrigin);
  const audios = resolveMany(providerAudioUrls, applicationOrigin);
  const assets = Array.isArray(request.assets) ? request.assets : [];
  const urlsForRoles = (roles) => resolveMany(
    assets.filter((asset) => roles.includes(asset.role)).map((asset) => asset.url),
    applicationOrigin,
  );
  const actorImages = urlsForRoles(["ACTOR_REFERENCE"]);
  const sourceImages = urlsForRoles(["SOURCE_IMAGE"]);
  const sourceVideos = urlsForRoles(["SOURCE_VIDEO"]);
  const explicitReferenceImages = urlsForRoles(["REFERENCE_IMAGE", "STYLE_REFERENCE", "PRIMARY_PRODUCT", "PRODUCT_PACKAGING", "PRODUCT_USAGE_REFERENCE", "APP_PRIMARY_SCREEN"]);
  const explicitReferenceVideos = urlsForRoles(["REFERENCE_VIDEO", "APP_SCREEN_RECORDING"]);
  const explicitReferenceAudios = urlsForRoles(["REFERENCE_AUDIO"]);
  const startFrames = urlsForRoles(["START_FRAME"]);
  const endFrames = urlsForRoles(["END_FRAME"]);
  const slots = model?.slots || null;
  const explicitAudioControl = firstDefined(settings.generateAudio, settings.nativeAudio);
  const resolvedGenerateAudio = typeof explicitAudioControl === "boolean"
    ? explicitAudioControl
    : model?.nativeAudio?.supported && model.nativeAudio.controllable && typeof model.nativeAudio.default === "boolean"
    ? model.nativeAudio.default
    : undefined;
  const invocation = {
    prompt: model?.controls?.prompt?.supported === false ? "" : prompt.trim(),
    duration: resolveModelDuration(settings, model),
    ...(settings.aspectRatio ? { aspectRatio: settings.aspectRatio } : {}),
    ...(settings.resolution ? { resolution: settings.resolution } : {}),
    ...(settings.quality ? { quality: settings.quality } : {}),
    ...(typeof resolvedGenerateAudio === "boolean" ? { generateAudio: resolvedGenerateAudio } : {}),
    ...(Number.isInteger(settings.seed) ? { seed: settings.seed } : {}),
    ...(settings.sourceRequestId ? { sourceRequestId: String(settings.sourceRequestId) } : {}),
    ...(settings.camera ? { camera: settings.camera } : {}),
    ...(settings.motion ? { motion: settings.motion } : {}),
    ...(settings.modelParameters ? { modelParameters: settings.modelParameters } : {}),
    ...(earliestSignedAssetExpiryMs ? { earliestSignedAssetExpiryMs: Number(earliestSignedAssetExpiryMs) } : {}),
  };

  // Map only semantically matching, ownership-checked asset roles. This avoids
  // treating an avatar as a first frame or a product image as an edit source.
  if (model?.mode === "first-last-frame-to-video") {
    if (startFrames[0]) invocation.startFrame = startFrames[0];
    if (endFrames[0]) invocation.endFrame = endFrames[0];
  } else if (slots?.sourceImage?.supported) {
    const source = sourceImages[0] || actorImages[0] || images[0];
    if (source) invocation.sourceImage = source;
    if (slots.referenceImages?.supported) {
      const references = explicitReferenceImages.filter((url) => url !== source);
      if (references.length) invocation.referenceImages = references;
    }
  } else if (slots?.referenceImages?.supported) {
    const references = [...actorImages, ...explicitReferenceImages];
    const fallback = references.length ? references : images;
    if (fallback.length) invocation.referenceImages = [...new Set(fallback)];
  } else if (!model && images.length) {
    invocation.referenceImages = images;
  }

  if (slots?.sourceVideo?.supported) {
    const source = sourceVideos[0] || videos[0];
    if (source) invocation.sourceVideo = source;
  }
  if (slots?.referenceVideos?.supported) {
    const references = explicitReferenceVideos.length ? explicitReferenceVideos : videos.filter((url) => url !== invocation.sourceVideo);
    if (references.length) invocation.referenceVideos = references;
  }
  if (slots?.referenceAudios?.supported) {
    const references = explicitReferenceAudios.length ? explicitReferenceAudios : audios;
    if (references.length) invocation.referenceAudios = references;
  }

  const sourceImage = firstDefined(request.sourceImage, settings.sourceImage);
  const sourceVideo = firstDefined(request.sourceVideo, settings.sourceVideo);
  const sourceRequestId = firstDefined(request.sourceRequestId, settings.sourceRequestId);
  if (sourceImage) invocation.sourceImage = resolveAsset(sourceImage, applicationOrigin);
  if (sourceVideo) invocation.sourceVideo = resolveAsset(sourceVideo, applicationOrigin);
  if (sourceRequestId) invocation.sourceRequestId = String(sourceRequestId);

  const explicitImages = resolveMany(firstDefined(request.referenceImages, settings.referenceImages, []), applicationOrigin);
  const explicitVideos = resolveMany(firstDefined(request.referenceVideos, settings.referenceVideos, []), applicationOrigin);
  const explicitAudios = resolveMany(firstDefined(request.referenceAudios, settings.referenceAudios, []), applicationOrigin);
  if (explicitImages.length) invocation.referenceImages = explicitImages;
  if (explicitVideos.length) invocation.referenceVideos = explicitVideos;
  if (explicitAudios.length) invocation.referenceAudios = explicitAudios;

  const startFrame = firstDefined(request.startFrame, settings.startFrame);
  const endFrame = firstDefined(request.endFrame, settings.endFrame);
  if (startFrame) invocation.startFrame = resolveAsset(startFrame, applicationOrigin);
  if (endFrame) invocation.endFrame = resolveAsset(endFrame, applicationOrigin);
  if (request.storyboard) invocation.storyboard = request.storyboard;
  else if (request.scenes) invocation.scenes = request.scenes;
  return invocation;
}

export function mapStudioWorkflowToNormalizedInvocation(legacyRequest = {}, options = {}) {
  const applicationOrigin = typeof options === "string" ? options : options?.applicationOrigin;
  const model = typeof options === "object" ? options?.model : null;
  const prompt = typeof legacyRequest.compiledPrompt === "string"
    ? legacyRequest.compiledPrompt
    : typeof legacyRequest.prompt === "string"
    ? legacyRequest.prompt
    : typeof legacyRequest.script === "string"
    ? legacyRequest.script
    : "";
  const imageUrls = [];
  const videoUrls = [];
  for (const asset of legacyRequest.assets || []) {
    const url = typeof asset === "string" ? asset : asset?.url;
    if (!url || asset?.role === "APP_SCREEN_RECORDING") continue;
    if (String(asset?.mimeType || "").startsWith("video/")) videoUrls.push(url);
    else imageUrls.push(url);
  }
  return mapValidatedStudioWorkflowToNormalizedInvocation({
    request: legacyRequest,
    model,
    compiledPrompt: prompt,
    providerImageUrls: imageUrls,
    providerVideoUrls: videoUrls,
    applicationOrigin,
  });
}
