import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const globalForPrisma = globalThis;

let rawPrisma;

if (globalForPrisma.prisma) {
  rawPrisma = globalForPrisma.prisma;
} else {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres";
  
  if (dbUrl.startsWith("postgres") || dbUrl.startsWith("postgresql")) {
    try {
      const require = createRequire(import.meta.url);
      const { PrismaPg } = require("@prisma/adapter-pg");
      const { Pool } = require("pg");
      const pool = new Pool({ connectionString: process.env.DIRECT_URL || dbUrl });
      const adapter = new PrismaPg(pool);
      rawPrisma = new PrismaClient({ adapter });
    } catch {
      rawPrisma = new PrismaClient();
    }
  } else {
    rawPrisma = new PrismaClient();
  }

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = rawPrisma;
  }
}

// Allowed Creation fields set to prevent Unknown argument errors
const CREATION_ALLOWED_FIELDS = new Set([
  "id", "workspaceId", "userId", "generationType", "presetId", "workflowVersion",
  "title", "spokenScript", "prompt", "compiledPrompt", "additionalInstructions",
  "ctaText", "numberOfVideos", "status", "currentStage", "stageIndex", "totalStages",
  "progressType", "progressValue", "quoteId", "idempotencyKey", "timeoutAt",
  "cancelledAt", "completedAt", "errorCode", "safeError", "version", "appVersion",
  "gitCommitSha", "deploymentId", "createdAt", "updatedAt", "modelId", "provider",
  "requestId", "providerJobId", "statusUrl", "responseUrl", "attemptId", "aspectRatio", "resolution", "duration",
  "mode", "inputImages", "reservedCredits", "url", "error", "stage", "productInterpretation",
  "avatarImageUrl", "useAvatar"
]);

function sanitizeDataPayload(data) {
  if (!data || typeof data !== "object") return data;
  const clean = {};
  for (const [key, val] of Object.entries(data)) {
    if (key === "stage" && !clean.currentStage) {
      clean.currentStage = val;
    }
    if (CREATION_ALLOWED_FIELDS.has(key)) {
      clean[key] = val;
    } else {
      console.warn(`[PRISMA_DRIVER_PROXY] Stripping unknown field '${key}' from creation query.`);
    }
  }
  return clean;
}

const creationProxy = new Proxy(rawPrisma.creation, {
  get(target, propKey) {
    const origMethod = target[propKey];
    if (typeof origMethod === "function") {
      if (propKey === "create" || propKey === "createMany") {
        return function (args) {
          if (args && args.data) {
            args = { ...args, data: Array.isArray(args.data) ? args.data.map(sanitizeDataPayload) : sanitizeDataPayload(args.data) };
          }
          return origMethod.call(target, args);
        };
      }
      if (propKey === "update" || propKey === "updateMany" || propKey === "upsert") {
        return function (args) {
          if (args && args.data) {
            args = { ...args, data: sanitizeDataPayload(args.data) };
          }
          return origMethod.call(target, args);
        };
      }
    }
    return Reflect.get(target, propKey);
  }
});

export const prisma = new Proxy(rawPrisma, {
  get(target, propKey) {
    if (propKey === "creation") {
      return creationProxy;
    }
    return Reflect.get(target, propKey);
  }
});

export default prisma;
