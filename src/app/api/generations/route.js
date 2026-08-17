import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { normalizeAndValidateGenerationRequest } from "@/lib/generation/contract";
import { compileCanonicalPrompt } from "@/lib/generation/promptCompiler";
import { getMuapiApiKey } from "@/lib/generation/muapiCredentials";
import { getProviderAdapter } from "@/lib/adapters";
import { buildMuapiWebhookUrl } from "@/lib/generation/webhookSecurity";
import { userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { claimProviderSubmission, clearSubmissionLease, newSubmissionOwner, submissionOwnerWhere } from "@/lib/generation/providerSubmissionLease";
import { HARDENED_RECONCILIATION_ENGINE_REVISION } from "@/lib/generation/reconciliationEligibility";

import { resolveTrustedExecutionUrl } from "@/lib/models/execution/muapiExecutor.js";
import { mapValidatedStudioWorkflowToNormalizedInvocation } from "@/lib/models/bridges/studioWorkflowBridge.js";
import { isModelPlatformV1Creation, settleModelPlatformWorkflow } from "@/lib/models/execution/workflowSettlement.js";

export const maxDuration = 300;

function mediaTypeFor(asset) {
  if (asset.role === "ACTOR_REFERENCE") return "IMAGE";
  if (asset.mimeType?.startsWith("video/")) return "VIDEO";
  return "IMAGE";
}

function sanitizePayload(rawJson) {
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed.prompt) parsed.prompt = "[REDACTED_PROMPT]";
    if (Array.isArray(parsed.images_list)) {
      parsed.images_list = parsed.images_list.map((_, index) => `[REDACTED_IMAGE_${index + 1}]`);
    }
    return parsed;
  } catch {
    return { sanitized: true };
  }
}

async function handleGenerationSubmission(req) {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ success: false, code: error.code || "UNAUTHORIZED", error: "Activation required" }, { status: error.status || 401 }); }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, code: "INVALID_JSON", error: "A valid JSON request is required" }, { status: 400 });
  }

  if (!body?.quoteId || !body?.idempotencyKey) {
    return NextResponse.json({ success: false, code: "MISSING_PARAMETERS", error: "Both quoteId and idempotencyKey are required" }, { status: 400 });
  }

  const quote = await prisma.preflightQuote.findFirst({ where: { id: body.quoteId, userId: session.user.id } });
  if (!quote) {
    return NextResponse.json({ success: false, code: "QUOTE_NOT_FOUND", error: "Preflight quote not found or not owned by user" }, { status: 404 });
  }

  // Idempotency check FIRST: If an existing Creation already exists for this idempotency key, return it idempotently!
  const existing = await prisma.creation.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId: quote.workspaceId, idempotencyKey: body.idempotencyKey } },
    include: { variants: true },
  });
  if (existing) return NextResponse.json({ success: true, creationId: existing.id, variants: existing.variants, idempotent: true });

  if (quote.consumedAt) {
    return NextResponse.json({ success: false, code: "QUOTE_ALREADY_CONSUMED", error: "This preflight quote has already been consumed" }, { status: 409 });
  }
  if (quote.expiresAt <= new Date()) {
    return NextResponse.json({ success: false, code: "QUOTE_EXPIRED", error: "Preflight quote has expired; run preflight again" }, { status: 410 });
  }

  const request = JSON.parse(quote.requestSnapshot);
  const validation = normalizeAndValidateGenerationRequest(request);
  if (!validation.valid) {
    return NextResponse.json({ success: false, code: "QUOTE_SNAPSHOT_INVALID", error: "Quote snapshot failed contract validation" }, { status: 422 });
  }
  const model = validation.model;
  const totalCreditsToReserve = quote.internalCreditsToReserve;

  let providerPayloadJson;
  let payloadFingerprint;
  let executionEndpoint;
  let registryRevisionId = quote.registryRevision;
  let pricingRevisionId = quote.pricingRevision;

  const parsedRouting = JSON.parse(quote.routingSnapshot || "{}");
  const isModelPlatformCutover = parsedRouting.authority === "MODEL_PLATFORM_V1";

  if (isModelPlatformCutover) {
    if (process.env.MODEL_PLATFORM_SEEDANCE_CUTOVER_ENABLED !== "true") {
      return NextResponse.json({
        success: false,
        code: "CUTOVER_DISABLED_EMERGENCY_KILL",
        error: "MODEL_PLATFORM_V1 generation is disabled by emergency kill-switch; no paid call was made",
      }, { status: 503 });
    }

    const preparedPlan = parsedRouting.modelPlatformPreparedPlan;
    if (!preparedPlan || preparedPlan.authorityVersion !== "MODEL_PLATFORM_PREPARED_V1") {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_MISSING", error: "Prepared execution plan is missing from quote snapshot" }, { status: 422 });
    }

    if (preparedPlan.providerPayloadHash !== parsedRouting.providerPayloadFingerprint) {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_TAMPERED", error: "Prepared plan payload fingerprint mismatch" }, { status: 422 });
    }

    if (preparedPlan.workflowPricing.quotedCredits !== totalCreditsToReserve) {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_CREDIT_MISMATCH", error: "Prepared plan credit quote mismatch" }, { status: 422 });
    }

    if (preparedPlan.workflowPricing.outputCount !== request.settings.outputCount) {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_OUTPUT_COUNT_MISMATCH", error: "Prepared plan outputCount mismatch" }, { status: 422 });
    }

    if (preparedPlan.expiresAt && new Date(preparedPlan.expiresAt) <= new Date()) {
      return NextResponse.json({ success: false, code: "PREPARED_PLAN_EXPIRED", error: "Prepared execution plan has expired" }, { status: 410 });
    }

    if (preparedPlan.earliestSignedAssetExpiry && new Date(preparedPlan.earliestSignedAssetExpiry) <= new Date(Date.now() + 5 * 60 * 1000)) {
      return NextResponse.json({ success: false, code: "SIGNED_ASSET_EXPIRING_SOON", error: "Signed asset URL in prepared plan has expired or violates safety margin" }, { status: 422 });
    }

    providerPayloadJson = preparedPlan.providerPayloadJson;
    payloadFingerprint = preparedPlan.providerPayloadHash;
    executionEndpoint = resolveTrustedExecutionUrl(preparedPlan.providerEndpoint);
    registryRevisionId = preparedPlan.providerSpecHash;
    pricingRevisionId = preparedPlan.pricingRevisionId;
  } else {
    const providerImages = request.assets
      .map((asset) => asset.url)
      .filter((url) => typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://")));
    const adapter = getProviderAdapter("seedance-2");
    const legacyProviderPayload = adapter.formatPayload({
      prompt: request.instructions.raw || request.script.text,
      settings: {
        duration: request.settings.durationSeconds,
        resolution: request.settings.resolution,
        aspect_ratio: request.settings.aspectRatio,
      },
      images: providerImages,
      webhookUrl: "https://api.doolphin.com/webhook",
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
          registryRevision: registryRevisionId,
          pricingRevision: pricingRevisionId,
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
    const isModelPlatform = await isModelPlatformV1Creation(created.creation.id);
    if (!isModelPlatform) {
      for (const item of created.variants) {
        await CreditEscrowService.releaseVariantReservations(item.variant.id, "PROVIDER_NOT_CONFIGURED");
        await prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_NOT_CONFIGURED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_NOT_CONFIGURED") } });
      }
    } else {
      for (const item of created.variants) {
        await prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_NOT_CONFIGURED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_NOT_CONFIGURED") } });
      }
      await settleModelPlatformWorkflow({ creationId: created.creation.id });
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
        redirect: "error",
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
        const isModelPlatform = await isModelPlatformV1Creation(created.creation.id);
        if (!isModelPlatform) {
          await CreditEscrowService.releaseVariantReservations(item.variant.id, "PROVIDER_SUBMISSION_REJECTED");
        }
        await prisma.$transaction([
          prisma.providerJob.updateMany({ where: submissionOwnerWhere(item.providerJob.id, submissionOwner), data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: error.message, ...clearSubmissionLease() } }),
          prisma.creationVariant.update({ where: { id: item.variant.id }, data: { status: "FAILED", errorCode: "PROVIDER_SUBMISSION_REJECTED", safeError: userFacingGenerationMessage("FAILED", "PROVIDER_SUBMISSION_REJECTED") } }),
          prisma.queueOutbox.update({ where: { deterministicJobId: `submit_muapi_${item.variant.id}` }, data: { status: "DEAD_LETTER", attemptCount: { increment: 1 }, lastError: error.message } }),
        ]);
        if (isModelPlatform) {
          await settleModelPlatformWorkflow({ creationId: created.creation.id });
        }
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
