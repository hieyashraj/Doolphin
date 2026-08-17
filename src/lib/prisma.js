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

// IMPORTANT: this module is imported by ~half of the app's API routes, and
// Next.js's build-time "Collecting page data" step actually executes every
// route module to determine static vs. dynamic behavior. If client
// construction (including DATABASE_URL validation) happened eagerly at
// import time, a missing/misconfigured DATABASE_URL would crash the BUILD
// itself for every route that imports this file, not just fail cleanly at
// request time for the routes that need it. The real client is built lazily,
// on first property access, via a Proxy — so importing this module is always
// safe, and only code that actually touches `prisma.<something>` at request
// time can throw the "DATABASE_URL is required" error, with a normal 500
// response instead of a broken deployment.
let lazyClient;
function getPrismaClient() {
  // Preserve the original caching contract exactly: reuse a cached client if
  // one already exists (dev hot-reload survivability), and only persist to
  // globalThis outside production, matching prior behavior bit-for-bit.
  if (globalForPrisma.__doolphinPrisma) return globalForPrisma.__doolphinPrisma;
  if (lazyClient) return lazyClient;
  lazyClient = createPrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.__doolphinPrisma = lazyClient;
  return lazyClient;
}

export const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getPrismaClient();
      const value = client[prop];
      // Prisma Client methods (e.g. $transaction, $queryRaw, model delegates)
      // are class members that read internal client state via `this`.
      // Returning them unbound would call them with `this` set to this
      // Proxy (an empty object) instead of the real client whenever a
      // caller does `prisma.$transaction(...)`, silently breaking every
      // call site. Binding to the real client preserves exact prior
      // behavior for every consumer in the app.
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);

export default prisma;
