import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatErrorResponse, AppError, ERROR_CODES } from "@/lib/errors";

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      throw new AppError(ERROR_CODES.UNAUTHORIZED, "Authentication required", { statusCode: 401 });
    }

    const { id } = await params;

    const creation = await prisma.creation.findUnique({
      where: { id },
      include: { variants: true },
    });

    if (!creation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Creation not found", { statusCode: 404 });
    }

    // Ownership check (Section 27)
    if (creation.userId !== session.user.id) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Access denied to creation", { statusCode: 403 });
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
