-- Applied only by the disposable local Supabase integration harness after
-- Prisma has created the baseline model tables.  Production rollout uses the
-- reviewed Prisma migration, not this test convenience file.
CREATE UNIQUE INDEX IF NOT EXISTS "Explorer_one_per_user" ON "Entitlement"("userId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX IF NOT EXISTS "Explorer_one_per_workspace" ON "Entitlement"("workspaceId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX IF NOT EXISTS "Explorer_one_per_customer" ON "Entitlement"("polarCustomerId") WHERE "planCode" = 'EXPLORER' AND "polarCustomerId" IS NOT NULL;

INSERT INTO "LegalDocumentVersion" ("id", "documentType", "version", "contentHash", "isCurrent")
VALUES ('local_terms_v1', 'TERMS', 'local-v1', 'synthetic', true),
       ('local_privacy_v1', 'PRIVACY', 'local-v1', 'synthetic', true)
ON CONFLICT ("documentType", "version") DO NOTHING;

ALTER TABLE "Entitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingCustomer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditGrantSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerCutover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BlockedEmailDomain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthRateLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreationAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeneratedArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderCostLedger" ENABLE ROW LEVEL SECURITY;
