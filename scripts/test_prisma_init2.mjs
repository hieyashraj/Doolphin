import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

try {
  const dbUrl = "file:./dev.db";
  const libsql = createClient({ url: dbUrl });
  const adapter = new PrismaLibSql(libsql);
  const prisma = new PrismaClient({ adapter });
  await prisma.user.findFirst();
  console.log("Success");
} catch (e) {
  console.error(e);
}
