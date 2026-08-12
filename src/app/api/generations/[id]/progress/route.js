import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { formatErrorResponse, AppError, ERROR_CODES } from "@/lib/errors";

export async function GET(req, { params }) {
  try {
    const { appUser } = await requireActivatedAccount();

    const { id } = await params;

    const creation = await prisma.creation.findFirst({
      where: { id, userId: appUser.id },
      include: { variants: true },
    });

    if (!creation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Creation not found", { statusCode: 404 });
    }


    return NextResponse.json({
      success: true,
      creationId: creation.id,
      status: creation.status,
      currentStage: creation.currentStage || "QUEUED",
      progressValue: creation.progressValue || 0.0,
      variants: creation.variants,
      completedAt: creation.completedAt,
      safeError: creation.safeError,
    });
  } catch (err) {
    const { status, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
