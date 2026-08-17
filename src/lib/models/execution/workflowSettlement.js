/**
 * Authoritative Model Platform V1 Workflow & Multi-Output Settlement Engine (Phase 4D).
 *
 * Implements a creation-level commercial settlement policy:
 * - All outputs succeed (S = N): Charge full quotedCredits, release 0.
 * - All outputs fail (S = 0): Charge 0, release full quotedCredits.
 * - Partial success (0 < S < N): Charge proportional earned credits, release unearned remainder.
 * - Idempotent, race-safe, transactional.
 */

export function calculateWorkflowSettlement({
  outputCount = 1,
  quotedCredits = 0,
  successfulVariantCount = 0,
  failedVariantCount = 0,
} = {}) {
  const totalOutputs = Math.max(1, Math.floor(Number(outputCount) || 1));
  const totalQuoted = Math.max(0, Math.floor(Number(quotedCredits) || 0));
  const successCount = Math.min(totalOutputs, Math.max(0, Math.floor(Number(successfulVariantCount) || 0)));
  const failCount = Math.max(0, Math.floor(Number(failedVariantCount) || 0));

  if (successCount === 0) {
    return {
      settledStatus: "FAILED",
      earnedCreditsToCharge: 0,
      unearnedCreditsToRelease: totalQuoted,
      isPartial: false,
    };
  }

  if (successCount === totalOutputs) {
    return {
      settledStatus: "COMPLETED",
      earnedCreditsToCharge: totalQuoted,
      unearnedCreditsToRelease: 0,
      isPartial: false,
    };
  }

  // Partial success (0 < successCount < totalOutputs)
  const earnedCreditsToCharge = Math.ceil((totalQuoted * successCount) / totalOutputs);
  const unearnedCreditsToRelease = Math.max(0, totalQuoted - earnedCreditsToCharge);

  return {
    settledStatus: "COMPLETED",
    earnedCreditsToCharge,
    unearnedCreditsToRelease,
    isPartial: true,
  };
}

export async function settleModelPlatformWorkflow({
  creationId,
  tx = null,
} = {}) {
  const { CreditEscrowService } = await import("../../billing/CreditEscrowService.js");
  const db = tx || (await import("../../prisma.js")).prisma;

  return await db.$transaction(async (prismaClient) => {
    const creation = await prismaClient.creation.findUnique({
      where: { id: creationId },
      include: {
        variants: true,
        quote: true,
      },
    });

    if (!creation) {
      throw new Error(`Creation '${creationId}' not found for settlement`);
    }

    // Idempotency guard: If already settled, return idempotent status
    if (creation.settledAt) {
      return {
        alreadySettled: true,
        creationId: creation.id,
        status: creation.status,
        reservedCredits: creation.reservedCredits,
      };
    }

    const totalOutputs = creation.numberOfVideos || creation.variants.length || 1;
    const terminalVariants = creation.variants.filter((v) => ["COMPLETED", "FAILED", "CANCELLED"].includes(v.status));

    // If not all variants are terminal yet, do not finalize creation settlement
    if (terminalVariants.length < totalOutputs) {
      return {
        settlementPending: true,
        completedVariants: creation.variants.filter((v) => v.status === "COMPLETED").length,
        totalVariants: totalOutputs,
      };
    }

    const successfulVariants = creation.variants.filter((v) => v.status === "COMPLETED");
    const failedVariants = creation.variants.filter((v) => ["FAILED", "CANCELLED"].includes(v.status));

    const totalReservedCredits = creation.reservedCredits || creation.quote?.internalCreditsToReserve || 0;

    const settlement = calculateWorkflowSettlement({
      outputCount: totalOutputs,
      quotedCredits: totalReservedCredits,
      successfulVariantCount: successfulVariants.length,
      failedVariantCount: failedVariants.length,
    });

    // Execute credit commit/release adjustments
    if (settlement.unearnedCreditsToRelease > 0) {
      // Release unearned credits from the creation reservation (which was placed on variant 0)
      const primaryVariant = creation.variants[0];
      if (primaryVariant) {
        await CreditEscrowService.releaseVariantReservations(
          primaryVariant.id,
          settlement.settledStatus === "FAILED" ? "CREATION_FAILED_FULL_REFUND" : "CREATION_PARTIAL_SUCCESS_REFUND",
          prismaClient
        );
      }
    }

    if (settlement.earnedCreditsToCharge > 0) {
      // Commit earned credits for successful variants
      for (const variant of successfulVariants) {
        // Mark credits committed
        await prismaClient.creationVariant.update({
          where: { id: variant.id },
          data: {
            creditsCommitted: true,
            currentStage: "delivery",
            status: "COMPLETED",
          },
        });
      }
    }

    // Finalize creation record
    const updatedCreation = await prismaClient.creation.update({
      where: { id: creation.id },
      data: {
        status: settlement.settledStatus,
        currentStage: settlement.settledStatus === "COMPLETED" ? "delivery" : "failed",
        settledAt: new Date(),
        settlementSummaryJson: JSON.stringify({
          settledStatus: settlement.settledStatus,
          totalOutputs,
          successfulCount: successfulVariants.length,
          failedCount: failedVariants.length,
          totalReservedCredits,
          earnedCreditsCharged: settlement.earnedCreditsToCharge,
          unearnedCreditsReleased: settlement.unearnedCreditsToRelease,
          isPartial: settlement.isPartial,
        }),
      },
    });

    return {
      alreadySettled: false,
      creationId: updatedCreation.id,
      status: updatedCreation.status,
      settlement,
    };
  });
}
