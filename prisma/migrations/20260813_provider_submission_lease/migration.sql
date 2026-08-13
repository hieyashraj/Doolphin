ALTER TABLE "ProviderJob"
  ADD COLUMN "submissionLeaseId" TEXT,
  ADD COLUMN "submissionClaimedAt" TIMESTAMP(3),
  ADD COLUMN "submissionLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "ProviderJob_status_submissionLeaseExpiresAt_idx"
  ON "ProviderJob"("status", "submissionLeaseExpiresAt");
