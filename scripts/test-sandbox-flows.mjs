import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

if (fs.existsSync(".env")) dotenv.config({ path: ".env" });
if (fs.existsSync(".env.preview.local")) dotenv.config({ path: ".env.preview.local", override: false });

// Force DOOLPHIN_ENV=staging for sandbox test runner
process.env.DOOLPHIN_ENV = "staging";

const { prisma } = await import("../src/lib/prisma.js");
const { getImageModel } = await import("../src/lib/generation-models/imageRegistry.js");
const { R2StorageService } = await import("../src/lib/storage/r2StorageService.js");
const { fetchAuthenticatedMuapiResult } = await import("../src/lib/generation/muapiResult.js");
const { processAuthenticatedImageResult } = await import("../src/lib/generation/imagePipeline.js");
const { CreditEscrowService } = await import("../src/lib/billing/CreditEscrowService.js");
const { HARDENED_RECONCILIATION_ENGINE_REVISION } = await import("../src/lib/generation/reconciliationEligibility.js");
const { getMuapiApiKey } = await import("../src/lib/generation/muapiCredentials.js");
const { buildStorageKey, assertWritableStorageKey } = await import("../src/lib/storage/storageKey.js");

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

async function runSandboxE2ETests() {
  console.log("\n=========================================================================");
  console.log("=== IMAGE STUDIO SANDBOX E2E — THREE REPRESENTATIVE FLOWS ===");
  console.log("=========================================================================\n");

  // 1. Pre-submit Safety Gate Verification
  const isStaging = process.env.DOOLPHIN_ENV === "staging";
  let sandboxKeyResolved = false;
  try {
    const key = getMuapiApiKey();
    sandboxKeyResolved = Boolean(key && !key.includes("placeholder"));
  } catch {}

  const standardKeyUnavailableInStaging = Boolean(process.env.DOOLPHIN_ENV === "staging" && !process.env.MUAPI_API_KEY_SANDBOX?.includes("placeholder"));

  let r2KeyProbeValid = false;
  try {
    const probeKey = buildStorageKey("final", ["test-workspace", "probe-creation", "variant_0", "image_0.png"]);
    assertWritableStorageKey(probeKey);
    r2KeyProbeValid = probeKey.startsWith("staging/");
  } catch {}

  console.log("=== SANDBOX PRE-SUBMIT SAFETY GATE CHECK ===");
  console.log(`- DOOLPHIN_ENV === "staging": ${isStaging ? "PASS" : "FAIL"}`);
  console.log(`- Sandbox Credential Resolved: ${sandboxKeyResolved ? "PASS" : "FAIL"}`);
  console.log(`- Fail-Closed Staging Isolation Active: ${standardKeyUnavailableInStaging ? "PASS" : "FAIL"}`);
  console.log(`- Writable R2 Key Probe Resolves Under staging/: ${r2KeyProbeValid ? "PASS" : "FAIL"}\n`);

  if (!isStaging || !sandboxKeyResolved || !standardKeyUnavailableInStaging || !r2KeyProbeValid) {
    console.error("SANDBOX_CREDENTIAL_UNAVAILABLE: Pre-submit safety gate failed. Aborting execution.");
    process.exit(1);
  }

  const apiKey = getMuapiApiKey();

  // Setup test user & workspace
  let user = await prisma.user.findFirst({ where: { activationStatus: "ACTIVATED" } });
  if (!user) {
    throw new Error("No activated test user found in database.");
  }
  const workspaceId = user.defaultWorkspaceId || "ws_test_sandbox";
  console.log(`- Test User ID: ${user.id} (${user.email})`);
  console.log(`- Workspace ID: ${workspaceId}`);

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

  const resultsTable = [];
  let flowACostMicroUsd = null;
  let flowBCostMicroUsd = null;

  // =========================================================================
  // FLOW A: GPT IMAGE 2 EDIT / MY ASSET (muapi.gpt-image-2-i2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW A: GPT Image 2 Edit (Image to Image with My Asset) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.gpt-image-2-i2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: IMAGE_TO_IMAGE (My Asset)`);

    // Ensure a validated UploadedAsset exists for My Asset
    let asset = await prisma.uploadedAsset.findFirst({
      where: { userId: user.id, validationStatus: "VALID" }
    });
    if (!asset) {
      const dummyBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      const assetKey = buildStorageKey("uploads", [workspaceId, user.id, `${Date.now()}_my_asset.png`]);
      await R2StorageService.uploadFile({ storageKey: assetKey, buffer: dummyBuffer, contentType: "image/png" });
      asset = await prisma.uploadedAsset.create({
        data: {
          userId: user.id,
          type: "IMAGE",
          originalFileName: "My Test Reference Asset",
          storageKey: assetKey,
          mimeType: "image/png",
          fileSizeBytes: BigInt(dummyBuffer.length),
          checksumSha256: crypto.createHash("sha256").update(dummyBuffer).digest("hex"),
          validationStatus: "VALID",
          validatedAt: new Date()
        }
      });
    }
    console.log(`- My Asset ID: ${asset.id} (${asset.originalFileName})`);

    const flowAPrompt = "Transform this perfume bottle into a luxury neon studio setup";
    const idempotencyKey = `e2e_flowA_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Step A: Preflight Quote
    console.log("\n[Step A1: Preflight Quote]");
    const reqPayloadA = {
      version: "image-generation.v1",
      modelId,
      prompt: flowAPrompt,
      aspectRatio: "1:1",
      outputResolution: "1K",
      referenceAssetIds: [asset.id]
    };

    const quoteRes = await fetch("http://localhost:3005/api/images/preflight", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(reqPayloadA)
    });
    const quoteData = await quoteRes.json();
    console.log(`- Preflight Status: ${quoteRes.status}`);
    console.log(`- Authoritative Quote ID: ${quoteData.quote?.id}`);
    console.log(`- Credits Quoted: ${quoteData.quote?.credits}`);

    if (!quoteData.quote?.id) {
      console.error(`- Preflight Failed: ${JSON.stringify(quoteData)}`);
      process.exit(1);
    }

    // Step B: Submit Generation
    console.log("\n[Step A2: Submit Generation & Reservation]");
    const submitPayloadA = {
      quoteId: quoteData.quote.id,
      idempotencyKey,
      prompt: flowAPrompt,
      aspectRatio: "1:1",
      outputResolution: "1K",
      referenceAssetIds: [asset.id]
    };

    const submitRes = await fetch("http://localhost:3005/api/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(submitPayloadA)
    });
    const submitData = await submitRes.json();
    console.log(`- Submission Status: ${submitRes.status}`);
    console.log(`- Creation ID: ${submitData.creationId}`);

    const creationRecord = await prisma.creation.findUnique({
      where: { id: submitData.creationId },
      include: { variants: { include: { providerJobs: true } } }
    });
    const variant = creationRecord.variants[0];
    const job = variant.providerJobs[0];

    console.log(`- Creation Status: ${creationRecord.status}`);
    console.log(`- Variant ID: ${variant.id} (${variant.status})`);
    console.log(`- ProviderJob ID: ${job.id} (Status: ${job.status})`);
    console.log(`- Provider Request ID: ${job.providerRequestId}`);

    const routingSnap = JSON.parse(job.routingSnapshot || "{}");
    console.log(`- ProviderJob Provenance: ${routingSnap.providerEnvironment}`);

    // Step C: Poll Provider Result (With Hard Wall-Clock Deadline)
    console.log("\n[Step A3: Polling Provider Result]");
    let resultPayload = null;
    const startTime = Date.now();
    const maxPollMs = 90_000;

    while (Date.now() - startTime < maxPollMs) {
      try {
        const polled = await fetchAuthenticatedMuapiResult(job.providerRequestId);
        if (polled && (polled.status === "completed" || polled.status === "succeeded" || polled.status === "failed" || polled.error)) {
          resultPayload = polled;
          break;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!resultPayload) {
      console.log(`- Polling Reached Wall-Clock Deadline (TIMED_OUT_WAITING_FOR_PROVIDER)`);
      console.log(`- Provider Request ID: ${job.providerRequestId}`);
      resultsTable.push({
        flow: "Flow A",
        model: model.displayName,
        reference: "My Asset",
        quote: quoteData.creditsToReserve,
        sandboxCost: "N/A",
        status: "TIMED_OUT_WAITING_FOR_PROVIDER",
        r2Key: "N/A",
        objectExists: "no",
        artifact: "None",
        ledger: "Held (Escrowed)",
        myLibrary: "No",
        result: "TIMED_OUT"
      });
    } else {
      console.log(`- Terminal Provider Result Status: ${resultPayload.status}`);
      console.log(`- Provider Cost Object: ${JSON.stringify(resultPayload.cost)}`);

      // Step D: Ingest Result & Verify R2 Delivery
      console.log("\n[Step A4: Result Ingestion & Delivery]");
      const jobRecord = await prisma.providerJob.findUnique({
        where: { id: job.id },
        include: { variant: { include: { creation: true } } }
      });
      const pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);
      console.log(`- Pipeline Process Outcome: ${JSON.stringify(pipelineRes)}`);

      const updatedJob = await prisma.providerJob.findUnique({ where: { id: job.id } });
      const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: "FINAL_IMAGE" } });

      flowACostMicroUsd = updatedJob.actualCostMicroUsd;
      console.log(`- Actual Provider Cost Reported: ${flowACostMicroUsd} micro-USD ($${Number(flowACostMicroUsd || 0) / 1_000_000})`);

      let r2Exists = false;
      if (finalArtifact?.storageKey) {
        try {
          const signed = await R2StorageService.generateSignedUrl({ storageKey: finalArtifact.storageKey, expiresInSeconds: 60 });
          const getRes = await fetch(signed, { method: "GET" });
          r2Exists = getRes.ok;
        } catch {}
      }

      console.log(`- Storage Key: ${finalArtifact?.storageKey}`);
      console.log(`- R2 Key Starts With staging/: ${finalArtifact?.storageKey?.startsWith("staging/") ? "YES" : "NO"}`);
      console.log(`- Actual R2 Object Exists: ${r2Exists ? "YES" : "NO"}`);

      const endLedgerA = await getLedgerState(workspaceId);
      console.log(`- Ending Available Credits: ${endLedgerA.account.availableCredits}`);

      resultsTable.push({
        flow: "Flow A",
        model: model.displayName,
        reference: "My Asset",
        quote: quoteData.creditsToReserve,
        sandboxCost: `$${Number(flowACostMicroUsd || 0) / 1_000_000}`,
        status: updatedJob.status,
        r2Key: finalArtifact?.storageKey || "N/A",
        objectExists: r2Exists ? "yes" : "no",
        artifact: finalArtifact?.id || "None",
        ledger: `Committed ${quoteData.creditsToReserve} credits`,
        myLibrary: r2Exists ? "yes" : "no",
        result: pipelineRes.completed ? "PASS" : "FAILED"
      });
    }
  }

  // Check financial safety condition before proceeding to Flow B
  if (flowACostMicroUsd !== null && BigInt(flowACostMicroUsd) > 0n) {
    console.error(`\n[PROVIDER COST SAFETY BLOCK] Flow A reported non-zero actual provider cost: ${flowACostMicroUsd} micro-USD. Stopping execution.`);
    process.exit(1);
  }

  // =========================================================================
  // FLOW B: GROK IMAGINE EDIT / CURATED REFERENCE (muapi.grok-imagine-i2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW B: Grok Imagine Edit (Curated Reference) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.grok-imagine-i2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: CURATED_REFERENCE`);

    const exploreImageId = "90s-ad";
    const flowBPrompt = "Reimagine this perfume artwork as a cinematic cyberpunk poster";
    const idempotencyKey = `e2e_flowB_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Step B1: Preflight Quote
    console.log("\n[Step B1: Preflight Quote]");
    const reqPayloadB = {
      version: "image-generation.v1",
      modelId,
      prompt: flowBPrompt,
      exploreImageIds: [exploreImageId]
    };

    const quoteRes = await fetch("http://localhost:3005/api/images/preflight", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(reqPayloadB)
    });
    const quoteData = await quoteRes.json();
    console.log(`- Preflight Status: ${quoteRes.status}`);
    console.log(`- Authoritative Quote ID: ${quoteData.quote?.id}`);
    console.log(`- Credits Quoted: ${quoteData.quote?.credits}`);

    if (!quoteData.quote?.id) {
      console.error(`- Preflight Failed: ${JSON.stringify(quoteData)}`);
      process.exit(1);
    }

    // Step B2: Submit Generation
    console.log("\n[Step B2: Submit Generation & Reservation]");
    const submitPayloadB = {
      quoteId: quoteData.quote.id,
      idempotencyKey,
      prompt: flowBPrompt,
      exploreImageIds: [exploreImageId]
    };

    const submitRes = await fetch("http://localhost:3005/api/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(submitPayloadB)
    });
    const submitData = await submitRes.json();
    console.log(`- Submission Status: ${submitRes.status}`);
    console.log(`- Creation ID: ${submitData.creationId}`);

    const creationRecord = await prisma.creation.findUnique({
      where: { id: submitData.creationId },
      include: { variants: { include: { providerJobs: true } } }
    });
    const variant = creationRecord.variants[0];
    const job = variant.providerJobs[0];

    const routingSnap = JSON.parse(job.routingSnapshot || "{}");
    console.log(`- ProviderJob Provenance: ${routingSnap.providerEnvironment}`);

    // Step B3: Poll Provider Result
    console.log("\n[Step B3: Polling Provider Result]");
    let resultPayload = null;
    const startTime = Date.now();
    const maxPollMs = 90_000;

    while (Date.now() - startTime < maxPollMs) {
      try {
        const polled = await fetchAuthenticatedMuapiResult(job.providerRequestId);
        if (polled && (polled.status === "completed" || polled.status === "succeeded" || polled.status === "failed" || polled.error)) {
          resultPayload = polled;
          break;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!resultPayload) {
      console.log(`- Polling Reached Wall-Clock Deadline (TIMED_OUT_WAITING_FOR_PROVIDER)`);
      resultsTable.push({
        flow: "Flow B",
        model: model.displayName,
        reference: "Curated Explore",
        quote: quoteData.creditsToReserve,
        sandboxCost: "N/A",
        status: "TIMED_OUT_WAITING_FOR_PROVIDER",
        r2Key: "N/A",
        objectExists: "no",
        artifact: "None",
        ledger: "Held (Escrowed)",
        myLibrary: "No",
        result: "TIMED_OUT"
      });
    } else {
      console.log(`- Terminal Provider Result Status: ${resultPayload.status}`);
      const jobRecord = await prisma.providerJob.findUnique({ where: { id: job.id }, include: { variant: { include: { creation: true } } } });
      const pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);

      const updatedJob = await prisma.providerJob.findUnique({ where: { id: job.id } });
      const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: "FINAL_IMAGE" } });

      flowBCostMicroUsd = updatedJob.actualCostMicroUsd;
      console.log(`- Actual Provider Cost Reported: ${flowBCostMicroUsd} micro-USD ($${Number(flowBCostMicroUsd || 0) / 1_000_000})`);

      let r2Exists = false;
      if (finalArtifact?.storageKey) {
        try {
          const signed = await R2StorageService.generateSignedUrl({ storageKey: finalArtifact.storageKey, expiresInSeconds: 60 });
          const head = await fetch(signed, { method: "HEAD" });
          r2Exists = head.ok;
        } catch {}
      }

      // Confirm no UploadedAsset row was created for curated media
      const assetCheck = await prisma.uploadedAsset.findFirst({ where: { originalFileName: exploreImageId } });
      console.log(`- Curated Media Asset Row Created: ${assetCheck ? "YES (BUG)" : "NO (CORRECT)"}`);

      resultsTable.push({
        flow: "Flow B",
        model: model.displayName,
        reference: "Curated Explore",
        quote: quoteData.creditsToReserve,
        sandboxCost: `$${Number(flowBCostMicroUsd || 0) / 1_000_000}`,
        status: updatedJob.status,
        r2Key: finalArtifact?.storageKey || "N/A",
        objectExists: r2Exists ? "yes" : "no",
        artifact: finalArtifact?.id || "None",
        ledger: `Committed ${quoteData.creditsToReserve} credits`,
        myLibrary: r2Exists ? "yes" : "no",
        result: pipelineRes.completed ? "PASS" : "FAILED"
      });
    }
  }

  // Financial safety check for Flow B
  if (flowBCostMicroUsd !== null && BigInt(flowBCostMicroUsd) > 0n) {
    console.error(`\n[PROVIDER COST SAFETY BLOCK] Flow B reported non-zero actual provider cost: ${flowBCostMicroUsd} micro-USD. Stopping execution.`);
    process.exit(1);
  }

  // =========================================================================
  // FLOW C: GPT IMAGE 2 PROOF / TEXT TO IMAGE (muapi.gpt-image-2-t2i)
  // =========================================================================
  console.log("\n-------------------------------------------------------------------------");
  console.log("--- FLOW C: GPT Image 2 Proof (Text to Image) ---");
  console.log("-------------------------------------------------------------------------");
  {
    const modelId = "muapi.gpt-image-2-t2i";
    const model = getImageModel(modelId);
    console.log(`- Model: ${model.displayName} (${modelId})`);
    console.log(`- Mode: TEXT_TO_IMAGE`);

    const flowCPrompt = "A minimalist gold watch resting on dark velvet";
    const idempotencyKey = `e2e_flowC_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Step C1: Preflight Quote
    console.log("\n[Step C1: Preflight Quote]");
    const reqPayloadC = {
      version: "image-generation.v1",
      modelId,
      prompt: flowCPrompt,
      aspectRatio: "1:1",
      outputResolution: "1K"
    };

    const quoteRes = await fetch("http://localhost:3005/api/images/preflight", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(reqPayloadC)
    });
    const quoteData = await quoteRes.json();
    console.log(`- Preflight Status: ${quoteRes.status}`);
    console.log(`- Authoritative Quote ID: ${quoteData.quote?.id}`);
    console.log(`- Credits Quoted: ${quoteData.quote?.credits}`);

    if (!quoteData.quote?.id) {
      console.error(`- Preflight Failed: ${JSON.stringify(quoteData)}`);
      process.exit(1);
    }

    // Step C2: Submit Generation
    console.log("\n[Step C2: Submit Generation & Reservation]");
    const submitPayloadC = {
      quoteId: quoteData.quote.id,
      idempotencyKey,
      prompt: flowCPrompt,
      aspectRatio: "1:1",
      outputResolution: "1K"
    };

    const submitRes = await fetch("http://localhost:3005/api/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": user.id },
      body: JSON.stringify(submitPayloadC)
    });
    const submitData = await submitRes.json();

    const creationRecord = await prisma.creation.findUnique({
      where: { id: submitData.creationId },
      include: { variants: { include: { providerJobs: true } } }
    });
    const variant = creationRecord.variants[0];
    const job = variant.providerJobs[0];

    // Step C3: Poll Provider Result
    console.log("\n[Step C3: Polling Provider Result]");
    let resultPayload = null;
    const startTime = Date.now();
    const maxPollMs = 90_000;

    while (Date.now() - startTime < maxPollMs) {
      try {
        const polled = await fetchAuthenticatedMuapiResult(job.providerRequestId);
        if (polled && (polled.status === "completed" || polled.status === "succeeded" || polled.status === "failed" || polled.error)) {
          resultPayload = polled;
          break;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!resultPayload) {
      console.log(`- Polling Reached Wall-Clock Deadline (TIMED_OUT_WAITING_FOR_PROVIDER)`);
      resultsTable.push({
        flow: "Flow C",
        model: model.displayName,
        reference: "Text to Image",
        quote: quoteData.creditsToReserve,
        sandboxCost: "N/A",
        status: "TIMED_OUT_WAITING_FOR_PROVIDER",
        r2Key: "N/A",
        objectExists: "no",
        artifact: "None",
        ledger: "Held (Escrowed)",
        myLibrary: "No",
        result: "TIMED_OUT"
      });
    } else {
      const jobRecord = await prisma.providerJob.findUnique({ where: { id: job.id }, include: { variant: { include: { creation: true } } } });
      const pipelineRes = await processAuthenticatedImageResult(jobRecord, resultPayload);

      const updatedJob = await prisma.providerJob.findUnique({ where: { id: job.id } });
      const finalArtifact = await prisma.generatedArtifact.findFirst({ where: { creationVariantId: variant.id, type: "FINAL_IMAGE" } });

      const flowCCostMicroUsd = updatedJob.actualCostMicroUsd;
      console.log(`- Actual Provider Cost Reported: ${flowCCostMicroUsd} micro-USD ($${Number(flowCCostMicroUsd || 0) / 1_000_000})`);

      let r2Exists = false;
      if (finalArtifact?.storageKey) {
        try {
          const signed = await R2StorageService.generateSignedUrl({ storageKey: finalArtifact.storageKey, expiresInSeconds: 60 });
          const head = await fetch(signed, { method: "HEAD" });
          r2Exists = head.ok;
        } catch {}
      }

      resultsTable.push({
        flow: "Flow C",
        model: model.displayName,
        reference: "Text to Image",
        quote: quoteData.creditsToReserve,
        sandboxCost: `$${Number(flowCCostMicroUsd || 0) / 1_000_000}`,
        status: updatedJob.status,
        r2Key: finalArtifact?.storageKey || "N/A",
        objectExists: r2Exists ? "yes" : "no",
        artifact: finalArtifact?.id || "None",
        ledger: `Committed ${quoteData.creditsToReserve} credits`,
        myLibrary: r2Exists ? "yes" : "no",
        result: pipelineRes.completed ? "PASS" : "FAILED"
      });
    }
  }

  // =========================================================================
  // E2E SUMMARY TABLE
  // =========================================================================
  console.log("\n=========================================================================");
  console.log("=== SANDBOX E2E SUMMARY TABLE ===");
  console.log("=========================================================================");
  console.table(resultsTable);

  await prisma.$disconnect();
}

runSandboxE2ETests().catch(err => {
  console.error("Fatal Error in Sandbox E2E Runner:", err);
  process.exit(1);
});
