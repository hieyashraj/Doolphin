import { prisma } from "../prisma.js";
import { AppError, ERROR_CODES } from "../errors.js";

/**
 * CreditEscrowService: Handles internal credit reservations, commits, releases,
 * and workspace credit balance management.
 * Section 5.4, 5.5, 5.6, 21 Compliance.
 */

export class CreditEscrowService {
  /**
   * Ensures user has a default workspace and credit account.
   */
  static async ensureUserWorkspace(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, "User not found");

    if (user.defaultWorkspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: user.defaultWorkspaceId },
        include: { creditAccount: true },
      });
      if (workspace) return workspace;
    }

    // Create workspace transactionally
    return await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: `${user.name || "Default"}'s Workspace`,
          ownerUserId: user.id,
          billingPlan: "starter",
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      const creditAccount = await tx.creditAccount.create({
        data: {
          workspaceId: workspace.id,
          availableCredits: 100,
          reservedCredits: 0,
          lifetimeIssuedCredits: 100,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { defaultWorkspaceId: workspace.id },
      });

      return { ...workspace, creditAccount };
    });
  }

  /**
   * Transactionally reserves credits for a creation variant.
   */
  static async reserveCredits({ workspaceId, creationId, creationVariantId, amount, idempotencyKey, userId, tx = null }) {
    const execute = async (db) => {
      // Check existing reservation
      const existingRes = await db.creditReservation.findUnique({
        where: { idempotencyKey },
      });
      if (existingRes) return existingRes;

      const account = await db.creditAccount.findUnique({
        where: { workspaceId },
      });
      if (!account || account.availableCredits < amount) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_CREDITS,
          `Insufficient available credits (${account?.availableCredits || 0} available, ${amount} required).`,
          { statusCode: 402, creationId, variantId: creationVariantId }
        );
      }

      // Update credit account
      const updatedAccount = await db.creditAccount.update({
        where: { id: account.id },
        data: {
          availableCredits: account.availableCredits - amount,
          reservedCredits: account.reservedCredits + amount,
          version: { increment: 1 },
        },
      });

      // Create CreditReservation
      const reservation = await db.creditReservation.create({
        data: {
          workspaceId,
          creationId,
          creationVariantId,
          amount,
          status: "RESERVED",
          idempotencyKey,
        },
      });

      // Create CreditTransaction
      await db.creditTransaction.create({
        data: {
          workspaceId,
          creationId,
          creationVariantId,
          creditReservationId: reservation.id,
          type: "RESERVE",
          amount,
          idempotencyKey: `tx_res_${idempotencyKey}`,
          balanceBefore: account.availableCredits,
          balanceAfter: updatedAccount.availableCredits,
          reservedBefore: account.reservedCredits,
          reservedAfter: updatedAccount.reservedCredits,
          reasonCode: "RESERVE_GENERATION_VARIANT",
          createdByUserId: userId,
          createdBySystemComponent: "CreditEscrowService",
        },
      });

      return reservation;
    };

    if (tx) return await execute(tx);
    return await prisma.$transaction(execute);
  }

  /**
   * Transactionally commits reserved credits upon successful deliverable validation.
   */
  static async commitCredits({ reservationId, tx = null }) {
    const execute = async (db) => {
      const reservation = await db.creditReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation) throw new AppError(ERROR_CODES.NOT_FOUND, "Credit reservation not found");
      if (reservation.status === "COMMITTED") return reservation;
      if (reservation.status === "RELEASED") {
        throw new AppError(ERROR_CODES.CREDIT_RESERVATION_FAILED, "Reservation already released.");
      }

      const account = await db.creditAccount.findUnique({
        where: { workspaceId: reservation.workspaceId },
      });

      const updatedAccount = await db.creditAccount.update({
        where: { id: account.id },
        data: {
          reservedCredits: Math.max(0, account.reservedCredits - reservation.amount),
          lifetimeCommittedCredits: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      const updatedReservation = await db.creditReservation.update({
        where: { id: reservation.id },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
        },
      });

      await db.creditTransaction.create({
        data: {
          workspaceId: reservation.workspaceId,
          creationId: reservation.creationId,
          creationVariantId: reservation.creationVariantId,
          creditReservationId: reservation.id,
          type: "COMMIT",
          amount: reservation.amount,
          idempotencyKey: `tx_commit_${reservation.id}`,
          balanceBefore: account.availableCredits,
          balanceAfter: account.availableCredits,
          reservedBefore: account.reservedCredits,
          reservedAfter: updatedAccount.reservedCredits,
          reasonCode: "COMMIT_DELIVERABLE_SUCCESS",
          createdBySystemComponent: "CreditEscrowService",
        },
      });

      return updatedReservation;
    };

    if (tx) return await execute(tx);
    return await prisma.$transaction(execute);
  }

  /**
   * Transactionally releases reserved credits when no final deliverable exists.
   */
  static async releaseCredits({ reservationId, reason = "JOB_FAILED", tx = null }) {
    const execute = async (db) => {
      const reservation = await db.creditReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation) return null;
      if (reservation.status === "RELEASED") return reservation;
      if (reservation.status === "COMMITTED") {
        throw new AppError(ERROR_CODES.CREDIT_RESERVATION_FAILED, "Cannot release already committed credits.");
      }

      const account = await db.creditAccount.findUnique({
        where: { workspaceId: reservation.workspaceId },
      });

      const updatedAccount = await db.creditAccount.update({
        where: { id: account.id },
        data: {
          availableCredits: account.availableCredits + reservation.amount,
          reservedCredits: Math.max(0, account.reservedCredits - reservation.amount),
          lifetimeReleasedCredits: { increment: reservation.amount },
          version: { increment: 1 },
        },
      });

      const updatedReservation = await db.creditReservation.update({
        where: { id: reservation.id },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
          releaseReason: reason,
        },
      });

      await db.creditTransaction.create({
        data: {
          workspaceId: reservation.workspaceId,
          creationId: reservation.creationId,
          creationVariantId: reservation.creationVariantId,
          creditReservationId: reservation.id,
          type: "RELEASE",
          amount: reservation.amount,
          idempotencyKey: `tx_release_${reservation.id}_${Date.now()}`,
          balanceBefore: account.availableCredits,
          balanceAfter: updatedAccount.availableCredits,
          reservedBefore: account.reservedCredits,
          reservedAfter: updatedAccount.reservedCredits,
          reasonCode: reason,
          createdBySystemComponent: "CreditEscrowService",
        },
      });

      return updatedReservation;
    };

    if (tx) return await execute(tx);
    return await prisma.$transaction(execute);
  }
}
