import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { R2StorageService } from "@/lib/storage/r2StorageService";

const req = createRequire(typeof import.meta.url === "string" ? import.meta.url : import.meta.url.href);
const sharp = req("sharp");

async function referenceBuffer(asset) {
  if (asset.storageKey.startsWith("/avatars/")) {
    return fs.promises.readFile(path.join(process.cwd(), "public", asset.storageKey));
  }
  return R2StorageService.downloadBuffer(asset.storageKey);
}

export async function createVerificationMontage({ assets, framePaths }) {
  const selected = [
    ...assets.filter((asset) => asset.role === "ACTOR_REFERENCE").slice(0, 1),
    ...assets.filter((asset) => ["PRIMARY_PRODUCT", "PRODUCT_PACKAGING", "APP_PRIMARY_SCREEN"].includes(asset.role)).slice(0, 4)
  ];
  const inputBuffers = [];
  for (const asset of selected) inputBuffers.push(await referenceBuffer(asset));
  for (const framePath of framePaths) inputBuffers.push(await fs.promises.readFile(framePath));
  if (!inputBuffers.length) throw new Error("No verification frames available");

  const tileWidth = 360;
  const tileHeight = 360;
  const columns = 3;
  const rows = Math.ceil(inputBuffers.length / columns);
  const composites = [];
  for (const [index, buffer] of inputBuffers.entries()) {
    const normalized = await sharp(buffer).rotate().resize(tileWidth, tileHeight, { fit: "contain", background: "#111111" }).jpeg({ quality: 88 }).toBuffer();
    composites.push({ input: normalized, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight });
  }
  const buffer = await sharp({ create: { width: columns * tileWidth, height: rows * tileHeight, channels: 3, background: "#111111" } }).composite(composites).jpeg({ quality: 90 }).toBuffer();
  return {
    buffer,
    layout: {
      referenceTiles: selected.map((asset, index) => ({ tile: index + 1, role: asset.role, alias: JSON.parse(asset.validationMetadata || "{}").alias || asset.originalFileName })),
      generatedFrameTiles: framePaths.map((_frame, index) => selected.length + index + 1)
    }
  };
}
