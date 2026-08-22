import { nativeAudioIsExpected, parseCapabilitySnapshot } from "./deliveryPolicy.js";

const VIDEO_CODECS = new Set(["h264", "hevc", "h265", "av1", "vp9"]);
const AUDIO_CODECS = new Set(["aac", "mp3", "opus", "ac3", "eac3", "vorbis"]);
const RESOLUTION_SHORT_EDGES = Object.freeze({
  "480p": [480],
  "720p": [720],
  "1080p": [1080],
  "2k": [1440],
  "4k": [2160],
});

function normalizedList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase());
  if (Array.isArray(value?.values)) return value.values.map((item) => String(item).toLowerCase());
  return [];
}

function parseRatio(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "adaptive" || normalized === "auto") return null;
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function dimensionsMatchResolution({ width, height, resolution }) {
  const targets = RESOLUTION_SHORT_EDGES[String(resolution || "").toLowerCase()];
  if (!targets) return true;
  const shortEdge = Math.min(width, height);
  return targets.some((target) => Math.abs(shortEdge - target) <= Math.max(16, target * 0.04));
}

export function deriveVideoMediaRequirements({ creation = {}, capabilitySnapshot = {} } = {}) {
  const capability = parseCapabilitySnapshot(capabilitySnapshot);
  const advertisedRatios = normalizedList(capability.aspectRatios);
  const advertisedResolutions = normalizedList(capability.resolutions);
  const requestedRatio = String(creation.aspectRatio || (advertisedRatios.length === 1 ? advertisedRatios[0] : "")).toLowerCase() || null;
  const requestedResolution = String(creation.resolution || (advertisedResolutions.length === 1 ? advertisedResolutions[0] : "")).toLowerCase() || null;

  return {
    requestedRatio,
    requestedResolution,
    expectedRatio: parseRatio(requestedRatio),
    expectedDurationSeconds: Number(creation.duration || 0),
    requireAudio: nativeAudioIsExpected(capability),
    advertisedRatios,
    advertisedResolutions,
    selectionAdvertised:
      (!requestedRatio || requestedRatio === "adaptive" || requestedRatio === "auto" || advertisedRatios.length === 0 || advertisedRatios.includes(requestedRatio)) &&
      (!requestedResolution || advertisedResolutions.length === 0 || advertisedResolutions.includes(requestedResolution)),
  };
}

export function validateVideoMedia({ probe, byteLength, creation, capabilitySnapshot } = {}) {
  const requirements = deriveVideoMediaRequirements({ creation, capabilitySnapshot });
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  const width = Number(videoStream?.width || 0);
  const height = Number(videoStream?.height || 0);
  const duration = Number(probe?.format?.duration || 0);
  const actualRatio = width > 0 && height > 0 ? width / height : 0;
  const ratioTolerance = requirements.expectedRatio ? Math.max(0.035, requirements.expectedRatio * 0.035) : null;
  const durationTolerance = requirements.expectedDurationSeconds > 0
    ? Math.max(3, requirements.expectedDurationSeconds * 0.15)
    : null;

  const checks = {
    hasDecodableVideo: Boolean(videoStream && width > 0 && height > 0 && duration > 0),
    plausibleSize: Number(byteLength || 0) > 1000,
    videoCodec: VIDEO_CODECS.has(String(videoStream?.codec_name || "").toLowerCase()),
    audioPresent: !requirements.requireAudio || Boolean(audioStream),
    audioCodec: !audioStream || AUDIO_CODECS.has(String(audioStream.codec_name || "").toLowerCase()),
    selectionAdvertised: requirements.selectionAdvertised,
    aspectRatio: !requirements.expectedRatio || Math.abs(actualRatio - requirements.expectedRatio) <= ratioTolerance,
    resolution: !requirements.requestedResolution || dimensionsMatchResolution({ width, height, resolution: requirements.requestedResolution }),
    duration: !durationTolerance || Math.abs(duration - requirements.expectedDurationSeconds) <= durationTolerance,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    requirements,
    observed: {
      width,
      height,
      durationSeconds: duration,
      aspectRatio: actualRatio,
      videoCodec: videoStream?.codec_name || null,
      audioCodec: audioStream?.codec_name || null,
      hasAudio: Boolean(audioStream),
      byteLength: Number(byteLength || 0),
    },
  };
}
