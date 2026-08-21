#!/usr/bin/env node
/**
 * Seeds the BlockedEmailDomain table from the in-app curated disposable list, so
 * the Supabase "Before User Created" hook (doolphin_before_user_created) rejects
 * the same domains at the database layer — matching what the signup route already
 * enforces in-app.
 *
 * Idempotent: re-running only inserts missing domains.
 *
 * Usage (points at whatever DATABASE_URL/DIRECT_URL is set):
 *   node scripts/seed-blocked-email-domains.mjs
 */
import { PrismaClient } from "@prisma/client";
import { DISPOSABLE_EMAIL_DOMAINS } from "../src/lib/access/disposable-email.js";

const prisma = new PrismaClient();

async function main() {
  const domains = [...DISPOSABLE_EMAIL_DOMAINS].filter((d) => d !== "tempmail.local"); // sentinel is app/test only
  let created = 0;
  for (const domain of domains) {
    const result = await prisma.blockedEmailDomain.upsert({
      where: { domain },
      update: {},
      create: { domain, reason: "Disposable/temporary email provider", source: "curated-seed", isActive: true },
    });
    if (result) created += 1;
  }
  const total = await prisma.blockedEmailDomain.count();
  console.log(`Seeded ${domains.length} curated disposable domains. BlockedEmailDomain now has ${total} rows.`);
}

main()
  .catch((error) => { console.error("Seed failed:", error.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
