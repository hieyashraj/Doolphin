import crypto from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { prisma } from "@/lib/prisma";
import { validateUploadedMedia } from "@/lib/media/uploadValidation";
import { buildStorageKey } from "@/lib/storage/storageKey";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"]);

function hasValidSignature(buffer, mimeType) {
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return buffer.subarray(4, 8).toString() === "ftyp";
  return false;
}

async function handleUpload(req) {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ success: false, error: error.code || "Activation required" }, { status: error.status || 401 }); }

  if (process.env.NODE_ENV === "production" && !R2StorageService.isConfigured()) {
    return NextResponse.json({ success: false, code: "DURABLE_STORAGE_REQUIRED", error: "R2 storage must be configured in production" }, { status: 503 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ success: false, error: "Use JPEG, PNG, WebP, MP4, or MOV files" }, { status: 415 });
  const maxBytes = file.type.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!file.size || file.size > maxBytes) return NextResponse.json({ success: false, error: `File must be smaller than ${Math.round(maxBytes / 1024 / 1024)}MB` }, { status: 413 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasValidSignature(buffer, file.type)) return NextResponse.json({ success: false, error: "File content does not match its declared media type" }, { status: 422 });
  let media;
  try { media = await validateUploadedMedia(buffer, file.type); }
  catch { return NextResponse.json({ success: false, error: "File is corrupted, unsafe, or cannot be decoded" }, { status: 422 }); }

  const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const safeExtension = path.extname(file.name || "") || (file.type.startsWith("video/") ? ".mp4" : ".png");
  const storageKey = buildStorageKey("uploads", [session.user.id, `${checksumSha256}${safeExtension.toLowerCase()}`]);
  await R2StorageService.uploadFile({ storageKey, buffer, contentType: file.type });
  const uploadedAsset = await prisma.uploadedAsset.upsert({
    where: { userId_checksumSha256: { userId: session.user.id, checksumSha256 } },
    update: {
      storageKey,
      originalFileName: file.name || `upload${safeExtension}`,
      mimeType: file.type,
      fileSizeBytes: BigInt(buffer.length),
      mediaType: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      validationStatus: "VALID",
      detectedMimeType: media.detectedMimeType,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      codec: media.codec,
      validationMetadata: JSON.stringify(media.metadata),
      validatedAt: new Date()
    },
    create: {
      userId: session.user.id,
      storageKey,
      originalFileName: file.name || `upload${safeExtension}`,
      mimeType: file.type,
      fileSizeBytes: BigInt(buffer.length),
      checksumSha256,
      mediaType: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      validationStatus: "VALID",
      detectedMimeType: media.detectedMimeType,
      width: media.width,
      height: media.height,
      durationMs: media.durationMs,
      codec: media.codec,
      validationMetadata: JSON.stringify(media.metadata),
      validatedAt: new Date()
    }
  });
  const url = R2StorageService.isConfigured()
    ? await R2StorageService.generateSignedUrl({ storageKey, expiresInSeconds: 60 * 60 })
    : `/storage/${storageKey}`;

  return NextResponse.json({
    success: true,
    asset: {
      assetId: uploadedAsset.id,
      url,
      storageKey,
      originalFileName: file.name || `upload${safeExtension}`,
      mimeType: file.type,
      fileSizeBytes: buffer.length,
      checksumSha256,
      validationStatus: "VALID",
      analysisStatus: uploadedAsset.analysisStatus,
      analysisRevision: uploadedAsset.analysisRevision,
      analysis: uploadedAsset.analysisJson ? JSON.parse(uploadedAsset.analysisJson) : null,
      analysisConfirmed: Boolean(uploadedAsset.analysisConfirmedAt),
    },
  });
}

export async function POST(req) {
  try { return await handleUpload(req); }
  catch (error) {
    console.error("[UPLOAD_INTERNAL_ERROR]", error);
    return NextResponse.json({ success: false, code: "UPLOAD_UNAVAILABLE", error: "Upload could not be persisted" }, { status: 503 });
  }
}
