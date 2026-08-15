import { prisma } from "../prisma.js";

export class IdempotencyIntegrityConflict extends Error {
  constructor(message) { super(message); this.code = "IDEMPOTENCY_INTEGRITY_CONFLICT"; }
}

function matches(entry, operation) {
  return entry.workspaceId === operation.workspaceId
    && entry.userId === (operation.userId ?? null)
    && entry.amount === operation.amount
    && entry.reason === operation.reason
    && entry.sourceId === (operation.sourceId ?? null)
    && entry.idempotencyKey === operation.idempotencyKey;
}

function isUniqueViolation(error, field) {
  const target = error?.meta?.target;
  return error?.code === "P2002" && (!field || JSON.stringify(target || "").includes(field));
}

export async function grantCreditsIdempotently(operation, db = prisma) {
  const existing = await db.creditLedgerEntry.findUnique({ where: { idempotencyKey: operation.idempotencyKey } });
  if (existing) {
    if (!matches(existing, operation)) throw new IdempotencyIntegrityConflict("Existing ledger operation differs from requested grant");
    return { status: "ALREADY_PROCESSED", entry: existing };
  }
  try {
    const executeTx = typeof db.$transaction === "function" ? (fn) => db.$transaction(fn) : (fn) => fn(db);
    const entry = await executeTx(async (tx) => {
      const created = await tx.creditLedgerEntry.create({ data: operation });
      await tx.creditAccount.update({ where: { workspaceId: operation.workspaceId }, data: {
        availableCredits: { increment: operation.amount },
        lifetimeIssuedCredits: { increment: operation.amount },
      } });
      return created;
    });
    return { status: "PROCESSED", entry };
  } catch (error) {
    // The Prisma adapter does not consistently expose the Postgres index name.
    // A P2002 is never accepted blindly: the durable operation below must match
    // every financial identity field before this becomes a benign duplicate.
    if (!isUniqueViolation(error)) throw error;
    const winner = await db.creditLedgerEntry.findUnique({ where: { idempotencyKey: operation.idempotencyKey } });
    if (!winner || !matches(winner, operation)) throw new IdempotencyIntegrityConflict("Ledger idempotency key conflicts with a different operation");
    return { status: "ALREADY_PROCESSED", entry: winner };
  }
}

export { isUniqueViolation };
