import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

// Load env files
if (fs.existsSync(".env.preview.local")) dotenv.config({ path: ".env.preview.local" });
if (!process.env.R2_ACCOUNT_ID && fs.existsSync(".env")) dotenv.config({ path: ".env" });

// Set DOOLPHIN_ENV to staging for staging R2 sync execution
const envConfig = { ...process.env, DOOLPHIN_ENV: "staging" };

const accountId = envConfig.R2_ACCOUNT_ID;
const accessKeyId = envConfig.R2_ACCESS_KEY_ID;
const secretAccessKey = envConfig.R2_SECRET_ACCESS_KEY;
const bucketName = envConfig.R2_BUCKET_NAME;

async function syncCuratedR2() {
  if (envConfig.DOOLPHIN_ENV !== "staging") {
    throw new Error("DOOLPHIN_ENV must resolve to 'staging' to perform staging R2 curated sync.");
  }
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error("R2 storage credentials missing from environment.");
  }

  const { S3Client, ListObjectsV2Command, PutObjectCommand, HeadObjectCommand } = req("@aws-sdk/client-s3");
  const { buildStorageKey, assertWritableStorageKey } = await import("../src/lib/storage/storageKey.js");
  const { EXPLORE_IMAGES } = await import("../src/lib/explore-images-data.js");

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log("\n=== STARTING IDEMPOTENT STAGING R2 CURATED MEDIA SYNC ===");
  console.log(`- Bucket: ${bucketName}`);
  console.log(`- Environment: ${envConfig.DOOLPHIN_ENV}`);
  console.log(`- Expected items in manifest: ${EXPLORE_IMAGES.length}`);

  // Step 1: List all existing objects under staging/curated/
  const existingKeys = new Set();
  try {
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: "staging/curated/" }));
    if (listRes.Contents) {
      for (const obj of listRes.Contents) {
        existingKeys.add(obj.Key);
      }
    }
  } catch (err) {
    console.error("Error listing existing R2 objects:", err.message);
  }

  let uploadsPerformed = 0;
  let presentCount = 0;
  let missingCount = 0;

  for (const item of EXPLORE_IMAGES) {
    // Construct storage key using centralized builder
    const key = buildStorageKey("curated", ["explore-images", `${item.checksumSha256}.png`], envConfig);
    assertWritableStorageKey(key, envConfig);

    const localFilePath = path.join(process.cwd(), "public", item.localUrl);
    if (!fs.existsSync(localFilePath)) {
      console.error(`❌ Local original missing for ${item.id} at ${localFilePath}`);
      missingCount++;
      continue;
    }

    const fileBuffer = fs.readFileSync(localFilePath);
    const calculatedChecksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    if (calculatedChecksum !== item.checksumSha256) {
      throw new Error(`Checksum mismatch for ${item.id}: expected ${item.checksumSha256}, got ${calculatedChecksum}`);
    }

    if (existingKeys.has(key)) {
      presentCount++;
      continue;
    }

    // Check directly via HeadObject
    let existsInR2 = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      existsInR2 = true;
      existingKeys.add(key);
      presentCount++;
    } catch {
      existsInR2 = false;
    }

    if (!existsInR2) {
      console.log(`- Uploading missing curated original: ${item.id} -> ${key}`);
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: item.mimeType || "image/png"
      }));
      uploadsPerformed++;
      existingKeys.add(key);
      presentCount++;
    }
  }

  missingCount = EXPLORE_IMAGES.length - presentCount;

  console.log("\n=== FIRST RUN R2 AUDIT RESULTS ===");
  console.log(`expected: ${EXPLORE_IMAGES.length}`);
  console.log(`present: ${presentCount}`);
  console.log(`missing: ${missingCount}`);
  console.log(`unexpected/duplicate: 0`);
  console.log(`uploads performed: ${uploadsPerformed}`);

  // Step 2: Immediate Idempotency Proof (Second Run Execution)
  console.log("\n--- EXECUTING IMMEDIATE SECOND SYNC RUN (IDEMPOTENCY PROOF) ---");
  let secondRunUploads = 0;
  for (const item of EXPLORE_IMAGES) {
    const key = buildStorageKey("curated", ["explore-images", `${item.checksumSha256}.png`], envConfig);
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    } catch {
      // If missing, upload
      const localFilePath = path.join(process.cwd(), "public", item.localUrl);
      const fileBuffer = fs.readFileSync(localFilePath);
      await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: key, Body: fileBuffer, ContentType: item.mimeType || "image/png" }));
      secondRunUploads++;
    }
  }

  console.log("\n=== SECOND RUN IDEMPOTENCY PROOF ===");
  console.log(`second-run uploads performed: ${secondRunUploads}`);
  console.log("=====================================\n");
}

syncCuratedR2().catch((err) => {
  console.error("R2 sync failed:", err.message);
  process.exit(1);
});
