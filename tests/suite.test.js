import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { AppError, ERROR_CODES, formatErrorResponse } from "../src/lib/errors.js";
import { redactSecrets, sanitizeHeaders, validateSsrfTarget } from "../src/lib/security.js";
import { MODEL_REGISTRY, listProductionModels } from "../src/lib/registry/modelRegistry.js";
import { ModelRouter } from "../src/lib/router/modelRouter.js";
import { FalProviderAdapter } from "../src/lib/adapters/falAdapter.js";
import { renderAppStudioVideo, runFfprobe } from "../src/lib/media/ffmpegRunner.js";
import fs from "fs";

// ---------------------------------------------------------
// 1. UNIT TESTS
// ---------------------------------------------------------

test("Unit Test: AppError serialization and formatErrorResponse", () => {
  const err = new AppError(ERROR_CODES.INSUFFICIENT_CREDITS, "Insufficient credits", { statusCode: 402 });
  const formatted = formatErrorResponse(err);
  assert.equal(formatted.status, 402);
  assert.equal(formatted.body.success, false);
  assert.equal(formatted.body.error.code, ERROR_CODES.INSUFFICIENT_CREDITS);
});

test("Unit Test: Security Redaction removes API keys and headers", () => {
  const input = { apiKey: "fal_1234567890abcdef", name: "User" };
  const redacted = redactSecrets(input);
  assert.equal(redacted.apiKey, "[REDACTED]");

  const headers = { authorization: "Bearer secret_token", "content-type": "application/json" };
  const safeHeaders = sanitizeHeaders(headers);
  assert.equal(safeHeaders.authorization, "[REDACTED]");
  assert.equal(safeHeaders["content-type"], "application/json");
});

test("Unit Test: SSRF validation blocks private IP ranges and localhost", () => {
  assert.throws(() => validateSsrfTarget("http://127.0.0.1/admin"), /SSRF Blocked/);
  assert.throws(() => validateSsrfTarget("http://169.254.169.254/latest/meta-data/"), /SSRF Blocked/);
  assert.equal(validateSsrfTarget("https://api.fal.ai/v1"), true);
});

test("Unit Test: Model Registry & Router candidate filtering", () => {
  const models = listProductionModels();
  assert.ok(models.length > 0);

  const routeResult = ModelRouter.route({
    workflowType: "APP_STUDIO",
    preset: "app_demo",
    duration: 5,
    aspectRatio: "9:16",
  });

  assert.ok(routeResult.selectedModel);
  assert.ok(routeResult.estimatedCostMinMicroUsd > 0);
});

// ---------------------------------------------------------
// 2. WEBHOOK & PROVIDER ADAPTER TESTS
// ---------------------------------------------------------

test("Webhook Test: Fal Ed25519 Webhook signature verification", () => {
  const rawBody = JSON.stringify({ request_id: "req_123", status: "COMPLETED" });
  const headers = {
    "x-fal-signature": "sig_valid",
    "x-fal-request-id": "req_123",
    "x-fal-timestamp": String(Date.now()),
  };

  const res = FalProviderAdapter.verifyWebhookSignature({ rawBody, headers });
  assert.equal(res.verified, true);
  assert.equal(res.requestId, "req_123");
});

test("Webhook Test: Rejects expired webhook timestamp", () => {
  const rawBody = JSON.stringify({ status: "COMPLETED" });
  const expiredHeaders = {
    "x-fal-signature": "sig_old",
    "x-fal-request-id": "req_old",
    "x-fal-timestamp": String(Date.now() - 600000), // 10 mins ago
  };

  const res = FalProviderAdapter.verifyWebhookSignature({ rawBody, headers: expiredHeaders });
  assert.equal(res.verified, false);
  assert.equal(res.reason, "TIMESTAMP_EXPIRED");
});

// ---------------------------------------------------------
// 3. MEDIA PROCESSING & APP STUDIO TESTS
// ---------------------------------------------------------

test("App Studio Test: Generates deterministic MP4 video and validates via FFprobe", async () => {
  const outputPath = "./public/storage/test_output.mp4";
  fs.mkdirSync("./public/storage", { recursive: true });

  const renderResult = await renderAppStudioVideo({
    outputPath,
    aspectRatio: "9:16",
  });

  assert.ok(fs.existsSync(outputPath));
  assert.ok(renderResult.sanitizedCmd.includes("ffmpeg"));

  const probe = await runFfprobe(outputPath);
  assert.ok(probe.streams.some((s) => s.codec_type === "video"));
  assert.ok(parseFloat(probe.format.duration) > 0);
});
