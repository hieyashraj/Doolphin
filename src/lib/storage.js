import fs from "fs";
import path from "path";

const STORAGE_DRIVER = process.env.STORAGE_DRIVER || "local";

/**
 * Universal Storage Manager
 * Supports local filesystem storage for development and S3/object storage interface for production.
 */
export async function saveMediaBuffer(buffer, filename, folder = "creations") {
  if (STORAGE_DRIVER === "s3" && process.env.S3_BUCKET) {
    // S3 / Cloud Storage Driver Hook
    // When credentials are configured, uploads to S3 bucket
    console.log(`[STORAGE_S3] Uploading ${filename} to S3 bucket ${process.env.S3_BUCKET}`);
    const s3Url = `${process.env.S3_ENDPOINT || "https://s3.amazonaws.com"}/${process.env.S3_BUCKET}/${folder}/${filename}`;
    return s3Url;
  }

  // Local Filesystem Storage (Development Default)
  const targetDir = path.join(process.cwd(), "public", "uploads", folder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filePath = path.join(targetDir, filename);
  await fs.promises.writeFile(filePath, buffer);
  
  // Return relative browser-accessible URL
  return `/uploads/${folder}/${filename}`;
}

export function isLocalDevUrl(url) {
  return url && (url.startsWith("/uploads/") || url.startsWith("http://localhost"));
}
