import path from "path";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { buildStorageKey } from "@/lib/storage/storageKey";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "audio/mpeg", "audio/wav", "audio/mp4"]);

export async function POST(req) {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ error: error.code || "Activation required" }, { status: error.status || 401 }); }
  // There is no server-upload fallback route. Failing explicitly prevents the
  // Studio from continuing into a guaranteed 404 and makes the unavailable
  // storage dependency visible to the customer before any local state changes.
  if (!R2StorageService.isConfigured()) {
    return NextResponse.json({ error: "Asset uploads are temporarily unavailable" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !ALLOWED.has(body.contentType) || !Number.isInteger(body.fileSizeBytes) || !/^[a-f0-9]{64}$/i.test(body.checksumSha256 || "")) return NextResponse.json({ error: "Invalid upload metadata" }, { status: 422 });
  const max = body.contentType.startsWith("video/") || body.contentType.startsWith("audio/") ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
  if (body.fileSizeBytes <= 0 || body.fileSizeBytes > max) return NextResponse.json({ error: "File exceeds the allowed size" }, { status: 413 });
  const extension = (path.extname(body.filename || "") || (body.contentType.startsWith("video/") ? ".mp4" : body.contentType === "audio/mpeg" ? ".mp3" : body.contentType === "audio/wav" ? ".wav" : body.contentType.startsWith("audio/") ? ".m4a" : ".png")).toLowerCase();
  const storageKey = buildStorageKey("uploads", [session.user.id, `${body.checksumSha256}${extension}`]);
  const asset = await prisma.uploadedAsset.upsert({
    where: { userId_checksumSha256: { userId: session.user.id, checksumSha256: body.checksumSha256 } },
    update: { storageKey, originalFileName: body.filename || `upload${extension}`, mimeType: body.contentType, fileSizeBytes: BigInt(body.fileSizeBytes), mediaType: body.contentType.startsWith("video/") ? "VIDEO" : body.contentType.startsWith("audio/") ? "AUDIO" : "IMAGE" },
    create: { userId: session.user.id, storageKey, originalFileName: body.filename || `upload${extension}`, mimeType: body.contentType, fileSizeBytes: BigInt(body.fileSizeBytes), checksumSha256: body.checksumSha256, mediaType: body.contentType.startsWith("video/") ? "VIDEO" : body.contentType.startsWith("audio/") ? "AUDIO" : "IMAGE", validationStatus: "VALIDATING" }
  });
  if (asset.validationStatus === "VALID" && asset.validatedAt) {
    return NextResponse.json({ directUpload: true, alreadyUploaded: true, assetId: asset.id });
  }
  const uploadUrl = await R2StorageService.generateUploadUrl({ storageKey, contentType: body.contentType, expiresInSeconds: 900 });
  return NextResponse.json({ directUpload: true, assetId: asset.id, uploadUrl, expiresInSeconds: 900, requiredHeaders: { "Content-Type": body.contentType } });
}
