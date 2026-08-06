import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";

export async function GET(req) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const creationId = searchParams.get("creationId");

    if (creationId) {
      const creation = await prisma.creation.findUnique({
        where: { id: creationId }
      });

      if (!creation || creation.userId !== session.user.id) {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }

      const creditTransactions = await prisma.creditTransaction.findMany({
        where: { creationId }
      });

      return NextResponse.json({
        creationId: creation.id,
        stage: creation.stage,
        status: creation.status,
        errorCode: creation.errorCode,
        error: creation.error,
        modelId: creation.modelId,
        provider: creation.provider,
        requestId: creation.requestId,
        compiledPrompt: creation.compiledPrompt,
        productInterpretation: creation.productInterpretation ? JSON.parse(creation.productInterpretation) : null,
        reservedCredits: creation.reservedCredits,
        attemptId: creation.attemptId,
        idempotencyKey: creation.idempotencyKey,
        creditTransactions
      });
    }

    const recentCreations = await prisma.creation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        modelId: true,
        provider: true,
        status: true,
        stage: true,
        errorCode: true,
        error: true,
        createdAt: true
      }
    });

    return NextResponse.json({
      environment: process.env.NODE_ENV,
      hasUgcApiKey: Boolean((process.env.MUAPI_API_KEY || process.env.UGC_API_KEY) && !(process.env.MUAPI_API_KEY || process.env.UGC_API_KEY).includes("placeholder")),
      hasFalApiKey: Boolean(process.env.FAL_KEY && !process.env.FAL_KEY.includes("placeholder")),
      creations: recentCreations
    });

  } catch (error) {
    console.error("[ADMIN_DIAGNOSTICS_ERROR]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
