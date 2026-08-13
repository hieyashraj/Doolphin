import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { getImageModel } from "@/lib/generation-models/imageRegistry";
import { canGenerate } from "@/lib/generation-models/types";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { claimProviderSubmission, clearSubmissionLease, newSubmissionOwner, submissionOwnerWhere } from "@/lib/generation/providerSubmissionLease";
import { HARDENED_RECONCILIATION_ENGINE_REVISION } from "@/lib/generation/reconciliationEligibility";

import { resolveCuratedSignedUrls } from "@/lib/generation/curatedReferenceResolver";

const providerEndpoint = (endpoint) => new URL(endpoint, "https://api.muapi.ai").toString();

export async function POST(req) {
  try {
    const { appUser } = await requireActivatedAccount();
    const body = await req.json();
    if (!body?.quoteId || !body?.idempotencyKey) return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
    const quote = await prisma.preflightQuote.findUnique({ where: { id: body.quoteId } });
    if (!quote || quote.userId !== appUser.id || quote.generationType !== "IMAGE_STUDIO") return NextResponse.json({ code: "QUOTE_NOT_FOUND" }, { status: 404 });
    const existing = await prisma.creation.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: quote.workspaceId, idempotencyKey: body.idempotencyKey } }, include: { variants: true } });
    if (existing) return NextResponse.json({ success: true, creationId: existing.id, variants: existing.variants, idempotent: true });
    if (quote.consumedAt || quote.expiresAt <= new Date()) return NextResponse.json({ code: quote.consumedAt ? "QUOTE_CONSUMED" : "QUOTE_EXPIRED" }, { status: 409 });
    const request = JSON.parse(quote.requestSnapshot); const routing = JSON.parse(quote.routingSnapshot); const model = getImageModel(quote.selectedModelId);
    if (!model || !canGenerate(model) || routing.quoteBreakdown?.pricingRevisionId !== quote.pricingRevision) return NextResponse.json({ code: "QUOTE_STALE" }, { status: 409 });
    const refIds = request.referenceAssetIds || [];
    const assets = refIds.length ? await prisma.uploadedAsset.findMany({ where: { id: { in: refIds }, userId: appUser.id, validationStatus: "VALID" } }) : [];
    if (assets.length !== refIds.length) return NextResponse.json({ code: "IMAGE_REFERENCE_OWNERSHIP_FAILED" }, { status: 403 });
    
    const exploreReqIds = request.exploreImageIds || [];
    const validatedExploreItems = validateExploreImageIds(exploreReqIds);
    if (validatedExploreItems.length !== exploreReqIds.length) return NextResponse.json({ code: "INVALID_CURATED_REFERENCE" }, { status: 422 });

    const referenceUrls = await Promise.all(assets.map((asset) => R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 3600 })));
    const exploreSignedUrls = await resolveCuratedSignedUrls(request.exploreImageIds);
    const providerPayload = model.adapter.buildProviderPayload(model, { request, referenceUrls, exploreUrls: exploreSignedUrls });
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ ...providerPayload, images_list: providerPayload.images_list?.map(() => "[SIGNED_REFERENCE]") })).digest("hex");

    const created = await prisma.$transaction(async (tx) => {
      const claimed = await tx.preflightQuote.updateMany({ where: { id: quote.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } }); if (claimed.count !== 1) throw new Error("QUOTE_CONCURRENTLY_CONSUMED");
      const creation = await tx.creation.create({ data: { workspaceId: quote.workspaceId, userId: appUser.id, generationType: "IMAGE_STUDIO", workflowVersion: "image-generation.v1", presetId: "image-studio", title: "Image Studio generation", prompt: request.prompt, compiledPrompt: request.prompt, numberOfVideos: 1, status: "QUEUED", currentStage: "provider_submission", totalStages: 3, quoteId: quote.id, idempotencyKey: body.idempotencyKey, timeoutAt: new Date(Date.now() + 25 * 60_000), modelId: model.id, provider: model.provider, aspectRatio: request.aspectRatio || null, resolution: request.outputResolution || null, inputImages: JSON.stringify(request.referenceAssetIds), reservedCredits: quote.internalCreditsToReserve } });
      const variant = await tx.creationVariant.create({ data: { creationId: creation.id, variantIndex: 0, status: "QUEUED", currentStage: "provider_submission", totalStages: 3, timeoutAt: creation.timeoutAt, reservedCredits: quote.internalCreditsToReserve, reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION } });
      await tx.workflowSnapshot.create({ data: { creationVariantId: variant.id, workflowType: "IMAGE_STUDIO", workflowVersion: "image-generation.v1", presetId: "image-studio", stageGraph: JSON.stringify(["provider_submission", "provider_generation", "delivery"]), capabilityRequirements: JSON.stringify({ modelId: model.id, locked: true }), assetRoleMapping: JSON.stringify(request.referenceAssetIds), speechPlan: "{}", compositionPlan: "{}", routingInput: JSON.stringify({ endpoint: model.endpoint, payloadFingerprint: fingerprint }) } });
      await CreditEscrowService.reserveCredits({ workspaceId: quote.workspaceId, creationId: creation.id, creationVariantId: variant.id, amount: quote.internalCreditsToReserve, idempotencyKey: `reserve_image_${creation.id}`, userId: appUser.id, tx });
      const job = await tx.providerJob.create({ data: { creationVariantId: variant.id, provider: model.provider, internalModelId: model.id, providerModelVersion: model.id, endpoint: model.endpoint, status: "PREPARED", stageIdempotencyKey: `image_provider_${variant.id}`, inputFingerprint: fingerprint, registryRevision: quote.registryRevision, pricingRevision: quote.pricingRevision, adapterVersion: quote.adapterVersion, routingSnapshot: JSON.stringify({ imageRequest: request, quote: routing.quoteBreakdown }), capabilitySnapshot: quote.capabilitySummary || "{}", sanitizedRequestPayload: JSON.stringify({ ...providerPayload, images_list: providerPayload.images_list?.map(() => "[SIGNED_REFERENCE]") }), estimatedCostMinMicroUsd: quote.estimatedProviderCostMinMicroUsd, estimatedCostMaxMicroUsd: quote.estimatedProviderCostMaxMicroUsd } });
      return { creation, variant, job };
    }, { isolationLevel: "Serializable" });
    const owner = newSubmissionOwner("image-api"); const claim = await claimProviderSubmission({ prisma, providerJobId: created.job.id, ownerId: owner });
    if (!claim.claimed) return NextResponse.json({ success: true, creationId: created.creation.id, status: "QUEUED" });
    let response; try { response = await fetch(providerEndpoint(model.endpoint), { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.MUAPI_API_KEY }, body: JSON.stringify(providerPayload), signal: AbortSignal.timeout(30_000) }); } catch { await prisma.providerJob.updateMany({ where: submissionOwnerWhere(created.job.id, owner), data: { status: "SUBMISSION_UNKNOWN", errorCode: "PROVIDER_SUBMISSION_UNKNOWN", safeError: "Submission outcome requires reconciliation." } }); return NextResponse.json({ success: true, creationId: created.creation.id, status: "QUEUED" }); }
    const result = await response.json().catch(() => ({})); if (!response.ok || !result.request_id) { await CreditEscrowService.releaseVariantReservations(created.variant.id, "PROVIDER_SUBMISSION_REJECTED"); await prisma.$transaction([prisma.providerJob.updateMany({ where: submissionOwnerWhere(created.job.id, owner), data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: "Provider rejected submission.", ...clearSubmissionLease() } }), prisma.creationVariant.update({ where: { id: created.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED" } }), prisma.creation.update({ where: { id: created.creation.id }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED" } })]); return NextResponse.json({ code: "PROVIDER_SUBMISSION_REJECTED" }, { status: 503 }); }
    await prisma.$transaction([prisma.providerJob.updateMany({ where: submissionOwnerWhere(created.job.id, owner), data: { status: "QUEUED", providerRequestId: result.request_id, submittedAt: new Date(), acceptedAt: new Date(), sanitizedInitialResponse: JSON.stringify({ request_id: result.request_id, status: result.status || "queued" }), ...clearSubmissionLease() } }), prisma.creationVariant.update({ where: { id: created.variant.id }, data: { status: "PROCESSING", currentStage: "provider_generation" } }), prisma.creation.update({ where: { id: created.creation.id }, data: { status: "PROCESSING", currentStage: "provider_generation" } })]);
    return NextResponse.json({ success: true, creationId: created.creation.id, status: "PROCESSING" });
  } catch (error) { console.error("[IMAGE_SUBMIT]", error); return NextResponse.json({ code: "IMAGE_SUBMISSION_UNAVAILABLE", error: "Image submission could not be completed safely." }, { status: 503 }); }
}
