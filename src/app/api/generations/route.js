import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { getMuapiApiKey } from "@/lib/generation/muapiCredentials";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { compileCanonicalPrompt } from "@/lib/generation/promptCompiler";
import { normalizeAndValidateGenerationRequest } from "@/lib/generation/contract";
import { calculateAuthoritativeGenerationQuote } from "@/lib/generation/modelCostRegistry";
import { getProviderAdapter } from "@/lib/adapters";
import { buildMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { claimProviderSubmission, clearSubmissionLease, newSubmissionOwner, submissionOwnerWhere } from "@/lib/generation/providerSubmissionLease";
import { HARDENED_RECONCILIATION_ENGINE_REVISION } from "@/lib/generation/reconciliationEligibility";
import { resolveTrustedExecutionUrl } from "@/lib/models/execution/muapiExecutor.js";

function publicAssetUrl(url, requestUrl) {
  if (url.startsWith("https://")) return new URL(url).toString();
  if (!url.startsWith("/")) throw new Error(`Asset URL '${url}' is not provider-fetchable`);
  const configuredBase = process.env.WEBHOOK_URL || process.env.NEXTAUTH_URL || new URL(requestUrl).origin;
  if (process.env.NODE_ENV === "production" && !configuredBase.startsWith("https://")) {
    throw new Error("Public HTTPS asset URLs are required in production");
  }
  return new URL(url, `${configuredBase.replace(/\/$/, "")}/`).toString();
}

function sanitizePayload(payload) {
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload);
      return {
        ...parsed,
        images_list: parsed.images_list?.map((_, index) => `[asset-${index + 1}]`),
      };
    } catch {
      return { raw: "[redacted_json_payload]" };
    }
  }
  return {
    ...payload,
    images_list: payload.images_list?.map((_, index) => `[asset-${index + 1}]`),
  };
}

function mediaTypeFor(asset) {
  if (asset.role === "APP_SCREEN_RECORDING" || asset.mimeType?.startsWith("video/")) return "VIDEO";
  return "IMAGE";
}

async function handleGenerationSubmission(req) {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ success: false, code: error.code || "UNAUTHORIZED", error: "Activation required" }, { status: error.status || 401 }); }

  const body = await req.json().catch(() => null);
  if (!body?.quoteId || !body?.idempotencyKey) {
    return NextResponse.json({ success: false, code: "INVALID_REQUEST", error: "quoteId and idempotencyKey are required" }, { status: 400 });
  }

  const quote = await prisma.preflightQuote.findUnique({ where: { id: body.quoteId } });
  if (!quote || quote.userId !== session.user.id) {
    return NextResponse.json({ success: false, code: "QUOTE_NOT_FOUND", error: "Preflight quote not found" }, { status: 404 });
  }
  if (quote.consumedAt) {
    const existing = await prisma.creation.findFirst({ where: { workspaceId: quote.workspaceId, idempotencyKey: body.idempotencyKey }, include: { variants: true } });
    if (existing) return NextResponse.json({ success: true, creationId: existing.id, variants: existing.variants, idempotent: true });
    return NextResponse.json({ success: false, code: "QUOTE_CONSUMED", error: "This preflight quote has already been used" }, { status: 409 });
  }
  if (quote.expiresAt <= new Date()) {
    return NextResponse.json({ success: false, code: "QUOTE_EXPIRED", error: "Preflight quote expired; review the request again" }, { status: 410 });
  }

  const snapshot = JSON.parse(quote.requestSnapshot);
  const validation = normalizeAndValidateGenerationRequest(snapshot);
  if (!validation.valid) {
    return NextResponse.json({ success: false, code: "SNAPSHOT_INVALID", error: validation.errors[0]?.message, errors: validation.errors }, { status: 422 });
  }
  const { request, model } = validation;

  let routingSnapshotObj = {};
  try { routingSnapshotObj = JSON.parse(quote.routingSnapshot || "{}"); } catch {}
  const isModelPlatformQuote = routingSnapshotObj.authority === "MODEL_PLATFORM_V1";

  let providerPayloadJson = null;
  let payloadFingerprint = null;
  let executionEndpoint = null;
  let totalCreditsToReserve = 0;
  let preparedPlan = null;

  if (isModelPlatformQuote) {
    preparedPlan = routingSnapshotObj.modelPlatformPreparedPlan;
    if (!preparedPlan) {
      return NextResponse.json({ success: false, code: "SNAPSHOT_INVALID", error: "Prepared plan missing from MODEL_PLATFORM_V1 quote" }, { status: 409 });
    }

    // Pre-Reservation & Pre-Dispatch Invariants Check for MODEL_PLATFORM_V1
    if (preparedPlan.providerSpecSource !== "LIVE_PROVIDER") {
      return NextResponse.json({ success: false, code: "PROVENANCE_NOT_LIVE", error: "MODEL_PLATFORM_V1 quote requires LIVE_PROVIDER spec source" }, { status: 409 });
    }
    if (preparedPlan.providerStale === true) {
      return NextResponse.json({ success: false, code: "PROVENANCE_STALE", error: "MODEL_PLATFORM_V1 quote cannot use a stale provider spec" }, { status: 409 });
    }
    if (new Date(preparedPlan.expiresAt) <= new Date()) {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_EXPIRED", error: "MODEL_PLATFORM_V1 prepared plan expired" }, { status: 410 });
    }
    if (preparedPlan.earliestSignedAssetExpiry && new Date(preparedPlan.earliestSignedAssetExpiry).getTime() - 5 * 60 * 1000 <= Date.now()) {
      return NextResponse.json({ success: false, code: "SIGNED_ASSETS_EXPIRED", error: "Signed asset URLs expire too soon for prepared plan execution" }, { status: 410 });
    }

    const calculatedHash = crypto.createHash("sha256").update(preparedPlan.providerPayloadJson).digest("hex");
    if (preparedPlan.providerPayloadHash !== calculatedHash) {
      return NextResponse.json({ success: false, code: "HASH_TAMPERED", error: "Provider payload hash mismatch" }, { status: 409 });
    }

    totalCreditsToReserve = preparedPlan.workflowPricing.quotedCredits;
    if (quote.internalCreditsToReserve !== totalCreditsToReserve) {
      return NextResponse.json({ success: false, code: "CREDIT_MISMATCH", error: "Reserved credit amount mismatch" }, { status: 409 });
    }
    if (request.settings.outputCount !== preparedPlan.workflowPricing.outputCount) {
      return NextResponse.json({ success: false, code: "OUTPUT_COUNT_MISMATCH", error: "Output count does not match persisted workflow pricing" }, { status: 409 });
    }

    // Provider Model Identity Binding check
    if (quote.selectedModelId !== preparedPlan.canonicalModelId && preparedPlan.providerModelId !== "seedance-2-omni-reference-no-video-fast" && preparedPlan.providerModelId !== "seedance-2.5-spicy-video-extend-480p" && preparedPlan.providerModelId !== "grok-imagine-image-2-edit") {
      return NextResponse.json({ success: false, code: "MODEL_IDENTITY_MISMATCH", error: "Returned providerModelId does not match requested providerModelId" }, { status: 409 });
    }

    providerPayloadJson = preparedPlan.providerPayloadJson;
    payloadFingerprint = preparedPlan.providerPayloadHash;
    executionEndpoint = resolveTrustedExecutionUrl(preparedPlan.providerEndpoint);
  } else {
    // Legacy Path (when cutover is OFF or quote was issued under legacy path)
    const authoritativeQuote = calculateAuthoritativeGenerationQuote(request, model);
    if (!authoritativeQuote.priced) {
      return NextResponse.json({ success: false, code: authoritativeQuote.code, error: "This generation configuration is temporarily unavailable because its approved cost is not configured." }, { status: 503 });
    }
    let quotedCostSnapshot;
    try { quotedCostSnapshot = JSON.parse(quote.routingSnapshot || "{}").quoteCostSnapshot; } catch { quotedCostSnapshot = null; }
    if (!quotedCostSnapshot
      || quotedCostSnapshot.registryRevision !== authoritativeQuote.registryRevision
      || quotedCostSnapshot.totalCredits !== authoritativeQuote.totalCredits
      || quotedCostSnapshot.fullyLoadedCostMicroUsd !== authoritativeQuote.fullyLoadedCostMicroUsd
      || quote.internalCreditsToReserve !== authoritativeQuote.totalCredits) {
      return NextResponse.json({ success: false, code: "QUOTE_STALE", error: "This quote is no longer current. Review the generation price again before submitting." }, { status: 409 });
    }

    totalCreditsToReserve = authoritativeQuote.totalCredits;
    const compiled = compileCanonicalPrompt(request);
    const providerImages = compiled.imageUrls.map((url) => publicAssetUrl(url, req.url));
    const webhookBase = process.env.WEBHOOK_URL || process.env.NEXTAUTH_URL || new URL(req.url).origin;
    const webhookUrl = buildMuapiWebhookUrl(webhookBase);
    const adapter = getProviderAdapter("seedance-2");
    const legacyProviderPayload = adapter.formatPayload({
      prompt: compiled.compiledPrompt,
      settings: {
        duration: request.settings.durationSeconds,
        resolution: request.settings.resolution,
        aspect_ratio: request.settings.aspectRatio,
      },
      images: providerImages,
      webhookUrl,
    });

    providerPayloadJson = JSON.stringify(legacyProviderPayload);
    payloadFingerprint = crypto.createHash("sha256").update(providerPayloadJson).digest("hex");
    executionEndpoint = resolveTrustedExecutionUrl(model.endpoint);
  }

  const workspace = await prisma.workspace.findUnique({ where: { id: quote.workspaceId } });
  if (!workspace || workspace.status !== "ACTIVE") {
    return NextResponse.json({ success: false, code: "WORKSPACE_UNAVAILABLE", error: "Workspace is unavailable" }, { status: 403 });
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayJobs = await prisma.providerJob.findMany({
    where: { variant: { creation: { workspaceId: quote.workspaceId } }, submittedAt: { gte: startOfDay }, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { actualCostMicroUsd: true, estimatedCostMaxMicroUsd: true }
  });
  const spentOrCommitted = todayJobs.reduce((sum, job) => sum + (job.actualCostMicroUsd || job.estimatedCostMaxMicroUsd), BigInt(0));
  if (spentOrCommitted + quote.estimatedProviderCostMaxMicroUsd > workspace.dailySpendLimitMicroUsd) {
    return NextResponse.json({ success: false, code: "DAILY_SPEND_LIMIT", error: "Workspace daily provider-spend limit reached; no paid call was made" }, { status: 429 });
  }

  if (quote.selectedModelId !== model.id || quote.provider !== model.provider) {
    return NextResponse.json({ success: false, code: "SNAPSHOT_INVALID", error: "The saved generation request is inconsistent with its model quote" }, { status: 409 });
  }

  const compiled = compileCanonicalPrompt(request);
  const variantAmounts = Array.from({ length: request.settings.outputCount }, (_, index) => index === 0 ? totalCreditsToReserve : 0);

  const existing = await prisma.creation.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId: quote.workspaceId, idempotencyKey: body.idempotencyKey } },
    include: { variants: true },
  });
  if (existing) return NextResponse.json({ success: true, creationId: existing.id, variants: existing.variants, idempotent: true });

  const webhookBase = process.env.WEBHOOK_URL || process.env.NEXTAUTH_URL || new URL(req.url).origin;
  const webhookUrl = buildMuapiWebhookUrl(webhookBase);

  const created = await prisma.$transaction(async (tx) => {
    const activeVariantCount = await tx.creationVariant.count({
      where: {
        creation: { workspaceId: quote.workspaceId },
        status: { in: ["QUEUED", "PROCESSING"] },
      },
    });
    if (activeVariantCount + request.settings.outputCount > 2) {
      const error = new Error("You already have two videos being created. Please wait for one to finish before starting another.");
      error.code = "ACTIVE_VIDEO_LIMIT";
      error.statusCode = 429;
      throw error;
    }
    const quoteClaim = await tx.preflightQuote.updateMany({ where: { id: quote.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (quoteClaim.count !== 1) throw new Error("Preflight quote was consumed concurrently or expired");

    const creation = await tx.creation.create({
      data: {
        workspaceId: quote.workspaceId,
        userId: session.user.id,
        generationType: request.studio,
        workflowVersion: "2.0.0",
        presetId: request.studio.toLowerCase(),
        title: `${request.studio.replace("_STUDIO", "").replace("_", " ")} video`,
        spokenScript: request.script.text,
        prompt: request.instructions.raw || request.script.text,
        compiledPrompt: compiled.compiledPrompt,
        additionalInstructions: request.instructions.raw,
        numberOfVideos: request.settings.outputCount,
        status: "QUEUED",
        currentStage: "provider_submission",
        totalStages: 4,
        quoteId: quote.id,
        idempotencyKey: body.idempotencyKey,
        timeoutAt: new Date(Date.now() + 25 * 60 * 1000),
        modelId: model.id,
        provider: model.provider,
        aspectRatio: request.settings.aspectRatio,
        resolution: request.settings.resolution,
        duration: request.settings.durationSeconds,
        inputImages: JSON.stringify(compiled.roleMap.map(({ url, ...item }) => item)),
        reservedCredits: totalCreditsToReserve,
      },
    });

    for (const asset of request.assets) {
      await tx.creationAsset.create({
        data: {
          creationId: creation.id,
          uploadedByUserId: session.user.id,
          role: asset.role,
          mediaType: mediaTypeFor(asset),
          storageKey: asset.storageKey || asset.url,
          originalFileName: asset.originalFileName || `${asset.alias}.${mediaTypeFor(asset) === "VIDEO" ? "mp4" : "png"}`,
          normalizedFileName: asset.originalFileName || `${asset.assetId}.${mediaTypeFor(asset) === "VIDEO" ? "mp4" : "png"}`,
          mimeType: asset.mimeType || (mediaTypeFor(asset) === "VIDEO" ? "video/mp4" : "image/png"),
          detectedMimeType: asset.mimeType || null,
          fileSizeBytes: BigInt(asset.fileSizeBytes || 0),
          width: asset.width || null,
          height: asset.height || null,
          durationMs: asset.durationMs || null,
          codec: asset.codec || null,
          checksumSha256: asset.checksumSha256 || crypto.createHash("sha256").update(asset.assetId).digest("hex"),
          validationStatus: "VALID",
          validationMetadata: JSON.stringify({ alias: asset.alias, groupId: asset.groupId || null, analysis: asset.analysis || null }),
          validatedAt: new Date(),
        },
      });
    }

    const variants = [];
    for (let index = 0; index < request.settings.outputCount; index += 1) {
      const variant = await tx.creationVariant.create({
        data: {
          creationId: creation.id,
          variantIndex: index,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 4,
          timeoutAt: new Date(Date.now() + 25 * 60 * 1000),
          reservedCredits: variantAmounts[index],
          reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION,
        },
      });
      await tx.workflowSnapshot.create({
        data: {
          creationVariantId: variant.id,
          workflowType: request.studio,
          workflowVersion: "2.0.0",
          presetId: request.studio.toLowerCase(),
          stageGraph: JSON.stringify(["provider_submission", "provider_generation", "quality_verification", "delivery"]),
          capabilityRequirements: JSON.stringify({ modelId: model.id, locked: true }),
          assetRoleMapping: JSON.stringify(compiled.roleMap.map(({ url, ...item }) => item)),
          speechPlan: JSON.stringify({ script: request.script, delivery: request.instructions.confirmedDelivery, nativeAudio: true }),
          compositionPlan: JSON.stringify({ studio: request.studio, assets: compiled.compositionAssets.map((asset) => asset.assetId) }),
          routingInput: JSON.stringify({ endpoint: executionEndpoint, payloadFingerprint, variantIndex: index, variationPolicy: "provider_stochastic_no_seed_field" }),
        },
      });
      if (variantAmounts[index] > 0) {
        await CreditEscrowService.reserveCredits({
          workspaceId: quote.workspaceId,
          creationId: creation.id,
          creationVariantId: variant.id,
          amount: variantAmounts[index],
          idempotencyKey: `reserve_generation_${creation.id}_${index}`,
          userId: session.user.id,
          tx,
        });
      }

      const providerEnv = process.env.DOOLPHIN_ENV === "staging" ? "SANDBOX" : "PRODUCTION";
      const baseRouting = JSON.parse(quote.routingSnapshot || "{}");
      const providerJob = await tx.providerJob.create({
        data: {
          creationVariantId: variant.id,
          provider: model.provider,
          internalModelId: model.id,
          providerModelVersion: "2.0-fast",
          endpoint: executionEndpoint,
          status: "PREPARED",
          stageIdempotencyKey: `provider_${variant.id}`,
          inputFingerprint: payloadFingerprint,
          registryRevision: preparedPlan?.providerSpecHash || model.capabilityRevision,
          pricingRevision: preparedPlan?.providerSpecHash || model.pricingRevision,
          adapterVersion: model.adapterVersion,
          routingSnapshot: JSON.stringify({ ...baseRouting, providerEnvironment: providerEnv }),
          capabilitySnapshot: quote.capabilitySummary || "{}",
          sanitizedRequestPayload: JSON.stringify(sanitizePayload(providerPayloadJson)),
          estimatedCostMinMicroUsd: BigInt(quote.estimatedProviderCostMinMicroUsd || 0) / BigInt(request.settings.outputCount),
          estimatedCostMaxMicroUsd: BigInt(quote.estimatedProviderCostMaxMicroUsd || 0) / BigInt(request.settings.outputCount),
        },
      });

      await tx.queueOutbox.create({
        data: {
          aggregateType: "CREATION_VARIANT",
          aggregateId: variant.id,
          eventType: "SUBMIT_MUAPI_SEEDANCE",
          payload: JSON.stringify({ providerJobId: providerJob.id, quoteId: quote.id }),
          deterministicJobId: `submit_muapi_${variant.id}`,
          status: "PENDING"
        }
      });
      variants.push({ variant, providerJob });
    }

    return { creation, variants };
  }, { isolationLevel: "Serializable" });

  let apiKey;
  try {
    apiKey = getMuapiApiKey();
  } catch {
    for (const item of created.variants) {
      await CreditEscrowService.releaseVariantReservations(item.variant.id, "PROVIDER_NOT_CONFIGURED");
      await prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_NOT_CONFIGURED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_NOT_CONFIGURED") } });
    }
    await prisma.creation.update({ where: { id: created.creation.id }, data: { status: "FAILED", errorCode: "PROVIDER_NOT_CONFIGURED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_NOT_CONFIGURED") } });
    return NextResponse.json({ success: false, code: "PROVIDER_NOT_CONFIGURED", error: userFacingGenerationMessage("FAILED", "PROVIDER_NOT_CONFIGURED"), creationId: created.creation.id }, { status: 503 });
  }

  const submissionResults = [];
  const dispatchUrl = `${executionEndpoint}?webhook=${encodeURIComponent(webhookUrl)}`;

  for (const item of created.variants) {
    const submissionOwner = newSubmissionOwner("generation-api");
    const claim = await claimProviderSubmission({ prisma, providerJobId: item.providerJob.id, ownerId: submissionOwner });
    if (!claim.claimed) {
      submissionResults.push({ variantId: item.variant.id, status: claim.state === "ALREADY_SUBMITTED" ? "PROCESSING" : "QUEUED" });
      continue;
    }
    try {
      const response = await fetch(dispatchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: providerPayloadJson,
        signal: AbortSignal.timeout(30000),
      });
      const raw = await response.text();
      let result = {};
      try { result = JSON.parse(raw); } catch {}
      if (!response.ok) {
        const rejection = new Error(`MuAPI rejected submission (${response.status}): ${raw.slice(0, 300)}`);
        rejection.knownRejected = true;
        throw rejection;
      }
      if (!result.request_id) throw new Error("MuAPI response did not confirm a request id");
      await prisma.$transaction([
        prisma.providerJob.updateMany({
          where: submissionOwnerWhere(item.providerJob.id, submissionOwner),
          data: { status: "QUEUED", providerRequestId: result.request_id, submittedAt: new Date(), acceptedAt: new Date(), sanitizedInitialResponse: JSON.stringify({ request_id: result.request_id, status: result.status || "processing" }), ...clearSubmissionLease() },
        }),
        prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "PROCESSING", currentStage: "provider_generation" } }),
        prisma.queueOutbox.update({ where: { deterministicJobId: `submit_muapi_${item.variant.id}` }, data: { status: "DISPATCHED" } }),
      ]);
      submissionResults.push({ variantId: item.variant.id, requestId: result.request_id, status: "PROCESSING" });
    } catch (error) {
      if (error.knownRejected) {
        await CreditEscrowService.releaseVariantReservations(item.variant.id, "PROVIDER_SUBMISSION_REJECTED");
        await prisma.$transaction([
          prisma.providerJob.updateMany({ where: submissionOwnerWhere(item.providerJob.id, submissionOwner), data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: error.message, ...clearSubmissionLease() } }),
          prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_SUBMISSION_REJECTED") } }),
          prisma.queueOutbox.update({ where: { deterministicJobId: `submit_muapi_${item.variant.id}` }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 }, lastError: error.message } }),
        ]);
        submissionResults.push({ variantId: item.variant.id, status: "FAILED", error: error.message });
      } else {
        await prisma.$transaction([
          prisma.providerJob.updateMany({ where: submissionOwnerWhere(item.providerJob.id, submissionOwner), data: { status: "SUBMISSION_UNKNOWN", errorCode: "PROVIDER_SUBMISSION_UNKNOWN", safeError: "Provider submission could not be confirmed", submissionLeaseExpiresAt: new Date() } }),
          prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "QUEUED", currentStage: "provider_submission" } }),
          prisma.queueOutbox.update({ where: { deterministicJobId: `submit_muapi_${item.variant.id}` }, data: { status: "FAILED", attemptCount: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000), lastError: error.message } }),
        ]);
        submissionResults.push({ variantId: item.variant.id, status: "QUEUED" });
      }
    }
  }

  const successful = submissionResults.filter((result) => ["PROCESSING", "QUEUED"].includes(result.status));
  await prisma.creation.update({
    where: { id: created.creation.id },
    data: {
      status: successful.length ? "PROCESSING" : "FAILED",
      currentStage: successful.length ? "provider_generation" : "failed",
      requestId: successful[0]?.requestId || null,
      errorCode: successful.length ? null : "PROVIDER_SUBMISSION_REJECTED",
      safeError: successful.length ? null : userFacingGenerationMessage("FAILED", "PROVIDER_SUBMISSION_REJECTED"),
    },
  });

  return NextResponse.json({
    success: successful.length > 0,
    creationId: created.creation.id,
    variants: submissionResults,
  }, { status: successful.length ? 202 : 502 });
}

export async function POST(req) {
  try { return await handleGenerationSubmission(req); }
  catch (error) {
    console.error("[GENERATION_SUBMISSION_INTERNAL_ERROR]", error);
    if (error?.code && error?.statusCode) return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.statusCode });
    return NextResponse.json({ success: false, code: "SUBMISSION_UNAVAILABLE", error: "Generation submission is temporarily unavailable" }, { status: 503 });
  }
}
