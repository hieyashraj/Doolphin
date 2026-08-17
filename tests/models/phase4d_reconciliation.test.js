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

test("Phase 4D.2 SQL Migration: File exists and matches schema shape", () => {
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
  assert.match(sqlContent, /WebhookEvent_provider_providerRequestId_payloadHash_key/);
  assert.match(sqlContent, /Creation_quoteId_fkey/);
});

test("Phase 4D.2 Prepared Plan: settlementSchedule survives JSON round-trip", async () => {
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

test("Phase 4D.2 Settlement: 1 output success commits reservation fully", () => {
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

test("Phase 4D.2 Settlement: 1 output failure releases reservation fully", () => {
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

test("Phase 4D.2 Settlement: 2 outputs partial success (output 0 rejected + output 1 succeeds)", () => {
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

test("Phase 4D.2 Settlement: 2 outputs partial success (output 0 succeeds + output 1 rejected)", () => {
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

test("Phase 4D.2 Settlement: both submissions rejected -> 0 charged, full release", () => {
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

test("Phase 4D.2 Settlement: missing settlementSchedule for partial success fails closed", () => {
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

test("Phase 4D.2 Strict Financial Parser: Pure decimal string parsing without floats", () => {
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

test("Phase 4D.2 Finalization Recovery: Existing FINAL_VIDEO adopts artifact and completes transition", () => {
  const qualityFile = fs.readFileSync(new URL("../../src/lib/generation/qualityPipeline.js", import.meta.url), "utf8");
  assert.match(qualityFile, /let finalArtifact = await prisma\.generatedArtifact\.findFirst/);
  assert.match(qualityFile, /if \(!finalArtifact\)/);
  assert.match(qualityFile, /stillOwnFinalization/);
  assert.match(qualityFile, /ensureDeliveryCheck/);
  assert.match(qualityFile, /settleModelPlatformWorkflow/);
});

test("Phase 4D.2 Truthful Signature Semantics: Webhook retains UNVERIFIED signature status", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.match(webhookFile, /signatureStatus: "UNVERIFIED"/);
  assert.doesNotMatch(webhookFile, /signatureStatus: "VERIFIED"/);
  assert.match(webhookFile, /verifiedAt: new Date\(\)/);
});

test("Phase 4D.2 Cost Ledger & Refunded Provider Result: WAIVED when refunded=true", () => {
  const webhookFile = fs.readFileSync(new URL("../../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
  assert.match(webhookFile, /isRefunded/);
  assert.match(webhookFile, /providerCostLedger\.updateMany/);
});

test("Phase 4D.2 Atomic Transaction: settleModelPlatformWorkflow owns Serializable transaction", () => {
  const workflowFile = fs.readFileSync(new URL("../../src/lib/models/execution/workflowSettlement.js", import.meta.url), "utf8");
  assert.match(workflowFile, /isolationLevel: "Serializable"/);
  assert.match(workflowFile, /prisma\.\$transaction/);
  assert.match(workflowFile, /settledAt: null/);
  assert.match(workflowFile, /settledAt: new Date\(\)/);
});
