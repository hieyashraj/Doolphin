import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ModelRouter } from "@/lib/router/ModelRouter";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { prisma } from "@/lib/prisma";
import { formatErrorResponse, AppError, ERROR_CODES } from "@/lib/errors";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Authentication required", { statusCode: 401 });
    }

    const body = await req.json();
    const { generationType = "APP_STUDIO", presetId = "app_demo", duration = 5, aspectRatio = "9:16", assets = [] } = body;

    const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);

    // Select Model via Router
    const routingResult = ModelRouter.route({
      workflowType: generationType,
      preset: presetId,
      duration,
      aspectRatio,
    });

    const creditsRequired = 10;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

    // Save PreflightQuote (reserves zero credits)
    const quote = await prisma.preflightQuote.create({
      data: {
        workspaceId: workspace.id,
        userId: session.user.id,
        generationType,
        requestSnapshot: JSON.stringify(body),
        normalizedAssetSummary: JSON.stringify(assets),
        routingSnapshot: JSON.stringify(routingResult),
        selectedModelId: routingResult.selectedModel.internalModelId,
        provider: routingResult.selectedModel.provider,
        providerEndpoint: routingResult.selectedModel.endpoint,
        registryRevision: "1.0.0",
        pricingRevision: "1.0.0",
        adapterVersion: "1.0.0",
        estimatedProviderCostMinMicroUsd: routingResult.estimatedCostMinMicroUsd,
        estimatedProviderCostMaxMicroUsd: routingResult.estimatedCostMaxMicroUsd,
        infrastructureCostEstimateMicroUsd: BigInt(50000),
        expectedFailureLossMicroUsd: BigInt(10000),
        internalCreditsToReserve: creditsRequired,
        expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      quote: {
        id: quote.id,
        selectedModelId: quote.selectedModelId,
        provider: quote.provider,
        creditsToReserve: quote.internalCreditsToReserve,
        expiresAt: quote.expiresAt,
      },
    });
  } catch (err) {
    const { status, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
