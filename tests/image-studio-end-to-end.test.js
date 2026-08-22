import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const studioSource = fs.readFileSync(new URL("../src/components/image-studio/ImageStudio.js", import.meta.url), "utf8");
const generationSource = fs.readFileSync(new URL("../src/app/api/images/generations/route.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("Image Studio validates discovery responses and model capability shapes", () => {
  assert.match(studioSource, /response\.ok/);
  assert.match(studioSource, /headers\.get\("content-type"\)/);
  assert.match(studioSource, /function hasValidCapabilities/);
  assert.match(studioSource, /No image models are currently enabled/);
  assert.match(studioSource, /invalid capabilities/);
});

test("Image Studio blocks missing required references and surfaces validation messages", () => {
  assert.match(studioSource, /missingRequiredReferences/);
  assert.match(studioSource, /referenceMinimumMessage\(minimumReferences\)/);
  assert.match(studioSource, /Array\.isArray\(data\?\.errors\)/);
  assert.match(studioSource, /data\.errors\.map/);
});

test("Image Studio waits for deliverable URLs and renders every returned output", () => {
  assert.match(studioSource, /status = "FINALIZING"/);
  assert.match(studioSource, /Finalizing delivery/);
  assert.match(studioSource, /function loadDeliveredImages/);
  assert.match(studioSource, /\/api\/my-images\?page=\$\{page\}/);
  assert.match(studioSource, /!data\.hasMore/);
  assert.match(studioSource, /if \(delivered\.length\)/);
  assert.match(studioSource, /next\.urls = delivered\.map/);
  assert.match(studioSource, /generation\.urls\.map/);
});

test("image submission signs a trusted webhook and redacts it from durable payloads", () => {
  assert.match(generationSource, /process\.env/);
  assert.match(generationSource, /env\.WEBHOOK_URL/);
  assert.match(generationSource, /isProduction/);
  assert.match(generationSource, /isProduction && parsed\.protocol !== "https:"/);
  assert.match(generationSource, /MUAPI_WEBHOOK_URL_INSECURE/);
  assert.match(generationSource, /buildMuapiWebhookUrl\(parsed\.toString\(\)\)/);
  assert.match(generationSource, /webhookUrl/);
  assert.match(generationSource, /webhook_url:\s*"\[SIGNED_WEBHOOK\]"/);
  assert.match(generationSource, /sanitizedRequestPayload:\s*JSON\.stringify\(redactedProviderPayload\)/);
});

test("image submission persists requested output count and curated audit IDs", () => {
  assert.match(generationSource, /numberOfVideos:\s*request\.requestedOutputCount \|\| 1/);
  assert.match(generationSource, /assetRoleMapping:\s*JSON\.stringify\(\{ referenceAssetIds: refIds, exploreImageIds: exploreReqIds \}\)/);
  assert.match(generationSource, /routingSnapshot:[\s\S]*exploreImageIds:\s*exploreReqIds/);
});

test("sandbox MuAPI credential is documented", () => {
  assert.match(envExample, /^MUAPI_API_KEY_SANDBOX=/m);
});
