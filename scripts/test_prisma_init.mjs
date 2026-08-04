import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import path from "path";

try {
  const dbPath = path.resolve(process.cwd(), "dev.db");
  const url = `file:${dbPath}`;
  
  const adapter = new PrismaLibSql({ url });
  const prisma = new PrismaClient({ adapter });

  console.log("Testing user query with PrismaLibSql({ url })...");
  const user = await prisma.user.findFirst();
  console.log("SUCCESS! User query returned:", user?.id || "No user found (table empty or ready)");
} catch (err) {
  console.error("Prisma LibSql test error:", err);
}
