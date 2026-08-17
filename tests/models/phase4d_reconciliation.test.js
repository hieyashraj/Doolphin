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
const { verifyMuapiCallbackToken, getMuapiWebhookToken } = await import("../../src/lib/generation/webhookSecurity.js");

const mockAuthoritativeSpec = {
  providerModelId: "seedance-2-omni-reference-no-video-fast",
  endpoint: "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast",
  inputSchema: { prompt: { type: "string" } },
  outputSchema: { video_url: { type: "string" } },
  dynamicPricing: true,
  estimateEndpoint: "https://api.muapi.ai/api/v1/estimate-cost",
  cost: null,
};

const mockFetchImpl = async (url) => {
  if (url.includes("/estimate-cost")) {
    return new Response(JSON.stringify({
      cost: { amount_usd: "0.05", currency: "USD" },
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

test("Phase 4D.3 SQL Migration: File exists with duplicate cleanup and orphan quoteId normalization", () => {
  const migrationDir = path.join(process.cwd(), "prisma/migrations");
  const entries = fs.readdirSync(migrationDir);
  const settlementMigration = entries.find((dir) => dir.includes("model_platform_workflow_settlement"));
  assert.ok(settlementMigration, "SQL migration directory for model_platform_workflow_settlement must exist");

  const sqlPath = path.join(migrationDir, settlementMigration, "migration.sql");
  assert.ok(fs.existsSync(sqlPath), "migration.sql must exist inside migration directory");

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

test("Phase 4D.3 Webhook Schema & Traffic Security: WebhookEvent model write fields and token verification", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  const schemaFile = fs.readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

  // Verify WebhookEvent Prisma schema uses payload (not payloadJson) specifically on WebhookEvent model
  const webhookModelStart = schemaFile.indexOf("model WebhookEvent {");
  const webhookModelEnd = schemaFile.indexOf("}", webhookModelStart);
  const webhookModelBlock = schemaFile.slice(webhookModelStart, webhookModelEnd);

  assert.match(webhookModelBlock, /payload\s+String/);
  assert.doesNotMatch(webhookModelBlock, /payloadJson/);

  // Verify webhook route writes payload and eventType
  assert.match(webhookFile, /payload:\s*payloadString/);
  assert.match(webhookFile, /eventType/);
  assert.doesNotMatch(webhookFile, /payloadJson:/);

  // Verify traffic security check before DB write
  assert.match(webhookFile, /verifyMuapiCallbackToken/);
  assert.match(webhookFile, /Unauthorized callback token/);

  // Verify token validation function operates correctly
  const validToken = getMuapiWebhookToken();
  assert.equal(verifyMuapiCallbackToken(validToken), true, "Valid HMAC token must pass verification");
  assert.equal(verifyMuapiCallbackToken("invalid_token_1234567890123456789012345678901234567890123456789012345678901234"), false, "Invalid token must fail verification");
  assert.equal(verifyMuapiCallbackToken(null), false, "Null token must fail verification");
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
  assert.match(workflowFile, /reservations\.length !== 1/);
  assert.match(workflowFile, /primaryReservation\.amount !== totalReservedCredits/);
});

test("Phase 4D.3 Truthful Cost Reconciliation: Ledger update does not swallow errors silently", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");

  assert.match(webhookFile, /await prisma\.providerCostLedger\.updateMany\(\{/);
  const ledgerIndex = webhookFile.indexOf("providerCostLedger.updateMany");
  const ledgerSnippet = webhookFile.slice(ledgerIndex, ledgerIndex + 250);
  assert.equal(ledgerSnippet.includes(".catch("), false, "Ledger update statement must not be wrapped in .catch()");
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

test("Phase 4D.3 Settlement: 2 outputs partial success (output 0 rejected + output 1 succeeds)", () => {
  const settlement = calculateWorkflowSettlement({
    outputCount: 2,
    quotedCredits: 90,
    successfulVariantCount: 1,
    failedVariantCount: 1,
    settlementSchedule: { 0: 0, 1: 50, 2: 90 },
  });

  assert.equal(settlement.settledStatus, "COMPLETED");
  assert.equal(settlement.earnedCreditsToCharge, 50);
  assert.equal(settlement.unearnedCreditsToRelease, 40);
  assert.equal(settlement.isPartial, true);
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
