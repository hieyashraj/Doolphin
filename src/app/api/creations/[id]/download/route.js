import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { prisma } from "@/lib/prisma";
import { formatErrorResponse, AppError, ERROR_CODES } from "@/lib/errors";

export async function GET(req, { params }) {
  try {
    const { appUser } = await requireActivatedAccount();

    const { id } = await params;

    const creation = await prisma.creation.findFirst({
      where: { id, userId: appUser.id, workspaceId: appUser.defaultWorkspaceId },
      include: { variants: { where: { status: "COMPLETED" }, include: { artifacts: { where: { type: "FINAL_VIDEO", validationStatus: "VALID" } } } } },
    });

    if (!creation) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Creation not found", { statusCode: 404 });
    }


    const variant = creation.variants[0];
    const artifact = variant?.artifacts?.[0];

    if (!artifact) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Artifact deliverable not found", { statusCode: 404 });
    }

    // Generate short-lived signed download URL
    const downloadUrl = await R2StorageService.generateSignedUrl({
      storageKey: artifact.storageKey,
      expiresInSeconds: 900,
      isDownload: true,
      filename: `doolphin_${creation.id}.mp4`,
    });

    return NextResponse.json({
      success: true,
      creationId: creation.id,
      downloadUrl,
      expiresInSeconds: 900,
    });
  } catch (err) {
    const { status, body } = formatErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
