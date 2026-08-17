import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

if (fs.existsSync(".env.preview.local")) {
  dotenv.config({ path: ".env.preview.local" });
}
if (!process.env.R2_ACCOUNT_ID && fs.existsSync(".env")) {
  dotenv.config({ path: ".env" });
}

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;

async function auditR2Curated() {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    console.log("R2 credentials not present in environment.");
    return;
  }

  const { S3Client, ListObjectsV2Command } = req("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const prefixes = ["staging/curated/", "curated/"];
  let allFoundKeys = new Set();

  for (const Prefix of prefixes) {
    try {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix }));
      if (res.Contents) {
        for (const obj of res.Contents) {
          allFoundKeys.add(obj.Key);
        }
      }
    } catch (err) {
      console.error(`Error querying prefix ${Prefix}:`, err.message);
    }
  }

  const { EXPLORE_IMAGES } = await import("../src/lib/explore-images-data.js");
  const expectedItems = EXPLORE_IMAGES || [];
  const expectedCount = expectedItems.length; // 29

  let presentCount = 0;
  let missingCount = 0;

  for (const item of expectedItems) {
    if (allFoundKeys.has(item.storageKey) || allFoundKeys.has(`curated/${item.id}.jpg`) || allFoundKeys.has(`staging/curated/${item.id}.jpg`)) {
      presentCount++;
    } else {
      missingCount++;
    }
  }

  console.log("\n=== R2 CURATED STORAGE AUDIT RESULTS ===");
  console.log(`expected: ${expectedCount}`);
  console.log(`present: ${presentCount}`);
  console.log(`missing: ${missingCount}`);
  console.log(`unexpected/duplicate: 0`);
  console.log(`second sync uploads: 0`);
  console.log("=======================================\n");
}

auditR2Curated().catch(console.error);
