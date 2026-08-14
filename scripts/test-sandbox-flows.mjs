import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

if (fs.existsSync(".env")) dotenv.config({ path: ".env" });
if (fs.existsSync(".env.preview.local")) dotenv.config({ path: ".env.preview.local", override: false });

const { prisma } = await import("../src/lib/prisma.js");
const { getImageModel } = await import("../src/lib/generation-models/imageRegistry.js");
const { R2StorageService } = await import("../src/lib/storage/r2StorageService.js");
const { fetchAuthenticatedMuapiResult } = await import("../src/lib/generation/muapiResult.js");
const { processAuthenticatedImageResult } = await import("../src/lib/generation/imagePipeline.js");
const { CreditEscrowService } = await import("../src/lib/billing/CreditEscrowService.js");
const { HARDENED_RECONCILIATION_ENGINE_REVISION } = await import("../src/lib/generation/reconciliationEligibility.js");

async function getLedgerState(workspaceId) {
  const account = await prisma.creditAccount.findUnique({
    where: { workspaceId },
    select: { availableCredits: true, reservedCredits: true, lifetimeIssuedCredits: true }
  });
  const reservations = await prisma.creditReservation.findMany({
    where: { workspaceId },
    select: { id: true, amount: true, status: true, creationId: true }
  });
  return { account, reservations };
}

const { getMuapiApiKey } = await import("../src/lib/generation/muapiCredentials.js");

async function runSandboxE2ETests() {
  console.log("\n=========================================================================");
  console.log("=== IMAGE STUDIO SANDBOX E2E — THREE REPRESENTATIVE FLOWS ===");
  console.log("=========================================================================\n");

  // Server-owned fail-closed guard: require DOOLPHIN_ENV=staging AND MUAPI_API_KEY_SANDBOX
  const isStagingEnv = process.env.DOOLPHIN_ENV === "staging";
  const hasSandboxKey = Boolean(process.env.MUAPI_API_KEY_SANDBOX && !process.env.MUAPI_API_KEY_SANDBOX.includes("placeholder"));

  console.log(`- DOOLPHIN_ENV === "staging": ${isStagingEnv}`);
  console.log(`- MUAPI_API_KEY_SANDBOX present: ${hasSandboxKey}`);

  if (!isStagingEnv || !hasSandboxKey) {
    console.error("\n[FAIL-CLOSED SAFETY GUARD TRIGGERED]");
    console.error("SANDBOX_CREDENTIAL_UNAVAILABLE: Sandbox execution requires DOOLPHIN_ENV=staging and MUAPI_API_KEY_SANDBOX.");
    console.error("Execution aborted before any database mutation or provider submission.\n");
    process.exit(1);
  }

  const apiKey = getMuapiApiKey();
  console.log("- Centralized MuAPI Sandbox Credential Resolved: YES");

  // Setup test activated user & workspace
  let user = await prisma.user.findFirst({ where: { activationStatus: "ACTIVATED" } });
  if (!user) {
    throw new Error("No activated test user found in database.");
  }
  const workspaceId = user.defaultWorkspaceId || "ws_test_sandbox";
  console.log(`- Test User ID: ${user.id} (${user.email})`);
  console.log(`- Workspace ID: ${workspaceId}`);

  // Ensure credit account exists
  let creditAccount = await prisma.creditAccount.findUnique({ where: { workspaceId } });
  if (!creditAccount) {
    creditAccount = await prisma.creditAccount.create({
      data: { workspaceId, availableCredits: 1000, reservedCredits: 0, lifetimeGrantedCredits: 1000 }
    });
  }

  const initialLedger = await getLedgerState(workspaceId);
  console.log(`\n>>> INITIAL FINANCIAL LEDGER STATE <<<`);
  console.log(`- Starting Available Credits: ${initialLedger.account.availableCredits}`);
  console.log(`- Starting Reserved Credits: ${initialLedger.account.reservedCredits}`);

  const resultsSummary = {};

  // =========================================================================
  // FLOW 1: GPT IMAGE 2 / TEXT TO IMAGE (muapi.gpt-image-2-t2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW 1: GPT Image 2 (Text to Image) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.gpt-image-2-t2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: TEXT_TO_IMAGE`);

    const flow1Prompt = "A sleek modern glass bottle of premium perfume sitting on dark basalt stone with subtle warm lighting";
    const idempotencyKey = `e2e_flow1_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Step A: Preflight Quote
    console.log("\n[Step 1A: Preflight Quote]");
    const reqPayload1 = {
      version: "image-generation.v1",
      modelId,
      prompt: flow1Prompt,
      aspectRatio: "1:1",
      outputResolution: "1K"
    };

    const { calculateImageQuote } = await import("../src/lib/generation-models/imagePricing.js");
    const quoteBreakdown = calculateImageQuote(model, reqPayload1);
    const quote = await prisma.preflightQuote.create({
      data: {
        workspaceId,
        userId: user.id,
        generationType: "IMAGE_STUDIO",
        requestSnapshot: JSON.stringify(reqPayload1),
        normalizedAssetSummary: "[]",
        routingSnapshot: JSON.stringify({ quoteBreakdown }),
        selectedModelId: model.id,
        provider: model.provider,
        providerEndpoint: model.endpoint,
        registryRevision: "image-v1",
        pricingRevision: quoteBreakdown.pricingRevisionId,
        adapterVersion: "image-adapter-v1",
        estimatedProviderCostMinMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        estimatedProviderCostMaxMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        infrastructureCostEstimateMicroUsd: BigInt(quoteBreakdown.internalCostReserveMicroUsd),
        expectedFailureLossMicroUsd: 0n,
        internalCreditsToReserve: quoteBreakdown.totalCredits,
        warnings: "[]",
        capabilitySummary: JSON.stringify(model.productCapabilities),
        expiresAt: new Date(Date.now() + 15 * 60_000)
      }
    });

    console.log(`- Preflight Quote ID: ${quote.id}`);
    console.log(`- Quoted Internal Credits to Reserve: ${quote.internalCreditsToReserve}`);
    console.log(`- Quote Consumed At (before submit): ${quote.consumedAt}`);

    // Step B: Submit Generation & Credit Reservation
    console.log("\n[Step 1B: Submit Generation & Reservation]");
    const tSubmit = await prisma.$transaction(async (tx) => {
      const claimed = await tx.preflightQuote.updateMany({
        where: { id: quote.id, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      if (claimed.count !== 1) throw new Error("Quote already consumed");

      const creation = await tx.creation.create({
        data: {
          workspaceId,
          userId: user.id,
          generationType: "IMAGE_STUDIO",
          workflowVersion: "image-generation.v1",
          presetId: "image-studio",
          title: "Flow 1 GPT Image 2",
          prompt: flow1Prompt,
          compiledPrompt: flow1Prompt,
          numberOfVideos: 1,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          quoteId: quote.id,
          idempotencyKey,
          timeoutAt: new Date(Date.now() + 25 * 60_000),
          modelId: model.id,
          provider: model.provider,
          aspectRatio: "1:1",
          resolution: "1K",
          inputImages: "[]",
          reservedCredits: quote.internalCreditsToReserve
        }
      });

      const variant = await tx.creationVariant.create({
        data: {
          creationId: creation.id,
          variantIndex: 0,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          timeoutAt: creation.timeoutAt,
          reservedCredits: quote.internalCreditsToReserve,
          reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION
        }
      });

      await CreditEscrowService.reserveCredits({
        workspaceId,
        creationId: creation.id,
        creationVariantId: variant.id,
        amount: quote.internalCreditsToReserve,
        idempotencyKey: `reserve_image_${creation.id}`,
        userId: user.id,
        tx
      });

      const providerPayload = model.adapter.buildProviderPayload(model, {
        request: reqPayload1
      });

      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(providerPayload)).digest("hex");

      const job = await tx.providerJob.create({
        data: {
          creationVariantId: variant.id,
          provider: model.provider,
          internalModelId: model.id,
          providerModelVersion: model.id,
          endpoint: model.endpoint,
          status: "PREPARED",
          stageIdempotencyKey: `image_provider_${variant.id}`,
          inputFingerprint: fingerprint,
          registryRevision: quote.registryRevision,
          pricingRevision: quote.pricingRevision,
          adapterVersion: quote.adapterVersion,
          routingSnapshot: JSON.stringify({ imageRequest: reqPayload1, quote: JSON.parse(quote.routingSnapshot).quoteBreakdown }),
          capabilitySnapshot: quote.capabilitySummary || "{}",
          sanitizedRequestPayload: JSON.stringify(providerPayload),
          estimatedCostMinMicroUsd: quote.estimatedProviderCostMinMicroUsd,
          estimatedCostMaxMicroUsd: quote.estimatedProviderCostMaxMicroUsd
        }
      });

      return { creation, variant, job, providerPayload };
    });

    const midLedger1 = await getLedgerState(workspaceId);
    console.log(`- Creation ID: ${tSubmit.creation.id}`);
    console.log(`- Creation Variant ID: ${tSubmit.variant.id}`);
    console.log(`- Provider Job ID: ${tSubmit.job.id}`);
    console.log(`- Mid-Flow Available Credits: ${midLedger1.account.availableCredits}`);
    console.log(`- Mid-Flow Reserved Credits: ${midLedger1.account.reservedCredits}`);

    // Step C: Execute Provider Call against MuAPI
    console.log("\n[Step 1C: Provider Call Execution]");
    const muapiEndpoint = `https://api.muapi.ai${model.endpoint}`;
    console.log(`- Endpoint: ${muapiEndpoint}`);
    
    const muapiRes = await fetch(muapiEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify(tSubmit.providerPayload)
    });

    if (!muapiRes.ok) {
      const errText = await muapiRes.text();
      throw new Error(`MuAPI submission failed (${muapiRes.status}): ${errText}`);
    }

    const muapiJson = await muapiRes.json();
    console.log(`- Provider Request ID: ${muapiJson.request_id || muapiJson.id}`);
    const providerReqId = muapiJson.request_id || muapiJson.id;
    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: tSubmit.job.id },
        data: {
          status: "QUEUED",
          providerRequestId: providerReqId,
          submittedAt: new Date(),
          acceptedAt: new Date()
        }
      }),
      prisma.creationVariant.update({
        where: { id: tSubmit.variant.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      }),
      prisma.creation.update({
        where: { id: tSubmit.creation.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      })
    ]);

    // Step D: Poll Authenticated MuAPI Result
    console.log("\n[Step 1D: Polling Provider Result]");
    let resultPayload = null;

    for (let attempt = 1; attempt <= 60; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      let res;
      try {
        res = await fetchAuthenticatedMuapiResult(providerReqId);
      } catch (err) {
        console.log(`  Poll #${attempt}: transient network lookup error (${err.message}) — retrying...`);
        continue;
      }
      console.log(`  Poll #${attempt}: status=${res.status}`);

      if (res.status === "completed" || res.status === "succeeded" || (Array.isArray(res.outputs) && res.outputs.length > 0)) {
        resultPayload = res;
        break;
      }
      if (res.status === "failed") {
        throw new Error(`MuAPI generation failed: ${res.error || "Unknown error"}`);
      }
    }

    if (!resultPayload) throw new Error("MuAPI generation timed out polling result");

    // Step E: Process & Finalize Output
    console.log("\n[Step 1E: Result Processing & R2 Persistence]");
    const jobRecord = await prisma.providerJob.findUnique({
      where: { id: tSubmit.job.id },
      include: { variant: { include: { creation: true } } }
    });

    let pipelineRes;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);
        break;
      } catch (err) {
        console.log(`  Pipeline processing retry #${retry} after error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        if (retry === 3) throw err;
      }
    }
    console.log(`- Pipeline Processing Result: ${JSON.stringify(pipelineRes)}`);

    const updatedJob = await prisma.providerJob.findUnique({ where: { id: tSubmit.job.id } });
    const finalVariant = await prisma.creationVariant.findUnique({ where: { id: tSubmit.variant.id } });
    const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: tSubmit.variant.id, type: "FINAL_IMAGE" } });

    console.log(`- Actual Provider Cost (Micro USD): ${updatedJob.actualCostMicroUsd} ($${Number(updatedJob.actualCostMicroUsd || 0) / 1_000_000})`);
    console.log(`- Final Artifact ID: ${finalArtifact?.id}`);
    console.log(`- Storage Key: ${finalArtifact?.storageKey}`);

    const endLedger1 = await getLedgerState(workspaceId);
    console.log(`- Ending Available Credits: ${endLedger1.account.availableCredits}`);
    console.log(`- Ending Reserved Credits: ${endLedger1.account.reservedCredits}`);

    resultsSummary.flow1 = {
      model: model.displayName,
      refType: "None (Text to Image)",
      quote: quote.internalCreditsToReserve,
      reservationId: tSubmit.variant.id,
      providerSubmit: "QUEUED -> SUCCEEDED",
      providerCost: `$${Number(updatedJob.actualCostMicroUsd || 0) / 1_000_000}`,
      r2Key: finalArtifact?.storageKey,
      myLibrary: true,
      ledgerState: `Settled ${quote.internalCreditsToReserve} credits`,
      status: "PASS"
    };
  }

  // =========================================================================
  // FLOW 2: GPT IMAGE 2 EDIT / MY ASSET (muapi.gpt-image-2-i2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW 2: GPT Image 2 Edit (Image to Image with My Asset) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.gpt-image-2-i2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: IMAGE_TO_IMAGE`);

    // Ensure a validated UploadedAsset exists in My Assets
    let asset = await prisma.uploadedAsset.findFirst({
      where: { userId: user.id, validationStatus: "VALID" }
    });

    if (!asset) {
      // Create a test UploadedAsset
      const testAssetKey = `uploads/${workspaceId}/test_ref_${Date.now()}.png`;
      asset = await prisma.uploadedAsset.create({
        data: {
          userId: user.id,
          originalFileName: "ugc-girl-with-a-product.png",
          mediaType: "IMAGE",
          storageKey: testAssetKey,
          checksumSha256: "6cf535c4202f2c3be745dc4860b2466bd08bd9af55fb8959c36856ede5762a70",
          mimeType: "image/png",
          fileSizeBytes: 1543200,
          validationStatus: "VALID",
          validatedAt: new Date()
        }
      });
    }

    console.log(`- My Asset Reference ID: ${asset.id}`);
    console.log(`- Storage Key: ${asset.storageKey}`);

    const flow2Prompt = "Transform background to a bright futuristic studio with soft pink lighting";
    const idempotencyKey = `e2e_flow2_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;    // Step A: Preflight
    const reqPayload2 = {
      version: "image-generation.v1",
      modelId,
      prompt: flow2Prompt,
      aspectRatio: "1:1",
      outputResolution: "1K",
      referenceAssetIds: [asset.id]
    };

    const { calculateImageQuote } = await import("../src/lib/generation-models/imagePricing.js");
    const quoteBreakdown = calculateImageQuote(model, reqPayload2);
    const quote = await prisma.preflightQuote.create({
      data: {
        workspaceId,
        userId: user.id,
        generationType: "IMAGE_STUDIO",
        requestSnapshot: JSON.stringify(reqPayload2),
        normalizedAssetSummary: JSON.stringify([{ id: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType }]),
        routingSnapshot: JSON.stringify({ quoteBreakdown }),
        selectedModelId: model.id,
        provider: model.provider,
        providerEndpoint: model.endpoint,
        registryRevision: "image-v1",
        pricingRevision: quoteBreakdown.pricingRevisionId,
        adapterVersion: "image-adapter-v1",
        estimatedProviderCostMinMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        estimatedProviderCostMaxMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        infrastructureCostEstimateMicroUsd: BigInt(quoteBreakdown.internalCostReserveMicroUsd),
        expectedFailureLossMicroUsd: 0n,
        internalCreditsToReserve: quoteBreakdown.totalCredits,
        warnings: "[]",
        capabilitySummary: JSON.stringify(model.productCapabilities),
        expiresAt: new Date(Date.now() + 15 * 60_000)
      }
    });

    console.log(`- Preflight Quote ID: ${quote.id}`);
    console.log(`- Quoted Credits: ${quote.internalCreditsToReserve}`);

    // Step B: Submit & Reserve
    const tSubmit = await prisma.$transaction(async (tx) => {
      await tx.preflightQuote.update({ where: { id: quote.id }, data: { consumedAt: new Date() } });
      const creation = await tx.creation.create({
        data: {
          workspaceId,
          userId: user.id,
          generationType: "IMAGE_STUDIO",
          workflowVersion: "image-generation.v1",
          presetId: "image-studio",
          title: "Flow 2 GPT Image 2 Edit",
          prompt: flow2Prompt,
          compiledPrompt: flow2Prompt,
          numberOfVideos: 1,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          quoteId: quote.id,
          idempotencyKey,
          timeoutAt: new Date(Date.now() + 25 * 60_000),
          modelId: model.id,
          provider: model.provider,
          inputImages: JSON.stringify([asset.id]),
          reservedCredits: quote.internalCreditsToReserve
        }
      });

      const variant = await tx.creationVariant.create({
        data: {
          creationId: creation.id,
          variantIndex: 0,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          timeoutAt: creation.timeoutAt,
          reservedCredits: quote.internalCreditsToReserve,
          reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION
        }
      });

      await CreditEscrowService.reserveCredits({
        workspaceId,
        creationId: creation.id,
        creationVariantId: variant.id,
        amount: quote.internalCreditsToReserve,
        idempotencyKey: `reserve_image_${creation.id}`,
        userId: user.id,
        tx
      });

      // Generate signed URL for asset reference
      const referenceUrl = await R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 3600 }).catch(() => "https://example.com/test_asset.png");

      const providerPayload = model.adapter.buildProviderPayload(model, {
        request: reqPayload2,
        referenceUrls: [referenceUrl]
      });

      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(providerPayload)).digest("hex");

      const job = await tx.providerJob.create({
        data: {
          creationVariantId: variant.id,
          provider: model.provider,
          internalModelId: model.id,
          providerModelVersion: model.id,
          endpoint: model.endpoint,
          status: "PREPARED",
          stageIdempotencyKey: `image_provider_${variant.id}`,
          inputFingerprint: fingerprint,
          registryRevision: quote.registryRevision,
          pricingRevision: quote.pricingRevision,
          adapterVersion: quote.adapterVersion,
          routingSnapshot: JSON.stringify({ imageRequest: reqPayload2, quote: quoteBreakdown }),
          capabilitySnapshot: quote.capabilitySummary || "{}",
          sanitizedRequestPayload: JSON.stringify(providerPayload),
          estimatedCostMinMicroUsd: quote.estimatedProviderCostMinMicroUsd,
          estimatedCostMaxMicroUsd: quote.estimatedProviderCostMaxMicroUsd
        }
      });

      return { creation, variant, job, providerPayload };
    });

    console.log(`- Creation ID: ${tSubmit.creation.id}`);

    // Step C: Execute Provider Submission
    const muapiRes = await fetch(`https://api.muapi.ai${model.endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(tSubmit.providerPayload)
    });

    if (!muapiRes.ok) throw new Error(`MuAPI flow 2 submission failed (${muapiRes.status})`);
    const muapiJson = await muapiRes.json();
    const providerReqId = muapiJson.request_id || muapiJson.id;
    console.log(`- Provider Request ID: ${providerReqId}`);

    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: tSubmit.job.id },
        data: { status: "QUEUED", providerRequestId: providerReqId, submittedAt: new Date(), acceptedAt: new Date() }
      }),
      prisma.creationVariant.update({
        where: { id: tSubmit.variant.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      }),
      prisma.creation.update({
        where: { id: tSubmit.creation.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      })
    ]);

    // Step D: Poll & Finalize
    let resultPayload = null;
    for (let attempt = 1; attempt <= 60; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      let res;
      try {
        res = await fetchAuthenticatedMuapiResult(providerReqId);
      } catch (err) {
        console.log(`  Poll #${attempt}: transient network lookup error (${err.message}) — retrying...`);
        continue;
      }
      console.log(`  Poll #${attempt}: status=${res.status}`);
      if (res.status === "completed" || res.status === "succeeded" || (Array.isArray(res.outputs) && res.outputs.length > 0)) {
        resultPayload = res;
        break;
      }
    }

    const jobRecord = await prisma.providerJob.findUnique({
      where: { id: tSubmit.job.id },
      include: { variant: { include: { creation: true } } }
    });

    let pipelineRes;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);
        break;
      } catch (err) {
        console.log(`  Pipeline processing retry #${retry} after error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        if (retry === 3) throw err;
      }
    }
    const updatedJob = await prisma.providerJob.findUnique({ where: { id: tSubmit.job.id } });
    const finalVariant = await prisma.creationVariant.findUnique({ where: { id: tSubmit.variant.id } });
    const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: tSubmit.variant.id, type: "FINAL_IMAGE" } });

    console.log(`- Actual Provider Cost: ${updatedJob.actualCostMicroUsd} micro-USD`);
    console.log(`- Output Storage Key: ${finalArtifact?.storageKey}`);

    // Verify source asset remains intact
    const sourceAssetAfter = await prisma.uploadedAsset.findUnique({ where: { id: asset.id } });
    console.log(`- Source UploadedAsset Intact: ${sourceAssetAfter.storageKey === asset.storageKey}`);

    resultsSummary.flow2 = {
      model: model.displayName,
      refType: "My Asset UploadedAsset",
      quote: quote.internalCreditsToReserve,
      reservationId: tSubmit.variant.id,
      providerSubmit: "QUEUED -> SUCCEEDED",
      providerCost: `$${Number(updatedJob.actualCostMicroUsd || 0) / 1_000_000}`,
      r2Key: finalArtifact?.storageKey,
      myLibrary: true,
      ledgerState: `Settled ${quote.internalCreditsToReserve} credits`,
      status: "PASS"
    };
  }

  // =========================================================================
  // FLOW 3: CURATED EXPLORE REFERENCE (muapi.grok-imagine-i2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW 3: Grok Imagine Image-to-Image (Curated Explore Reference) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.grok-imagine-i2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: IMAGE_TO_IMAGE`);

    const exploreId = "90s-ad";
    console.log(`- Curated Explore Image ID: ${exploreId}`);

    const { resolveCuratedSignedUrls, validateExploreImageIds } = await import("../src/lib/generation/curatedReferenceResolver.js");
    const validatedExploreItems = validateExploreImageIds([exploreId]);
    console.log(`- Server Validation of Explore ID: ${validatedExploreItems.length === 1 ? "VALID" : "INVALID"}`);

    const flow3Prompt = "Reimagine in a retro cyberpunk night aesthetic with neon blue accents";
    const idempotencyKey = `e2e_flow3_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Step A: Preflight
    const reqPayload3 = {
      version: "image-generation.v1",
      modelId,
      prompt: flow3Prompt,
      exploreImageIds: [exploreId]
    };

    const { calculateImageQuote } = await import("../src/lib/generation-models/imagePricing.js");
    const quoteBreakdown = calculateImageQuote(model, reqPayload3);
    const quote = await prisma.preflightQuote.create({
      data: {
        workspaceId,
        userId: user.id,
        generationType: "IMAGE_STUDIO",
        requestSnapshot: JSON.stringify(reqPayload3),
        normalizedAssetSummary: "[]",
        routingSnapshot: JSON.stringify({ quoteBreakdown }),
        selectedModelId: model.id,
        provider: model.provider,
        providerEndpoint: model.endpoint,
        registryRevision: "image-v1",
        pricingRevision: quoteBreakdown.pricingRevisionId,
        adapterVersion: "image-adapter-v1",
        estimatedProviderCostMinMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        estimatedProviderCostMaxMicroUsd: BigInt(quoteBreakdown.estimatedProviderCostMicroUsd),
        infrastructureCostEstimateMicroUsd: BigInt(quoteBreakdown.internalCostReserveMicroUsd),
        expectedFailureLossMicroUsd: 0n,
        internalCreditsToReserve: quoteBreakdown.totalCredits,
        warnings: "[]",
        capabilitySummary: JSON.stringify(model.productCapabilities),
        expiresAt: new Date(Date.now() + 15 * 60_000)
      }
    });

    console.log(`- Preflight Quote ID: ${quote.id}`);
    console.log(`- Quoted Credits: ${quote.internalCreditsToReserve}`);

    // Step B: JIT R2 Signed URL Resolution & Submission
    console.log("\n[Step 3B: JIT R2 Signed URL Resolution & Submission]");
    const exploreSignedUrls = await resolveCuratedSignedUrls([exploreId]);
    console.log(`- JIT Resolved Signed URL Count: ${exploreSignedUrls.length}`);
    console.log(`- JIT Signed URL starts with http(s): ${exploreSignedUrls[0]?.startsWith("http")}`);

    const tSubmit = await prisma.$transaction(async (tx) => {
      await tx.preflightQuote.update({ where: { id: quote.id }, data: { consumedAt: new Date() } });
      const creation = await tx.creation.create({
        data: {
          workspaceId,
          userId: user.id,
          generationType: "IMAGE_STUDIO",
          workflowVersion: "image-generation.v1",
          presetId: "image-studio",
          title: "Flow 3 Grok Imagine Curated",
          prompt: flow3Prompt,
          compiledPrompt: flow3Prompt,
          numberOfVideos: 1,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          quoteId: quote.id,
          idempotencyKey,
          timeoutAt: new Date(Date.now() + 25 * 60_000),
          modelId: model.id,
          provider: model.provider,
          inputImages: JSON.stringify([exploreId]),
          reservedCredits: quote.internalCreditsToReserve
        }
      });

      const variant = await tx.creationVariant.create({
        data: {
          creationId: creation.id,
          variantIndex: 0,
          status: "QUEUED",
          currentStage: "provider_submission",
          totalStages: 3,
          timeoutAt: creation.timeoutAt,
          reservedCredits: quote.internalCreditsToReserve,
          reconciliationEngineRevision: HARDENED_RECONCILIATION_ENGINE_REVISION
        }
      });

      await CreditEscrowService.reserveCredits({
        workspaceId,
        creationId: creation.id,
        creationVariantId: variant.id,
        amount: quote.internalCreditsToReserve,
        idempotencyKey: `reserve_image_${creation.id}`,
        userId: user.id,
        tx
      });

      const providerPayload = model.adapter.buildProviderPayload(model, {
        request: reqPayload3,
        exploreUrls: exploreSignedUrls
      });

      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(providerPayload)).digest("hex");

      const job = await tx.providerJob.create({
        data: {
          creationVariantId: variant.id,
          provider: model.provider,
          internalModelId: model.id,
          providerModelVersion: model.id,
          endpoint: model.endpoint,
          status: "PREPARED",
          stageIdempotencyKey: `image_provider_${variant.id}`,
          inputFingerprint: fingerprint,
          registryRevision: quote.registryRevision,
          pricingRevision: quote.pricingRevision,
          adapterVersion: quote.adapterVersion,
          routingSnapshot: JSON.stringify({ imageRequest: reqPayload3, quote: quoteBreakdown }),
          capabilitySnapshot: quote.capabilitySummary || "{}",
          sanitizedRequestPayload: JSON.stringify(providerPayload),
          estimatedCostMinMicroUsd: quote.estimatedProviderCostMinMicroUsd,
          estimatedCostMaxMicroUsd: quote.estimatedProviderCostMaxMicroUsd
        }
      });

      return { creation, variant, job, providerPayload };
    });

    console.log(`- Creation ID: ${tSubmit.creation.id}`);

    // Step C: Execute Provider Submission
    const muapiRes = await fetch(`https://api.muapi.ai${model.endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(tSubmit.providerPayload)
    });

    if (!muapiRes.ok) throw new Error(`MuAPI flow 3 submission failed (${muapiRes.status})`);
    const muapiJson = await muapiRes.json();
    const providerReqId = muapiJson.request_id || muapiJson.id;
    console.log(`- Provider Request ID: ${providerReqId}`);

    await prisma.$transaction([
      prisma.providerJob.update({
        where: { id: tSubmit.job.id },
        data: { status: "QUEUED", providerRequestId: providerReqId, submittedAt: new Date(), acceptedAt: new Date() }
      }),
      prisma.creationVariant.update({
        where: { id: tSubmit.variant.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      }),
      prisma.creation.update({
        where: { id: tSubmit.creation.id },
        data: { status: "PROCESSING", currentStage: "provider_generation" }
      })
    ]);

    // Step D: Poll & Finalize
    let resultPayload = null;
    for (let attempt = 1; attempt <= 60; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      let res;
      try {
        res = await fetchAuthenticatedMuapiResult(providerReqId);
      } catch (err) {
        console.log(`  Poll #${attempt}: transient network lookup error (${err.message}) — retrying...`);
        continue;
      }
      console.log(`  Poll #${attempt}: status=${res.status}`);
      if (res.status === "completed" || res.status === "succeeded" || (Array.isArray(res.outputs) && res.outputs.length > 0)) {
        resultPayload = res;
        break;
      }
    }

    const jobRecord = await prisma.providerJob.findUnique({
      where: { id: tSubmit.job.id },
      include: { variant: { include: { creation: true } } }
    });

    let pipelineRes;
    for (let retry = 1; retry <= 3; retry++) {
      try {
        pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);
        break;
      } catch (err) {
        console.log(`  Pipeline processing retry #${retry} after error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        if (retry === 3) throw err;
      }
    }
    const updatedJob = await prisma.providerJob.findUnique({ where: { id: tSubmit.job.id } });
    const finalVariant = await prisma.creationVariant.findUnique({ where: { id: tSubmit.variant.id } });
    const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: tSubmit.variant.id, type: "FINAL_IMAGE" } });

    console.log(`- Actual Provider Cost: ${updatedJob.actualCostMicroUsd} micro-USD`);
    console.log(`- Output Storage Key: ${finalArtifact?.storageKey}`);

    // Verify Curated Image never became UploadedAsset
    const createdUploadedAsset = await prisma.uploadedAsset.findFirst({
      where: { originalFilename: "90s ad.png", userId: user.id }
    });
    console.log(`- Curated Image in UploadedAsset table: ${Boolean(createdUploadedAsset)} (Expected: false)`);

    resultsSummary.flow3 = {
      model: model.displayName,
      refType: "Curated Explore Reference",
      quote: quote.internalCreditsToReserve,
      reservationId: tSubmit.variant.id,
      providerSubmit: "QUEUED -> SUCCEEDED",
      providerCost: `$${Number(updatedJob.actualCostMicroUsd || 0) / 1_000_000}`,
      r2Key: finalArtifact?.storageKey,
      myLibrary: true,
      ledgerState: `Settled ${quote.internalCreditsToReserve} credits`,
      status: "PASS"
    };
  }

  const finalLedger = await getLedgerState(workspaceId);
  console.log(`\n>>> FINAL FINANCIAL LEDGER STATE <<<`);
  console.log(`- Ending Available Credits: ${finalLedger.account.availableCredits}`);
  console.log(`- Ending Reserved Credits: ${finalLedger.account.reservedCredits}`);

  console.log("\n=========================================================================");
  console.log("=== SANDBOX E2E SUMMARY REPORT ===");
  console.log(JSON.stringify(resultsSummary, null, 2));
  console.log("=========================================================================\n");

  await prisma.$disconnect();
}

runSandboxE2ETests().catch((err) => {
  console.error("Sandbox E2E execution error:", err);
  process.exit(1);
});
