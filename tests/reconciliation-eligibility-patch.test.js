import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const canonical = fs.readFileSync(new URL("../prisma/canonical_migrations/20260813_reconciliation_engine_cutover/migration.sql", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../prisma/legacy_staging_patches/20260813_reconciliation_engine_cutover.sql", import.meta.url), "utf8");

for (const [name, sql] of [["canonical", canonical], ["legacy compatibility", legacy]]) {
  test(`${name} cutover SQL is additive and preserves historical NULL eligibility`, () => {
    const executableSql = sql.replace(/^--.*$/gm, "");
    assert.match(sql, /ADD COLUMN "reconciliationEngineRevision" TEXT/);
    assert.match(sql, /CREATE INDEX "CreationVariant_reconciliationEngineRevision_status_timeout_idx"/);
    assert.doesNotMatch(executableSql, /DEFAULT\s+/i);
    assert.doesNotMatch(executableSql, /\bUPDATE\b|\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
}

test("legacy compatibility patch is explicitly transactional", () => {
  assert.match(legacy, /^BEGIN;/m);
  assert.match(legacy, /COMMIT;\s*$/m);
});
