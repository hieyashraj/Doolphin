-- Additive compatibility patch for the existing populated staging project.
-- Review/rehearse before applying; this file is intentionally not a Prisma
-- history operation.
BEGIN;
ALTER TYPE "GenerationType" ADD VALUE IF NOT EXISTS 'IMAGE_STUDIO';
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'FINAL_IMAGE';
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'IMAGE_THUMBNAIL';
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'IMAGE_CARD';
ALTER TABLE "GeneratedArtifact" ADD COLUMN IF NOT EXISTS "outputIndex" INTEGER;
ALTER TABLE "ProviderJob" ADD COLUMN IF NOT EXISTS "actualContributionMarginMicroUsd" BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS "GeneratedArtifact_creationVariantId_type_outputIndex_key"
  ON "GeneratedArtifact" ("creationVariantId", type, "outputIndex");
CREATE INDEX IF NOT EXISTS "Creation_userId_generationType_createdAt_idx"
  ON "Creation" ("userId", "generationType", "createdAt" DESC);
COMMIT;
