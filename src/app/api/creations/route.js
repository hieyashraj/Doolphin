import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

export async function GET(req) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // 1. ROBUST AUTO-CLEANUP: Mark dead/zombie creations older than 15 mins as FAILED & release held credits
    try {
      const deadCreations = await prisma.creation.findMany({
        where: {
          userId,
          status: { in: ["PROCESSING", "QUEUED", "DRAFT"] },
          createdAt: { lt: fifteenMinutesAgo }
        }
      });

      for (const dead of deadCreations) {
        // Release held credits so user is never charged for dead/stuck requests
        if (dead.reservedCredits > 0) {
          const releaseKey = `rel_dead_${dead.id}`;
          try {
            await CreditEscrowService.releaseCreationCredits({
              userId,
              workspaceId: dead.workspaceId,
              creationId: dead.id,
              amount: dead.reservedCredits,
              reason: "TIMEOUT_AUTO_CLEANED",
              idempotencyKey: releaseKey
            });
          } catch (e) {
            console.error("[DEAD_CLEANUP_RELEASE_WARN]", e.message);
          }
        }

        await prisma.creation.update({
          where: { id: dead.id },
          data: {
            status: "FAILED",
            currentStage: "failed",
            errorCode: "TIMEOUT_AUTO_CLEANED",
            error: "Generation request timed out after 15 minutes and was automatically cleaned up."
          }
        });
      }
    } catch (cleanupErr) {
      console.error("[AUTO_CLEANUP_WARN]", cleanupErr.message);
    }

    // 2. SUPER-FAST INDEXED LIST QUERY (< 30ms with index)
    const creations = await prisma.creation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    // Sanitize heavy base64 images so list payloads stay under 20KB for instant loading
    const sanitizedCreations = creations.map(c => {
      let imagesList = [];
      if (c.inputImages) {
        try {
          const parsed = JSON.parse(c.inputImages);
          if (Array.isArray(parsed)) {
            imagesList = parsed.map(img => typeof img === "string" && img.startsWith("data:") ? "[Data URI Image]" : img);
          }
        } catch {
          imagesList = [c.inputImages.startsWith("data:") ? "[Data URI Image]" : c.inputImages];
        }
      }

      return {
        id: c.id,
        workspaceId: c.workspaceId,
        userId: c.userId,
        generationType: c.generationType,
        presetId: c.presetId,
        title: c.title,
        prompt: c.prompt,
        spokenScript: c.spokenScript,
        status: c.status,
        currentStage: c.currentStage,
        modelId: c.modelId,
        provider: c.provider,
        aspectRatio: c.aspectRatio,
        resolution: c.resolution,
        duration: c.duration,
        url: c.url,
        error: c.error,
        errorCode: c.errorCode,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        inputImages: imagesList
      };
    });

    return NextResponse.json(sanitizedCreations);

  } catch (error) {
    console.error("[CREATIONS_GET_ERROR]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
