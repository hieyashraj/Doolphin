-- Ledger V2, Supabase identity, entitlement and consent foundation.
-- This migration creates structures only. Cutover is explicitly controlled by server code.
CREATE TYPE "ActivationStatus" AS ENUM ('UNVERIFIED','VERIFIED_PAYWALLED','ACTIVATED','SUSPENDED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE','ACTIVE','PAST_DUE','CANCEL_AT_PERIOD_END','CANCELED','SUSPENDED');
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE','CANCEL_AT_PERIOD_END','REVOKED','EXPIRED','PENDING_REVIEW');
CREATE TYPE "BillingInterval" AS ENUM ('ONE_TIME','MONTHLY','ANNUAL');
CREATE TYPE "CreditLedgerReason" AS ENUM ('LEGACY_OPENING_BALANCE','EXPLORER_GRANT','STARTER_MONTHLY_GRANT','GROWTH_MONTHLY_GRANT','AGENCY_MONTHLY_GRANT','TOP_UP','GENERATION_SETTLEMENT','ADMIN_ADJUSTMENT','REFUND_ADJUSTMENT');
CREATE TYPE "CreditGrantStatus" AS ENUM ('PENDING','GRANTED','STOPPED');
CREATE TYPE "LedgerCutoverStatus" AS ENUM ('PENDING','FROZEN','RECONCILED','BLOCKED','ACTIVE');

ALTER TABLE "User" ADD COLUMN "supabaseUserId" TEXT, ADD COLUMN "normalizedEmail" TEXT, ADD COLUMN "activationStatus" "ActivationStatus" NOT NULL DEFAULT 'UNVERIFIED', ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'NONE', ADD COLUMN "explorerClaimedAt" TIMESTAMP(3), ADD COLUMN "explorerOrderId" TEXT;
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");
CREATE UNIQUE INDEX "User_explorerOrderId_key" ON "User"("explorerOrderId");

CREATE TABLE "PricingRevision" ("id" TEXT PRIMARY KEY, "version" TEXT NOT NULL UNIQUE, "customerListValuePerCreditMicroUsd" BIGINT NOT NULL, "netRevenuePerCreditFloorMicroUsd" BIGINT NOT NULL, "targetContributionMarginBps" INTEGER NOT NULL, "maxFullyLoadedCostPerCreditMicroUsd" BIGINT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PaymentCostAssumption" ("id" TEXT PRIMARY KEY, "revisionId" TEXT NOT NULL UNIQUE, "processor" TEXT NOT NULL, "transactionFeeBps" INTEGER NOT NULL, "fixedFeeMicroUsd" BIGINT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "PlanDefinition" ("id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "interval" "BillingInterval" NOT NULL, "priceMicroUsd" BIGINT NOT NULL, "monthlyCredits" INTEGER NOT NULL, "seats" INTEGER NOT NULL, "workspaces" INTEGER NOT NULL, "featuresJson" TEXT NOT NULL DEFAULT '[]', "pricingRevisionId" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Entitlement" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "planCode" TEXT NOT NULL, "billingInterval" "BillingInterval" NOT NULL, "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE', "polarCustomerId" TEXT, "polarOrderId" TEXT UNIQUE, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "grantsStoppedAt" TIMESTAMP(3), "featuresJson" TEXT NOT NULL DEFAULT '[]', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "Explorer_one_per_user" ON "Entitlement"("userId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX "Explorer_one_per_workspace" ON "Entitlement"("workspaceId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX "Explorer_one_per_customer" ON "Entitlement"("polarCustomerId") WHERE "planCode" = 'EXPLORER' AND "polarCustomerId" IS NOT NULL;
CREATE INDEX "Entitlement_user_workspace_status_idx" ON "Entitlement"("userId", "workspaceId", "status");
CREATE TABLE "BillingCustomer" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "polarCustomerId" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "BillingWebhookEvent" ("id" TEXT PRIMARY KEY, "polarEventId" TEXT NOT NULL UNIQUE, "eventType" TEXT NOT NULL, "payloadJson" TEXT NOT NULL, "processedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "CreditLedgerEntry" ("id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "userId" TEXT, "amount" INTEGER NOT NULL, "reason" "CreditLedgerReason" NOT NULL, "sourceId" TEXT, "idempotencyKey" TEXT NOT NULL UNIQUE, "pricingRevisionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "CreditLedgerEntry_workspace_created_idx" ON "CreditLedgerEntry"("workspaceId", "createdAt");
CREATE TABLE "CreditGrantSchedule" ("id" TEXT PRIMARY KEY, "entitlementId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "periodIndex" INTEGER NOT NULL, "periodStartsAt" TIMESTAMP(3) NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL, "credits" INTEGER NOT NULL, "status" "CreditGrantStatus" NOT NULL DEFAULT 'PENDING', "idempotencyKey" TEXT NOT NULL UNIQUE, "grantedAt" TIMESTAMP(3), "stoppedAt" TIMESTAMP(3), UNIQUE("entitlementId", "periodIndex"));
CREATE INDEX "CreditGrantSchedule_status_due_idx" ON "CreditGrantSchedule"("status", "dueAt");
CREATE TABLE "LedgerCutover" ("id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL UNIQUE, "status" "LedgerCutoverStatus" NOT NULL DEFAULT 'PENDING', "cutoverAt" TIMESTAMP(3), "legacyAvailableCredits" INTEGER, "openingLedgerCredits" INTEGER, "discrepancyCredits" INTEGER, "reconciliationJson" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "BlockedEmailDomain" ("id" TEXT PRIMARY KEY, "domain" TEXT NOT NULL UNIQUE, "reason" TEXT NOT NULL, "source" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "AuthRateLimit" ("id" TEXT PRIMARY KEY, "scope" TEXT NOT NULL, "subjectHash" TEXT NOT NULL, "windowStartsAt" TIMESTAMP(3) NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, UNIQUE("scope", "subjectHash", "windowStartsAt"));
CREATE TABLE "LegalDocumentVersion" ("id" TEXT PRIMARY KEY, "documentType" TEXT NOT NULL, "version" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "isCurrent" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("documentType", "version"));
CREATE TABLE "LegalConsent" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "supabaseUserId" TEXT NOT NULL, "legalDocumentVersionId" TEXT NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "source" TEXT NOT NULL, UNIQUE("supabaseUserId", "legalDocumentVersionId"));
INSERT INTO "LegalDocumentVersion" ("id", "documentType", "version", "contentHash", "isCurrent") VALUES ('legal_terms_v1','TERMS','v1','PENDING_APPROVED_LEGAL_COPY',true), ('legal_privacy_v1','PRIVACY','v1','PENDING_APPROVED_LEGAL_COPY',true);

-- Browser roles have no direct access to sensitive accounting data.
ALTER TABLE "Entitlement" ENABLE ROW LEVEL SECURITY; ALTER TABLE "BillingCustomer" ENABLE ROW LEVEL SECURITY; ALTER TABLE "BillingWebhookEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CreditLedgerEntry" ENABLE ROW LEVEL SECURITY; ALTER TABLE "CreditGrantSchedule" ENABLE ROW LEVEL SECURITY; ALTER TABLE "LedgerCutover" ENABLE ROW LEVEL SECURITY; ALTER TABLE "BlockedEmailDomain" ENABLE ROW LEVEL SECURITY; ALTER TABLE "AuthRateLimit" ENABLE ROW LEVEL SECURITY; ALTER TABLE "LegalConsent" ENABLE ROW LEVEL SECURITY;

-- If browser access is later enabled through Supabase Data APIs, these policies
-- scope the user-facing resource tables to the authenticated Supabase identity.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Creation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UploadedAsset" ENABLE ROW LEVEL SECURITY;
-- Financial/provider evidence is exclusively server-accessed. RLS has no
-- authenticated/anon policies on these tables; Prisma must still authorize.
ALTER TABLE "CreditAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreationAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeneratedArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderCostLedger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_self_read" ON "User" FOR SELECT USING ("supabaseUserId" = auth.uid()::text);
CREATE POLICY "workspace_member_read" ON "Workspace" FOR SELECT USING (EXISTS (SELECT 1 FROM "WorkspaceMember" wm JOIN "User" u ON u.id = wm."userId" WHERE wm."workspaceId" = "Workspace".id AND u."supabaseUserId" = auth.uid()::text));
CREATE POLICY "workspace_member_read_members" ON "WorkspaceMember" FOR SELECT USING (EXISTS (SELECT 1 FROM "User" u WHERE u.id = "WorkspaceMember"."userId" AND u."supabaseUserId" = auth.uid()::text));
CREATE POLICY "creation_owner_read" ON "Creation" FOR SELECT USING (EXISTS (SELECT 1 FROM "User" u WHERE u.id = "Creation"."userId" AND u."supabaseUserId" = auth.uid()::text));
CREATE POLICY "uploaded_asset_owner_read" ON "UploadedAsset" FOR SELECT USING (EXISTS (SELECT 1 FROM "User" u WHERE u.id = "UploadedAsset"."userId" AND u."supabaseUserId" = auth.uid()::text));

CREATE OR REPLACE FUNCTION public.doolphin_before_user_created(event jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE email_domain text;
BEGIN
  email_domain := lower(trim(split_part(coalesce(event->'user'->>'email',''), '@', 2)));
  IF email_domain = '' OR EXISTS (SELECT 1 FROM "BlockedEmailDomain" b WHERE b."isActive" AND (email_domain = b.domain OR email_domain LIKE '%.' || b.domain)) THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 400, 'message', 'Temporary or disposable email addresses are not supported. Please use a permanent email address.'));
  END IF;
  RETURN '{}'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.doolphin_before_user_created(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doolphin_before_user_created(jsonb) TO supabase_auth_admin;
