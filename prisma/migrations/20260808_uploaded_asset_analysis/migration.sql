CREATE TABLE "UploadedAsset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "mediaType" "MediaType" NOT NULL,
  "validationStatus" "AssetValidationStatus" NOT NULL DEFAULT 'VALIDATING',
  "detectedMimeType" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "durationMs" INTEGER,
  "codec" TEXT,
  "validationMetadata" TEXT,
  "validatedAt" TIMESTAMP(3),
  "analysisStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "analysisRevision" TEXT,
  "analysisJson" TEXT,
  "providerRequestId" TEXT,
  "analysisConfirmedAt" TIMESTAMP(3),
  "analysisWorkspaceId" TEXT,
  "analysisCreditsCharged" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadedAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UploadedAsset_userId_checksumSha256_key" ON "UploadedAsset"("userId", "checksumSha256");
CREATE INDEX "UploadedAsset_userId_analysisStatus_idx" ON "UploadedAsset"("userId", "analysisStatus");
ALTER TABLE "UploadedAsset" ADD CONSTRAINT "UploadedAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
