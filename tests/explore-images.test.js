import test from "node:test";
import assert from "node:assert/strict";
import { buildStorageKey, assertWritableStorageKey } from "../src/lib/storage/storageKey.js";
import { EXPLORE_IMAGES, getExploreImageById } from "../src/lib/explore-images-data.js";
import { validateExploreImageIds, resolveCuratedSignedUrls } from "../src/lib/generation/curatedReferenceResolver.js";
import { validateImageRequest, createMuapiImageAdapter } from "../src/lib/generation-models/imageAdapterHelpers.js";

const stagingEnv = { DOOLPHIN_ENV: "staging", VERCEL_ENV: "preview" };
const prodEnv = { DOOLPHIN_ENV: "production", VERCEL_ENV: "production" };

test("curated storage namespace is registered and enforces environment isolation", () => {
  const keyStaging = buildStorageKey("curated", ["explore-images", "test-checksum.png"], stagingEnv);
  assert.equal(keyStaging, "staging/curated/explore-images/test-checksum.png");

  const keyProd = buildStorageKey("curated", ["explore-images", "test-checksum.png"], prodEnv);
  assert.equal(keyProd, "curated/explore-images/test-checksum.png");

  assert.equal(assertWritableStorageKey(keyStaging, stagingEnv), keyStaging);
  assert.equal(assertWritableStorageKey(keyProd, prodEnv), keyProd);
});

test("curated manifest contains valid, immutable metadata records", () => {
  assert.ok(Array.isArray(EXPLORE_IMAGES));
  assert.equal(EXPLORE_IMAGES.length, 29);

  for (const item of EXPLORE_IMAGES) {
    assert.ok(typeof item.id === "string" && item.id.length > 0);
    assert.ok(typeof item.title === "string");
    assert.ok(typeof item.storageKey === "string" && item.storageKey.startsWith("curated/explore-images/"));
    assert.ok(typeof item.checksumSha256 === "string" && /^[a-f0-9]{64}$/i.test(item.checksumSha256));
    assert.ok(typeof item.thumbUrl === "string" && item.thumbUrl.startsWith("/explore/images/thumbs/"));
    assert.ok(item.width > 0 && item.height > 0 && item.aspectRatio > 0);
  }
});

test("validateExploreImageIds rejects unknown IDs, nulls, and path traversal attempts", () => {
  const item1 = EXPLORE_IMAGES[0];
  const item2 = EXPLORE_IMAGES[1];

  const result = validateExploreImageIds([
    item1.id,
    "unknown-id-12345",
    "../../etc/passwd",
    "../public/explore/image",
    null,
    123,
    item2.id,
    item1.id // duplicate check
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, item1.id);
  assert.equal(result[1].id, item2.id);
});

test("resolveCuratedSignedUrls resolves valid explore IDs to provider URLs just-in-time", async () => {
  const item = EXPLORE_IMAGES[0];
  const urls = await resolveCuratedSignedUrls([item.id, "invalid-id"]);
  assert.equal(urls.length, 1);
  assert.ok(typeof urls[0] === "string" && urls[0].length > 0);
});

test("image request validation combines referenceAssetIds and exploreImageIds correctly", () => {
  const mockI2IModel = {
    id: "test.image-to-image",
    productCapabilities: {
      referenceImages: { visible: true, min: 1, max: 2 },
      aspectRatio: { visible: true, values: ["1:1"] },
      outputResolution: { visible: true, values: ["1K"] },
      requestedOutputCount: { visible: true, values: [1] }
    }
  };

  const mockT2IModel = {
    id: "test.text-to-image",
    productCapabilities: {
      referenceImages: { visible: false, min: 0, max: 0 },
      aspectRatio: { visible: true, values: ["1:1"] },
      outputResolution: { visible: true, values: ["1K"] },
      requestedOutputCount: { visible: true, values: [1] }
    }
  };

  // Valid combined references (1 user asset + 1 explore reference = 2)
  const validRequest = {
    version: "image-generation.v1",
    modelId: "test.image-to-image",
    prompt: "Test prompt",
    referenceAssetIds: ["asset-1"],
    exploreImageIds: ["90s-ad"],
    aspectRatio: "1:1",
    outputResolution: "1K",
    requestedOutputCount: 1
  };
  const validCheck = validateImageRequest(mockI2IModel, validRequest);
  assert.equal(validCheck.valid, true);

  // Exceeds max reference limit (2 assets + 1 explore = 3 > 2)
  const overLimitRequest = {
    ...validRequest,
    referenceAssetIds: ["asset-1", "asset-2"],
    exploreImageIds: ["90s-ad"]
  };
  const overCheck = validateImageRequest(mockI2IModel, overLimitRequest);
  assert.equal(overCheck.valid, false);
  assert.equal(overCheck.errors[0].code, "REFERENCE_COUNT_UNSUPPORTED");

  // T2I model rejects explore images
  const t2iRequest = {
    ...validRequest,
    modelId: "test.text-to-image"
  };
  const t2iCheck = validateImageRequest(mockT2IModel, t2iRequest);
  assert.equal(t2iCheck.valid, false);
  assert.equal(t2iCheck.errors[0].code, "REFERENCE_IMAGES_UNSUPPORTED");
});

test("createMuapiImageAdapter constructs provider payload with combined reference URLs", () => {
  const mockModel = {
    id: "test.i2i",
    fixedProviderDefaults: {},
    productCapabilities: {
      referenceImages: { visible: true, min: 1, max: 3 },
      aspectRatio: { visible: true, values: ["1:1"] },
      outputResolution: { visible: true, values: ["1K"] },
      requestedOutputCount: { visible: true, values: [1] }
    }
  };

  const adapter = createMuapiImageAdapter();
  const request = {
    version: "image-generation.v1",
    modelId: "test.i2i",
    prompt: "Test prompt",
    referenceAssetIds: ["asset-1"],
    exploreImageIds: ["90s-ad"],
    aspectRatio: "1:1",
    outputResolution: "1K",
    requestedOutputCount: 1
  };

  const referenceUrls = ["https://r2.example.com/user-asset-1.png"];
  const exploreUrls = ["https://r2.example.com/curated-explore-1.png"];

  const payload = adapter.buildProviderPayload(mockModel, {
    request,
    referenceUrls,
    exploreUrls
  });

  assert.deepEqual(payload.images_list, [
    "https://r2.example.com/user-asset-1.png",
    "https://r2.example.com/curated-explore-1.png"
  ]);
});
