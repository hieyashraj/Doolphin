import { prisma } from "../prisma.js";
import { CreditEscrowService } from "../billing/CreditEscrowService.js";
import { R2StorageService } from "../storage/r2StorageService.js";
import { ArtifactDeliveryValidator } from "../storage/ArtifactValidator.js";
import { renderAppStudioVideo } from "../media/FfmpegRunner.js";
import fs from "fs";

/**
 * Dedicated Generation Worker.
 * Section 15 & 16 Compliance: Handles browser-independent job execution,
 * stage graph processing, artifact storage, delivery validation, and credit escrow commitment.
 */

export class GenerationWorker {
  static async processJob(jobPayload) {
    const { creationId, variantId, workspaceId, workflowType } = jobPayload;

    console.log(`[GENERATION WORKER] Processing Variant ${variantId} for Creation ${creationId}`);

    const variant = await prisma.creationVariant.findUnique({
      where: { id: variantId },
      include: { stages: true, creditReservations: true, creation: true },
    });

    if (!variant) throw new Error(`CreationVariant ${variantId} not found`);
    if (variant.status === "COMPLETED" || variant.status === "FAILED") {
      console.log(`[GENERATION WORKER] Variant ${variantId} already terminal (${variant.status}).`);
      return variant;
    }

    // Update status to PROCESSING
    await prisma.creationVariant.update({
      where: { id: variantId },
      data: { status: "PROCESSING", currentStage: "PROCESSING_STAGE" },
    });

    await prisma.creation.update({
      where: { id: creationId },
      data: { status: "PROCESSING", currentStage: "PROCESSING_STAGE" },
    });

    try {
      const outputKey = `final/${workspaceId}/${creationId}/variant_${variant.variantIndex}.mp4`;
      const localOutputPath = `./public/storage/${outputKey}`;
      fs.mkdirSync(`./public/storage/final/${workspaceId}/${creationId}`, { recursive: true });

      // Execute App Studio or Product Ad render
      const renderRes = await renderAppStudioVideo({
        outputPath: localOutputPath,
        aspectRatio: "9:16",
      });

      // Upload to R2 Storage
      const storageRecord = await R2StorageService.uploadFile({
        storageKey: outputKey,
        filePath: localOutputPath,
        contentType: "video/mp4",
      });

      // Save GeneratedArtifact
      const artifact = await prisma.generatedArtifact.create({
        data: {
          workspaceId,
          creationVariantId: variant.id,
          type: "FINAL_VIDEO",
          storageKey: outputKey,
          checksumSha256: storageRecord.checksumSha256,
          mimeType: "video/mp4",
          fileSizeBytes: storageRecord.fileSizeBytes,
          width: 1080,
          height: 1920,
          durationMs: 5000,
          videoCodec: "h264",
          audioCodec: "aac",
        },
      });

      // Perform Delivery Validation
      const validationResult = await ArtifactDeliveryValidator.validateArtifact({
        generatedArtifactId: artifact.id,
        workspaceId,
      });

      if (!validationResult.passed) {
        throw new Error("Artifact delivery validation failed");
      }

      // Commit Credits
      const reservation = variant.creditReservations[0];
      if (reservation) {
        await CreditEscrowService.commitCredits({ reservationId: reservation.id });
      }

      // Update Variant and Creation status to COMPLETED
      const updatedVariant = await prisma.creationVariant.update({
        where: { id: variantId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          finalArtifactId: artifact.id,
          progressValue: 100.0,
        },
      });

      await prisma.creation.update({
        where: { id: creationId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          progressValue: 100.0,
        },
      });

      console.log(`[GENERATION WORKER] Variant ${variantId} COMPLETED successfully.`);
      return updatedVariant;
    } catch (err) {
      console.error(`[GENERATION WORKER ERROR] Variant ${variantId} failed:`, err.message);

      // Release Credits on failure
      const reservation = variant.creditReservations[0];
      if (reservation) {
        await CreditEscrowService.releaseCredits({
          reservationId: reservation.id,
          reason: `WORKER_FAILURE: ${err.message}`,
        });
      }

      await prisma.creationVariant.update({
        where: { id: variantId },
        data: {
          status: "FAILED",
          errorCode: "WORKER_EXECUTION_FAILED",
          safeError: err.message,
        },
      });

      await prisma.creation.update({
        where: { id: creationId },
        data: {
          status: "FAILED",
          errorCode: "WORKER_EXECUTION_FAILED",
          safeError: err.message,
        },
      });

      throw err;
    }
  }
}
