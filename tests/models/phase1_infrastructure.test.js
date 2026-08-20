import test from "node:test";
import assert from "node:assert/strict";

import { getProviderCatalog, clearCatalogMemoryCache, CatalogStoreAbstraction } from "../../src/lib/models/catalogStore.js";
import { getModel, listModelsByStudio } from "../../src/lib/models/registry.js";
import { grokImagineImage2EditDefinition } from "../../src/lib/models/definitions/grok-imagine-image-2-edit.js";
import { seedanceSpicyVideoExtendDefinition } from "../../src/lib/models/definitions/seedance-2.5-spicy-video-extend-480p.js";
import { validateAndTransformInvocationInput } from "../../src/lib/models/contracts/invocationContract.js";
import { calculateCommercialCreditQuote } from "../../src/lib/models/pricingIntegration.js";
import bootstrapCatalog from "../../src/lib/models/catalog/bootstrap-catalog.json" with { type: "json" };

// The bootstrap revision is compared against the shipped file rather than a pinned
// literal. What this test is proving is that the level-3 fallback served THE
// BOOTSTRAP FILE WE SHIP (and that the memory cache then serves the same object) —
// not that the catalog still carries one particular revision string. Correcting a
// wrong entry in that catalog is supposed to bump its revision, so a hardcoded
// literal here just fails every legitimate catalog fix. Whether the catalog's
// CONTENTS are right is enforced separately, against MuAPI's own published
// response, by tests/catalog-reconciliation.test.js.
const BOOTSTRAP_REVISION = bootstrapCatalog.revision;

test("Phase 1 Infrastructure: Catalog resolution hierarchy (Memory -> Store -> Bootstrap)", async () => {
  clearCatalogMemoryCache();

  // Test Level 3 fallback to bootstrap-catalog.json
  const resFallback = await getProviderCatalog({ forceRefresh: true });
  assert.equal(resFallback.source, "BOOTSTRAP");
  assert.equal(resFallback.catalog.revision, BOOTSTRAP_REVISION);
  assert.ok(Array.isArray(resFallback.catalog.models));
  assert.equal(resFallback.catalog.models.length, 2);

  // Test Level 1 memory cache hit on immediate second read
  const resCache = await getProviderCatalog();
  assert.equal(resCache.source, "BOOTSTRAP");
  assert.equal(resCache.catalog.revision, BOOTSTRAP_REVISION);

  // Test Level 2 CatalogStore abstraction override
  class CustomCatalogStore extends CatalogStoreAbstraction {
    async getDurableCatalog() {
      return { revision: "custom-durable-v2", models: [{ providerModelId: "custom-model" }] };
    }
  }

  clearCatalogMemoryCache();
  const resStore = await getProviderCatalog({ forceRefresh: true, store: new CustomCatalogStore() });
  assert.equal(resStore.source, "DURABLE_STORE");
  assert.equal(resStore.catalog.revision, "custom-durable-v2");
});

test("Phase 1 Infrastructure: 3-Layer Model Registry studio filtering and lookups", async () => {
  clearCatalogMemoryCache();

  const imageModels = await listModelsByStudio("image-studio");
  assert.equal(imageModels.length, 1);
  assert.equal(imageModels[0].productPolicy.id, "muapi.grok-imagine-image-2-edit");

  const videoModels = await listModelsByStudio("video-studio");
  assert.equal(videoModels.length, 2);
  assert.ok(videoModels.some((m) => m.productPolicy.id === "muapi.seedance-2.5-spicy-video-extend-480p"));
  assert.ok(videoModels.some((m) => m.productPolicy.id === "muapi.seedance2.omni-reference-fast"));

  const modelByAlias = await getModel("grok-edit");
  assert.ok(modelByAlias);
  assert.equal(modelByAlias.productPolicy.id, "muapi.grok-imagine-image-2-edit");
});

test("Phase 1 Infrastructure: Golden Model A (Grok Image 2 Edit) parameter translation matrix", () => {
  const rawInput = {
    prompt: "  Remove background objects and add studio lights  ",
    sourceRequestId: "req_grok_previous_123",
    maskIndexes: [1, 4, 9],
  };

  const result = validateAndTransformInvocationInput(
    grokImagineImage2EditDefinition,
    rawInput,
    "https://api.doolphin.com/webhook"
  );

  assert.equal(result.valid, true);
  assert.equal(result.providerPayload.prompt, "Remove background objects and add studio lights");
  assert.equal(result.providerPayload.request_id, "req_grok_previous_123");
  assert.deepEqual(result.providerPayload.mask_indexs, [1, 4, 9]);
  assert.equal(result.providerPayload.webhook_url, undefined);

  // Verify failure on missing sourceRequestId
  const invalidResult = validateAndTransformInvocationInput(
    grokImagineImage2EditDefinition,
    { prompt: "Test prompt without request ID" }
  );
  assert.equal(invalidResult.valid, false);
  assert.equal(invalidResult.errors[0].code, "PROVIDER_PAYLOAD_TRANSLATION_FAILED");
});

test("Phase 1 Infrastructure: Golden Model B (Seedance 2.5 Video Extend) parameter translation matrix & duration bounds (4-30s)", () => {
  const rawInput = {
    prompt: "Continue walking towards the sunset",
    sourceVideo: "https://r2.doolphin.com/assets/input_video.mp4",
    targetLastFrame: "https://r2.doolphin.com/assets/last_frame.jpg",
    duration: 15,
    aspectRatio: "16:9",
    generateAudio: false,
    seed: 42,
  };

  const result = validateAndTransformInvocationInput(
    seedanceSpicyVideoExtendDefinition,
    rawInput,
    "https://api.doolphin.com/webhook"
  );

  assert.equal(result.valid, true);
  assert.equal(result.providerPayload.prompt, "Continue walking towards the sunset");
  assert.equal(result.providerPayload.video, "https://r2.doolphin.com/assets/input_video.mp4");
  assert.equal(result.providerPayload.last_image, "https://r2.doolphin.com/assets/last_frame.jpg");
  assert.equal(result.providerPayload.duration, 15);
  assert.equal(result.providerPayload.aspect_ratio, "16:9");
  assert.equal(result.providerPayload.generate_audio, false);
  assert.equal(result.providerPayload.seed, 42);
  assert.equal(result.providerPayload.webhook_url, undefined);

  // Verify valid 30s duration (extended bound)
  const maxBoundResult = validateAndTransformInvocationInput(
    seedanceSpicyVideoExtendDefinition,
    { ...rawInput, duration: 30 }
  );
  assert.equal(maxBoundResult.valid, true);
  assert.equal(maxBoundResult.providerPayload.duration, 30);

  // Verify failure on invalid duration (>30s)
  const outOfBoundResult = validateAndTransformInvocationInput(
    seedanceSpicyVideoExtendDefinition,
    { ...rawInput, duration: 35 }
  );
  assert.equal(outOfBoundResult.valid, false);
  assert.equal(outOfBoundResult.errors[0].code, "PROVIDER_PAYLOAD_TRANSLATION_FAILED");
});

test("Phase 1 Infrastructure: Integration with Doolphin Commercial Pricing Engine (pricing.js)", () => {
  // CREDIT UNIT: pricing revision 2026-08-credit-rescale-v2. The divisor is
  // PRICING_REVISION.maxFullyLoadedCostPerCreditMicroUsd = 5_000 ($0.005/credit).
  // This test previously divided by 21_000 ($0.021/credit) and expected 5 and 20
  // credits. The unit was deliberately rescaled 4.2x (identical economics, more
  // credits per dollar) in src/lib/entitlements/pricing.js, so the same COSTS now
  // quote 4.2x more CREDITS. The costs asserted below are unchanged — only the
  // credit denomination moved.
  //
  // Note both expectations move UP, never down: this suite still proves the engine
  // charges at least enough credits to cover cost at the target margin.
  const COST_CEILING_MICRO_USD = 5_000;

  // Test $0.05 provider cost quote calculation
  const quoteFlat = calculateCommercialCreditQuote({ providerCostUsd: 0.05, variableInfraCostMicroUsd: 5000n });
  assert.equal(quoteFlat.priced, true);
  assert.equal(quoteFlat.providerCostMicroUsd, "50000");
  assert.equal(quoteFlat.fullyLoadedCostMicroUsd, "55000"); // $0.055 total cost
  // rawCredits = ceil(55000 / 5000) = 11 credits
  // quotedCredits = rounded up to a multiple of 5 = 15 credits
  assert.equal(quoteFlat.totalCredits, 15);
  assert.ok(
    quoteFlat.totalCredits * COST_CEILING_MICRO_USD >= Number(quoteFlat.fullyLoadedCostMicroUsd),
    "credits quoted must always cover the fully-loaded cost at the ceiling"
  );

  // Test $0.40 provider cost quote calculation (e.g. 5 sec video extension)
  const quoteVideo = calculateCommercialCreditQuote({ providerCostUsd: 0.40, variableInfraCostMicroUsd: 10000n });
  assert.equal(quoteVideo.priced, true);
  assert.equal(quoteVideo.providerCostMicroUsd, "400000");
  assert.equal(quoteVideo.fullyLoadedCostMicroUsd, "410000"); // $0.41 total cost
  // rawCredits = ceil(410000 / 5000) = 82 credits
  // quotedCredits = rounded up to a multiple of 5 = 85 credits
  assert.equal(quoteVideo.totalCredits, 85);
  assert.ok(
    quoteVideo.totalCredits * COST_CEILING_MICRO_USD >= Number(quoteVideo.fullyLoadedCostMicroUsd),
    "credits quoted must always cover the fully-loaded cost at the ceiling"
  );
});
