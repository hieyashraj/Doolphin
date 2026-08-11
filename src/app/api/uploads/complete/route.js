import crypto from "crypto";
import { NextResponse } from "next/server";
import { getMockSession as getRequestSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { validateUploadedMedia } from "@/lib/media/uploadValidation";

export async function POST(req) {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { assetId } = await req.json().catch(() => ({}));
  const asset = await prisma.uploadedAsset.findFirst({ where: { id: assetId, userId: session.user.id } });
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  const object = await R2StorageService.checkObjectExists(asset.storageKey);
  if (!object.exists || Number(object.size) !== Number(asset.fileSizeBytes)) return NextResponse.json({ error: "Uploaded object is missing or incomplete" }, { status: 422 });
  const buffer = await R2StorageService.downloadBuffer(asset.storageKey);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  if (checksum !== asset.checksumSha256) {
    await prisma.uploadedAsset.update({ where: { id: asset.id }, data: { validationStatus: "INVALID" } });
    return NextResponse.json({ error: "Upload failed checksum validation" }, { status: 422 });
  }
  let media;
  try { media = await validateUploadedMedia(buffer, asset.mimeType); }
  catch {
    await prisma.uploadedAsset.update({ where: { id: asset.id }, data: { validationStatus: "INVALID" } });
    return NextResponse.json({ error: "Upload is corrupted, unsafe, or does not match its declared media type" }, { status: 422 });
  }
  const updated = await prisma.uploadedAsset.update({ where: { id: asset.id }, data: { validationStatus: "VALID", detectedMimeType: media.detectedMimeType, width: media.width, height: media.height, durationMs: media.durationMs, codec: media.codec, validationMetadata: JSON.stringify(media.metadata), validatedAt: new Date() } });
  const url = await R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 3600 });
  return NextResponse.json({ success: true, asset: { assetId: updated.id, url, storageKey: updated.storageKey, originalFileName: updated.originalFileName, mimeType: updated.mimeType, fileSizeBytes: Number(updated.fileSizeBytes), checksumSha256: updated.checksumSha256, validationStatus: updated.validationStatus, analysisStatus: updated.analysisStatus, analysisRevision: updated.analysisRevision, analysis: updated.analysisJson ? JSON.parse(updated.analysisJson) : null, analysisConfirmed: Boolean(updated.analysisConfirmedAt) } });
}
