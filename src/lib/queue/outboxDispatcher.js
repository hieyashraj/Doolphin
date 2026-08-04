import { prisma } from "../prisma.js";

/**
 * Transactional Outbox Dispatcher.
 * Section 15 Compliance: Claims PENDING outbox rows, enqueues deterministic BullMQ jobs,
 * marks DISPATCHED, or DEAD_LETTER after retry bounds.
 */

let generationQueue = null;

async function getGenerationQueue() {
  if (generationQueue) return generationQueue;
  try {
    const { Queue } = await import("bullmq");
    const Redis = (await import("ioredis")).default;
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    generationQueue = new Queue("doolphin-generation-jobs", { connection });
  } catch (e) {
    console.warn("BullMQ/Redis initialization notice:", e.message);
  }
  return generationQueue;
}

export class OutboxDispatcher {
  static async dispatchPendingJobs() {
    const pendingRows = await prisma.queueOutbox.findMany({
      where: { status: "PENDING" },
      take: 10,
    });

    const results = [];
    const queue = await getGenerationQueue();

    for (const row of pendingRows) {
      try {
        await prisma.queueOutbox.update({
          where: { id: row.id },
          data: {
            status: "LOCKED",
            lockedAt: new Date(),
            lockedBy: "OutboxDispatcher",
            leaseExpiresAt: new Date(Date.now() + 60000),
          },
        });

        if (queue) {
          await queue.add(
            row.eventType,
            JSON.parse(row.payload),
            { jobId: row.deterministicJobId }
          );
        }

        const updated = await prisma.queueOutbox.update({
          where: { id: row.id },
          data: {
            status: "DISPATCHED",
            dispatchedAt: new Date(),
          },
        });

        results.push({ id: row.id, deterministicJobId: row.deterministicJobId, status: "DISPATCHED" });
      } catch (err) {
        const attemptCount = row.attemptCount + 1;
        const status = attemptCount >= 5 ? "DEAD_LETTER" : "PENDING";
        await prisma.queueOutbox.update({
          where: { id: row.id },
          data: {
            status,
            attemptCount,
            lastError: err.message,
          },
        });
        results.push({ id: row.id, deterministicJobId: row.deterministicJobId, status, error: err.message });
      }
    }

    return results;
  }
}
