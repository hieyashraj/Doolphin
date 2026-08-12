import { NextResponse } from "next/server";
import { getMockSession as getRequestSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";

const MAX_ASSETS = 100;

function parseAnalysis(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

// The library deliberately returns only media that has completed server-side
// validation.  URLs are short-lived and are generated after ownership is
// checked, so a client can never use this endpoint to enumerate another user.
export async function GET() {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const assets = await prisma.uploadedAsset.findMany({
      where: { userId: session.user.id, validationStatus: "VALID" },
      orderBy: { updatedAt: "desc" },
      take: MAX_ASSETS,
      select: {
        id: true, storageKey: true, originalFileName: true, mimeType: true,
        fileSizeBytes: true, checksumSha256: true, mediaType: true,
        validationStatus: true, width: true, height: true, durationMs: true,
        analysisStatus: true, analysisRevision: true, analysisJson: true,
        analysisConfirmedAt: true, createdAt: true, updatedAt: true,
      },
    });
    const library = await Promise.all(assets.map(async (asset) => ({
      assetId: asset.id,
      id: asset.id,
      storageKey: asset.storageKey,
      url: await R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 60 * 60 }),
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      mediaType: asset.mediaType,
      fileSizeBytes: Number(asset.fileSizeBytes),
      checksumSha256: asset.checksumSha256,
      validationStatus: asset.validationStatus,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      analysisStatus: asset.analysisStatus,
      analysisRevision: asset.analysisRevision,
      analysis: parseAnalysis(asset.analysisJson),
      analysisConfirmed: Boolean(asset.analysisConfirmedAt),
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    })));
    return NextResponse.json({ assets: library });
  } catch (error) {
    console.error("[ASSET_LIBRARY_LIST_ERROR]", error);
    return NextResponse.json({ error: "Asset library is temporarily unavailable" }, { status: 503 });
  }
}
