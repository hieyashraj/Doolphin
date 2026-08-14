import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { getImageModel } from "@/lib/generation-models/imageRegistry";
import { canGenerate } from "@/lib/generation-models/types";
import { estimateImageQuote } from "@/lib/generation-models/imageEstimate";
import { validateExploreImageIds } from "@/lib/generation/curatedReferenceResolver";

function payloadFingerprint(payload) { return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }

export async function POST(req) {
  try {
    const { appUser } = await requireActivatedAccount();
    const input = await req.json();
    const model = getImageModel(input?.modelId);
    if (!model || !canGenerate(model)) return NextResponse.json({ code: "IMAGE_MODEL_UNAVAILABLE", error: "This image model is not enabled in this environment." }, { status: 503 });
    const validation = model.adapter.validateNormalizedRequest(model, input);
    if (!validation.valid) return NextResponse.json({ code: "IMAGE_PREFLIGHT_INVALID", errors: validation.errors }, { status: 422 });
    const workspace = await prisma.workspace.findUnique({ where: { id: appUser.defaultWorkspaceId } });
    if (!workspace || workspace.status !== "ACTIVE") return NextResponse.json({ code: "WORKSPACE_UNAVAILABLE" }, { status: 403 });
    
    // Validate user uploaded reference assets
    const refIds = validation.request.referenceAssetIds || [];
    const assets = refIds.length ? await prisma.uploadedAsset.findMany({ where: { id: { in: refIds }, userId: appUser.id, validationStatus: "VALID" } }) : [];
    if (assets.length !== refIds.length || assets.some((asset) => !asset.mimeType.startsWith("image/"))) return NextResponse.json({ code: "IMAGE_REFERENCE_OWNERSHIP_FAILED", error: "References must be validated image assets owned by you." }, { status: 403 });
    
    // Validate curated explore reference IDs against manifest
    const exploreReqIds = validation.request.exploreImageIds || [];
    const validatedExploreItems = validateExploreImageIds(exploreReqIds);
    if (validatedExploreItems.length !== exploreReqIds.length) return NextResponse.json({ code: "INVALID_CURATED_REFERENCE", error: "Curated reference image is invalid or unavailable." }, { status: 422 });

    const estimatePayload = model.adapter.buildEstimatePayload(model, { request: validation.request });
    const quoteBreakdown = await estimateImageQuote({ model, request: validation.request, payload: estimatePayload });
    if (!quoteBreakdown.priced) return NextResponse.json({ code: quoteBreakdown.code, error: quoteBreakdown.reason }, { status: 503 });
    const account = await prisma.creditAccount.findUnique({ where: { workspaceId: workspace.id } });
    if (!account || account.availableCredits < quoteBreakdown.totalCredits) return NextResponse.json({ code: "INSUFFICIENT_CREDITS", requiredCredits: quoteBreakdown.totalCredits, availableCredits: account?.availableCredits || 0 }, { status: 402 });
    const snapshot = { imageRequest: validation.request, referenceAssetIds: validation.request.referenceAssetIds, providerPayloadFingerprint: payloadFingerprint(estimatePayload), providerDefaults: model.fixedProviderDefaults, estimate: quoteBreakdown.estimate, quoteBreakdown };
    const quote = await prisma.preflightQuote.create({ data: { workspaceId: workspace.id, userId: appUser.id, generationType: "IMAGE_STUDIO", requestSnapshot: JSON.stringify(validation.request), normalizedAssetSummary: JSON.stringify(assets.map((asset) => ({ id: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType }))), routingSnapshot: JSON.stringify(snapshot), selectedModelId: model.id, provider: model.provider, providerEndpoint: model.endpoint, registryRevision: model.capabilityRevision || "image-v1", pricingRevision: quoteBreakdown.pricingRevisionId, adapterVersion: model.adapterVersion || "image-adapter-v1", estimatedProviderCostMinMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd), estimatedProviderCostMaxMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd), infrastructureCostEstimateMicroUsd: BigInt(quoteBreakdown.internalCostReserveMicroUsd), expectedFailureLossMicroUsd: 0n, internalCreditsToReserve: quoteBreakdown.totalCredits, warnings: "[]", capabilitySummary: JSON.stringify(model.productCapabilities), expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return NextResponse.json({ quote: { id: quote.id, expiresAt: quote.expiresAt, modelId: model.id, credits: quoteBreakdown.totalCredits, costs: quoteBreakdown, request: validation.request } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { console.error("[IMAGE_PREFLIGHT]", error); return NextResponse.json({ code: "IMAGE_PREFLIGHT_UNAVAILABLE", error: "Image pricing is temporarily unavailable." }, { status: 503 }); }
}
