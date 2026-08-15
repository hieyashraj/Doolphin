import { prisma } from "../prisma.js";
import { grantCreditsIdempotently } from "./ledger.js";

export function annualPeriods(startsAt) {
  const start = new Date(startsAt);
  return Array.from({ length: 12 }, (_, periodIndex) => {
    const dueAt = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + periodIndex,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds()
    ));
    return { periodIndex, periodStartsAt: dueAt, dueAt };
  });
}

function grantReason(code) {
  if (code.startsWith("STARTER")) return "STARTER_MONTHLY_GRANT";
  if (code.startsWith("GROWTH")) return "GROWTH_MONTHLY_GRANT";
  return "AGENCY_MONTHLY_GRANT";
}

export async function materializeAnnualGrantSchedule(entitlement, credits, db = prisma) {
  const periods = annualPeriods(entitlement.startsAt);
  const now = new Date();

  // Create or update all 12 periods
  const schedules = await Promise.all(
    periods.map(({ periodIndex, periodStartsAt, dueAt }) => {
      const isPeriodZero = periodIndex === 0;
      const idempotencyKey = `annual-grant:${entitlement.id}:${periodIndex}`;

      return db.creditGrantSchedule.upsert({
        where: { entitlementId_periodIndex: { entitlementId: entitlement.id, periodIndex } },
        update: {},
        create: {
          entitlementId: entitlement.id,
          workspaceId: entitlement.workspaceId,
          userId: entitlement.userId,
          periodIndex,
          periodStartsAt,
          dueAt,
          credits,
          status: isPeriodZero ? "GRANTED" : "PENDING",
          grantedAt: isPeriodZero ? now : null,
          idempotencyKey,
        },
      });
    })
  );

  // Immediately issue Month 0 credit grant synchronously
  const p0Key = `annual-grant:${entitlement.id}:0`;
  await grantCreditsIdempotently(
    {
      workspaceId: entitlement.workspaceId,
      userId: entitlement.userId,
      amount: credits,
      reason: grantReason(entitlement.planCode),
      sourceId: entitlement.id,
      idempotencyKey: p0Key,
    },
    db
  );

  return schedules;
}

export async function processDueGrantSchedules(now = new Date(), db = prisma) {
  const due = await db.creditGrantSchedule.findMany({
    where: { status: "PENDING", dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
  });

  for (const schedule of due) {
    const entitlement = await db.entitlement.findUnique({ where: { id: schedule.entitlementId } });
    if (!entitlement || entitlement.grantsStoppedAt || entitlement.endsAt <= now) {
      await db.creditGrantSchedule.updateMany({
        where: { id: schedule.id, status: "PENDING" },
        data: { status: "STOPPED", stoppedAt: now },
      });
      continue;
    }

    await grantCreditsIdempotently(
      {
        workspaceId: schedule.workspaceId,
        userId: schedule.userId,
        amount: schedule.credits,
        reason: grantReason(entitlement.planCode),
        sourceId: schedule.id,
        idempotencyKey: schedule.idempotencyKey,
      },
      db
    );

    await db.creditGrantSchedule.updateMany({
      where: { id: schedule.id, status: "PENDING" },
      data: { status: "GRANTED", grantedAt: now },
    });
  }

  return due.length;
}
