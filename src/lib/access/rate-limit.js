import crypto from "crypto";

// Prisma is imported lazily so this module is unit-testable with an injected db.
async function defaultDb() {
  const { prisma } = await import("../prisma.js");
  return prisma;
}

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * Fixed-window rate limiter backed by AuthRateLimit. Throws a 429 once `limit`
 * is exceeded within the current `windowMs` bucket. The subject is hashed so no
 * raw email / IP is ever stored.
 */
export async function enforceRateLimit({ scope, subject, limit, windowMs }, db = null) {
  const client = db || (await defaultDb());
  const now = new Date();
  const windowStartsAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const row = await client.authRateLimit.upsert({
    where: { scope_subjectHash_windowStartsAt: { scope, subjectHash: hash(subject), windowStartsAt } },
    update: { attempts: { increment: 1 } },
    create: { scope, subjectHash: hash(subject), windowStartsAt, attempts: 1 },
  });
  if (row.attempts > limit) {
    const error = new Error("RATE_LIMITED");
    error.status = 429;
    throw error;
  }
}
