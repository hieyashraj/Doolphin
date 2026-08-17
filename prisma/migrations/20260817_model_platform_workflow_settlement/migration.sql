-- AlterEnum
ALTER TYPE "CreditReservationStatus" ADD VALUE 'PARTIALLY_SETTLED';

-- AlterTable
ALTER TABLE "CreditReservation" ADD COLUMN "committedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "releasedAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Creation" ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "settlementSummaryJson" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerRequestId_payloadHash_key" ON "WebhookEvent"("provider", "providerRequestId", "payloadHash");

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PreflightQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
