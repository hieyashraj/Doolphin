import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis;

let prismaInstance;

if (globalForPrisma.prisma) {
  prismaInstance = globalForPrisma.prisma;
} else {
  const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/doolphin";
  const pool = new pg.Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  
  try {
    prismaInstance = new PrismaClient({ adapter });
  } catch (e) {
    console.warn("PrismaClient initialization fallback warning:", e.message);
    prismaInstance = new PrismaClient({ adapter });
  }

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prismaInstance;
  }
}

export const prisma = prismaInstance;
export default prisma;
