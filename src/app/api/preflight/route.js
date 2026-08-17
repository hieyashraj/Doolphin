import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { fingerprintGenerationRequest, normalizeAndValidateGenerationRequest } from "@/lib/generation/contract";
import { compileCanonicalPrompt } from "@/lib/generation/promptCompiler";
import { buildMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { resolvePlatformAvatar } from "@/lib/generation/avatarRegistry";
import { R2StorageService } from "@/lib/storage/r2StorageService";

import { mapValidatedStudioWorkflowToNormalizedInvocation } from "@/lib/models/bridges/studioWorkflowBridge.js";
import { resolveTrustedApplicationOrigin } from "@/lib/models/bridges/applicationOrigin.js";
import { prepareExecutionPlan } from "@/lib/models/execution/prepareExecutionPlan.js";

function safeModelSnapshot(model) {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    endpoint: model.endpoint,
    adapterVersion: model.adapterVersion,
    capabilityRevision: model.capabilityRevision,
    pricingRevision: model.pricingRevision,
    resolutions: model.resolutions,
    aspectRatios: model.aspectRatios,
    minDuration: model.minDuration,
    maxDuration: model.maxDuration,
    maxImages: model.maxImages,
  };
}

async function handlePreflight(req) {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ success: false, code: error.code || "UNAUTHORIZED", error: "Activation required" }, { status: error.status || 401 }); }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, code: "INVALID_JSON", error: "A valid JSON request is required" }, { status: 400 });
  }

  let earliestSignedAssetExpiryMs = null;

  if (Array.isArray(body?.assets)) {
    for (const asset of body.assets) {
      if (asset.role === "ACTOR_REFERENCE") {
        const platformAvatar = resolvePlatformAvatar(asset.assetId);
        if (!platformAvatar) {
          return NextResponse.json({ success: false, code: "INVALID_AVATAR", error: "Select an avatar from the authenticated studio library" }, { status: 422 });
        }
        asset.alias = platformAvatar.name;
        asset.url = platformAvatar.url;
        asset.storageKey = null;
      } else {
        const storedAsset = await prisma.uploadedAsset.findFirst({ where: { id: asset.assetId, userId: session.user.id } });
        if (!storedAsset) {
          return NextResponse.json({ success: false, code: "ASSET_OWNERSHIP_FAILED", error: `Asset '${asset.alias || asset.assetId}' is not owned by this user` }, { status: 403 });
        }
        if (storedAsset.validationStatus !== "VALID" || !storedAsset.validatedAt) {
          return NextResponse.json({ success: false, code: "ASSET_INVALID", error: `Uploaded asset '${asset.alias || storedAsset.originalFileName}' has not passed media validation` }, { status: 422 });
        }
        if (!storedAsset.analysisConfirmedAt || storedAsset.analysisStatus !== "CONFIRMED") {
          return NextResponse.json({ success: false, code: "ASSET_ANALYSIS_UNCONFIRMED", error: `Review and confirm the analysis for '${asset.alias || storedAsset.originalFileName}' before generation`, assetId: storedAsset.id }, { status: 422 });
        }
        const stored = await R2StorageService.checkObjectExists(storedAsset.storageKey);
        if (!stored.exists || Number(stored.size) !== Number(storedAsset.fileSizeBytes)) {
          return NextResponse.json({ success: false, code: "ASSET_MISSING", error: `Uploaded asset '${asset.alias || asset.assetId}' is missing or incomplete` }, { status: 422 });
        }
        asset.storageKey = storedAsset.storageKey;
        asset.originalFileName = storedAsset.originalFileName;
        asset.mimeType = storedAsset.mimeType;
        asset.fileSizeBytes = Number(storedAsset.fileSizeBytes);
        asset.detectedMimeType = storedAsset.detectedMimeType;
        asset.width = storedAsset.width;
        asset.height = storedAsset.height;
        asset.durationMs = storedAsset.durationMs;
        asset.codec = storedAsset.codec;
        asset.checksumSha256 = storedAsset.checksumSha256;
        asset.analysisRevision = storedAsset.analysisRevision;
        asset.analysis = JSON.parse(storedAsset.analysisJson);
        asset.analysis._billing = { creditsCharged: storedAsset.analysisCreditsCharged, workspaceId: storedAsset.analysisWorkspaceId };

        const signedUrlExpirySeconds = 60 * 60;
        const assetExpiresAtMs = Date.now() + signedUrlExpirySeconds * 1000;
        if (earliestSignedAssetExpiryMs === null || assetExpiresAtMs < earliestSignedAssetExpiryMs) {
          earliestSignedAssetExpiryMs = assetExpiresAtMs;
        }

        asset.url = R2StorageService.isConfigured()
          ? await R2StorageService.generateSignedUrl({ storageKey: storedAsset.storageKey, expiresInSeconds: signedUrlExpirySeconds })
          : `/storage/${storedAsset.storageKey}`;
      }
    }
  }

  const validation = normalizeAndValidateGenerationRequest(body);
  if (!validation.valid) {
    return NextResponse.json({
      success: false,
      code: "PREFLIGHT_FAILED",
      error: validation.errors[0]?.message || "Preflight validation failed",
      errors: validation.errors,
      estimatedSpeechSeconds: validation.estimatedSpeechSeconds,
    }, { status: 422 });
  }

  const { request, model, estimatedSpeechSeconds } = validation;
  const compiled = compileCanonicalPrompt(request);
  const webhookBase = process.env.WEBHOOK_URL || process.env.NEXTAUTH_URL;
  if (!webhookBase?.startsWith("https://") && process.env.NODE_ENV === "production") {
    return NextResponse.json({ success: false, code: "WEBHOOK_NOT_CONFIGURED", error: "A public HTTPS WEBHOOK_URL is required" }, { status: 503 });
  }
  let webhookUrl;
  try {
    webhookUrl = buildMuapiWebhookUrl(webhookBase || "http://localhost:3000");
  } catch (error) {
    return NextResponse.json({ success: false, code: "WEBHOOK_NOT_CONFIGURED", error: error.message }, { status: 503 });
  }

  const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);
  if (!workspace?.id || workspace.id === "ws_default_fallback") {
    return NextResponse.json({ success: false, code: "DATABASE_UNAVAILABLE", error: "Preflight cannot continue without durable workspace storage" }, { status: 503 });
  }

  const requestFingerprint = fingerprintGenerationRequest(request);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const roleMap = compiled.roleMap.map(({ url, ...entry }) => entry);

  // Model Platform V1 is the sole authoritative pricing/dispatch path. The
  // legacy Seedance adapter/pricing branch and its feature-flagged cutover
  // have been fully retired — this route no longer conditionally selects
  // between two systems.
  try {
      const outputCount = Math.max(
        1,
        Math.floor(
          Number(
            request.settings?.outputCount ||
            body.outputCount
          ) || 1
        )
      );

      const applicationOrigin = resolveTrustedApplicationOrigin({
        appBaseUrl: process.process?.env?.APP_BASE_URL || process.env.APP_BASE_URL,
        nextAuthUrl: process.process?.env?.NEXTAUTH_URL || process.env.NEXTAUTH_URL,
        requestOrigin: req?.nextUrl?.origin,
        nodeEnv: process.process?.env?.NODE_ENV || process.env.NODE_ENV,
      });

      const normalizedInput = mapValidatedStudioWorkflowToNormalizedInvocation({
        request,
        compiledPrompt: compiled.compiledPrompt,
        providerImageUrls: compiled.imageUrls,
        earliestSignedAssetExpiryMs,
        applicationOrigin,
      });
      const modelId = body.modelId || model.id || "seedance-2";
      const plan = await prepareExecutionPlan({
        modelId,
        normalizedInput,
        outputCount,
        env: process.env,
      });

      const modelPlatformPreparedPlan = {
        authorityVersion: "MODEL_PLATFORM_PREPARED_V1",
        canonicalModelId: plan.canonicalModelId,
        providerModelId: plan.providerModelId,
        providerEndpoint: plan.providerEndpoint,
        providerSpecHash: plan.providerSpecHash,
        providerSpecSource: plan.provenance?.source || "BOOTSTRAP",
        providerFetchedAt: plan.provenance?.providerFetchedAt || null,
        providerStale: Boolean(plan.provenance?.stale),
        providerPayloadJson: plan.providerPayloadJson,
        providerPayloadHash: plan.providerPayloadHash,
        unitPricing: plan.unitPricing,
        workflowPricing: plan.workflowPricing,
        pricingRevisionId: plan.workflowPricing.pricingRevisionId,
        outputCount: plan.workflowPricing.outputCount,
        preparedAt: plan.preparedAt,
        expiresAt: plan.expiresAt,
        earliestSignedAssetExpiry: earliestSignedAssetExpiryMs ? new Date(earliestSignedAssetExpiryMs).toISOString() : null,
        webhookStrategy: plan.transport.webhookStrategy,
      };

      const quoteCostSnapshot = {
        priced: true,
        totalCredits: plan.workflowPricing.quotedCredits,
        fullyLoadedCostMicroUsd: Number(plan.workflowPricing.fullyLoadedCostMicroUsd),
        pricingRevisionId: plan.workflowPricing.pricingRevisionId,
        components: {
          providerGeneration: Number(plan.workflowPricing.costComponents.providerGeneration || plan.workflowPricing.totalProviderCostMicroUsd),
          variableInfra: Number(plan.workflowPricing.costComponents.variableInfra || 0),
        },
      };

      const routingSnapshot = {
        authority: "MODEL_PLATFORM_V1",
        model: safeModelSnapshot(model),
        webhookUrl,
        requestFingerprint,
        quoteCostSnapshot,
        providerPayloadFingerprint: plan.providerPayloadHash,
        modelPlatformPreparedPlan,
      };

      const quote = await prisma.preflightQuote.create({
        data: {
          workspaceId: workspace.id,
          userId: session.user.id,
          generationType: request.studio,
          requestSnapshot: JSON.stringify(request),
          normalizedAssetSummary: JSON.stringify(roleMap),
          routingSnapshot: JSON.stringify(routingSnapshot),
          selectedModelId: model.id,
          provider: model.provider,
          providerEndpoint: plan.providerEndpoint,
          registryRevision: plan.providerSpecHash,
          pricingRevision: plan.workflowPricing.pricingRevisionId,
          adapterVersion: model.adapterVersion,
          estimatedProviderCostMinMicroUsd: BigInt(plan.workflowPricing.totalProviderCostMicroUsd),
          estimatedProviderCostMaxMicroUsd: BigInt(plan.workflowPricing.totalProviderCostMicroUsd),
          infrastructureCostEstimateMicroUsd: BigInt(plan.workflowPricing.fullyLoadedCostMicroUsd) - BigInt(plan.workflowPricing.totalProviderCostMicroUsd),
          expectedFailureLossMicroUsd: BigInt(0),
          internalCreditsToReserve: plan.workflowPricing.quotedCredits,
          warnings: JSON.stringify([]),
          capabilitySummary: JSON.stringify(safeModelSnapshot(model)),
          expiresAt,
        },
      });

      return NextResponse.json({
        success: true,
        quote: {
          id: quote.id,
          expiresAt,
          requestFingerprint,
          model: safeModelSnapshot(model),
          settings: request.settings,
          estimatedSpeechSeconds,
          delivery: request.instructions.confirmedDelivery,
          roleMap,
          scenePlan: compiled.compiledPrompt,
          costs: quoteCostSnapshot,
          providerPreview: {
            endpoint: plan.providerEndpoint,
            payload: { prompt: compiled.compiledPrompt, images_list: compiled.imageUrls.map((_, idx) => `[signed-asset-${idx + 1}]`) },
          },
        },
      });
  } catch (planError) {
    return NextResponse.json({
      success: false,
      code: planError.code || "PREFLIGHT_FAILED",
      error: planError.message || "Model Platform preflight execution plan generation failed",
    }, { status: 503 });
  }
}

export async function POST(req) {
  try { return await handlePreflight(req); }
  catch (error) {
    console.error("[PREFLIGHT_INTERNAL_ERROR]", error);
    return NextResponse.json({ success: false, code: "PREFLIGHT_UNAVAILABLE", error: "Preflight is temporarily unavailable; no provider call was made" }, { status: 503 });
  }
}
