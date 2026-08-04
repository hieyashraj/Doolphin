import { validateModelCapability } from "../src/lib/capabilityMatrix.js";
import { compileGenerationPrompt } from "../src/lib/promptCompiler.js";
import { validateSsrfTargetUrl } from "../src/lib/downloader.js";
import { validateGenerationRequest, prepareProviderImage, isSsrfSafeUrl } from "../src/lib/validation.js";
import { getProviderAdapter } from "../src/lib/adapters/index.js";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING UGC GENERATION PIPELINE V2 VERIFICATION TEST");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, errorDetails = "") {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${errorDetails}`);
      failed++;
    }
  }

  // 1. ADAPTER & ENDPOINT ASSERTION TESTS
  console.log("--- 1. KLING 3.0 V3 ADAPTER ENDPOINT ASSERTIONS ---");

  const klingAdapter = getProviderAdapter("fal-kling-3-std");
  const webhookUrl = "http://localhost:3000/api/webhook/fal";
  const klingEndpoint = klingAdapter.getEndpoint("fal-kling-3-std", webhookUrl);
  
  assert(
    klingEndpoint.includes("fal-ai/kling-video/v3/standard/image-to-video"),
    "fal-kling-3-std maps to fal-ai/kling-video/v3/standard/image-to-video endpoint",
    `Received: ${klingEndpoint}`
  );
  assert(
    !klingEndpoint.includes("v1.6"),
    "fal-kling-3-std NEVER falls back to v1.6",
    `Received: ${klingEndpoint}`
  );

  const klingPayload = klingAdapter.formatPayload({
    prompt: "A realistic avatar speaking about a new product",
    settings: { aspect_ratio: "9:16", duration: 5 },
    images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
    webhookUrl
  });

  assert(klingPayload.aspect_ratio === "9:16", "Payload contains valid aspect_ratio");
  assert(klingPayload.duration === "5", "Payload contains valid duration string");
  assert(klingPayload.image_url.startsWith("data:image/"), "Payload contains prepared image_url");
  assert(!klingPayload.reference_images, "Payload does NOT send unsupported reference_images field");

  // 2. CAPABILITY MATRIX VALIDATION TESTS
  console.log("\n--- 2. CAPABILITY MATRIX & SPECS TESTS ---");

  const validCap = validateModelCapability("grok-video", { duration: 6, aspect_ratio: "9:16" }, "handheld");
  assert(validCap.valid === true, "Valid Grok video handheld capability check");

  const invalidDur = validateModelCapability("grok-video", { duration: 18, aspect_ratio: "9:16" }, "handheld");
  assert(invalidDur.valid === false && invalidDur.code === "INVALID_DURATION", "Duration > 15s rejected with INVALID_DURATION");

  const invalidAspect = validateModelCapability("veo-3-1", { duration: 8, aspect_ratio: "1:1" }, "handheld");
  assert(invalidAspect.valid === false && invalidAspect.code === "UNSUPPORTED_ASPECT_RATIO", "Unsupported aspect ratio rejected with UNSUPPORTED_ASPECT_RATIO");

  const invalidTryOn = validateModelCapability("grok-video", { duration: 6, aspect_ratio: "9:16" }, "wearable");
  assert(invalidTryOn.valid === false && invalidTryOn.code === "UNSUPPORTED_CAPABILITY", "Virtual try-on on unsupported model rejected with UNSUPPORTED_CAPABILITY");

  // 3. PROMPT COMPILER & PLACEHOLDER RESOLUTION
  console.log("\n--- 3. PROMPT COMPILER & PLACEHOLDER RESOLUTION ---");

  const compiled = compileGenerationPrompt({
    rawPrompt: "UGC video of [Avatar] showing [Target Product] with [Primary Benefit]. Call to action: [CTA].",
    spokenScript: "Try this product today!",
    avatarName: "Andrew",
    productName: "Glow Serum",
    aspectRatio: "9:16",
    duration: 6
  });

  const promptText = compiled.compiledPrompt;
  assert(!promptText.includes("[Avatar]"), "Placeholder [Avatar] resolved");
  assert(!promptText.includes("[Target Product]"), "Placeholder [Target Product] resolved");
  assert(!promptText.includes("[Primary Benefit]"), "Placeholder [Primary Benefit] resolved");
  assert(!promptText.includes("[CTA]"), "Placeholder [CTA] resolved");
  assert(promptText.includes("Andrew"), "Avatar name 'Andrew' present in compiled prompt");
  assert(promptText.includes("Glow Serum"), "Product name 'Glow Serum' present in compiled prompt");
  assert(promptText.includes("9:16"), "Aspect ratio 9:16 composition instruction appended");

  // 4. DETERMINISTIC IMAGE PREPARATION & SSRF DEFENSE TESTS
  console.log("\n--- 4. DETERMINISTIC IMAGE PREPARATION & SSRF TESTS ---");

  const avatarPrep = prepareProviderImage("/avatars/Andrew E1.png");
  assert(avatarPrep.valid === true && avatarPrep.url.startsWith("data:image/png;base64,"), "Local asset '/avatars/Andrew E1.png' converted to Data URI");

  const blobPrep = prepareProviderImage("blob:http://localhost:3000/1234-5678");
  assert(blobPrep.valid === false && blobPrep.code === "IMAGE_UPLOAD_ERROR", "Browser blob URL rejected with IMAGE_UPLOAD_ERROR");

  const localHostPrep = prepareProviderImage("http://localhost:3000/avatars/Andrew.png");
  assert(localHostPrep.valid === false && localHostPrep.code === "IMAGE_UPLOAD_ERROR", "http://localhost URL rejected with IMAGE_UPLOAD_ERROR");

  const loopbackPrep = prepareProviderImage("http://127.0.0.1/secret.png");
  assert(loopbackPrep.valid === false && loopbackPrep.code === "IMAGE_UPLOAD_ERROR", "http://127.0.0.1 URL rejected with IMAGE_UPLOAD_ERROR");

  const ssrfSafeUrl = isSsrfSafeUrl("https://queue.fal.run/files/image.png");
  assert(ssrfSafeUrl === true, "HTTPS public URL passed SSRF check");

  const ssrfMetadata = isSsrfSafeUrl("http://169.254.169.254/latest/meta-data/");
  assert(ssrfMetadata === false, "Cloud metadata IP 169.254.169.254 blocked by SSRF check");

  const ssrfPrivateIp = isSsrfSafeUrl("http://10.0.0.1/internal.jpg");
  assert(ssrfPrivateIp === false, "Private IP 10.0.0.1 blocked by SSRF check");

  // 5. REQUEST VALIDATION LOGIC TESTS
  console.log("\n--- 5. REQUEST VALIDATION LOGIC TESTS ---");

  const valDurationMax = validateGenerationRequest({
    modelId: "grok-video",
    settings: { duration: 25, aspect_ratio: "9:16" }
  }, { id: "test-user" });
  assert(valDurationMax.valid === false && valDurationMax.code === "INVALID_DURATION", "Validation rejects duration > 15s");

  const valLongScript = validateGenerationRequest({
    modelId: "grok-video",
    spokenScript: "Word ".repeat(50),
    settings: { duration: 15, aspect_ratio: "9:16" }
  }, { id: "test-user" });
  assert(valLongScript.valid === false && valLongScript.code === "SCRIPT_TOO_LONG", "Validation rejects script > 40 words for 15s");

  const valRelativeAsset = validateGenerationRequest({
    modelId: "fal-kling-3-std",
    images: ["/avatars/Andrew E1.png"],
    settings: { duration: 6, aspect_ratio: "9:16" }
  }, { id: "test-user" });
  assert(valRelativeAsset.valid === true && valRelativeAsset.processedImages[0].startsWith("data:image/"), "Relative asset path prepared cleanly to Data URI");

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
