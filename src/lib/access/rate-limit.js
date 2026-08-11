import crypto from "crypto";
import { prisma } from "@/lib/prisma";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
export async function enforceRateLimit({ scope, subject, limit, windowMs }) { const now = new Date(); const windowStartsAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs); const row = await prisma.authRateLimit.upsert({ where: { scope_subjectHash_windowStartsAt: { scope, subjectHash: hash(subject), windowStartsAt } }, update: { attempts: { increment: 1 } }, create: { scope, subjectHash: hash(subject), windowStartsAt, attempts: 1 } }); if (row.attempts > limit) { const error = new Error("RATE_LIMITED"); error.status = 429; throw error; } }
