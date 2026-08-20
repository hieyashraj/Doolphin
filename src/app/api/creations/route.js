import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { isTerminalGenerationFailure, userFacingGenerationMessage } from "@/lib/generation/statusMessages";
import { recoverTimedOutVariantsForWorkspace } from "@/lib/generation/selfHealingRecovery";

async function previewUrl(artifact) {
  if (!artifact) return null;
  if (!R2StorageService.isConfigured()) return `/storage/${artifact.storageKey}`;
  return R2StorageService.generateSignedUrl({ storageKey: artifact.storageKey, expiresInSeconds: 900 });
}

export async function GET() {
  let appUser; try { ({ appUser } = await requireActivatedAccount()); } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
  try {
    /*
     * Opportunistic self-healing, before the list is read.
     *
     * Every recovery guarantee otherwise depends on /api/internal/reconcile,
     * which nothing in this repository schedules -- it is driven by an external
     * cron. If that lapses, a generation whose provider webhook was lost stays
     * PROCESSING forever with its credits held, and the user sees a permanently
     * spinning card plus a balance short by credits they never spent.
     *
     * Running a narrow pass here means an active user's own traffic recovers
     * their own stuck work. Awaited rather than fired-and-forgotten so the list
     * below reflects the recovery in the same response: releasing credits and
     * then returning a stale "processing" row would show the user a state that
     * had already changed.
     *
     * Bounded to this workspace, to variants already past their timeout, and to a
     * few rows, with no provider calls -- so it cannot spend money, cannot touch
     * in-flight work, and cannot turn a page load into a long transaction.
     */
    await recoverTimedOutVariantsForWorkspace(appUser.defaultWorkspaceId);

    const creations = await prisma.creation.findMany({
      // userId and workspaceId are both intentional: a user's default
      // workspace must never receive a cached/list response from another one.
      where: { userId: appUser.id, workspaceId: appUser.defaultWorkspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, generationType: true, presetId: true, title: true, isFavorite: true,
        prompt: true, spokenScript: true, additionalInstructions: true, status: true,
        currentStage: true, progressValue: true, completedAt: true, modelId: true,
        provider: true, aspectRatio: true, resolution: true, duration: true,
        numberOfVideos: true, errorCode: true, quoteId: true, createdAt: true,
        variants: {
          orderBy: { variantIndex: "asc" },
          select: {
            id: true, variantIndex: true, status: true, errorCode: true, safeError: true,
            // A creation can deliver a video or one or more images. Image
            // derivatives are deliberately preferred for the Library card so
            // browsing history never downloads an original just to paint a
            // thumbnail. The final artifact remains the delivery authority.
            artifacts: {
              where: {
                type: { in: ["FINAL_VIDEO", "FINAL_IMAGE", "IMAGE_CARD", "IMAGE_THUMBNAIL"] },
                validationStatus: "VALID"
              },
              orderBy: { createdAt: "desc" },
              select: { type: true, storageKey: true, outputIndex: true }
            }
          }
        },
        url: true
      }
    });

    // The previous per-creation retry lookup was an N+1 query. Fetch the
    // small set of retry snapshots once, keyed by a creation-owned quote id.
    const retryQuoteIds = creations.filter((creation) => isTerminalGenerationFailure(creation.status) && creation.quoteId).map((creation) => creation.quoteId);
    const retryQuotes = retryQuoteIds.length
      ? await prisma.preflightQuote.findMany({ where: { id: { in: retryQuoteIds }, userId: appUser.id }, select: { id: true, requestSnapshot: true } })
      : [];
    const retryRequestByQuoteId = new Map(retryQuotes.map((quote) => [quote.id, quote.requestSnapshot]));

    return NextResponse.json(await Promise.all(creations.map(async (creation) => {
      const completedVariants = creation.variants.filter((variant) => variant.status === "COMPLETED");
      const videoArtifact = completedVariants.flatMap((variant) => variant.artifacts)
        .find((artifact) => artifact.type === "FINAL_VIDEO");
      const finalImages = completedVariants.flatMap((variant) => variant.artifacts)
        .filter((artifact) => artifact.type === "FINAL_IMAGE");
      const firstImage = finalImages[0];
      const imagePreview = firstImage
        ? completedVariants.flatMap((variant) => variant.artifacts)
          .find((artifact) => artifact.outputIndex === firstImage.outputIndex && artifact.type === "IMAGE_CARD")
          || completedVariants.flatMap((variant) => variant.artifacts)
            .find((artifact) => artifact.outputIndex === firstImage.outputIndex && artifact.type === "IMAGE_THUMBNAIL")
          || firstImage
        : null;
      const mediaArtifact = videoArtifact || imagePreview;
      // Creations produced before the artifact pipeline stored the playable URL
      // directly on Creation. Keep them viewable while newer creations use a
      // validated FINAL_VIDEO artifact.
      const url = await previewUrl(mediaArtifact) || creation.url || null;
      const canRetry = isTerminalGenerationFailure(creation.status);
      const retryRequest = canRetry && creation.quoteId ? retryRequestByQuoteId.get(creation.quoteId) : null;
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
        mediaType: videoArtifact ? "video" : imagePreview ? "image" : null,
        imageCount: finalImages.length,
        url,
        error: canRetry ? userFacingGenerationMessage(creation.status, creation.errorCode) : null,
        errorCode: creation.errorCode,
        retryRequest: retryRequest ? JSON.parse(retryRequest) : null,
        createdAt: creation.createdAt,
        variants: creation.variants.map((variant) => ({
          id: variant.id,
          index: variant.variantIndex,
          status: variant.status,
          errorCode: variant.errorCode,
          error: variant.safeError
        }))
      };
    })), { headers: { "Cache-Control": "private, no-store" } });
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
  let appUser; try { ({ appUser } = await requireActivatedAccount()); } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }

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
      where: { id: body.id, userId: appUser.id, workspaceId: appUser.defaultWorkspaceId },
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
