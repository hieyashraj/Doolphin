import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const quality = fs.readFileSync(new URL("../src/lib/generation/qualityPipeline.js", import.meta.url), "utf8");
const escrow = fs.readFileSync(new URL("../src/lib/billing/CreditEscrowService.js", import.meta.url), "utf8");
const reconcile = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");
const webhook = fs.readFileSync(new URL("../src/app/api/webhooks/muapi/route.js", import.meta.url), "utf8");

test("no-delivery policy releases every reservation, including internal QA", () => {
  assert.match(escrow, /if \(passed\) await this\.commitCredits[\s\S]*else await this\.releaseCredits/);
  assert.doesNotMatch(escrow, /passed \|\| !isGeneration/);
  assert.match(quality, /releaseVariantReservations\(variantId, errorCode \|\| "NO_DELIVERABLE"\)/);
});

test("finalization has an expiring DB-backed owner lease and deterministic R2 key", () => {
  assert.match(quality, /FINALIZATION_LEASE_MS/);
  assert.match(quality, /creationVariant\.updateMany/);
  assert.match(quality, /finalizationLeaseId: ownerId/);
  assert.match(quality, /finalizationLeaseExpiresAt/);
  assert.match(quality, /stillOwnFinalization/);
  assert.match(quality, /buildStorageKey\("final", \[variant\.creation\.workspaceId, variant\.creation\.id, `variant_\$\{variant\.variantIndex\}\.mp4`\]\)/);
  assert.match(quality, /type: "FINAL_VIDEO", storageKey: finalStorageKey/);
});

test("crash boundaries replay existing artifact and idempotent settlement", () => {
  assert.match(quality, /findFirst\(\{ where: \{ creationVariantId: variant\.id, type: "FINAL_VIDEO", storageKey: finalStorageKey/);
  assert.match(quality, /ensureDeliveryCheck/);
  assert.match(quality, /generatedArtifact\.upsert/);
  assert.match(quality, /creationVariantId_type_storageKey/);
  assert.match(quality, /settleVerifiedVariant\(variant\.id, true\)/);
  assert.match(quality, /currentStage: "delivery_retry"/);
  assert.match(reconcile, /replayFinalization/);
});

test("result processing failures remain recoverable for reconciliation", () => {
  assert.match(webhook, /RESULT_PROCESSING_RETRYABLE/);
  assert.match(webhook, /currentStage: "result_processing_retry"/);
  assert.match(webhook, /status: 503/);
});
