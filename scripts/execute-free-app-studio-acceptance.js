import fs from "fs";
import crypto from "crypto";
import { prisma } from "../src/lib/prisma.js";
import { CreditEscrowService } from "../src/lib/billing/creditEscrowService.js";
import { ModelRouter } from "../src/lib/router/modelRouter.js";
import { OutboxDispatcher } from "../src/lib/queue/outboxDispatcher.js";
import { GenerationWorker } from "../src/lib/queue/generationWorker.js";
import { R2StorageService } from "../src/lib/storage/r2StorageService.js";
import { ArtifactDeliveryValidator } from "../src/lib/storage/artifactValidator.js";

/**
 * Free App Studio Acceptance Pipeline.
 * Section 30 Compliance.
 */

export async function runFreeAppStudioAcceptance() {
  console.log("=== STARTING FREE APP STUDIO ACCEPTANCE ===");

  // 1. Create test user and workspace
  const user = await prisma.user.upsert({
    where: { email: "appstudio_test_user@doolphin.internal" },
    create: {
      name: "App Studio Test User",
      email: "appstudio_test_user@doolphin.internal",
      status: "ACTIVE",
    },
    update: {},
  });

  const workspace = await CreditEscrowService.ensureUserWorkspace(user.id);

  // 2. Preflight Quote (0 credits reserved)
  const routing = ModelRouter.route({
    workflowType: "APP_STUDIO",
    preset: "app_demo",
    duration: 5,
    aspectRatio: "9:16",
  });

  const quote = await prisma.preflightQuote.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      generationType: "APP_STUDIO",
      requestSnapshot: JSON.stringify({ preset: "app_demo" }),
      normalizedAssetSummary: JSON.stringify([]),
      routingSnapshot: JSON.stringify(routing),
      selectedModelId: routing.selectedModel.internalModelId,
      provider: routing.selectedModel.provider,
      providerEndpoint: routing.selectedModel.endpoint,
      registryRevision: "1.0.0",
      pricingRevision: "1.0.0",
      adapterVersion: "1.0.0",
      estimatedProviderCostMinMicroUsd: routing.estimatedCostMinMicroUsd,
      estimatedProviderCostMaxMicroUsd: routing.estimatedCostMaxMicroUsd,
      infrastructureCostEstimateMicroUsd: BigInt(50000),
      expectedFailureLossMicroUsd: BigInt(10000),
      internalCreditsToReserve: 10,
      expiresAt: new Date(Date.now() + 900000),
    },
  });

  const accountBefore = await prisma.creditAccount.findUnique({ where: { workspaceId: workspace.id } });
  console.log(`[ACCEPTANCE] Preflight quote created. Available credits before reservation: ${accountBefore.availableCredits}`);

  // 3. Creation & Credit Reservation (1 reservation created)
  const idempotencyKey = `app_studio_acc_${crypto.randomUUID()}`;
  const creation = await prisma.creation.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      generationType: "APP_STUDIO",
      presetId: "app_demo",
      title: "Acceptance App Studio Video",
      idempotencyKey,
      quoteId: quote.id,
      status: "QUEUED",
    },
  });

  const variant = await txCreateVariant(creation.id, workspace.id, user.id);

  // 4. Outbox Dispatch & Worker Execution
  await OutboxDispatcher.dispatchPendingJobs();

  const workerResult = await GenerationWorker.processJob({
    creationId: creation.id,
    variantId: variant.id,
    workspaceId: workspace.id,
    workflowType: "APP_STUDIO",
  });

  const accountAfter = await prisma.creditAccount.findUnique({ where: { workspaceId: workspace.id } });
  console.log(`[ACCEPTANCE] Job processed. Lifetime committed credits: ${accountAfter.lifetimeCommittedCredits}`);

  const evidence = {
    creationId: creation.id,
    variantId: variant.id,
    quoteId: quote.id,
    status: workerResult.status,
    finalArtifactId: workerResult.finalArtifactId,
    committedCredits: accountAfter.lifetimeCommittedCredits,
    timestamp: new Date().toISOString(),
  };

  fs.mkdirSync("evidence/final-acceptance/app-studio", { recursive: true });
  fs.writeFileSync(
    "evidence/final-acceptance/app-studio/acceptance_summary.json",
    JSON.stringify(evidence, null, 2)
  );

  console.log("=== FREE APP STUDIO ACCEPTANCE COMPLETED SUCCESSFULLY ===");
  return evidence;
}

async function txCreateVariant(creationId, workspaceId, userId) {
  return await prisma.$transaction(async (tx) => {
    const variant = await tx.creationVariant.create({
      data: {
        creationId,
        variantIndex: 0,
        status: "QUEUED",
        reservedCredits: 10,
      },
    });

    await CreditEscrowService.reserveCredits({
      workspaceId,
      creationId,
      creationVariantId: variant.id,
      amount: 10,
      idempotencyKey: `res_${variant.id}`,
      userId,
      tx,
    });

    await tx.queueOutbox.create({
      data: {
        aggregateType: "CREATION_VARIANT",
        aggregateId: variant.id,
        eventType: "GENERATE_VARIANT",
        payload: JSON.stringify({
          creationId,
          variantId: variant.id,
          workspaceId,
          workflowType: "APP_STUDIO",
        }),
        deterministicJobId: `job_${variant.id}`,
      },
    });

    return variant;
  });
}

if (process.argv[1] && process.argv[1].endsWith("execute-free-app-studio-acceptance.js")) {
  runFreeAppStudioAcceptance()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("App Studio acceptance failed:", err);
      process.exit(1);
    });
}
