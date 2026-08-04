import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { OutboxDispatcher } from "@/lib/queue/outboxDispatcher";
import { GenerationWorker } from "@/lib/queue/generationWorker";
import { prisma } from "@/lib/prisma";
import { formatErrorResponse, AppError, ERROR_CODES } from "@/lib/errors";

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Authentication required", { statusCode: 401 });
    }

    const body = await req.json();
    const { quoteId, idempotencyKey, title = "New Generation" } = body;

    if (!idempotencyKey) {
      throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, "Idempotency key required", { statusCode: 400 });
    }

    const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);

    // Duplicate idempotency check
    const existingCreation = await prisma.creation.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: workspace.id,
          idempotencyKey,
        },
      },
      include: { variants: true },
    });

    if (existingCreation) {
      return NextResponse.json({
        success: true,
        creation: existingCreation,
        isDuplicate: true,
      });
    }

    // Quote validation
    let quote = null;
    if (quoteId) {
      quote = await prisma.preflightQuote.findUnique({ where: { id: quoteId } });
      if (quote && quote.userId !== session.user.id) {
        throw new AppError(ERROR_CODES.FORBIDDEN, "Quote ownership mismatch", { statusCode: 403 });
      }
      if (quote && quote.consumedAt) {
        throw new AppError(ERROR_CODES.IDEMPOTENCY_CONFLICT, "Quote already consumed", { statusCode: 400 });
      }
    }

    const creditsToReserve = quote?.internalCreditsToReserve || 10;
    const generationType = quote?.generationType || body.generationType || "APP_STUDIO";
    const presetId = body.presetId || "app_demo";

    // Perform Creation & Credit Reservation Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Creation
      const creation = await tx.creation.create({
        data: {
          workspaceId: workspace.id,
          userId: session.user.id,
          generationType,
          presetId,
          title,
          idempotencyKey,
          quoteId: quote?.id,
          status: "QUEUED",
        },
      });

      // 2. Create CreationVariant
      const variant = await tx.creationVariant.create({
        data: {
          creationId: creation.id,
          variantIndex: 0,
          status: "QUEUED",
          reservedCredits: creditsToReserve,
        },
      });

      // 3. Reserve Credits
      await CreditEscrowService.reserveCredits({
        workspaceId: workspace.id,
        creationId: creation.id,
        creationVariantId: variant.id,
        amount: creditsToReserve,
        idempotencyKey: `res_${creation.id}_v0`,
        userId: session.user.id,
        tx,
      });

      // 4. Create QueueOutbox row
      const outbox = await tx.queueOutbox.create({
        data: {
          aggregateType: "CREATION_VARIANT",
          aggregateId: variant.id,
          eventType: "GENERATE_VARIANT",
          payload: JSON.stringify({
            creationId: creation.id,
            variantId: variant.id,
            workspaceId: workspace.id,
            workflowType: generationType,
          }),
          deterministicJobId: `job_${variant.id}`,
        },
      });

      // 5. Mark Quote consumed
      if (quote) {
        await tx.preflightQuote.update({
          where: { id: quote.id },
          data: { consumedAt: new Date() },
        });
      }

      return { creation, variant, outbox };
    });

    // Trigger Outbox Dispatcher
    await OutboxDispatcher.dispatchPendingJobs();

    // Trigger Generation Worker asynchronously for immediate execution in local/staging environment
    GenerationWorker.processJob({
      creationId: result.creation.id,
      variantId: result.variant.id,
      workspaceId: workspace.id,
      workflowType: generationType,
    }).catch((e) => console.error("Async worker background error:", e.message));

    return NextResponse.json({
      success: true,
      creation: result.creation,
      variant: result.variant,
    });
  } catch (err) {
    const { status, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
