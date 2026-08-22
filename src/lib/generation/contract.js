import crypto from "crypto";
import { z } from "zod";
import { getGenerationModel } from "./modelRegistry.js";
import { calculateAuthoritativeGenerationQuote } from "./modelCostRegistry.js";

export const STUDIO_TYPES = ["VIDEO_STUDIO", "PRODUCT_STUDIO", "APP_STUDIO"];
export const DELIVERY_TYPES = ["AVATAR_DIALOGUE", "VOICEOVER", "MIXED"];
export const ASSET_ROLES = [
  "ACTOR_REFERENCE",
  "PRIMARY_PRODUCT",
  "PRODUCT_PACKAGING",
  "PRODUCT_USAGE_REFERENCE",
  "APP_PRIMARY_SCREEN",
  "APP_SCREEN_RECORDING",
  "STYLE_REFERENCE",
  "SOURCE_IMAGE",
  "SOURCE_VIDEO",
  "REFERENCE_IMAGE",
  "REFERENCE_VIDEO",
  "REFERENCE_AUDIO",
  "START_FRAME",
  "END_FRAME",
];

const ROLE_MEDIA_PREFIX = Object.freeze({
  ACTOR_REFERENCE: "image/",
  PRIMARY_PRODUCT: "image/",
  PRODUCT_PACKAGING: "image/",
  PRODUCT_USAGE_REFERENCE: "image/",
  APP_PRIMARY_SCREEN: "image/",
  APP_SCREEN_RECORDING: "video/",
  STYLE_REFERENCE: "image/",
  SOURCE_IMAGE: "image/",
  SOURCE_VIDEO: "video/",
  REFERENCE_IMAGE: "image/",
  REFERENCE_VIDEO: "video/",
  REFERENCE_AUDIO: "audio/",
  START_FRAME: "image/",
  END_FRAME: "image/",
});

const assetSchema = z.object({
  assetId: z.string().min(1),
  role: z.enum(ASSET_ROLES),
  alias: z.string().min(1).max(80),
  groupId: z.string().max(80).nullable().optional(),
  url: z.string().min(1),
  storageKey: z.string().nullable().optional(),
  originalFileName: z.string().max(255).optional(),
  mimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  detectedMimeType: z.string().max(100).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  codec: z.string().max(100).nullable().optional(),
  checksumSha256: z.string().max(128).optional(),
  analysisRevision: z.string().nullable().optional(),
  analysis: z.record(z.string(), z.unknown()).optional(),
});

const storyboardSceneSchema = z.object({
  description: z.string().trim().min(1).max(2000).optional(),
  scene: z.string().trim().min(1).max(2000).optional(),
  duration: z.number().positive(),
}).strict().refine((value) => Boolean(value.description || value.scene), {
  message: "A storyboard scene requires a description.",
});

export const generationRequestV1Schema = z.object({
  version: z.literal("1").default("1"),
  studio: z.enum(STUDIO_TYPES),
  modelId: z.string().min(1),
  modelLocked: z.literal(true).default(true),
  script: z.object({
    text: z.string().trim().max(300).default(""),
    language: z.string().default("auto"),
    maxCharacters: z.literal(300).default(300),
  }).strict(),
  instructions: z.object({
    raw: z.string().trim().max(1600).default(""),
    // Older clients sent `null` for an unselected delivery mode. Treat it as
    // omitted so the normal inference below can choose the safe default.
    confirmedDelivery: z.preprocess(
      (value) => value === null ? undefined : value,
      z.enum(DELIVERY_TYPES).optional(),
    ),
    confirmedScenePlanId: z.string().nullable().optional(),
  }).strict().default({ raw: "" }),
  settings: z.object({
    durationMode: z.enum(["AUTO", "EXPLICIT"]),
    durationSeconds: z.number().int().min(1).max(60).optional(),
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
    outputCount: z.number().int().min(1).max(4),
    quality: z.string().optional(),
    nativeAudio: z.boolean().optional(),
    generateAudio: z.boolean().optional(),
    seed: z.number().int().optional(),
    sourceRequestId: z.string().trim().min(1).optional(),
    camera: z.record(z.string(), z.unknown()).optional(),
    motion: z.record(z.string(), z.unknown()).optional(),
    modelParameters: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  storyboard: z.array(storyboardSceneSchema).max(30).optional(),
  scenes: z.array(storyboardSceneSchema).max(30).optional(),
  // All media references travel as owned UploadedAsset IDs. Raw provider URLs
  // are never accepted as top-level client input.
  assets: z.array(assetSchema).min(1).max(40),
}).strict();

export function estimateSpeechDurationSeconds(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  // Natural UGC speech: ~2.8 words/sec plus a short breathing/punctuation allowance.
  return Math.max(4, Math.ceil(words / 2.8 + 1));
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

export function inferDelivery(instructions = "") {
  const value = instructions.toLowerCase();
  if (value.includes("voiceover only") || value.includes("no talking head")) return "VOICEOVER";
  if (value.includes("mixed") || value.includes("combination") || (value.includes("b-roll") && value.includes("speak"))) return "MIXED";
  if (value.includes("voiceover") || value.includes("b-roll")) return "MIXED";
  return "AVATAR_DIALOGUE";
}

export function estimateAutoDurationSeconds(request, model, estimatedSpeechSeconds = estimateSpeechDurationSeconds(request.script.text)) {
  const delivery = request.instructions.confirmedDelivery || inferDelivery(request.instructions.raw);
  const rawInstructions = String(request.instructions.raw || "");
  const instructionWords = countWords(rawInstructions);
  const visualAssets = request.assets.filter((asset) => asset.role !== "ACTOR_REFERENCE" && asset.role !== "APP_SCREEN_RECORDING");

  let complexityBonus = 0;

  if (delivery === "VOICEOVER") complexityBonus += 1;
  if (delivery === "MIXED") complexityBonus += 2;

  if (request.studio === "PRODUCT_STUDIO") {
    const productGroups = new Set(
      request.assets
        .filter((asset) => asset.role.startsWith("PRIMARY_PRODUCT") || asset.role.startsWith("PRODUCT_"))
        .map((asset) => asset.groupId)
        .filter(Boolean),
    );
    complexityBonus += Math.max(0, productGroups.size - 1);
    if (visualAssets.length > 2) complexityBonus += 1;
  } else if (request.studio === "APP_STUDIO") {
    const appScreens = request.assets.filter((asset) => asset.role === "APP_PRIMARY_SCREEN");
    const appRecordings = request.assets.filter((asset) => asset.role === "APP_SCREEN_RECORDING");
    complexityBonus += Math.max(0, appScreens.length - 1);
    if (appRecordings.length) complexityBonus += 1;
  } else if (request.studio === "VIDEO_STUDIO") {
    const styleReferences = request.assets.filter((asset) => asset.role === "STYLE_REFERENCE");
    if (styleReferences.length) complexityBonus += 1;
  }

  if (/\b(b-?roll|cut|transition|demo|close[- ]?up|scene|product shot|screen demo|hold the phone)\b/i.test(rawInstructions)) {
    complexityBonus += 1;
  }

  if (instructionWords >= 25) complexityBonus += 1;
  if (instructionWords >= 55) complexityBonus += 1;

  const resolved = estimatedSpeechSeconds + complexityBonus;
  return Math.min(model.maxDuration, Math.max(model.minDuration, resolved));
}

function validationError(code, message, path = null) {
  return { code, message, path };
}

export function expectedMediaPrefixForRole(role) {
  return ROLE_MEDIA_PREFIX[role] || null;
}

export function normalizeAndValidateGenerationRequest(input) {
  const parsed = generationRequestV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => validationError("INVALID_REQUEST", issue.message, issue.path.join("."))),
    };
  }

  const request = structuredClone(parsed.data);
  const model = getGenerationModel(request.modelId);
  const errors = [];
  if (!model) {
    errors.push(validationError("UNSUPPORTED_MODEL", `Model '${request.modelId}' is not registered.`));
    return { valid: false, errors };
  }
  request.modelId = model.id;

  request.assets.sort((left, right) => Number(right.role === "ACTOR_REFERENCE") - Number(left.role === "ACTOR_REFERENCE"));
  const actors = request.assets.filter((asset) => asset.role === "ACTOR_REFERENCE");
  if (actors.length !== 1) errors.push(validationError("ACTOR_REQUIRED", "Exactly one selected avatar is required."));

  for (const asset of request.assets) {
    const expectedPrefix = ROLE_MEDIA_PREFIX[asset.role];
    const authoritativeMime = String(asset.detectedMimeType || asset.mimeType || "").toLowerCase();
    if (expectedPrefix && authoritativeMime && !authoritativeMime.startsWith(expectedPrefix)) {
      errors.push(validationError(
        "ASSET_ROLE_MEDIA_MISMATCH",
        `${asset.alias} is ${authoritativeMime}, but ${asset.role} requires ${expectedPrefix.slice(0, -1)} media.`,
        `assets.${asset.assetId}.role`,
      ));
    }
  }

  const duplicateAssetIds = request.assets.filter((asset, index, list) => list.findIndex((other) => other.assetId === asset.assetId) !== index);
  if (duplicateAssetIds.length) errors.push(validationError("DUPLICATE_ASSET_ID", "Every asset must have a unique stable assetId."));

  const checksumOwners = new Map();
  request.assets = request.assets.filter((asset) => {
    if (!asset.checksumSha256) return true;
    const first = checksumOwners.get(asset.checksumSha256);
    if (!first) {
      checksumOwners.set(asset.checksumSha256, asset);
      return true;
    }
    if (first.role !== asset.role || (first.groupId || null) !== (asset.groupId || null)) {
      errors.push(validationError("DUPLICATE_ROLE_CONFLICT", `The same file is assigned conflicting roles or groups ('${first.alias}' and '${asset.alias}').`));
      return false;
    }
    first.analysis = {
      ...(first.analysis || {}),
      duplicateAliases: [...new Set([...(first.analysis?.duplicateAliases || []), asset.alias])]
    };
    return false;
  });

  const imageProviderRoles = new Set([
    "ACTOR_REFERENCE", "PRIMARY_PRODUCT", "PRODUCT_PACKAGING", "PRODUCT_USAGE_REFERENCE",
    "APP_PRIMARY_SCREEN", "STYLE_REFERENCE", "SOURCE_IMAGE", "REFERENCE_IMAGE", "START_FRAME", "END_FRAME",
  ]);
  const providerImageAssets = request.assets.filter((asset) => imageProviderRoles.has(asset.role));
  const nonActorCount = providerImageAssets.length - actors.length;
  if (providerImageAssets.length > model.maxImages || nonActorCount > model.maxImages - 1) {
    errors.push(validationError("ASSET_LIMIT_EXCEEDED", `This model supports one avatar plus at most ${model.maxImages - 1} other images.`));
  }

  const countRole = (role) => request.assets.filter((asset) => asset.role === role).length;
  const explicitSourceImages = countRole("SOURCE_IMAGE");
  const explicitSourceVideos = countRole("SOURCE_VIDEO");
  const appScreenRecordings = countRole("APP_SCREEN_RECORDING");
  const sourceVideoCandidates = explicitSourceVideos + appScreenRecordings;
  const explicitReferenceImages = countRole("REFERENCE_IMAGE");
  const explicitReferenceVideos = countRole("REFERENCE_VIDEO");
  const explicitReferenceAudios = countRole("REFERENCE_AUDIO");
  const explicitStartFrames = countRole("START_FRAME");
  const explicitEndFrames = countRole("END_FRAME");

  if (explicitSourceImages > model.slots.sourceImage.max) errors.push(validationError("SOURCE_IMAGE_LIMIT_EXCEEDED", `This model accepts at most ${model.slots.sourceImage.max} source image.`));
  if (explicitSourceVideos > model.slots.sourceVideo.max) errors.push(validationError("SOURCE_VIDEO_LIMIT_EXCEEDED", model.slots.sourceVideo.supported ? `This model accepts at most ${model.slots.sourceVideo.max} source video.` : "This model does not accept a source video."));
  if (explicitReferenceImages > model.slots.referenceImages.max) errors.push(validationError("REFERENCE_IMAGE_LIMIT_EXCEEDED", `This model accepts at most ${model.slots.referenceImages.max} reference images.`));
  if (explicitReferenceVideos > model.slots.referenceVideos.max) errors.push(validationError("REFERENCE_VIDEO_LIMIT_EXCEEDED", `This model accepts at most ${model.slots.referenceVideos.max} reference videos.`));
  if (explicitReferenceAudios > model.slots.referenceAudios.max) errors.push(validationError("REFERENCE_AUDIO_LIMIT_EXCEEDED", `This model accepts at most ${model.slots.referenceAudios.max} reference audio files.`));
  const videoInputCapacity = model.slots.sourceVideo.max + model.slots.referenceVideos.max;
  if (appScreenRecordings > videoInputCapacity) {
    errors.push(validationError("APP_RECORDING_UNSUPPORTED", `${model.displayName} cannot consume the selected app screen recording.`));
  }
  if (explicitStartFrames > 1 || explicitEndFrames > 1) errors.push(validationError("FRAME_LIMIT_EXCEEDED", "Only one start frame and one end frame may be selected."));

  if (model.slots.sourceVideo.required && sourceVideoCandidates < model.slots.sourceVideo.min) errors.push(validationError("SOURCE_VIDEO_REQUIRED", "This model requires a source video."));
  if (model.slots.referenceImages.required && providerImageAssets.length < model.slots.referenceImages.min) errors.push(validationError("REFERENCE_IMAGES_REQUIRED", `This model requires at least ${model.slots.referenceImages.min} reference image(s).`));
  if (model.requiredSlots.includes("startFrame") && explicitStartFrames !== 1) errors.push(validationError("START_FRAME_REQUIRED", "This model requires a start frame."));
  if (model.controls.sourceRequestId.required && !request.settings.sourceRequestId) errors.push(validationError("SOURCE_REQUEST_ID_REQUIRED", "This model requires the previous provider request ID."));
  const storyboard = request.storyboard || request.scenes;
  if (model.controls.storyboard.required && !storyboard?.length) errors.push(validationError("STORYBOARD_REQUIRED", "This model requires at least one storyboard scene."));
  if (model.controls.prompt.required && !request.script.text && !request.instructions.raw) errors.push(validationError("PROMPT_REQUIRED", "Enter a prompt or script for this model."));

  if (request.studio === "PRODUCT_STUDIO") {
    const products = request.assets.filter((asset) => asset.role.startsWith("PRIMARY_PRODUCT") || asset.role.startsWith("PRODUCT_"));
    if (!products.length) errors.push(validationError("PRODUCT_REQUIRED", "Product Studio requires at least one product image."));
    if (products.some((asset) => !asset.groupId || asset.groupId === "product_group_1" || asset.groupId.startsWith("unconfirmed_"))) errors.push(validationError("PRODUCT_GROUP_REQUIRED", "Name and confirm every product group before generation."));
    const groups = [...new Set(products.map((asset) => asset.groupId).filter(Boolean))];
    if (groups.length > 1 && /\b(first|second|third|last|other)\s+(one|product)\b/i.test(request.instructions.raw)) {
      errors.push(validationError("AMBIGUOUS_PRODUCT_REFERENCE", `Name the product group directly (${groups.join(", ")}) instead of using an ordinal reference.`));
    }
  }

  if (request.studio === "APP_STUDIO") {
    const appAssets = request.assets.filter((asset) => asset.role === "APP_PRIMARY_SCREEN" || asset.role === "APP_SCREEN_RECORDING");
    if (!appAssets.length) errors.push(validationError("APP_ASSET_REQUIRED", "App Studio requires an app screenshot or screen recording."));
  }

  if (/\b(different|another|second|extra)\s+(person|actor|avatar|creator)\b|\bmultiple people\b/i.test(request.instructions.raw)) {
    errors.push(validationError("IDENTITY_CONTRADICTION", "Instructions request another person, but the studio is locked to exactly one selected avatar."));
  }
  if (/voiceover only/i.test(request.instructions.raw) && /(speak|talk)\s+(to|at)\s+(the\s+)?camera/i.test(request.instructions.raw)) {
    errors.push(validationError("DELIVERY_CONTRADICTION", "Instructions conflict between voiceover-only and speaking to camera."));
  }

  if (model.resolutions.length) {
    if (!request.settings.resolution || !model.resolutions.some((value) => String(value).toLowerCase() === String(request.settings.resolution).toLowerCase())) {
      errors.push(validationError("UNSUPPORTED_RESOLUTION", `${model.displayName} supports: ${model.resolutions.join(", ")}.`));
    }
  } else if (request.settings.resolution) {
    errors.push(validationError("UNSUPPORTED_RESOLUTION", `${model.displayName} does not expose a resolution control.`));
  }
  if (model.aspectRatios.length) {
    if (!request.settings.aspectRatio || !model.aspectRatios.includes(request.settings.aspectRatio)) {
      errors.push(validationError("UNSUPPORTED_ASPECT_RATIO", `${model.displayName} supports: ${model.aspectRatios.join(", ")}.`));
    }
  } else if (request.settings.aspectRatio) {
    errors.push(validationError("UNSUPPORTED_ASPECT_RATIO", `${model.displayName} does not expose an aspect-ratio control.`));
  }
  if (request.settings.quality && !model.qualityValues.includes(request.settings.quality)) {
    errors.push(validationError("UNSUPPORTED_QUALITY", `${model.displayName} supports quality values: ${model.qualityValues.join(", ") || "none"}.`));
  }
  if (request.settings.outputCount > model.outputCount.max) {
    errors.push(validationError("UNSUPPORTED_OUTPUT_COUNT", `${model.displayName} supports at most ${model.outputCount.max} output(s).`));
  }

  const estimatedSpeechSeconds = request.script.text ? estimateSpeechDurationSeconds(request.script.text) : 0;
  if (estimatedSpeechSeconds > model.maxDuration) {
    errors.push(validationError("SCRIPT_TIMING_EXCEEDED", `The script needs about ${estimatedSpeechSeconds}s at a natural pace, exceeding the ${model.maxDuration}s model limit.`));
  }

  const autoDurationSeconds = estimateAutoDurationSeconds(request, model, estimatedSpeechSeconds);
  if (request.settings.durationMode === "AUTO") {
    request.settings.durationSeconds = autoDurationSeconds;
  } else if (!request.settings.durationSeconds) {
    errors.push(validationError("DURATION_REQUIRED", "Explicit duration requires durationSeconds."));
  } else if (estimatedSpeechSeconds > request.settings.durationSeconds) {
    errors.push(validationError("SCRIPT_DOES_NOT_FIT", `The script needs about ${estimatedSpeechSeconds}s but the selected duration is ${request.settings.durationSeconds}s.`));
  }
  const selectedDuration = request.settings.durationSeconds;
  if (selectedDuration) {
    if (model.durationValues.length && !model.durationValues.includes(selectedDuration)) {
      errors.push(validationError("UNSUPPORTED_DURATION", `${model.displayName} supports durations: ${model.durationValues.join(", ")} seconds.`));
    } else if (selectedDuration < model.minDuration || selectedDuration > model.maxDuration) {
      errors.push(validationError("UNSUPPORTED_DURATION", `${model.displayName} supports ${model.minDuration}-${model.maxDuration} seconds.`));
    }
  }

  request.instructions.confirmedDelivery ||= inferDelivery(request.instructions.raw);

  return errors.length
    ? { valid: false, errors, estimatedSpeechSeconds, model }
    : { valid: true, request, estimatedSpeechSeconds, autoDurationSeconds, model };
}

export function fingerprintGenerationRequest(request) {
  return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function calculateGenerationQuote(request, model) {
  return calculateAuthoritativeGenerationQuote(request, model);
}
