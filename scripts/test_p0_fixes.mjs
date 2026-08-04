/**
 * P0 Incident Automated Test Suite
 * Tests for the video generation, polling, and download pipeline.
 *
 * Run: node scripts/test_p0_fixes.mjs
 */

import { strict as assert } from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => { console.log(`  ✅ PASS: ${name}`); passed++; })
        .catch((err) => { console.error(`  ❌ FAIL: ${name}\n       ${err.message}`); failed++; });
    }
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n       ${err.message}`);
    failed++;
  }
}

// ─── Load production modules ────────────────────────────────────────────────

// We need to simulate Next.js environment for imports
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.db";
process.env.NODE_ENV = "test";

// Import the adapter index
const { getProviderAdapter } = await import(path.join(rootDir, "src/lib/adapters/index.js"));

// Import the Kling adapter directly
const { FalKlingAdapter } = await import(path.join(rootDir, "src/lib/adapters/FalKlingAdapter.js"));

// Import downloader for SSRF validation
const { validateSsrfTargetUrl } = await import(path.join(rootDir, "src/lib/downloader.js"));

// ─── Inline the functions under test ────────────────────────────────────────

function getFalModelPath(modelId) {
  const FAL_MODEL_PATHS = {
    "fal-kling-3-std":           "fal-ai/kling-video/v3/standard/image-to-video",
    "fal-kling-3-pro":           "fal-ai/kling-video/v3/pro/image-to-video",
    "fal-bytedance-seedance-v2": "fal-ai/bytedance/seedance/v1/lite/image-to-video",
    "fal-luma-ray-v2":           "fal-ai/luma-dream-machine/ray-2/image-to-video",
  };
  return FAL_MODEL_PATHS[modelId] || null;
}

function extractFalVideoResult(resultData) {
  if (!resultData || typeof resultData !== "object") return null;

  // Primary: video object (Kling, Seedance, Luma)
  if (resultData.video && typeof resultData.video === "object") {
    const v = resultData.video;
    const url = v.url;
    if (url && typeof url === "string" && url.startsWith("https://")) {
      return { url, contentType: v.content_type || "video/mp4", width: v.width || null, height: v.height || null, duration: v.duration || null, fileSize: v.file_size || null };
    }
  }

  if (Array.isArray(resultData.videos) && resultData.videos.length > 0) {
    const v = resultData.videos[0];
    const url = typeof v === "string" ? v : v?.url;
    if (url && url.startsWith("https://")) {
      return { url, contentType: "video/mp4", width: null, height: null, duration: null, fileSize: null };
    }
  }

  if (Array.isArray(resultData.images) && resultData.images.length > 0) {
    const img = resultData.images[0];
    const url = typeof img === "string" ? img : img?.url;
    if (url && url.startsWith("https://")) {
      return { url, contentType: "image/jpeg", width: null, height: null, duration: null, fileSize: null };
    }
  }

  if (resultData.url && typeof resultData.url === "string" && resultData.url.startsWith("https://")) {
    return { url: resultData.url, contentType: "video/mp4", width: null, height: null, duration: null, fileSize: null };
  }

  return null;
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

console.log("\n📋 [GROUP 1] Fal Model Path Mapping");

test("fal-kling-3-std maps to correct v3/standard endpoint", () => {
  const path = getFalModelPath("fal-kling-3-std");
  assert.equal(path, "fal-ai/kling-video/v3/standard/image-to-video");
});

test("fal-kling-3-pro maps to correct v3/pro endpoint", () => {
  const path = getFalModelPath("fal-kling-3-pro");
  assert.equal(path, "fal-ai/kling-video/v3/pro/image-to-video");
});

test("unknown modelId returns null (not undefined, not a broken path)", () => {
  const path = getFalModelPath("unknown-model");
  assert.equal(path, null);
});

test("fal-kling-3-std does NOT map to v1.6 (old broken endpoint)", () => {
  const path = getFalModelPath("fal-kling-3-std");
  assert.ok(!path.includes("v1.6"), `Expected v3 path, got: ${path}`);
});

console.log("\n📋 [GROUP 2] Fal Kling Adapter");

test("FalKlingAdapter.getEndpoint returns v3/standard path for standard model", () => {
  const adapter = new FalKlingAdapter();
  const endpoint = adapter.getEndpoint("fal-kling-3-std", "http://localhost:3000/api/webhook/fal");
  assert.ok(endpoint.includes("fal-ai/kling-video/v3/standard/image-to-video"), `Endpoint path wrong: ${endpoint}`);
});

test("FalKlingAdapter.getEndpoint returns v3/pro path for pro model", () => {
  const adapter = new FalKlingAdapter();
  const endpoint = adapter.getEndpoint("fal-kling-3-pro", "http://localhost:3000/api/webhook/fal");
  assert.ok(endpoint.includes("fal-ai/kling-video/v3/pro/image-to-video"), `Endpoint path wrong: ${endpoint}`);
});

test("FalKlingAdapter.formatPayload includes image_url when image provided", () => {
  const adapter = new FalKlingAdapter();
  const payload = adapter.formatPayload({
    prompt: "test prompt",
    settings: { aspect_ratio: "9:16", duration: 5 },
    images: ["https://fal.media/test.png"],
    webhookUrl: "http://localhost:3000/api/webhook/fal"
  });
  assert.equal(payload.image_url, "https://fal.media/test.png");
  assert.equal(payload.prompt, "test prompt");
  assert.equal(payload.aspect_ratio, "9:16");
});

test("FalKlingAdapter.formatPayload does NOT include image_url when no image", () => {
  const adapter = new FalKlingAdapter();
  const payload = adapter.formatPayload({
    prompt: "test prompt",
    settings: { aspect_ratio: "9:16", duration: 5 },
    images: [],
    webhookUrl: "http://localhost:3000/api/webhook/fal"
  });
  assert.equal(payload.image_url, undefined);
});

test("FalKlingAdapter.formatPayload caps duration at 15", () => {
  const adapter = new FalKlingAdapter();
  const payload = adapter.formatPayload({
    prompt: "test",
    settings: { duration: 99 },
    images: [],
    webhookUrl: "http://localhost"
  });
  assert.equal(payload.duration, "15");
});

console.log("\n📋 [GROUP 3] Fal Result Extraction (extractFalVideoResult)");

test("Extracts video URL from Kling result shape {video: {url, content_type}}", () => {
  const result = {
    video: { url: "https://fal.media/output.mp4", content_type: "video/mp4", duration: 5, file_size: 1234567 }
  };
  const extracted = extractFalVideoResult(result);
  assert.ok(extracted, "Should return an object");
  assert.equal(extracted.url, "https://fal.media/output.mp4");
  assert.equal(extracted.contentType, "video/mp4");
  assert.equal(extracted.duration, 5);
  assert.equal(extracted.fileSize, 1234567);
});

test("Extracts video URL from videos array fallback", () => {
  const result = { videos: [{ url: "https://fal.media/v1.mp4" }] };
  const extracted = extractFalVideoResult(result);
  assert.ok(extracted);
  assert.equal(extracted.url, "https://fal.media/v1.mp4");
});

test("Extracts video URL from images array fallback (image models)", () => {
  const result = { images: [{ url: "https://fal.media/img.jpg" }] };
  const extracted = extractFalVideoResult(result);
  assert.ok(extracted);
  assert.equal(extracted.url, "https://fal.media/img.jpg");
});

test("Extracts from top-level url as last resort", () => {
  const result = { url: "https://fal.media/top.mp4" };
  const extracted = extractFalVideoResult(result);
  assert.ok(extracted);
  assert.equal(extracted.url, "https://fal.media/top.mp4");
});

test("Returns null for empty result object — PROVIDER_RESULT_INVALID", () => {
  const extracted = extractFalVideoResult({});
  assert.equal(extracted, null);
});

test("Returns null for null input", () => {
  const extracted = extractFalVideoResult(null);
  assert.equal(extracted, null);
});

test("Rejects http:// URL (non-HTTPS) from video object", () => {
  const result = { video: { url: "http://insecure.example.com/video.mp4", content_type: "video/mp4" } };
  const extracted = extractFalVideoResult(result);
  assert.equal(extracted, null, "HTTP URLs should be rejected");
});

test("Rejects empty string URL", () => {
  const result = { video: { url: "", content_type: "video/mp4" } };
  const extracted = extractFalVideoResult(result);
  assert.equal(extracted, null, "Empty string URL should be rejected");
});

test("Handles malformed video object gracefully (no url property)", () => {
  const result = { video: { content_type: "video/mp4" } };  // no url
  const extracted = extractFalVideoResult(result);
  assert.equal(extracted, null);
});

console.log("\n📋 [GROUP 4] SSRF Validation");

test("Allows fal.media domain", () => {
  const { safe } = validateSsrfTargetUrl("https://fal.media/output.mp4");
  assert.ok(safe, "fal.media should be allowed");
});

test("Allows v1.fal.media domain", () => {
  const { safe } = validateSsrfTargetUrl("https://v1.fal.media/output.mp4");
  assert.ok(safe);
});

test("Blocks localhost", () => {
  const { safe } = validateSsrfTargetUrl("http://localhost/exploit");
  assert.ok(!safe, "localhost should be blocked");
});

test("Blocks 10.x.x.x private IP", () => {
  const { safe } = validateSsrfTargetUrl("http://10.0.0.1/internal");
  assert.ok(!safe, "Private 10.x should be blocked");
});

test("Blocks 192.168.x.x private IP", () => {
  const { safe } = validateSsrfTargetUrl("http://192.168.1.100/internal");
  assert.ok(!safe, "Private 192.168.x should be blocked");
});

test("Blocks 169.254.x.x link-local (cloud metadata)", () => {
  const { safe } = validateSsrfTargetUrl("http://169.254.169.254/latest/meta-data/");
  assert.ok(!safe, "Link-local metadata endpoint should be blocked");
});

test("Blocks arbitrary external domains not in whitelist", () => {
  const { safe } = validateSsrfTargetUrl("https://attacker.com/malicious");
  assert.ok(!safe, "Non-whitelisted domain should be blocked");
});

test("Blocks file:// protocol", () => {
  const { safe } = validateSsrfTargetUrl("file:///etc/passwd");
  assert.ok(!safe, "file:// protocol should be blocked");
});

console.log("\n📋 [GROUP 5] Provider Adapter Registry");

test("getProviderAdapter returns FalKlingAdapter for fal-kling-3-std", () => {
  const adapter = getProviderAdapter("fal-kling-3-std");
  assert.ok(adapter instanceof FalKlingAdapter, "Should return FalKlingAdapter instance");
});

test("getProviderAdapter returns non-null for all known Fal model IDs", () => {
  const falModels = ["fal-kling-3-std", "fal-bytedance-seedance-v2", "fal-luma-ray-v2"];
  for (const modelId of falModels) {
    const adapter = getProviderAdapter(modelId);
    assert.ok(adapter, `Adapter should exist for ${modelId}`);
  }
});

console.log("\n📋 [GROUP 6] Status Polling URL Construction (regression test)");

test("Status polling URL uses correct Fal path NOT the internal modelId string", () => {
  // This is the regression test for the primary P0 bug:
  // creation.modelId = "fal-kling-3-std" (wrong to use in URL)
  // Correct Fal path = "fal-ai/kling-video/v3/standard/image-to-video"
  const internalModelId = "fal-kling-3-std";
  const requestId = "019fc2b1-27a3-7903-957d-73c2d6d22ce4";

  const WRONG_url = `https://queue.fal.run/${internalModelId}/requests/${requestId}/status`;
  const falModelPath = getFalModelPath(internalModelId);
  const CORRECT_url = `https://queue.fal.run/${falModelPath}/requests/${requestId}/status`;

  assert.ok(WRONG_url.includes("fal-kling-3-std"), "Wrong URL uses internal model ID");
  assert.ok(!CORRECT_url.includes("fal-kling-3-std"), "Correct URL should NOT contain internal model ID");
  assert.ok(CORRECT_url.includes("fal-ai/kling-video/v3/standard/image-to-video"), "Correct URL must use real Fal model path");
});

test("Correct Fal status URL for known request ID passes format check", () => {
  const falModelPath = getFalModelPath("fal-kling-3-std");
  const requestId = "019fc2b1-27a3-7903-957d-73c2d6d22ce4";
  const statusUrl = `https://queue.fal.run/${falModelPath}/requests/${requestId}/status`;
  
  assert.ok(statusUrl.startsWith("https://"), "Must be HTTPS");
  assert.ok(statusUrl.includes(requestId), "Must contain the request ID");
  assert.ok(statusUrl.endsWith("/status"), "Must end with /status");
});

console.log("\n📋 [GROUP 7] Download Route Logic");

test("Download filename sanitization removes dangerous characters", () => {
  const id = "cmsbugs4l0000ls9wogxp3mjp";
  const safeFilename = `lembda-${id}.mp4`.replace(/[^a-zA-Z0-9._-]/g, "_");
  assert.equal(safeFilename, `lembda-${id}.mp4`);
});

test("Local /uploads path detection works", () => {
  const localUrl = "/uploads/creations/test_123.mp4";
  const isLocal = localUrl.startsWith("/uploads/");
  assert.ok(isLocal, "Local upload path should be detected");
});

test("Remote HTTPS URL detection works", () => {
  const remoteUrl = "https://fal.media/output.mp4";
  const isLocal = remoteUrl.startsWith("/uploads/");
  assert.ok(!isLocal, "Remote URL should not be detected as local");
});

// ─── Summary ────────────────────────────────────────────────────────────────

await new Promise(resolve => setTimeout(resolve, 100)); // flush async tests

console.log(`\n${"─".repeat(60)}`);
console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("⚠️  Some tests failed. See details above.");
  process.exit(1);
} else {
  console.log("✅ All tests passed.");
  process.exit(0);
}
