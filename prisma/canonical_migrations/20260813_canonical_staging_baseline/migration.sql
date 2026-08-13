-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "ActivationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED_PAYWALLED', 'ACTIVATED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCEL_AT_PERIOD_END', 'CANCELED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'CANCEL_AT_PERIOD_END', 'REVOKED', 'EXPIRED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('ONE_TIME', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "CreditLedgerReason" AS ENUM ('LEGACY_OPENING_BALANCE', 'EXPLORER_GRANT', 'STARTER_MONTHLY_GRANT', 'GROWTH_MONTHLY_GRANT', 'AGENCY_MONTHLY_GRANT', 'TOP_UP', 'GENERATION_SETTLEMENT', 'ADMIN_ADJUSTMENT', 'REFUND_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditGrantStatus" AS ENUM ('PENDING', 'GRANTED', 'STOPPED');

-- CreateEnum
CREATE TYPE "LedgerCutoverStatus" AS ENUM ('PENDING', 'FROZEN', 'RECONCILED', 'BLOCKED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('ISSUE', 'RESERVE', 'COMMIT', 'RELEASE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CreditReservationStatus" AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "GenerationType" AS ENUM ('PRODUCT_AD', 'PRODUCT_STUDIO', 'APP_STUDIO', 'VIDEO_STUDIO', 'LEGACY');

-- CreateEnum
CREATE TYPE "CreationStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'PARTIAL_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_PROVIDER', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO');

-- CreateEnum
CREATE TYPE "AssetRole" AS ENUM ('PRIMARY_PRODUCT', 'PRODUCT_PACKAGING', 'PRODUCT_LOGO', 'PRODUCT_USAGE_REFERENCE', 'ACTOR_REFERENCE', 'APP_PRIMARY_SCREEN', 'APP_SCREEN_RECORDING', 'APP_LOGO', 'MOTION_REFERENCE', 'AUDIO_REFERENCE', 'VOICE_REFERENCE', 'STYLE_REFERENCE', 'LEGACY_REFERENCE');

-- CreateEnum
CREATE TYPE "AssetValidationStatus" AS ENUM ('QUARANTINED', 'VALIDATING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "ProviderJobStatus" AS ENUM ('PREPARED', 'SUBMITTING', 'SUBMISSION_UNKNOWN', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ProviderBillingStatus" AS ENUM ('UNKNOWN', 'ESTIMATED', 'BILLED', 'WAIVED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('TTS_AUDIO', 'RAW_PROVIDER_VIDEO', 'NATIVE_AUDIO_VIDEO', 'LIP_SYNCED_VIDEO', 'COMPOSED_VIDEO', 'CAPTIONED_VIDEO', 'FINAL_VIDEO', 'THUMBNAIL', 'CAPTION_FILE', 'PROVIDER_RAW_RESULT');

-- CreateEnum
CREATE TYPE "ArtifactValidationStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'LOCKED', 'DISPATCHED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "WebhookSignatureStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'INVALID');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'DUPLICATE', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "SchemaStatus" AS ENUM ('SCHEMA_UNVERIFIED', 'SCHEMA_VERIFIED');

-- CreateEnum
CREATE TYPE "PricingStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'STALE');

-- CreateEnum
CREATE TYPE "OutputStatus" AS ENUM ('NOT_TESTED', 'POC_FAILED', 'POC_PASSED');

-- CreateEnum
CREATE TYPE "CircuitState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'WORKSPACE', 'USER', 'PROVIDER', 'MODEL');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'PROVIDER');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "defaultWorkspaceId" TEXT,
    "supabaseUserId" TEXT,
    "normalizedEmail" TEXT,
    "activationStatus" "ActivationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "explorerClaimedAt" TIMESTAMP(3),
    "explorerOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customApiKey" TEXT,
    "falKey" TEXT,
    "elevenLabsKey" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRevision" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "customerListValuePerCreditMicroUsd" BIGINT NOT NULL,
    "netRevenuePerCreditFloorMicroUsd" BIGINT NOT NULL,
    "targetContributionMarginBps" INTEGER NOT NULL,
    "maxFullyLoadedCostPerCreditMicroUsd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCostAssumption" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "processor" TEXT NOT NULL,
    "transactionFeeBps" INTEGER NOT NULL,
    "fixedFeeMicroUsd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCostAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "priceMicroUsd" BIGINT NOT NULL,
    "monthlyCredits" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL,
    "workspaces" INTEGER NOT NULL,
    "featuresJson" TEXT NOT NULL DEFAULT '[]',
    "pricingRevisionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "polarCustomerId" TEXT,
    "polarOrderId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "grantsStoppedAt" TIMESTAMP(3),
    "featuresJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "polarCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "polarEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" "CreditLedgerReason" NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "pricingRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditGrantSchedule" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "periodStartsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "CreditGrantStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),

    CONSTRAINT "CreditGrantSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerCutover" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "LedgerCutoverStatus" NOT NULL DEFAULT 'PENDING',
    "cutoverAt" TIMESTAMP(3),
    "legacyAvailableCredits" INTEGER,
    "openingLedgerCredits" INTEGER,
    "discrepancyCredits" INTEGER,
    "reconciliationJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerCutover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedEmailDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedEmailDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStartsAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supabaseUserId" TEXT NOT NULL,
    "legalDocumentVersionId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "LegalConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingPlan" TEXT NOT NULL DEFAULT 'starter',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "dailySpendLimitMicroUsd" BIGINT NOT NULL DEFAULT 50000000,
    "monthlySpendLimitMicroUsd" BIGINT NOT NULL DEFAULT 500000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "availableCredits" INTEGER NOT NULL DEFAULT 100,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "lifetimeIssuedCredits" INTEGER NOT NULL DEFAULT 100,
    "lifetimeCommittedCredits" INTEGER NOT NULL DEFAULT 0,
    "lifetimeReleasedCredits" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "creationId" TEXT,
    "creationVariantId" TEXT,
    "creditReservationId" TEXT,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reservedBefore" INTEGER NOT NULL,
    "reservedAfter" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdBySystemComponent" TEXT,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "CreditReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreflightQuote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationType" "GenerationType" NOT NULL,
    "requestSnapshot" TEXT NOT NULL,
    "normalizedAssetSummary" TEXT NOT NULL,
    "routingSnapshot" TEXT NOT NULL,
    "selectedModelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEndpoint" TEXT NOT NULL,
    "registryRevision" TEXT NOT NULL,
    "pricingRevision" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "estimatedProviderCostMinMicroUsd" BIGINT NOT NULL,
    "estimatedProviderCostMaxMicroUsd" BIGINT NOT NULL,
    "infrastructureCostEstimateMicroUsd" BIGINT NOT NULL,
    "expectedFailureLossMicroUsd" BIGINT NOT NULL,
    "internalCreditsToReserve" INTEGER NOT NULL,
    "warnings" TEXT,
    "capabilitySummary" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreflightQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationType" "GenerationType" NOT NULL,
    "workflowVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "presetId" TEXT NOT NULL,
    "title" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "spokenScript" TEXT,
    "prompt" TEXT,
    "compiledPrompt" TEXT,
    "additionalInstructions" TEXT,
    "ctaText" TEXT,
    "numberOfVideos" INTEGER NOT NULL DEFAULT 1,
    "status" "CreationStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStage" TEXT,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "totalStages" INTEGER NOT NULL DEFAULT 1,
    "progressType" TEXT NOT NULL DEFAULT 'STAGE_BASED',
    "progressValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "quoteId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "timeoutAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "safeError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "appVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "modelId" TEXT,
    "provider" TEXT,
    "requestId" TEXT,
    "providerJobId" TEXT,
    "statusUrl" TEXT,
    "responseUrl" TEXT,
    "attemptId" TEXT,
    "aspectRatio" TEXT,
    "resolution" TEXT,
    "duration" INTEGER,
    "mode" TEXT,
    "inputImages" TEXT,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT,
    "error" TEXT,
    "stage" TEXT,
    "productInterpretation" TEXT,

    CONSTRAINT "Creation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationVariant" (
    "id" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "variantIndex" INTEGER NOT NULL,
    "status" "CreationStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "stageIndex" INTEGER NOT NULL DEFAULT 0,
    "totalStages" INTEGER NOT NULL DEFAULT 1,
    "progressType" TEXT NOT NULL DEFAULT 'STAGE_BASED',
    "progressValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "timeoutAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "finalArtifactId" TEXT,
    "finalizationLeaseId" TEXT,
    "finalizationClaimedAt" TIMESTAMP(3),
    "finalizationLeaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "safeError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreationVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationAsset" (
    "id" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "role" "AssetRole" NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "normalizedFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "detectedMimeType" TEXT,
    "fileSizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "codec" TEXT,
    "validationStatus" "AssetValidationStatus" NOT NULL DEFAULT 'QUARANTINED',
    "validationErrorCode" TEXT,
    "validationMetadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "CreationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowSnapshot" (
    "id" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "workflowType" "GenerationType" NOT NULL,
    "workflowVersion" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "stageGraph" TEXT NOT NULL,
    "capabilityRequirements" TEXT NOT NULL,
    "assetRoleMapping" TEXT NOT NULL,
    "speechPlan" TEXT NOT NULL,
    "compositionPlan" TEXT NOT NULL,
    "routingInput" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationStage" (
    "id" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "userFacingLabel" TEXT NOT NULL,
    "paidStage" BOOLEAN NOT NULL DEFAULT false,
    "providerJobId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "safeError" TEXT,
    "internalMetadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderJob" (
    "id" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "generationStageId" TEXT,
    "provider" TEXT NOT NULL,
    "internalModelId" TEXT NOT NULL,
    "providerModelVersion" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "status" "ProviderJobStatus" NOT NULL DEFAULT 'PREPARED',
    "stageIdempotencyKey" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "registryRevision" TEXT NOT NULL,
    "pricingRevision" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "routingSnapshot" TEXT NOT NULL,
    "capabilitySnapshot" TEXT NOT NULL,
    "sanitizedRequestPayload" TEXT NOT NULL,
    "sanitizedInitialResponse" TEXT,
    "sanitizedResultPayload" TEXT,
    "sanitizedResponseHeaders" TEXT,
    "providerQueueStatusHistory" TEXT,
    "submissionLeaseId" TEXT,
    "submissionClaimedAt" TIMESTAMP(3),
    "submissionLeaseExpiresAt" TIMESTAMP(3),
    "providerRequestCreatedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "webhookCount" INTEGER NOT NULL DEFAULT 0,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMinMicroUsd" BIGINT NOT NULL,
    "estimatedCostMaxMicroUsd" BIGINT NOT NULL,
    "actualCostMicroUsd" BIGINT,
    "providerBillingStatus" "ProviderBillingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "billableUnits" DOUBLE PRECISION,
    "providerLatencyMs" INTEGER,
    "errorCode" TEXT,
    "safeError" TEXT,
    "internalErrorFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCostLedger" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "providerJobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "estimatedCostMinMicroUsd" BIGINT NOT NULL,
    "estimatedCostMaxMicroUsd" BIGINT NOT NULL,
    "actualCostMicroUsd" BIGINT,
    "providerBillingStatus" "ProviderBillingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "providerRequestId" TEXT,
    "billableUnits" DOUBLE PRECISION,
    "pricingRevision" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCostLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedArtifact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "generationStageId" TEXT,
    "type" "ArtifactType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "frameRate" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "validationStatus" "ArtifactValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validationMetadata" TEXT,
    "reusableFingerprint" TEXT,
    "sourceProviderUrlHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "GeneratedArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactDeliveryCheck" (
    "id" TEXT NOT NULL,
    "generatedArtifactId" TEXT NOT NULL,
    "objectExists" BOOLEAN NOT NULL,
    "metadataValid" BOOLEAN NOT NULL,
    "authorizedRangeGetSucceeded" BOOLEAN NOT NULL,
    "contentTypeValid" BOOLEAN NOT NULL,
    "nonEmpty" BOOLEAN NOT NULL,
    "ffprobeSucceeded" BOOLEAN NOT NULL,
    "durationValid" BOOLEAN NOT NULL,
    "dimensionsValid" BOOLEAN NOT NULL,
    "videoCodecValid" BOOLEAN NOT NULL,
    "audioCodecValid" BOOLEAN NOT NULL,
    "previewSucceeded" BOOLEAN NOT NULL,
    "downloadSucceeded" BOOLEAN NOT NULL,
    "checksumVerified" BOOLEAN NOT NULL,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCode" TEXT,
    "evidence" TEXT,

    CONSTRAINT "ArtifactDeliveryCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueOutbox" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "deterministicJobId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "QueueOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueJobRecord" (
    "id" TEXT NOT NULL,
    "deterministicJobId" TEXT NOT NULL,
    "bullmqJobId" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "workerName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "workerInstanceId" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueJobRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRequestId" TEXT NOT NULL,
    "providerEventId" TEXT,
    "gatewayRequestId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureStatus" "WebhookSignatureStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" TEXT NOT NULL,
    "sanitizedHeaders" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRegistryRevision" (
    "id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ModelRegistryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelDeployment" (
    "id" TEXT NOT NULL,
    "internalModelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "schemaStatus" "SchemaStatus" NOT NULL DEFAULT 'SCHEMA_UNVERIFIED',
    "pricingStatus" "PricingStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "outputStatus" "OutputStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "productionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "featureFlag" TEXT,
    "circuitState" "CircuitState" NOT NULL DEFAULT 'CLOSED',
    "lastSchemaVerifiedAt" TIMESTAMP(3),
    "lastPriceVerifiedAt" TIMESTAMP(3),
    "lastPocAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecision" (
    "id" TEXT NOT NULL,
    "creationVariantId" TEXT NOT NULL,
    "routingInput" TEXT NOT NULL,
    "eligibleCandidates" TEXT NOT NULL,
    "rejectedCandidates" TEXT NOT NULL,
    "selectedModelId" TEXT NOT NULL,
    "selectedProvider" TEXT NOT NULL,
    "selectedEndpoint" TEXT NOT NULL,
    "rankingExplanation" TEXT NOT NULL,
    "estimatedCostMinMicroUsd" BIGINT NOT NULL,
    "estimatedCostMaxMicroUsd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCounter" (
    "id" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "dateBucket" TEXT NOT NULL,
    "spentMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "reservedMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircuitBreakerState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "internalModelId" TEXT,
    "state" "CircuitState" NOT NULL DEFAULT 'CLOSED',
    "openedAt" TIMESTAMP(3),
    "halfOpenedAt" TIMESTAMP(3),
    "failureWindowStart" TIMESTAMP(3),
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircuitBreakerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "creationId" TEXT,
    "variantId" TEXT,
    "modelId" TEXT,
    "provider" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentVersion" (
    "id" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "gitCommitSha" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "workerVersion" TEXT NOT NULL,
    "registryRevision" TEXT NOT NULL,
    "pricingRevision" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "User_explorerOrderId_key" ON "User"("explorerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRevision_version_key" ON "PricingRevision"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCostAssumption_revisionId_key" ON "PaymentCostAssumption"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDefinition_code_key" ON "PlanDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_polarOrderId_key" ON "Entitlement"("polarOrderId");

-- CreateIndex
CREATE INDEX "Entitlement_userId_workspaceId_status_idx" ON "Entitlement"("userId", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_polarCustomerId_key" ON "BillingCustomer"("polarCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingWebhookEvent_polarEventId_key" ON "BillingWebhookEvent"("polarEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_idempotencyKey_key" ON "CreditLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_workspaceId_createdAt_idx" ON "CreditLedgerEntry"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrantSchedule_idempotencyKey_key" ON "CreditGrantSchedule"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditGrantSchedule_status_dueAt_idx" ON "CreditGrantSchedule"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrantSchedule_entitlementId_periodIndex_key" ON "CreditGrantSchedule"("entitlementId", "periodIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCutover_workspaceId_key" ON "LedgerCutover"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedEmailDomain_domain_key" ON "BlockedEmailDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "AuthRateLimit_scope_subjectHash_windowStartsAt_key" ON "AuthRateLimit"("scope", "subjectHash", "windowStartsAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_documentType_version_key" ON "LegalDocumentVersion"("documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalConsent_supabaseUserId_legalDocumentVersionId_key" ON "LegalConsent"("supabaseUserId", "legalDocumentVersionId");

-- CreateIndex
CREATE INDEX "UploadedAsset_userId_analysisStatus_idx" ON "UploadedAsset"("userId", "analysisStatus");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedAsset_userId_checksumSha256_key" ON "UploadedAsset"("userId", "checksumSha256");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_workspaceId_key" ON "CreditAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_idempotencyKey_key" ON "CreditReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Creation_userId_createdAt_idx" ON "Creation"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Creation_userId_status_idx" ON "Creation"("userId", "status");

-- CreateIndex
CREATE INDEX "Creation_requestId_idx" ON "Creation"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Creation_workspaceId_idempotencyKey_key" ON "Creation"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CreationVariant_status_finalizationLeaseExpiresAt_idx" ON "CreationVariant"("status", "finalizationLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreationVariant_creationId_variantIndex_key" ON "CreationVariant"("creationId", "variantIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowSnapshot_creationVariantId_key" ON "WorkflowSnapshot"("creationVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationStage_creationVariantId_name_key" ON "GenerationStage"("creationVariantId", "name");

-- CreateIndex
CREATE INDEX "ProviderJob_status_submissionLeaseExpiresAt_idx" ON "ProviderJob"("status", "submissionLeaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedArtifact_creationVariantId_type_storageKey_key" ON "GeneratedArtifact"("creationVariantId", "type", "storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "QueueOutbox_deterministicJobId_key" ON "QueueOutbox"("deterministicJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistryRevision_revision_key" ON "ModelRegistryRevision"("revision");

-- CreateIndex
CREATE UNIQUE INDEX "ModelDeployment_internalModelId_key" ON "ModelDeployment"("internalModelId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCounter_scopeType_scopeId_dateBucket_key" ON "BudgetCounter"("scopeType", "scopeId", "dateBucket");

-- CreateIndex
CREATE UNIQUE INDEX "CircuitBreakerState_provider_internalModelId_key" ON "CircuitBreakerState"("provider", "internalModelId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentVersion_deploymentId_key" ON "DeploymentVersion"("deploymentId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedAsset" ADD CONSTRAINT "UploadedAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationVariant" ADD CONSTRAINT "CreationVariant_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationAsset" ADD CONSTRAINT "CreationAsset_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreationAsset" ADD CONSTRAINT "CreationAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSnapshot" ADD CONSTRAINT "WorkflowSnapshot_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationStage" ADD CONSTRAINT "GenerationStage_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderJob" ADD CONSTRAINT "ProviderJob_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCostLedger" ADD CONSTRAINT "ProviderCostLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCostLedger" ADD CONSTRAINT "ProviderCostLedger_providerJobId_fkey" FOREIGN KEY ("providerJobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCostLedger" ADD CONSTRAINT "ProviderCostLedger_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_generationStageId_fkey" FOREIGN KEY ("generationStageId") REFERENCES "GenerationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactDeliveryCheck" ADD CONSTRAINT "ArtifactDeliveryCheck_generatedArtifactId_fkey" FOREIGN KEY ("generatedArtifactId") REFERENCES "GeneratedArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingDecision" ADD CONSTRAINT "RoutingDecision_creationVariantId_fkey" FOREIGN KEY ("creationVariantId") REFERENCES "CreationVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- Doolphin custom database contract (not expressible in Prisma schema)
-- -------------------------------------------------------------------------
-- The historical database applies RLS to every Doolphin relation, including
-- Prisma's migration table.  Keep the list explicit so this baseline does not
-- depend on a pre-existing event trigger during its own first replay.
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'Account', 'ArtifactDeliveryCheck', 'AuditEvent', 'AuthRateLimit',
    'BillingCustomer', 'BillingWebhookEvent', 'BlockedEmailDomain',
    'BudgetCounter', 'CircuitBreakerState', 'Creation', 'CreationAsset',
    'CreationVariant', 'CreditAccount', 'CreditGrantSchedule',
    'CreditLedgerEntry', 'CreditReservation', 'CreditTransaction',
    'DeploymentVersion', 'Entitlement', 'GeneratedArtifact',
    'GenerationStage', 'LedgerCutover', 'LegalConsent',
    'LegalDocumentVersion', 'ModelDeployment', 'ModelRegistryRevision',
    'PaymentCostAssumption', 'PlanDefinition', 'PreflightQuote',
    'PricingRevision', 'ProviderCostLedger', 'ProviderJob',
    'QueueJobRecord', 'QueueOutbox', 'RoutingDecision', 'Session',
    'UploadedAsset', 'UsageEvent', 'User', 'VerificationToken',
    'WebhookEvent', 'WorkflowSnapshot', 'Workspace', 'WorkspaceMember',
    '_prisma_migrations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
  END LOOP;
END
$$;

-- Browser-visible tables have only the narrow read policies verified below.
-- All financial and provider evidence tables intentionally have no browser
-- policy and remain server-authorized only.
CREATE POLICY "user_self_read" ON "User"
  FOR SELECT USING ("supabaseUserId" = auth.uid()::text);
CREATE POLICY "workspace_member_read" ON "Workspace"
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM "WorkspaceMember" wm
      JOIN "User" u ON u.id = wm."userId"
      WHERE wm."workspaceId" = "Workspace".id
        AND u."supabaseUserId" = auth.uid()::text
    )
  );
CREATE POLICY "workspace_member_read_members" ON "WorkspaceMember"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "WorkspaceMember"."userId"
        AND u."supabaseUserId" = auth.uid()::text
    )
  );
CREATE POLICY "creation_owner_read" ON "Creation"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "Creation"."userId"
        AND u."supabaseUserId" = auth.uid()::text
    )
  );
CREATE POLICY "uploaded_asset_owner_read" ON "UploadedAsset"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "UploadedAsset"."userId"
        AND u."supabaseUserId" = auth.uid()::text
    )
  );

-- Partial business-uniqueness indexes are intentionally outside Prisma's
-- datamodel.  The duplicate unfiltered entitlement index found in the
-- reference database is historical and deliberately not recreated.
CREATE UNIQUE INDEX "Explorer_one_per_user"
  ON "Entitlement"("userId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX "Explorer_one_per_workspace"
  ON "Entitlement"("workspaceId") WHERE "planCode" = 'EXPLORER';
CREATE UNIQUE INDEX "Explorer_one_per_customer"
  ON "Entitlement"("polarCustomerId")
  WHERE "planCode" = 'EXPLORER' AND "polarCustomerId" IS NOT NULL;

-- Supabase Before User Created auth-hook function.  The function is created
-- only in the application schema; the corresponding Auth dashboard hook is a
-- separate post-provisioning configuration step.
CREATE OR REPLACE FUNCTION public.doolphin_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE email_domain text;
BEGIN
  email_domain := lower(trim(split_part(coalesce(event->'user'->>'email',''), '@', 2)));
  IF email_domain = '' OR EXISTS (
    SELECT 1 FROM "BlockedEmailDomain" b
    WHERE b."isActive"
      AND (email_domain = b.domain OR email_domain LIKE '%.' || b.domain)
  ) THEN
    RETURN jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 400,
        'message', 'Temporary or disposable email addresses are not supported. Please use a permanent email address.'
      )
    );
  END IF;
  RETURN '{}'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.doolphin_before_user_created(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.doolphin_before_user_created(jsonb) TO supabase_auth_admin';
  END IF;
END
$$;

-- Keep the all-public-tables RLS invariant for future Prisma migrations.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE command_record record;
BEGIN
  FOR command_record IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF command_record.schema_name = 'public' THEN
      BEGIN
        EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', command_record.object_identity);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable failed for %', command_record.object_identity;
      END;
    END IF;
  END LOOP;
END;
$$;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();
