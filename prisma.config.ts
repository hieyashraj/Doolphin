import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    // The earlier incremental chain predates the recoverable canonical
    // baseline.  It is intentionally inactive; new environments replay only
    // the verified clean chain below.
    path: "prisma/canonical_migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"] || "file:dev.db",
  },
});
