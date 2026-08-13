import test from "node:test";
import assert from "node:assert/strict";
import { assertWritableStorageKey, buildStorageKey } from "../src/lib/storage/storageKey.js";

const staging = { DOOLPHIN_ENV: "staging", VERCEL_ENV: "preview" };
const production = { DOOLPHIN_ENV: "production", VERCEL_ENV: "production" };

test("staging write keys always receive the server-owned staging namespace", () => {
  assert.equal(buildStorageKey("uploads", ["user-1", "checksum.png"], staging), "staging/uploads/user-1/checksum.png");
  assert.equal(buildStorageKey("images", ["workspace-1", "image.png"], staging), "staging/images/workspace-1/image.png");
});

test("staging write path escapes and non-staging keys are rejected", () => {
  assert.throws(() => buildStorageKey("uploads", ["../production", "object.png"], staging), /INVALID_STORAGE_KEY_SEGMENT/);
  assert.throws(() => assertWritableStorageKey("uploads/user-1/object.png", staging), /STAGING_STORAGE_NAMESPACE_REQUIRED/);
  assert.throws(() => assertWritableStorageKey("staging/uploads/user-1/../../object.png", staging), /INVALID_STORAGE_WRITE_KEY/);
});

test("legacy keys remain readable while new writes cannot cross environments", () => {
  assert.equal("final/legacy-workspace/video.mp4", "final/legacy-workspace/video.mp4");
  assert.equal(assertWritableStorageKey("final/workspace-1/video.mp4", production), "final/workspace-1/video.mp4");
  assert.throws(() => assertWritableStorageKey("staging/final/workspace-1/video.mp4", production), /CROSS_ENVIRONMENT_STORAGE_NAMESPACE/);
});

test("request payload cannot choose storage environment or namespace", async () => {
  const [uploadRoute, presignRoute] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/app/api/upload/route.js", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/app/api/uploads/presign/route.js", import.meta.url), "utf8")),
  ]);
  for (const source of [uploadRoute, presignRoute]) {
    assert.match(source, /buildStorageKey\("uploads"/);
    assert.doesNotMatch(source, /body\.(environment|prefix|storageKey)|formData\.get\(["'](environment|prefix|storageKey)/);
  }
});
