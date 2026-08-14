import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HARDENED_RECONCILIATION_ENGINE_REVISION,
  isReconciliationEligibleVariant,
  reconciliationEligibleVariantWhere,
} from "../src/lib/generation/reconciliationEligibility.js";

const reconcile = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");
const generations = fs.readFileSync(new URL("../src/app/api/generations/route.js", import.meta.url), "utf8");
const webhook = fs.readFileSync(new URL("../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");
const quality = fs.readFileSync(new URL("../src/lib/generation/qualityPipeline.js", import.meta.url), "utf8");

test("only the exact server-owned hardened revision is reconciliation eligible", () => {
  assert.equal(HARDENED_RECONCILIATION_ENGINE_REVISION, "generation-recovery.v1");
  assert.equal(isReconciliationEligibleVariant({ reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION }), true);
  assert.equal(isReconciliationEligibleVariant({ reconciliationEngineRevision: null }), false, "legacy null is fail-closed");
  assert.equal(isReconciliationEligibleVariant({ reconciliationEngineRevision: "generation-recovery.v2" }), false, "unknown revision is fail-closed");
  assert.deepEqual(reconciliationEligibleVariantWhere(), { reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION });
});

test("new hardened variants persist the server-owned revision in their creation transaction", () => {
  assert.match(generations, /reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION/);
});

test("reconciliation excludes legacy variants before submission, polling, finalization, and timeout work", () => {
  assert.match(reconcile, /const eligibleVariants = await prisma\.creationVariant\.findMany\(\{ where: reconciliationEligibleVariantWhere\(\)/);
  assert.match(reconcile, /aggregateId: \{ in: eligibleVariantIds \}/);
  assert.match(reconcile, /variant: \{ is: \{ \.\.\.reconciliationEligibleVariantWhere\(\), status: \{ in: \["QUEUED", "PROCESSING"\] \} \} \}/);
  assert.match(reconcile, /\.\.\.reconciliationEligibleVariantWhere\(\), status: "PROCESSING", currentStage/);
  assert.match(reconcile, /\.\.\.reconciliationEligibleVariantWhere\(\), status: \{ in: \["QUEUED", "PROCESSING"\] \}, timeoutAt/);
  assert.match(reconcile, /if \(!isReconciliationEligibleVariant\(job\.variant\)\) return "EXCLUDED_LEGACY"/);
  assert.match(reconcile, /if \(!providerJob \|\| !isReconciliationEligibleVariant\(providerJob\.variant\)\) return "EXCLUDED_LEGACY"/);
});

test("legacy provider notifications cannot bypass the eligibility boundary", () => {
  const guard = webhook.indexOf("if (!isReconciliationEligibleVariant(job.variant))");
  const authenticatedResultFetch = webhook.indexOf("fetchAuthenticatedMuapiResult(providerRequestId)");
  assert.ok(guard >= 0 && authenticatedResultFetch > guard, "legacy notification is stopped before authenticated provider result polling");
  assert.match(webhook, /errorCode: "RECONCILIATION_INELIGIBLE"/);
  assert.match(quality, /if \(!isReconciliationEligibleVariant\(variant\)\) return null/);
  assert.match(quality, /reason: "RECONCILIATION_INELIGIBLE"/);
});
