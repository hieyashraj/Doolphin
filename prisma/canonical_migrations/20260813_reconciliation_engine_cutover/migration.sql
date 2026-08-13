-- Canonical forward migration after 20260813_canonical_staging_baseline.
-- NULL deliberately means legacy/ineligible: no default and no backfill.
ALTER TABLE "CreationVariant"
  ADD COLUMN "reconciliationEngineRevision" TEXT;

-- The reconciliation worker runs frequently and filters active variants by
-- this durable cutover revision before timeout/finalization work.
CREATE INDEX "CreationVariant_reconciliationEngineRevision_status_timeout_idx"
  ON "CreationVariant"("reconciliationEngineRevision", "status", "timeoutAt");
