import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertProviderAssetsAreFetchable } from "../src/lib/generation/assetReachability.js";

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const submission = fs.readFileSync(new URL("../src/app/api/generations/route.js", import.meta.url), "utf8");
const preflight = fs.readFileSync(new URL("../src/app/api/preflight/route.js", import.meta.url), "utf8");

const richRoles = [
  "SOURCE_IMAGE",
  "SOURCE_VIDEO",
  "REFERENCE_IMAGE",
  "REFERENCE_VIDEO",
  "REFERENCE_AUDIO",
  "START_FRAME",
  "END_FRAME",
];

test("every canonical rich asset role is persistable", () => {
  for (const role of richRoles) assert.match(schema, new RegExp(`\\b${role}\\b`), role);
  assert.match(submission, /asset\.mimeType\?\.startsWith\("audio\/"\)/);
  assert.match(submission, /asset\.role === "REFERENCE_AUDIO"/);
  assert.match(submission, /mediaType === "AUDIO" \? "audio\/mpeg"/);
});

test("provider reachability accepts ordinary signed audio responses", async () => {
  const result = await assertProviderAssetsAreFetchable(
    ["https://assets.example.test/reference.wav?signature=test"],
    {
      fetchImpl: async () => new Response(new Uint8Array([0]), {
        status: 206,
        headers: { "content-type": "audio/wav" },
      }),
    },
  );
  assert.deepEqual(result, { ok: true });
});


test("server-owned MIME evidence must match every rich semantic role", () => {
  const contract = fs.readFileSync(new URL("../src/lib/generation/contract.js", import.meta.url), "utf8");
  assert.match(contract, /const ROLE_MEDIA_PREFIX = Object\.freeze/);
  assert.match(contract, /asset\.detectedMimeType \|\| asset\.mimeType/);
  assert.match(contract, /ASSET_ROLE_MEDIA_MISMATCH/);
  assert.match(contract, /APP_RECORDING_LIMIT_EXCEEDED/);
  assert.doesNotMatch(contract, /APP_RECORDING_UNSUPPORTED/);
  assert.match(preflight, /expectedMediaPrefixForRole\(asset\.role\)/);
  assert.match(preflight, /storedAsset\.detectedMimeType \|\| storedAsset\.mimeType/);
  assert.match(preflight, /asset\.role === "SOURCE_VIDEO" \|\| asset\.role === "REFERENCE_VIDEO"/);
});
