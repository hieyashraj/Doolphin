import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
}

const { prepareExecutionPlan } = await import("../../src/lib/models/execution/prepareExecutionPlan.js");
const { calculateWorkflowCommercialQuote } = await import("../../src/lib/models/pricingIntegration.js");
const { calculateWorkflowSettlement, settleModelPlatformWorkflow, isModelPlatformV1Creation } = await import("../../src/lib/models/execution/workflowSettlement.js");
const { parseUsdToMicroUsdConservatively } = await import("../../src/lib/models/execution/muapiExecutor.js");
const { verifyMuapiCallbackToken, getMuapiWebhookToken, buildMuapiWebhookUrl } = await import("../../src/lib/generation/webhookSecurity.js");
const { validateModelPlatformPreparedQuoteForDispatch } = await import("../../src/lib/models/execution/validateDispatch.js");
const { validateLegacyGenerationQuoteForDispatch } = await import("../../src/lib/models/execution/validateLegacyDispatch.js");
const { classifyMuapiProviderStatus } = await import("../../src/lib/generation/muapiStatusClassifier.js");
const { calculateAuthoritativeGenerationQuote } = await import("../../src/lib/generation/modelCostRegistry.js");

const mockAuthoritativeSpec = {
  providerModelId: "seedance-2-omni-reference-no-video-fast",
  endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
  inputSchema: { prompt: { type: "string" } },
  outputSchema: { video_url: { type: "string" } },
  dynamicPricing: true,
  estimateEndpoint: "https://api.muapi.ai/api/v1/estimate-cost",
  cost: null,
};

/**
 * Mocked estimate-cost for seedance-2-omni-reference-no-video-fast.
 *
 * This fixture used to quote $0.05. MuAPI's own published catalog
 * (src/lib/models/catalog/muapi-live-catalog.json) prices this model at $0.75, and
 * src/lib/models/verifiedCosts.js independently cross-checks every live estimate
 * against that baseline, failing closed below 1/10 of it (PROVIDER_COST_DRIFT_LOW,
 * DRIFT_LOWER_DIVISOR = 10 -> floor $0.075). $0.05 is under that floor, so
 * prepareExecutionPlan threw PRICING_UNAVAILABLE before any test below reached its
 * own assertions. That guard landed after this file was last touched.
 *
 * The low-side guard is the one that protects against UNDER-charging, so it is
 * deliberately NOT relaxed. The fixture is corrected to the price MuAPI actually
 * publishes. Every assertion below derives its expected credits from the returned
 * plan rather than from a literal, so no financial expectation changes — this only
 * stops the suite contradicting the provider's own catalog.
 */
const MOCK_SEEDANCE_ESTIMATE_USD = "0.75";

const mockFetchImpl = async (url) => {
  if (url.includes("/estimate-cost")) {
    return new Response(JSON.stringify({
      cost: { amount_usd: MOCK_SEEDANCE_ESTIMATE_USD, currency: "USD" },
      pricing_mode: "DYNAMIC",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({
    id: "seedance-2-omni-reference-no-video-fast",
    endpoint: "/api/v1/seedance-2-omni-reference-no-video-fast",
    input_schema: { prompt: { type: "string" } },
    output_schema: { video_url: { type: "string" } },
    dynamic_pricing: true,
    estimate_endpoint: "/api/v1/estimate-cost",
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const mockLegacyModel = {
  id: "muapi.seedance2.omni-reference-fast",
  provider: "MUAPI",
  endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
  capabilityRevision: "rev_reg_v1",
  pricingRevision: "rev_prc_v1",
};

const mockLegacyRequest = {
  studio: "PRODUCT_STUDIO",
  settings: {
    durationSeconds: 5,
    resolution: "1080p",
    aspectRatio: "9:16",
    outputCount: 1,
  },
  script: { text: "Test script" },
  instructions: { raw: "Test instructions" },
  assets: [],
};

test("Phase 4D.3 Defect 1 & 5: validateLegacyGenerationQuoteForDispatch passes valid legacy quote", () => {
  const authoritative = calculateAuthoritativeGenerationQuote(mockLegacyRequest, mockLegacyModel);
  assert.equal(authoritative.priced, true);

  const quote = {
    selectedModelId: "muapi.seedance2.omni-reference-fast",
    internalCreditsToReserve: authoritative.totalCredits,
    pricingRevision: authoritative.pricingRevisionId,
    registryRevision: authoritative.registryRevision,
  };

  const routingSnapshot = {
    quoteCostSnapshot: {
      registryRevision: authoritative.registryRevision,
      totalCredits: authoritative.totalCredits,
      fullyLoadedCostMicroUsd: authoritative.fullyLoadedCostMicroUsd,
      pricingRevisionId: authoritative.pricingRevisionId,
    },
  };

  const result = validateLegacyGenerationQuoteForDispatch({ quote, request: mockLegacyRequest, model: mockLegacyModel, routingSnapshot });
  assert.equal(result.totalCreditsToReserve, authoritative.totalCredits);
  assert.equal(result.pricingRevisionId, mockLegacyModel.pricingRevision);
  assert.equal(result.registryRevisionId, mockLegacyModel.capabilityRevision);
});

test("Phase 4D.3 Defect 1 & 5: validateLegacyGenerationQuoteForDispatch fails QUOTE_STALE on pricing revision mismatch", () => {
  const authoritative = calculateAuthoritativeGenerationQuote(mockLegacyRequest, mockLegacyModel);

  const quote = {
    selectedModelId: "muapi.seedance2.omni-reference-fast",
    internalCreditsToReserve: authoritative.totalCredits,
    pricingRevision: "rev_prc_OLD",
    registryRevision: authoritative.registryRevision,
  };

  const routingSnapshot = {
    quoteCostSnapshot: {
      registryRevision: authoritative.registryRevision,
      totalCredits: authoritative.totalCredits,
      fullyLoadedCostMicroUsd: authoritative.fullyLoadedCostMicroUsd,
      pricingRevisionId: authoritative.pricingRevisionId,
    },
  };

  assert.throws(
    () => validateLegacyGenerationQuoteForDispatch({ quote, request: mockLegacyRequest, model: mockLegacyModel, routingSnapshot }),
    (err) => err.code === "QUOTE_STALE"
  );
});

test("Phase 4D.3 Defect 3: Prepared plan authorityVersion validation", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt for authorityVersion check" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const validPlan = JSON.parse(JSON.stringify(plan));
  validPlan.provenance = { source: "LIVE_PROVIDER", stale: false };
  validPlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: validPlan.workflowPricing.quotedCredits,
    pricingRevision: validPlan.workflowPricing.pricingRevisionId,
    registryRevision: validPlan.providerSpecHash,
    adapterVersion: validPlan.adapterRevision,
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    model: {
      adapterVersion: validPlan.adapterRevision,
      capabilityRevision: validPlan.capabilityRevision,
    },
    providerPayloadFingerprint: validPlan.providerPayloadHash,
    modelPlatformPreparedPlan: validPlan,
  };

  const validated = validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot });
  assert.ok(validated);

  const adapterMismatch = structuredClone(routingSnapshot);
  adapterMismatch.model.adapterVersion = "adapter-old";
  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot: adapterMismatch }),
    (err) => err.code === "REGISTRY_REVISION_MISMATCH"
  );

  const capabilityMismatch = structuredClone(routingSnapshot);
  capabilityMismatch.model.capabilityRevision = "capability-old";
  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot: capabilityMismatch }),
    (err) => err.code === "REGISTRY_REVISION_MISMATCH"
  );

  // Missing authorityVersion fails closed
  const invalidPlan = JSON.parse(JSON.stringify(validPlan));
  delete invalidPlan.authorityVersion;
  delete invalidPlan.preparedPlanVersion;
  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot: { authority: "MODEL_PLATFORM_V1", providerPayloadFingerprint: invalidPlan.providerPayloadHash, modelPlatformPreparedPlan: invalidPlan } }),
    (err) => err.code === "INVALID_PREPARED_PLAN"
  );

  // Wrong authorityVersion fails closed
  const wrongPlan = JSON.parse(JSON.stringify(validPlan));
  wrongPlan.authorityVersion = "WRONG_VERSION_V9";
  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot: { authority: "MODEL_PLATFORM_V1", providerPayloadFingerprint: wrongPlan.providerPayloadHash, modelPlatformPreparedPlan: wrongPlan } }),
    (err) => err.code === "INVALID_PREPARED_PLAN"
  );
});

test("Phase 4D.3 Defect 3: Reject missing providerStale metadata", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const missingStalePlan = JSON.parse(JSON.stringify(plan));
  missingStalePlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";
  missingStalePlan.provenance = { source: "LIVE_PROVIDER" }; // missing stale property
  delete missingStalePlan.providerStale;

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: missingStalePlan.workflowPricing.quotedCredits,
    pricingRevision: missingStalePlan.workflowPricing.pricingRevisionId,
    registryRevision: missingStalePlan.providerSpecHash,
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    providerPayloadFingerprint: missingStalePlan.providerPayloadHash,
    modelPlatformPreparedPlan: missingStalePlan,
  };

  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot }),
    (err) => err.code === "PROVENANCE_STALE"
  );
});

test("Phase 4D.3 Defect 4: classifyMuapiProviderStatus returns correct classification type", () => {
  assert.deepEqual(classifyMuapiProviderStatus({ status: "processing" }), { type: "INTERMEDIATE", status: "processing" });
  assert.deepEqual(classifyMuapiProviderStatus({ status: "queued" }), { type: "INTERMEDIATE", status: "queued" });
  assert.deepEqual(classifyMuapiProviderStatus({ status: "pending" }), { type: "INTERMEDIATE", status: "pending" });

  assert.deepEqual(classifyMuapiProviderStatus({ status: "completed" }), { type: "SUCCESS_TERMINAL", status: "completed" });
  assert.deepEqual(classifyMuapiProviderStatus({ status: "succeeded" }), { type: "SUCCESS_TERMINAL", status: "succeeded" });

  assert.deepEqual(classifyMuapiProviderStatus({ status: "failed" }), { type: "FAILURE_TERMINAL", status: "failed" });
  assert.deepEqual(classifyMuapiProviderStatus({ status: "cancelled" }), { type: "FAILURE_TERMINAL", status: "cancelled" });
  assert.deepEqual(classifyMuapiProviderStatus({ status: "error" }), { type: "FAILURE_TERMINAL", status: "error" });
  assert.deepEqual(classifyMuapiProviderStatus({ error: "Something failed" }), { type: "FAILURE_TERMINAL", status: "failed" });

  assert.deepEqual(classifyMuapiProviderStatus({ status: "UNKNOWN_CUSTOM_STATUS" }), { type: "UNKNOWN", status: "unknown_custom_status" });
  assert.deepEqual(classifyMuapiProviderStatus(null), { type: "UNKNOWN", status: "missing_payload" });
});

test("Phase 4D.3 SQL Migration: File exists with duplicate cleanup and orphan quoteId normalization", () => {
  const migrationDir = path.join(process.cwd(), "prisma/canonical_migrations");
  const entries = fs.readdirSync(migrationDir);
  const settlementMigration = entries.find((dir) => dir.includes("model_platform"));
  assert.ok(settlementMigration, "SQL migration directory for model_platform must exist in canonical_migrations");

  const sqlPath = path.join(migrationDir, settlementMigration, "migration.sql");
  assert.ok(fs.existsSync(sqlPath), "migration.sql must exist inside canonical migration directory");

  const sqlContent = fs.readFileSync(sqlPath, "utf8");
  assert.match(sqlContent, /PARTIALLY_SETTLED/);
  assert.match(sqlContent, /committedAmount/);
  assert.match(sqlContent, /releasedAmount/);
  assert.match(sqlContent, /settledAt/);
  assert.match(sqlContent, /settlementSummaryJson/);
  assert.match(sqlContent, /DELETE FROM "WebhookEvent"/, "Migration must clean up historical WebhookEvent duplicates");
  assert.match(sqlContent, /UPDATE "Creation"[\s\S]*SET "quoteId" = NULL/, "Migration must normalize orphan quoteId values to NULL");
  assert.match(sqlContent, /WebhookEvent_provider_providerRequestId_payloadHash_key/);
  assert.match(sqlContent, /Creation_quoteId_fkey/);
});

test("Phase 4D.3 Webhook Security: Missing secret fails closed and valid secret verifies", () => {
  const origSecret = process.env.MUAPI_WEBHOOK_SECRET;
  try {
    delete process.env.MUAPI_WEBHOOK_SECRET;
    assert.equal(getMuapiWebhookToken(), null, "getMuapiWebhookToken must return null when secret is missing");
    assert.throws(() => buildMuapiWebhookUrl("https://api.doolphin.com"), /MUAPI_WEBHOOK_SECRET is required/);
    assert.equal(verifyMuapiCallbackToken("some_token"), false, "verifyMuapiCallbackToken must return false when secret is missing");

    process.env.MUAPI_WEBHOOK_SECRET = "test_secret_key_123456789";
    const validToken = getMuapiWebhookToken();
    assert.ok(validToken, "Valid token must be generated when secret is configured");
    assert.equal(verifyMuapiCallbackToken(validToken), true, "Valid HMAC token must pass verification");
    assert.equal(verifyMuapiCallbackToken("invalid_token"), false, "Invalid token must fail verification");
  } finally {
    if (origSecret) process.env.MUAPI_WEBHOOK_SECRET = origSecret;
    else delete process.env.MUAPI_WEBHOOK_SECRET;
  }
});

test("Phase 4D.3 Dispatch Validation: All 16 Model Platform V1 cutover pre-dispatch invariants pass", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt for cutover invariant validation" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const livePlan = JSON.parse(JSON.stringify(plan));
  livePlan.provenance = { source: "LIVE_PROVIDER", stale: false };
  livePlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: livePlan.workflowPricing.quotedCredits,
    pricingRevision: livePlan.workflowPricing.pricingRevisionId,
    registryRevision: livePlan.providerSpecHash,
    adapterVersion: livePlan.adapterRevision,
  };

  const request = {
    settings: { outputCount: 1 },
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    model: {
      adapterVersion: livePlan.adapterRevision,
      capabilityRevision: livePlan.capabilityRevision,
    },
    providerPayloadFingerprint: livePlan.providerPayloadHash,
    modelPlatformPreparedPlan: livePlan,
  };

  const validated = validateModelPlatformPreparedQuoteForDispatch({ quote, request, routingSnapshot });
  assert.equal(validated.providerPayloadJson, livePlan.providerPayloadJson);
  assert.equal(validated.providerPayloadHash, livePlan.providerPayloadHash);
});

test("Phase 4D.3 Dispatch Validation: Reject providerSpecSource !== LIVE_PROVIDER", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const bootstrapPlan = JSON.parse(JSON.stringify(plan));
  bootstrapPlan.provenance = { source: "BOOTSTRAP", stale: false };
  bootstrapPlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: bootstrapPlan.workflowPricing.quotedCredits,
    pricingRevision: bootstrapPlan.workflowPricing.pricingRevisionId,
    registryRevision: bootstrapPlan.providerSpecHash,
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    providerPayloadFingerprint: bootstrapPlan.providerPayloadHash,
    modelPlatformPreparedPlan: bootstrapPlan,
  };

  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot }),
    (err) => err.code === "PROVENANCE_NOT_LIVE"
  );
});

test("Phase 4D.3 Dispatch Validation: Reject providerStale === true", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const stalePlan = JSON.parse(JSON.stringify(plan));
  stalePlan.provenance = { source: "LIVE_PROVIDER", stale: true };
  stalePlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: stalePlan.workflowPricing.quotedCredits,
    pricingRevision: stalePlan.workflowPricing.pricingRevisionId,
    registryRevision: stalePlan.providerSpecHash,
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    providerPayloadFingerprint: stalePlan.providerPayloadHash,
    modelPlatformPreparedPlan: stalePlan,
  };

  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot }),
    (err) => err.code === "PROVENANCE_STALE"
  );
});

test("Phase 4D.3 Dispatch Validation: Reject payload JSON hash tampering", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt" },
    outputCount: 1,
    fetchImpl: mockFetchImpl,
  });

  const tamperedPlan = JSON.parse(JSON.stringify(plan));
  tamperedPlan.provenance = { source: "LIVE_PROVIDER", stale: false };
  tamperedPlan.authorityVersion = "MODEL_PLATFORM_PREPARED_V1";
  tamperedPlan.providerPayloadJson = JSON.stringify({ prompt: "Tampered prompt" });

  const quote = {
    selectedModelId: "seedance-2-omni-reference-no-video-fast",
    internalCreditsToReserve: tamperedPlan.workflowPricing.quotedCredits,
    pricingRevision: tamperedPlan.workflowPricing.pricingRevisionId,
    registryRevision: tamperedPlan.providerSpecHash,
  };

  const routingSnapshot = {
    authority: "MODEL_PLATFORM_V1",
    providerPayloadFingerprint: tamperedPlan.providerPayloadHash,
    modelPlatformPreparedPlan: tamperedPlan,
  };

  assert.throws(
    () => validateModelPlatformPreparedQuoteForDispatch({ quote, request: { settings: { outputCount: 1 } }, routingSnapshot }),
    (err) => err.code === "HASH_TAMPERED"
  );
});

test("Phase 4D.3 Generation Retry: Idempotent creation check occurs before consumed check", () => {
  const generationsFile = fs.readFileSync(new URL("../../src/app/api/generations/route.js", import.meta.url), "utf8");

  const existingCheckIdx = generationsFile.indexOf("prisma.creation.findUnique");
  const consumedCheckIdx = generationsFile.indexOf("quote.consumedAt");

  assert.ok(existingCheckIdx > 0, "Creation idempotency check must exist");
  assert.ok(consumedCheckIdx > 0, "Quote consumed check must exist");
  assert.ok(existingCheckIdx < consumedCheckIdx, "Creation idempotency check must precede quote.consumedAt check");
});

test("Phase 4D.3 Settlement Inconsistency Guard: Missing/mismatched reservation rolls back transaction", () => {
  const workflowFile = fs.readFileSync(new URL("../../src/lib/models/execution/workflowSettlement.js", import.meta.url), "utf8");

  assert.match(workflowFile, /INCONSISTENT_SETTLEMENT_RESERVATION/);
  assert.match(workflowFile, /INCONSISTENT_SETTLEMENT_STATE/);
  assert.match(workflowFile, /reservations\.length !== 1/);
  assert.match(workflowFile, /primaryReservation\.amount !== totalReservedCredits/);
});

test("Phase 4D.3 Truthful Cost Reconciliation: Ledger update restricts reconciledAt to terminal statuses", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");

  assert.match(webhookFile, /providerCostLedger\.updateMany/);
  assert.match(webhookFile, /providerBillingStatus = "WAIVED"/);
  assert.match(webhookFile, /providerBillingStatus = "BILLED"/);
  assert.match(webhookFile, /providerBillingStatus = "ESTIMATED"/);
});

test("Phase 4D.3 Prepared Plan: settlementSchedule survives JSON round-trip", async () => {
  const plan = await prepareExecutionPlan({
    modelId: "seedance-2-omni-reference-no-video-fast",
    normalizedInput: { prompt: "Test prompt" },
    outputCount: 2,
    fetchImpl: mockFetchImpl,
  });

  assert.ok(plan.workflowPricing.settlementSchedule, "settlementSchedule must be present in workflowPricing");
  assert.equal(plan.workflowPricing.outputCount, 2);

  const serialized = JSON.stringify(plan);
  const deserialized = JSON.parse(serialized);

  assert.deepEqual(deserialized.workflowPricing.settlementSchedule, plan.workflowPricing.settlementSchedule);
});

test("Phase 4D.3 Settlement: 1 output success commits reservation fully", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 1,
    quotedCredits: 50,
    successfulVariantCount: 1,
    failedVariantCount: 0,
    settlementSchedule: { 0: 0, 1: 50 },
  });

  assert.equal(settlement.settledStatus, "COMPLETED");
  assert.equal(settlement.earnedCreditsToCharge, 50);
  assert.equal(settlement.unearnedCreditsToRelease, 0);
  assert.equal(settlement.isPartial, false);
});

test("Phase 4D.3 Settlement: 1 output failure releases reservation fully", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 1,
    quotedCredits: 50,
    successfulVariantCount: 0,
    failedVariantCount: 1,
    settlementSchedule: { 0: 0, 1: 50 },
  });

  assert.equal(settlement.settledStatus, "FAILED");
  assert.equal(settlement.earnedCreditsToCharge, 0);
  assert.equal(settlement.unearnedCreditsToRelease, 50);
  assert.equal(settlement.isPartial, false);
});

test("Phase 4D.3 Settlement: 2 outputs partial success (output 0 rejected + output 1 succeeds)", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 90,
    successfulVariantCount: 1,
    failedVariantCount: 1,
    settlementSchedule: { 0: 0, 1: 50, 2: 90 },
  });

  assert.equal(settlement.settledStatus, "PARTIAL_COMPLETED");
  assert.equal(settlement.earnedCreditsToCharge, 50);
  assert.equal(settlement.unearnedCreditsToRelease, 40);
  assert.equal(settlement.isPartial, true);
});

test("Phase 4D.3 Settlement: 2 outputs partial success (output 0 succeeds + output 1 rejected)", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 90,
    successfulVariantCount: 1,
    failedVariantCount: 1,
    settlementSchedule: { 0: 0, 1: 50, 2: 90 },
  });

  assert.equal(settlement.settledStatus, "PARTIAL_COMPLETED");
  assert.equal(settlement.earnedCreditsToCharge, 50);
  assert.equal(settlement.unearnedCreditsToRelease, 40);
  assert.equal(settlement.isPartial, true);
});

test("Phase 4D.3 Settlement: both submissions rejected -> 0 charged, full release", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 90,
    successfulVariantCount: 0,
    failedVariantCount: 2,
    settlementSchedule: { 0: 0, 1: 50, 2: 90 },
  });

  assert.equal(settlement.settledStatus, "FAILED");
  assert.equal(settlement.earnedCreditsToCharge, 0);
  assert.equal(settlement.unearnedCreditsToRelease, 90);
  assert.equal(settlement.isPartial, false);
});

test("Phase 4D.3 Settlement: missing settlementSchedule for partial success fails closed", () => {
  assert.throws(
    () => calculateWorkflowSettlement({
      outputCount: 2,
      quotedCredits: 90,
      successfulVariantCount: 1,
      failedVariantCount: 1,
      settlementSchedule: null,
    }),
    /MISSING_SETTLEMENT_SCHEDULE/
  );
});

test("Phase 4D.3 Strict Financial Parser: Pure decimal string parsing without floats", () => {
  assert.equal(parseUsdToMicroUsdConservatively("0.05"), 50000n);
  assert.equal(parseUsdToMicroUsdConservatively("0.2419"), 241900n);
  assert.equal(parseUsdToMicroUsdConservatively("1.000000"), 1000000n);
  assert.equal(parseUsdToMicroUsdConservatively(0.05), 50000n);

  // Conservative ceiling (+1 microUSD for digits after 6 fractional places)
  assert.equal(parseUsdToMicroUsdConservatively("0.1234567"), 123457n);
  assert.equal(parseUsdToMicroUsdConservatively("0.0000001"), 1n);

  // BigInt passthrough
  assert.equal(parseUsdToMicroUsdConservatively(100000n), 100000n);

  // Negative / invalid fails closed
  assert.throws(() => parseUsdToMicroUsdConservatively("-0.05"), /Invalid or negative USD value/);
  assert.throws(() => parseUsdToMicroUsdConservatively("abc"), /Invalid whole dollar portion/);
  assert.throws(() => parseUsdToMicroUsdConservatively(null), /USD value is required/);
});

test("Phase 4D.3 Finalization Recovery: Existing FINAL_VIDEO adopts artifact and completes transition", () => {
  const qualityFile = fs.readFileSync(new URL("../../src/lib/generation/qualityPipeline.js", import.meta.url), "utf8");
  assert.match(qualityFile, /let finalArtifact = await prisma\.generatedArtifact\.findFirst/);
  assert.match(qualityFile, /if \(!finalArtifact\)/);
  assert.match(qualityFile, /stillOwnFinalization/);
  assert.match(qualityFile, /ensureDeliveryCheck/);
  assert.match(qualityFile, /settleModelPlatformWorkflow/);
});

test("Phase 4D.3 Truthful Signature Semantics: Webhook retains UNVERIFIED signature status", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.match(webhookFile, /signatureStatus: "UNVERIFIED"/);
  assert.doesNotMatch(webhookFile, /signatureStatus: "VERIFIED"/);
  assert.match(webhookFile, /verifiedAt: new Date\(\)/);
});

test("Phase 4D.3 Atomic Transaction: settleModelPlatformWorkflow owns Serializable transaction", () => {
  const workflowFile = fs.readFileSync(new URL("../../src/lib/models/execution/workflowSettlement.js", import.meta.url), "utf8");
  assert.match(workflowFile, /isolationLevel: "Serializable"/);
  assert.match(workflowFile, /prisma\.\$transaction/);
  assert.match(workflowFile, /settledAt: null/);
  assert.match(workflowFile, /settledAt: new Date\(\)/);
});
