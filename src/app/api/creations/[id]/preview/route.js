import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { R2StorageService } from "@/lib/storage/r2StorageService";
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
      include: { variants: { where: { status: "COMPLETED" }, include: { artifacts: { where: { type: "FINAL_VIDEO", validationStatus: "VALID" } } } } },
    });

    if (!creation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Creation not found", { statusCode: 404 });
    }

    // Authorization check (Section 27)
    if (creation.userId !== session.user.id) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "Access denied to creation", { statusCode: 403 });
    }

    const variant = creation.variants[0];
    const artifact = variant?.artifacts?.[0];

    if (!artifact) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Artifact deliverable not found", { statusCode: 404 });
    }

    // Generate short-lived signed preview URL
    const previewUrl = await R2StorageService.generateSignedUrl({
      storageKey: artifact.storageKey,
      expiresInSeconds: 900,
      isDownload: false,
    });

    return NextResponse.json({
      success: true,
      creationId: creation.id,
      previewUrl,
      expiresInSeconds: 900,
    });
  } catch (err) {
    const { status, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
