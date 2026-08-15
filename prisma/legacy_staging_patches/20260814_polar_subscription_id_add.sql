-- Additive compatibility patch for Polar subscription mapping
-- Target table: Entitlement
-- Safety invariant: Additive only, non-blocking, zero data loss, safe on existing NULL records.

ALTER TABLE "Entitlement" ADD COLUMN IF NOT EXISTS "polarSubscriptionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_polarSubscriptionId_key" ON "Entitlement"("polarSubscriptionId");
