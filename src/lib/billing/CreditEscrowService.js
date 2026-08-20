import { prisma } from "../prisma.js";
import { AppError, ERROR_CODES } from "../errors.js";

/**
 * CreditEscrowService: Handles internal credit reservations, commits, releases,
 * and workspace credit balance management.
 * Section 5.4, 5.5, 5.6, 21 Compliance.
 */

export class CreditEscrowService {
  static async assertLegacyMutationAllowed(workspaceId, db = prisma) {
    const cutover = await db.ledgerCutover?.findUnique({ where: { workspaceId } });
    if (cutover && ["FROZEN", "BLOCKED"].includes(cutover.status)) throw new AppError(ERROR_CODES.CREDIT_RESERVATION_FAILED, "Credit balances are temporarily reconciling; no charge was made.", { statusCode: 503 });
  }

  static async releaseVariantReservations(creationVariantId, reason, tx = null) {
    const db = tx || prisma;
    const reservations = await db.creditReservation.findMany({ where: { creationVariantId } });
    return Promise.all(reservations.map((reservation) => this.releaseCredits({ reservationId: reservation.id, reason, tx: db })));
  }

  static async settleVerifiedVariant(creationVariantId, passed, tx = null) {
    const db = tx || prisma;
    const reservations = await db.creditReservation.findMany({ where: { creationVariantId } });
    for (const reservation of reservations) {
      if (passed) await this.commitCredits({ reservationId: reservation.id, tx: db });
      else await this.releaseCredits({ reservationId: reservation.id, reason: "NO_DELIVERABLE", tx: db });
    }
  }

  static async chargeImmediate({ workspaceId, amount, idempotencyKey, userId, reasonCode }) {
    return prisma.$transaction(async (tx) => {
      await this.assertLegacyMutationAllowed(workspaceId, tx);
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const account = await tx.creditAccount.findUnique({ where: { workspaceId } });
      if (!account || account.availableCredits < amount) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_CREDITS, `Insufficient available credits (${account?.availableCredits || 0} available, ${amount} required).`, { statusCode: 402 });
      }
      const claimed = await tx.creditAccount.updateMany({ where: { id: account.id, version: account.version, availableCredits: { gte: amount } }, data: { availableCredits: { decrement: amount }, lifetimeCommittedCredits: { increment: amount }, version: { increment: 1 } } });
      if (claimed.count !== 1) throw new AppError(ERROR_CODES.CREDIT_RESERVATION_FAILED, "Credit balance changed concurrently; retry the request", { statusCode: 409 });
      const updated = await tx.creditAccount.findUnique({ where: { id: account.id } });
      return tx.creditTransaction.create({ data: { workspaceId, type: "COMMIT", amount, idempotencyKey, balanceBefore: account.availableCredits, balanceAfter: updated.availableCredits, reservedBefore: account.reservedCredits, reservedAfter: account.reservedCredits, reasonCode, createdByUserId: userId, createdBySystemComponent: "CreditEscrowService" } });
    });
  }

  static async refundImmediate({ workspaceId, amount, idempotencyKey, userId, reasonCode }) {
    return prisma.$transaction(async (tx) => {
      await this.assertLegacyMutationAllowed(workspaceId, tx);
      const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const account = await tx.creditAccount.findUnique({ where: { workspaceId } });
      const updated = await tx.creditAccount.update({ where: { id: account.id }, data: { availableCredits: account.availableCredits + amount, version: { increment: 1 } } });
      return tx.creditTransaction.create({ data: { workspaceId, type: "REFUND", amount, idempotencyKey, balanceBefore: account.availableCredits, balanceAfter: updated.availableCredits, reservedBefore: account.reservedCredits, reservedAfter: account.reservedCredits, reasonCode, createdByUserId: userId, createdBySystemComponent: "CreditEscrowService" } });
    });
  }

  static async ensureUserWorkspace(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, "Authenticated user record not found");

    if (user.defaultWorkspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: user.defaultWorkspaceId },
        include: { creditAccount: true },
      });
      if (workspace) return workspace;
    }

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

      // A new workspace starts with ZERO spendable credits. Credits are only
      // ever created by a purchase or a plan grant, so revenue is always booked
      // before generation capacity exists — the app cannot give away paid work.
      // This previously seeded 100 free credits (~$2.50 of generation under the
      // v3 unit) on every workspace, which contradicted the "no free tier" model
      // and eroded margin on every account. The schema column default is
      // irrelevant here because these values are always set explicitly.
      const creditAccount = await tx.creditAccount.create({
        data: {
          workspaceId: workspace.id,
          availableCredits: 0,
          reservedCredits: 0,
          lifetimeIssuedCredits: 0,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { defaultWorkspaceId: workspace.id },
      });

      return { ...workspace, creditAccount };
    });
  }

  static async reserveCredits({ workspaceId, creationId, creationVariantId, amount, idempotencyKey, userId, tx = null }) {
    const execute = async (db) => {
      await this.assertLegacyMutationAllowed(workspaceId, db);
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

      const claimed = await db.creditAccount.updateMany({
        where: { id: account.id, version: account.version, availableCredits: { gte: amount } },
        data: {
          availableCredits: { decrement: amount },
          reservedCredits: { increment: amount },
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new AppError(ERROR_CODES.CREDIT_RESERVATION_FAILED, "Credit balance changed concurrently; retry preflight", { statusCode: 409 });
      const updatedAccount = await db.creditAccount.findUnique({ where: { id: account.id } });

      const reservation = await db.creditReservation.create({
        data: {
          workspaceId,
          creationId,
          creationVariantId,
          amount,
          committedAmount: 0,
          releasedAmount: 0,
          status: "RESERVED",
          idempotencyKey,
        },
      });

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
          committedAmount: reservation.amount,
          releasedAmount: 0,
          status: "COMMITTED",
          committedAt: new Date(),
          settledAt: new Date(),
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
          committedAmount: 0,
          releasedAmount: reservation.amount,
          status: "RELEASED",
          releasedAt: new Date(),
          settledAt: new Date(),
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
          idempotencyKey: `tx_release_${reservation.id}`,
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

  /**
   * Phase 4D.1: Atomic split settlement primitive.
   */
  static async settleReservationSplit({
    reservationId,
    commitAmount,
    releaseAmount,
    reason = "WORKFLOW_SPLIT_SETTLEMENT",
    tx = null,
  }) {
    const execute = async (db) => {
      const reservation = await db.creditReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation) throw new AppError(ERROR_CODES.NOT_FOUND, "Credit reservation not found");
      if (reservation.settledAt || ["COMMITTED", "RELEASED", "PARTIALLY_SETTLED"].includes(reservation.status)) {
        return reservation;
      }

      if (commitAmount + releaseAmount !== reservation.amount) {
        throw new AppError(
          ERROR_CODES.CREDIT_RESERVATION_FAILED,
          `Commit amount (${commitAmount}) + release amount (${releaseAmount}) must equal reservation amount (${reservation.amount}).`
        );
      }

      const account = await db.creditAccount.findUnique({
        where: { workspaceId: reservation.workspaceId },
      });
      if (!account) throw new AppError(ERROR_CODES.NOT_FOUND, "Credit account not found");

      const updatedAccount = await db.creditAccount.update({
        where: { id: account.id },
        data: {
          reservedCredits: Math.max(0, account.reservedCredits - reservation.amount),
          availableCredits: account.availableCredits + releaseAmount,
          lifetimeCommittedCredits: { increment: commitAmount },
          lifetimeReleasedCredits: { increment: releaseAmount },
          version: { increment: 1 },
        },
      });

      const targetStatus =
        commitAmount > 0 && releaseAmount > 0
          ? "PARTIALLY_SETTLED"
          : commitAmount > 0
          ? "COMMITTED"
          : "RELEASED";

      const updatedReservation = await db.creditReservation.update({
        where: { id: reservation.id },
        data: {
          committedAmount: commitAmount,
          releasedAmount: releaseAmount,
          status: targetStatus,
          committedAt: commitAmount > 0 ? new Date() : null,
          releasedAt: releaseAmount > 0 ? new Date() : null,
          settledAt: new Date(),
          releaseReason: reason,
        },
      });

      if (commitAmount > 0) {
        await db.creditTransaction.create({
          data: {
            workspaceId: reservation.workspaceId,
            creationId: reservation.creationId,
            creationVariantId: reservation.creationVariantId,
            creditReservationId: reservation.id,
            type: "COMMIT",
            amount: commitAmount,
            idempotencyKey: `tx_commit_split_${reservation.id}`,
            balanceBefore: account.availableCredits,
            balanceAfter: updatedAccount.availableCredits,
            reservedBefore: account.reservedCredits,
            reservedAfter: updatedAccount.reservedCredits,
            reasonCode: reason,
            createdBySystemComponent: "CreditEscrowService",
          },
        });
      }

      if (releaseAmount > 0) {
        await db.creditTransaction.create({
          data: {
            workspaceId: reservation.workspaceId,
            creationId: reservation.creationId,
            creationVariantId: reservation.creationVariantId,
            creditReservationId: reservation.id,
            type: "RELEASE",
            amount: releaseAmount,
            idempotencyKey: `tx_release_split_${reservation.id}`,
            balanceBefore: account.availableCredits,
            balanceAfter: updatedAccount.availableCredits,
            reservedBefore: account.reservedCredits,
            reservedAfter: updatedAccount.reservedCredits,
            reasonCode: reason,
            createdBySystemComponent: "CreditEscrowService",
          },
        });
      }

      return updatedReservation;
    };

    if (tx) return await execute(tx);
    return await prisma.$transaction(execute);
  }
}
