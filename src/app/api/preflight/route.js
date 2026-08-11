import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import {
  calculateGenerationQuote,
  fingerprintGenerationRequest,
  normalizeAndValidateGenerationRequest,
} from "@/lib/generation/contract";
import { compileCanonicalPrompt } from "@/lib/generation/promptCompiler";
import { getProviderAdapter } from "@/lib/adapters";
import { buildMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { resolvePlatformAvatar } from "@/lib/generation/avatarRegistry";
import { R2StorageService } from "@/lib/storage/r2StorageService";

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
        asset.url = R2StorageService.isConfigured()
          ? await R2StorageService.generateSignedUrl({ storageKey: storedAsset.storageKey, expiresInSeconds: 60 * 60 })
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
  const adapter = getProviderAdapter("seedance-2");
  let providerPayload;
  try {
    providerPayload = adapter.formatPayload({
      prompt: compiled.compiledPrompt,
      settings: {
        duration: request.settings.durationSeconds,
        resolution: request.settings.resolution,
        aspect_ratio: request.settings.aspectRatio,
      },
      images: compiled.imageUrls,
      webhookUrl,
    });
  } catch (error) {
    return NextResponse.json({ success: false, code: "ADAPTER_VALIDATION_FAILED", error: error.message }, { status: 422 });
  }

  const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);
  if (!workspace?.id || workspace.id === "ws_default_fallback") {
    return NextResponse.json({ success: false, code: "DATABASE_UNAVAILABLE", error: "Preflight cannot continue without durable workspace storage" }, { status: 503 });
  }

  const quoteBreakdown = calculateGenerationQuote(request, model);
  const requestFingerprint = fingerprintGenerationRequest(request);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const roleMap = compiled.roleMap.map(({ url, ...entry }) => entry);
  const routingSnapshot = {
    model: safeModelSnapshot(model),
    webhookUrl,
    requestFingerprint,
    providerPayloadFingerprint: crypto.createHash("sha256").update(JSON.stringify(providerPayload)).digest("hex"),
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
      providerEndpoint: model.endpoint,
      registryRevision: model.capabilityRevision,
      pricingRevision: model.pricingRevision,
      adapterVersion: model.adapterVersion,
      estimatedProviderCostMinMicroUsd: BigInt(quoteBreakdown.generationCredits * 10000),
      estimatedProviderCostMaxMicroUsd: BigInt(quoteBreakdown.totalCredits * 10000),
      infrastructureCostEstimateMicroUsd: BigInt((quoteBreakdown.analysisCredits + quoteBreakdown.verificationCredits) * 10000),
      expectedFailureLossMicroUsd: BigInt(0),
      internalCreditsToReserve: quoteBreakdown.totalCredits,
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
      costs: quoteBreakdown,
      providerPreview: {
        endpoint: model.endpoint,
        payload: { ...providerPayload, images_list: providerPayload.images_list.map((_, index) => `[signed-asset-${index + 1}]`) },
      },
    },
  });
}

export async function POST(req) {
  try { return await handlePreflight(req); }
  catch (error) {
    console.error("[PREFLIGHT_INTERNAL_ERROR]", error);
    return NextResponse.json({ success: false, code: "PREFLIGHT_UNAVAILABLE", error: "Preflight is temporarily unavailable; no provider call was made" }, { status: 503 });
  }
}
