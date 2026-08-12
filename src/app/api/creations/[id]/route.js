import { NextResponse } from "next/server";
import { getMockSession as getRequestSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";

async function artifactUrl(artifact) {
  if (!artifact) return null;
  if (!R2StorageService.isConfigured()) return `/storage/${artifact.storageKey}`;
  return R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900 });
}

export async function GET(_req, { params }) {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const creation = await prisma.creation.findFirst({
      where: { id, userId: session.user.id },
      include: {
        variants: {
          orderBy: { variantIndex: "asc" },
          include: { artifacts: { where: { type: "FINAL_VIDEO" }, orderBy: { createdAt: "desc" }, take: 1 } }
        }
      }
    });
    if (!creation) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const variants = await Promise.all(creation.variants.map(async (variant) => ({
      id: variant.id,
      variantIndex: variant.variantIndex,
      status: variant.status,
      stage: variant.currentStage,
      progress: variant.progressValue,
      errorCode: variant.errorCode,
      error: variant.safeError,
      url: await artifactUrl(variant.artifacts[0])
    })));
    const delivered = variants.find((variant) => variant.status === "COMPLETED" && variant.url);

    return NextResponse.json({
      id: creation.id,
      title: creation.title,
      isFavorite: creation.isFavorite,
      status: creation.status,
      stage: creation.currentStage,
      // Preserve previews for completed records created before artifacts were
      // introduced; otherwise those history cards have no src and look blank.
      url: delivered?.url || creation.url || null,
      error: creation.safeError || creation.error,
      errorCode: creation.errorCode,
      modelId: creation.modelId,
      prompt: creation.prompt,
      spokenScript: creation.spokenScript,
      resolution: creation.resolution,
      aspectRatio: creation.aspectRatio,
      duration: creation.duration,
      outputCount: creation.numberOfVideos,
      variants
    });
  } catch (error) {
    console.error("[CREATION_READ_FAILED]", error);
    return NextResponse.json({ error: "Creation status is temporarily unavailable" }, { status: 503 });
  }
}
