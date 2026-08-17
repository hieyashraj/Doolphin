-- AlterEnum
ALTER TYPE "CreditReservationStatus" ADD VALUE 'PARTIALLY_SETTLED';

-- AlterTable
ALTER TABLE "CreditReservation" ADD COLUMN "committedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "releasedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Creation" ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "settlementSummaryJson" TEXT;

-- Clean up historical exact duplicate WebhookEvent rows if any exist before creating unique index
DELETE FROM "WebhookEvent" a USING "WebhookEvent" b
WHERE a.id > b.id
  AND a.provider = b.provider
  AND a."providerRequestId" = b."providerRequestId"
  AND a."payloadHash" = b."payloadHash";

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerRequestId_payloadHash_key" ON "WebhookEvent"("provider", "providerRequestId", "payloadHash");

-- Normalize orphan historical quoteId values to NULL before adding FK constraint
UPDATE "Creation"
SET "quoteId" = NULL
WHERE "quoteId" IS NOT NULL
  AND "quoteId" NOT IN (SELECT id FROM "PreflightQuote");

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PreflightQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
