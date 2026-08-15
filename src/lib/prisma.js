import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    const req = createRequire(import.meta.url);
    const { PrismaPg } = req("@prisma/adapter-pg");
    const { Pool } = req("pg");
    const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 1 });
    return new PrismaClient({ adapter: new PrismaPg(pool), log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  }
  return new PrismaClient();
}

export const prisma = globalForPrisma.__doolphinPrisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__doolphinPrisma = prisma;

export default prisma;
