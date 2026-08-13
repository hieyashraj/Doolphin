-- REVIEW-ONLY legacy staging compatibility patch.
-- Apply once, transactionally, only after explicit approval. This is additive
-- and intentionally has no default or backfill: all historical rows remain
-- reconciliation-ineligible (NULL).
BEGIN;

ALTER TABLE "CreationVariant"
  ADD COLUMN "reconciliationEngineRevision" TEXT;

CREATE INDEX "CreationVariant_reconciliationEngineRevision_status_timeout_idx"
  ON "CreationVariant"("reconciliationEngineRevision", "status", "timeoutAt");

COMMIT;
