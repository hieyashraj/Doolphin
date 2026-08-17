-- AlterEnum
ALTER TYPE "CreditReservationStatus" ADD VALUE 'PARTIALLY_SETTLED';

-- DropIndex
DROP INDEX IF EXISTS "Creation_userId_generationType_createdAt_idx";

-- AlterTable
ALTER TABLE "Creation" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "settlementSummaryJson" TEXT;

-- AlterTable
ALTER TABLE "CreditReservation" ADD COLUMN IF NOT EXISTS "committedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "releasedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN IF NOT EXISTS "polarSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_polarSubscriptionId_key" ON "Entitlement"("polarSubscriptionId");

-- Clean up historical exact duplicate WebhookEvent rows if any exist before creating unique index
DELETE FROM "WebhookEvent" a USING "WebhookEvent" b
WHERE a.id > b.id
  AND a.provider = b.provider
  AND a."providerRequestId" = b."providerRequestId"
  AND a."payloadHash" = b."payloadHash";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_provider_providerRequestId_payloadHash_key" ON "WebhookEvent"("provider", "providerRequestId", "payloadHash");

-- Normalize orphan historical quoteId values to NULL before adding FK constraint
UPDATE "Creation"
SET "quoteId" = NULL
WHERE "quoteId" IS NOT NULL
  AND "quoteId" NOT IN (SELECT id FROM "PreflightQuote");

-- AddForeignKey
ALTER TABLE "Creation" DROP CONSTRAINT IF EXISTS "Creation_quoteId_fkey";
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PreflightQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed baseline legal document versions and blocked email domains if missing
INSERT INTO "LegalDocumentVersion" ("id", "documentType", "version", "contentHash", "isCurrent")
VALUES 
  ('legal_terms_v1', 'TERMS', 'v1', 'PENDING_APPROVED_LEGAL_COPY', true),
  ('legal_privacy_v1', 'PRIVACY', 'v1', 'PENDING_APPROVED_LEGAL_COPY', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "BlockedEmailDomain" ("id", "domain", "reason", "source", "isActive", "createdAt", "updatedAt")
VALUES 
  ('block_tempmail_local', 'tempmail.local', 'Disposable email domain', 'SEED', true, NOW(), NOW())
ON CONFLICT ("domain") DO NOTHING;
