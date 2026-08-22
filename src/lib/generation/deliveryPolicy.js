function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseCapabilitySnapshot(value) {
  return parseJsonObject(value);
}

export function isAuthenticatedImageDeliveryJob(job) {
  const capability = parseCapabilitySnapshot(job?.capabilitySnapshot);
  const generationType = job?.variant?.creation?.generationType;
  return generationType === "IMAGE_STUDIO" ||
    capability.mediaType === "IMAGE" ||
    capability.completionStrategy === "MUAPI_AUTHENTICATED_ASYNC_IMAGE_V1" ||
    capability.finalizerStrategy === "DOOLPHIN_IMAGE_ATOMIC_V1";
}

export function verificationModelIdsForCapability(capabilitySnapshot) {
  return nativeAudioIsExpected(capabilitySnapshot)
    ? ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"]
    : ["muapi.gemini-2.5-flash-verifier"];
}

export function nativeAudioIsExpected(capabilitySnapshot) {
  const capability = parseCapabilitySnapshot(capabilitySnapshot);
  if (typeof capability.nativeAudioRequested === "boolean") return capability.nativeAudioRequested;
  if (typeof capability.generateAudio === "boolean") return capability.generateAudio;
  if (typeof capability.nativeAudio === "boolean") return capability.nativeAudio;
  if (capability.nativeAudio && typeof capability.nativeAudio === "object") {
    if (capability.nativeAudio.supported !== true) return false;
    return capability.nativeAudio.default !== false;
  }
  if (typeof capability.supportsNativeAudio === "boolean") return capability.supportsNativeAudio;
  // Old Seedance snapshots predate an audio capability field and historically
  // promised spoken output. Preserve that behavior while new snapshots are
  // explicit and silent-capable models are never rejected for missing audio.
  return true;
}


export function buildWebhookDispatchUrl(endpoint, callbackUrl) {
  let dispatch;
  let callback;
  try {
    dispatch = new URL(endpoint);
    callback = new URL(callbackUrl);
  } catch {
    throw new Error("Provider endpoint and callback must be absolute HTTP(S) URLs");
  }
  if (!["http:", "https:"].includes(dispatch.protocol) || !["http:", "https:"].includes(callback.protocol)) {
    throw new Error("Provider endpoint and callback must be absolute HTTP(S) URLs");
  }
  dispatch.searchParams.set("webhook", callback.toString());
  return dispatch.toString();
}


export function shouldReplayDeliveryCallback(job) {
  const verifierRetry = ["muapi.openai-whisper", "muapi.gemini-2.5-flash-verifier"].includes(job?.internalModelId) &&
    job?.status === "SUCCEEDED" &&
    ["delivery_retry", "delivery_finalizing"].includes(job?.variant?.currentStage);
  const imageRetry = isAuthenticatedImageDeliveryJob(job) &&
    ["result_processing_retry", "delivery_finalizing"].includes(job?.variant?.currentStage) &&
    !["FAILED", "CANCELLED"].includes(job?.status);
  return verifierRetry || imageRetry;
}
