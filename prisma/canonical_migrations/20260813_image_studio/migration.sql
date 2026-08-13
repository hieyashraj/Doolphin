-- Canonical forward migration after the baseline and reconciliation cutover.
ALTER TYPE "GenerationType" ADD VALUE 'IMAGE_STUDIO';
ALTER TYPE "ArtifactType" ADD VALUE 'FINAL_IMAGE';
ALTER TYPE "ArtifactType" ADD VALUE 'IMAGE_THUMBNAIL';
ALTER TYPE "ArtifactType" ADD VALUE 'IMAGE_CARD';

ALTER TABLE "GeneratedArtifact" ADD COLUMN "outputIndex" INTEGER;
ALTER TABLE "ProviderJob" ADD COLUMN "actualContributionMarginMicroUsd" BIGINT;

CREATE UNIQUE INDEX "GeneratedArtifact_creationVariantId_type_outputIndex_key"
  ON "GeneratedArtifact"("creationVariantId", type, "outputIndex");
CREATE INDEX "Creation_userId_generationType_createdAt_idx"
  ON "Creation"("userId", "generationType", "createdAt" DESC);
