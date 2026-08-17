import { prisma } from "../../prisma.js";

/**
 * Authoritative Model Platform V1 Workflow & Multi-Output Settlement Engine (Phase 4D.3).
 *
 * Implements a strictly transactional, Serializable creation-level commercial settlement policy:
 * - All outputs succeed (S = N): Charge full quotedCredits, release 0.
 * - All outputs fail (S = 0): Charge 0, release full quotedCredits.
 * - Partial success (0 < S < N): Charge exact preflight settlementSchedule, release unearned remainder.
 * - Fails closed if workflow reservation is missing or inconsistent.
 * - Idempotent, race-safe, transactional.
 */

export function calculateWorkflowSettlement({
  outputCount = 1,
  quotedCredits = 0,
  successfulVariantCount = 0,
  failedVariantCount = 0,
  settlementSchedule = null,
} = {}) {
  const totalOutputs = Math.max(1, Math.floor(Number(outputCount) || 1));
  const totalQuoted = Math.max(0, Math.floor(Number(quotedCredits) || 0));
  const successCount = Math.min(totalOutputs, Math.max(0, Math.floor(Number(successfulVariantCount) || 0)));

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
  // Require authoritative preflight settlement schedule; fail closed if missing
  if (!settlementSchedule || settlementSchedule[successCount] === undefined || settlementSchedule[successCount] === null) {
    throw new Error(`MISSING_SETTLEMENT_SCHEDULE: Prepared plan lacks authoritative settlement schedule for ${successCount}/${totalOutputs} outputs`);
  }

  const earnedCreditsToCharge = Math.min(totalQuoted, Math.max(0, Number(settlementSchedule[successCount])));
  const unearnedCreditsToRelease = Math.max(0, totalQuoted - earnedCreditsToCharge);

  return {
    settledStatus: "COMPLETED",
    earnedCreditsToCharge,
    unearnedCreditsToRelease,
    isPartial: true,
  };
}

export async function isModelPlatformV1Creation(creationId, { tx = null } = {}) {
  const db = tx || prisma;
  const creation = await db.creation.findUnique({
    where: { id: creationId },
    select: { quote: { select: { routingSnapshot: true } } },
  });
  if (!creation?.quote?.routingSnapshot) return false;
  try {
    const parsed = JSON.parse(creation.quote.routingSnapshot);
    return parsed.authority === "MODEL_PLATFORM_V1";
  } catch {
    return false;
  }
}

export async function settleModelPlatformWorkflow({
  creationId,
  tx = null,
} = {}) {
  const { CreditEscrowService } = await import("../../billing/CreditEscrowService.js");

  const runInsideTx = async (db) => {
    const creation = await db.creation.findUnique({
      where: { id: creationId },
      include: {
        variants: true,
        quote: true,
      },
    });

    if (!creation) {
      throw new Error(`Creation '${creationId}' not found for settlement`);
    }

    if (creation.settledAt) {
      return {
        alreadySettled: true,
        creationId: creation.id,
        status: creation.status,
        reservedCredits: creation.reservedCredits,
      };
    }

    const totalOutputs = creation.numberOfVideos || creation.variants.length || 1;

    const isSuccessfulVariant = (v) => v.status === "COMPLETED" && Boolean(v.finalArtifactId);
    const isUnsuccessfulVariant = (v) => ["FAILED", "CANCELLED", "TIMED_OUT", "QUARANTINED"].includes(v.status);
    const isTerminalVariant = (v) => isSuccessfulVariant(v) || isUnsuccessfulVariant(v);

    const terminalVariants = creation.variants.filter(isTerminalVariant);

    if (terminalVariants.length < totalOutputs) {
      return {
        settlementPending: true,
        completedVariants: creation.variants.filter(isSuccessfulVariant).length,
        totalVariants: totalOutputs,
      };
    }

    const isModelPlatform = await isModelPlatformV1Creation(creationId, { tx: db });
    const totalReservedCredits = creation.reservedCredits || creation.quote?.internalCreditsToReserve || 0;

    let primaryReservation = null;
    if (isModelPlatform && totalReservedCredits > 0) {
      const reservations = await db.creditReservation.findMany({
        where: { creationId: creation.id },
      });

      if (reservations.length !== 1) {
        throw new Error(`INCONSISTENT_SETTLEMENT_RESERVATION: Expected exactly 1 workflow reservation for Creation '${creationId}', found ${reservations.length}`);
      }

      primaryReservation = reservations[0];

      if (primaryReservation.creationId !== creation.id) {
        throw new Error(`INCONSISTENT_SETTLEMENT_RESERVATION: Reservation creationId '${primaryReservation.creationId}' does not match Creation '${creation.id}'`);
      }

      if (primaryReservation.amount !== totalReservedCredits) {
        throw new Error(`INCONSISTENT_SETTLEMENT_RESERVATION: Reservation amount ${primaryReservation.amount} does not match expected workflow reserved credits ${totalReservedCredits}`);
      }

      if (primaryReservation.status !== "RESERVED" && !primaryReservation.settledAt) {
        throw new Error(`INCONSISTENT_SETTLEMENT_RESERVATION: Reservation status '${primaryReservation.status}' is invalid for settlement`);
      }
    } else {
      primaryReservation = await db.creditReservation.findFirst({
        where: { creationId: creation.id },
      });
    }

    // Single-writer claim inside Serializable transaction
    const claim = await db.creation.updateMany({
      where: { id: creationId, settledAt: null },
      data: { settledAt: new Date() },
    });

    if (claim.count === 0) {
      return {
        alreadySettled: true,
        creationId: creation.id,
        status: creation.status,
        reservedCredits: creation.reservedCredits,
      };
    }

    const successfulVariants = creation.variants.filter(isSuccessfulVariant);
    const failedVariants = creation.variants.filter(isUnsuccessfulVariant);

    let settlementSchedule = null;
    if (creation.quote?.routingSnapshot) {
      try {
        const parsedRouting = JSON.parse(creation.quote.routingSnapshot);
        settlementSchedule = parsedRouting.modelPlatformPreparedPlan?.workflowPricing?.settlementSchedule || null;
      } catch {}
    }

    const settlement = calculateWorkflowSettlement({
      outputCount: totalOutputs,
      quotedCredits: totalReservedCredits,
      successfulVariantCount: successfulVariants.length,
      failedVariantCount: failedVariants.length,
      settlementSchedule,
    });

    if (primaryReservation && !primaryReservation.settledAt) {
      await CreditEscrowService.settleReservationSplit({
        reservationId: primaryReservation.id,
        commitAmount: settlement.earnedCreditsToCharge,
        releaseAmount: settlement.unearnedCreditsToRelease,
        reason: settlement.settledStatus === "FAILED" ? "CREATION_FAILED_FULL_REFUND" : "CREATION_WORKFLOW_SETTLEMENT",
        tx: db,
      });
    }

    const updatedCreation = await db.creation.update({
      where: { id: creation.id },
      data: {
        status: settlement.settledStatus,
        currentStage: settlement.settledStatus === "COMPLETED" ? "delivery" : "failed",
        completedAt: new Date(),
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
  };

  // If transaction client was passed explicitly, use it directly
  if (tx) {
    return await runInsideTx(tx);
  }

  // Otherwise, settlement service owns the single Serializable transaction
  return await prisma.$transaction(runInsideTx, { isolationLevel: "Serializable" });
}
