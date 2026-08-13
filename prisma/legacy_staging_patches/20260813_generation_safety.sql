-- REVIEW-ONLY legacy staging compatibility patch.
-- Generated from the read-only current-staging -> target Prisma diff on
-- 2026-08-13. Apply once only after explicit approval; never through Prisma
-- migration-history reconciliation. This patch contains no data rewrite.

-- AlterTable
ALTER TABLE "CreationVariant" ADD COLUMN     "finalizationClaimedAt" TIMESTAMP(3),
ADD COLUMN     "finalizationLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "finalizationLeaseId" TEXT;

-- AlterTable
ALTER TABLE "ProviderJob" ADD COLUMN     "submissionClaimedAt" TIMESTAMP(3),
ADD COLUMN     "submissionLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "submissionLeaseId" TEXT;

-- CreateIndex
CREATE INDEX "CreationVariant_status_finalizationLeaseExpiresAt_idx" ON "CreationVariant"("status", "finalizationLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedArtifact_creationVariantId_type_storageKey_key" ON "GeneratedArtifact"("creationVariantId", "type", "storageKey");

-- CreateIndex
CREATE INDEX "ProviderJob_status_submissionLeaseExpiresAt_idx" ON "ProviderJob"("status", "submissionLeaseExpiresAt");
