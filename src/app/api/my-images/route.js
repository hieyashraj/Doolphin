import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";

export async function GET(req) {
  try {
    const { appUser } = await requireActivatedAccount(); const page = Math.max(0, Number(new URL(req.url).searchParams.get("page") || 0));
    const artifacts = await prisma.generatedArtifact.findMany({
      where: { type: "FINAL_IMAGE", validationStatus: "VALID", variant: { creation: { userId: appUser.id, generationType: "IMAGE_STUDIO", status: { in: ["COMPLETED", "PARTIAL_COMPLETED"] } } } },
      include: { variant: { include: { creation: { select: { id: true, prompt: true, modelId: true, createdAt: true } } } } },
      orderBy: { createdAt: "desc" }, skip: page * 24, take: 24,
    });
    const items = await Promise.all(artifacts.map(async (artifact) => ({ id: artifact.id, creationId: artifact.variant.creation.id, outputIndex: artifact.outputIndex, prompt: artifact.variant.creation.prompt, modelId: artifact.variant.creation.modelId, width: artifact.width, height: artifact.height, createdAt: artifact.createdAt, url: await R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900 }) })));
    return NextResponse.json({ items, page, hasMore: artifacts.length === 24 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ code: error.code || "MY_IMAGES_UNAVAILABLE" }, { status: error.status || 503 }); }
}
