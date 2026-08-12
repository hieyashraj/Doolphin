import { NextResponse } from "next/server";
import { z } from "zod";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { isTerminalGenerationFailure, userFacingGenerationMessage } from "@/lib/generation/statusMessages";

async function previewUrl(artifact) {
  if (!artifact) return null;
  if (!R2StorageService.isConfigured()) return `/storage/${artifact.storageKey}`;
  return R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900 });
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json([], { status: 200 });
  try {
    const creations = await prisma.creation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        variants: {
          orderBy: { variantIndex: "asc" },
          include: { artifacts: { where: { type: "FINAL_VIDEO" }, orderBy: { createdAt: "desc" }, take: 1 } }
        }
      }
    });

    return NextResponse.json(await Promise.all(creations.map(async (creation) => {
      const passing = creation.variants.find((variant) => variant.status === "COMPLETED" && variant.artifacts[0]);
      // Creations produced before the artifact pipeline stored the playable URL
      // directly on Creation. Keep them viewable while newer creations use a
      // validated FINAL_VIDEO artifact.
      const url = await previewUrl(passing?.artifacts[0]) || creation.url || null;
      const canRetry = isTerminalGenerationFailure(creation.status);
      const retryQuote = canRetry && creation.quoteId
        ? await prisma.preflightQuote.findUnique({ where: { id: creation.quoteId }, select: { requestSnapshot: true } })
        : null;
      return {
        id: creation.id,
        generationType: creation.generationType,
        presetId: creation.presetId,
        title: creation.title,
        isFavorite: creation.isFavorite,
        prompt: creation.prompt,
        spokenScript: creation.spokenScript,
        additionalInstructions: creation.additionalInstructions,
        status: creation.status,
        currentStage: creation.currentStage,
        progressValue: creation.progressValue ?? 0,
        completedAt: creation.completedAt,
        modelId: creation.modelId,
        provider: creation.provider,
        aspectRatio: creation.aspectRatio,
        resolution: creation.resolution,
        duration: creation.duration,
        outputCount: creation.numberOfVideos,
        url,
        error: canRetry ? userFacingGenerationMessage(creation.status, creation.errorCode) : null,
        errorCode: creation.errorCode,
        retryRequest: retryQuote ? JSON.parse(retryQuote.requestSnapshot) : null,
        createdAt: creation.createdAt,
        variants: creation.variants.map((variant) => ({
          id: variant.id,
          index: variant.variantIndex,
          status: variant.status,
          errorCode: variant.errorCode,
          error: variant.safeError
        }))
      };
    })));
  } catch (error) {
    console.error("[CREATIONS_LIST_FAILED]", error);
    return NextResponse.json({ error: "Creation history is temporarily unavailable" }, { status: 503 });
  }
}

const creationMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().max(120).nullable().optional(),
  isFavorite: z.boolean().optional()
}).refine((value) => value.title !== undefined || value.isFavorite !== undefined, {
  message: "Provide a title or favorite status"
});

// Metadata is deliberately kept on Creation (rather than the generated asset),
// so it applies consistently to all variants made in a single request.
export async function PATCH(request) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = creationMetadataSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : "Invalid request" }, { status: 400 });
  }

  const data = {};
  if (body.title !== undefined) data.title = body.title || null;
  if (body.isFavorite !== undefined) data.isFavorite = body.isFavorite;

  try {
    const result = await prisma.creation.updateMany({
      where: { id: body.id, userId: session.user.id },
      data
    });
    if (!result.count) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const creation = await prisma.creation.findUnique({
      where: { id: body.id },
      select: { id: true, title: true, isFavorite: true, updatedAt: true }
    });
    return NextResponse.json(creation);
  } catch (error) {
    console.error("[CREATION_METADATA_UPDATE_FAILED]", error);
    return NextResponse.json({ error: "Could not update creation" }, { status: 503 });
  }
}
