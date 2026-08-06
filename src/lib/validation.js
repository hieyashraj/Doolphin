import fs from "fs";
import path from "path";
import { validateModelCapability } from "./capabilityMatrix.js";
import { ScenePlanner } from "./workflows/ScenePlanner.js";

/**
 * Validates target image URLs against SSRF vulnerabilities (blocking private IPs, loopback, metadata endpoints).
 */
export function isSsrfSafeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  
  if (urlStr.startsWith("data:image/")) {
    return true; // Base64 data URLs are inline assets
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "169.254.169.254"
    ) {
      return false;
    }

    // Check private IPv4 subnet ranges
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministically prepares image inputs for external provider submission.
 * Converts local static/upload assets to Data URIs or verifies SSRF safety for remote HTTPS URLs.
 */
export function prepareProviderImage(inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    return { valid: false, code: "IMAGE_UPLOAD_ERROR", error: "Image input is required but missing or invalid." };
  }

  const trimmed = inputUrl.trim();

  // Reject forbidden browser or local protocol schemes
  if (trimmed.startsWith("file:") || trimmed.startsWith("http://localhost") || trimmed.startsWith("http://127.0.0.1")) {
    return {
      valid: false,
      code: "IMAGE_UPLOAD_ERROR",
      error: `Invalid image URL scheme '${trimmed.substring(0, 20)}...'. Local host and file URLs cannot be processed by external providers.`
    };
  }

  // Handle blob URIs
  if (trimmed.startsWith("blob:")) {
    return { valid: true, url: trimmed };
  }

  // Handle local application relative static/uploaded assets
  if (trimmed.startsWith("/")) {
    const relativePath = decodeURIComponent(trimmed);
    const localFilePath = path.join(process.cwd(), "public", relativePath);

    if (!fs.existsSync(localFilePath)) {
      return { valid: true, url: trimmed };
    }

    try {
      const stats = fs.statSync(localFilePath);
      if (stats.size > 15 * 1024 * 1024) { // 15MB limit
        return {
          valid: false,
          code: "IMAGE_UPLOAD_ERROR",
          error: `Image file '${relativePath}' exceeds the maximum allowed size of 15MB.`
        };
      }

      const ext = path.extname(localFilePath).toLowerCase();
      let mimeType = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
      else if (ext === ".webp") mimeType = "image/webp";
      else if (ext === ".gif") mimeType = "image/gif";

      const fileBuffer = fs.readFileSync(localFilePath);
      const base64Data = fileBuffer.toString("base64");
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      return { valid: true, url: dataUri };
    } catch (err) {
      return {
        valid: false,
        code: "IMAGE_UPLOAD_ERROR",
        error: `Failed to read local image asset: ${err.message}`
      };
    }
  }

  // Handle base64 Data URIs
  if (trimmed.startsWith("data:image/")) {
    if (trimmed.length > 25 * 1024 * 1024) { // ~18MB base64 data
      return { valid: false, code: "IMAGE_UPLOAD_ERROR", error: "Base64 image payload exceeds size limits." };
    }
    return { valid: true, url: trimmed };
  }

  // Handle external HTTPS URLs
  if (trimmed.startsWith("https://")) {
    if (!isSsrfSafeUrl(trimmed)) {
      return {
        valid: false,
        code: "IMAGE_UPLOAD_ERROR",
        error: `Image URL '${trimmed}' failed SSRF safety checks.`
      };
    }
    return { valid: true, url: trimmed };
  }

  return {
    valid: false,
    code: "IMAGE_UPLOAD_ERROR",
    error: `Unsupported image URL structure: '${trimmed.substring(0, 30)}...'`
  };
}

/**
 * Server-Side Request Validator
 * Validates script requirements (max 300 chars), scene plan, model capabilities, and asset URLs before credit reservations.
 */
export function validateGenerationRequest(body, sessionUser) {
  const { modelId, settings = {}, prompt = "", images = [], additionalInstructions = "", generationType = "PRODUCT_AD" } = body;
  const scriptInput = body.spokenScript || body.voiceoverText || prompt || "";

  if (!modelId) {
    return { valid: false, code: "INVALID_MODEL", error: "modelId is required", status: 400 };
  }

  // 1. Required Script Field & Length Validation (Max 1000 characters)
  if (!scriptInput || !scriptInput.trim()) {
    return {
      valid: false,
      code: "SCRIPT_REQUIRED",
      error: "Script or prompt is required for video generation.",
      status: 400
    };
  }

  const scriptTrimmed = scriptInput.trim();
  if (scriptTrimmed.length > 1000) {
    return {
      valid: false,
      code: "SCRIPT_EXCEEDS_MAX_LENGTH",
      error: `Script length exceeds maximum limit of 1000 characters.`,
      status: 400
    };
  }

  // 2. Duration Validation (Strict Max 15 Seconds)
  const duration = settings.duration === "Auto" ? "Auto" : (typeof settings.duration === "number" ? settings.duration : parseInt(settings.duration) || 12);
  if (duration !== "Auto" && duration > 15) {
    return {
      valid: false,
      code: "INVALID_DURATION",
      error: `Requested duration of ${duration}s exceeds the maximum limit of 15 seconds.`,
      status: 400
    };
  }

  // 3. Structured Scene Plan Generation (Pre-Credit Escrow)
  const scenePlanResult = ScenePlanner.createScenePlan({
    spokenScript: scriptTrimmed,
    additionalInstructions,
    duration,
    generationType,
    modelId
  });

  if (!scenePlanResult.valid) {
    return {
      valid: false,
      code: scenePlanResult.code,
      error: scenePlanResult.error,
      status: 400
    };
  }

  // 4. Model Capability & Aspect Ratio Validation
  const capResult = validateModelCapability(modelId, settings, body.productType || "handheld");
  if (!capResult.valid) {
    return {
      valid: false,
      code: capResult.code,
      error: capResult.error,
      status: capResult.code === "UNSUPPORTED_CAPABILITY" ? 422 : 400
    };
  }

  // 5. Deterministic Image Preparation & Validation
  const processedImages = [];
  for (const rawImg of images) {
    if (!rawImg) continue;
    const prepResult = prepareProviderImage(rawImg);
    if (!prepResult.valid) {
      return {
        valid: false,
        code: prepResult.code,
        error: prepResult.error,
        status: 422
      };
    }
    processedImages.push(prepResult.url);
  }

  return {
    valid: true,
    duration,
    processedImages,
    scenePlan: scenePlanResult.scenePlan,
    resolvedSettings: capResult.resolvedSettings
  };
}

export function checkCreationOwnership(creation, userId) {
  if (!creation) return false;
  return creation.userId === userId;
}

