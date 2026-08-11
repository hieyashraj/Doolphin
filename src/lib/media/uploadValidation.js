import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { runFfprobe } from "./FfmpegRunner.js";

function detectedMimeType(buffer, declaredMimeType) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.subarray(4, 8).toString() === "ftyp") return declaredMimeType === "video/quicktime" ? "video/quicktime" : "video/mp4";
  return null;
}

export async function validateUploadedMedia(buffer, declaredMimeType) {
  const detected = detectedMimeType(buffer, declaredMimeType);
  if (!detected || detected !== declaredMimeType) throw new Error("MIME_SIGNATURE_MISMATCH");
  if (buffer.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))) throw new Error("MALWARE_SIGNATURE_DETECTED");

  if (declaredMimeType.startsWith("image/")) {
    const metadata = await sharp(buffer, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("IMAGE_DECODE_FAILED");
    return { detectedMimeType: detected, width: metadata.width, height: metadata.height, durationMs: null, codec: metadata.format || null, metadata: { orientation: metadata.orientation || 1, pages: metadata.pages || 1, basicMalwareSignatureClean: true } };
  }

  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "upload-validation-"));
  const filePath = path.join(directory, declaredMimeType === "video/quicktime" ? "asset.mov" : "asset.mp4");
  try {
    await fs.promises.writeFile(filePath, buffer);
    const probe = await runFfprobe(filePath);
    const stream = probe.streams?.find((item) => item.codec_type === "video");
    const duration = Number(probe.format?.duration || stream?.duration || 0);
    if (!stream?.width || !stream?.height || !Number.isFinite(duration) || duration <= 0) throw new Error("VIDEO_DECODE_FAILED");
    return { detectedMimeType: detected, width: stream.width, height: stream.height, durationMs: Math.round(duration * 1000), codec: stream.codec_name || null, metadata: { frameRate: stream.avg_frame_rate || null, basicMalwareSignatureClean: true } };
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}
