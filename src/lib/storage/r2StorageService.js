import fs from "fs";
import crypto from "crypto";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

/**
 * Cloudflare R2 Storage Service.
 * Section 4 & 20 Compliance: Canonical private object keys, signed URL generation,
 * upload, download, and range checks.
 */

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || "doolphin-staging";

let s3ClientInstance = null;

function getS3Client() {
  if (!accessKeyId || !secretAccessKey || !accountId) return null;
  if (s3ClientInstance) return s3ClientInstance;
  try {
    const { S3Client } = req("@aws-sdk/client-s3");
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  } catch (e) {
    console.warn("R2 S3 Client load notice:", e.message);
  }
  return s3ClientInstance;
}

export class R2StorageService {
  static isConfigured() {
    return Boolean(accessKeyId && secretAccessKey && accountId && bucketName);
  }

  static async uploadFile({ storageKey, filePath, buffer, contentType }) {
    let data = buffer;
    if (!data && filePath) {
      data = fs.readFileSync(filePath);
    }
    const checksumSha256 = crypto.createHash("sha256").update(data).digest("hex");

    const s3 = getS3Client();
    if (s3) {
      const { PutObjectCommand } = req("@aws-sdk/client-s3");
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: storageKey,
          Body: data,
          ContentType: contentType,
        })
      );
    } else {
      // Local fallback storage
      const localDir = `./public/storage/${storageKey.substring(0, storageKey.lastIndexOf("/"))}`;
      fs.mkdirSync(localDir, { recursive: true });
      fs.writeFileSync(`./public/storage/${storageKey}`, data);
    }

    return {
      storageKey,
      fileSizeBytes: BigInt(data.length),
      checksumSha256,
      mimeType: contentType,
    };
  }

  static async generateSignedUrl({ storageKey, expiresInSeconds = 900, isDownload = false, filename = "video.mp4" }) {
    const s3 = getS3Client();
    if (s3) {
      const { GetObjectCommand } = req("@aws-sdk/client-s3");
      const { getSignedUrl } = req("@aws-sdk/s3-request-presigner");
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: storageKey,
        ResponseContentDisposition: isDownload ? `attachment; filename="${filename}"` : "inline",
      });
      return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
    }

    // Local development storage lives below `public`, so it is served directly by
    // Next.js.  The previous fallback pointed at `/api/uploads/serve`, which does
    // not exist and made otherwise completed videos render as blank players.
    return `/storage/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
  }

  static async generateUploadUrl({ storageKey, contentType, expiresInSeconds = 900 }) {
    const s3 = getS3Client();
    if (!s3) return null;
    const { PutObjectCommand } = req("@aws-sdk/client-s3");
    const { getSignedUrl } = req("@aws-sdk/s3-request-presigner");
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucketName, Key: storageKey, ContentType: contentType }), { expiresIn: expiresInSeconds });
  }

  static async checkObjectExists(storageKey) {
    const s3 = getS3Client();
    if (s3) {
      try {
        const { HeadObjectCommand } = req("@aws-sdk/client-s3");
        const head = await s3.send(
          new HeadObjectCommand({
            Bucket: bucketName,
            Key: storageKey,
          })
        );
        return { exists: true, size: head.ContentLength, contentType: head.ContentType };
      } catch (e) {
        return { exists: false };
      }
    }

    // Local fallback check
    const localPath = `./public/storage/${storageKey}`;
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      return { exists: true, size: stats.size, contentType: "video/mp4" };
    }
    return { exists: false };
  }

  static async downloadBuffer(storageKey) {
    const s3 = getS3Client();
    if (s3) {
      const { GetObjectCommand } = req("@aws-sdk/client-s3");
      const response = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: storageKey }));
      return Buffer.from(await response.Body.transformToByteArray());
    }
    return fs.readFileSync(`./public/storage/${storageKey}`);
  }
}
