ALTER TABLE "CreationVariant"
  ADD COLUMN "finalizationLeaseId" TEXT,
  ADD COLUMN "finalizationClaimedAt" TIMESTAMP(3),
  ADD COLUMN "finalizationLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "CreationVariant_status_finalizationLeaseExpiresAt_idx"
  ON "CreationVariant"("status", "finalizationLeaseExpiresAt");

CREATE UNIQUE INDEX "GeneratedArtifact_creationVariantId_type_storageKey_key"
  ON "GeneratedArtifact"("creationVariantId", "type", "storageKey");
