#!/usr/bin/env node

/**
 * SAFETY GATE FOR DESTRUCTIVE REMOTE INTEGRATION TESTS.
 *
 * The ledger integration suite intentionally TRUNCATEs User, Workspace,
 * CreditAccount, Entitlement, billing and ledger tables. That is correct for a
 * disposable test database and catastrophic for the live app.
 *
 * This script is deliberately dependency-free and prints no secret values, URLs,
 * hostnames, usernames or project refs. It verifies all three connection paths
 * resolve to the same non-production Supabase project and rejects the known
 * Doolphin production project ref before migrations or the test process begin.
 *
 * Defence in depth:
 *   1. Required names must be non-empty.
 *   2. Supabase API URL must be HTTPS and parse to <ref>.supabase.co.
 *   3. Direct DB URL ref (db.<ref>.supabase.co) and pooled DB URL ref (normally
 *      postgres.<ref> embedded in the username) must agree with the API URL.
 *   4. Any occurrence of the known production ref in ANY connection value fails.
 *   5. Destructive mode additionally requires the exact handwritten confirmation
 *      RESET_DOOLPHIN_STAGING, supplied only by manual workflow dispatch.
 *
 * Update PRODUCTION_PROJECT_REF only through reviewed source when production is
 * deliberately recreated. Never remove the denylist simply because a test needs
 * to pass.
 */

const PRODUCTION_PROJECT_REF = "ezhopjyooxjnqdfjfuty";
const REQUIRED = [
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_PUBLISHABLE_KEY",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
  "TEST_DATABASE_URL",
  "TEST_DIRECT_URL",
];

function fail(code) {
  // Fixed codes only: logs are viewable by repository collaborators, while
  // connection strings contain database passwords.
  console.error(`STAGING_TARGET_REJECTED: ${code}`);
  process.exit(1);
}

function parseUrl(name) {
  const value = process.env[name];
  if (!value) fail(`MISSING_${name}`);
  try {
    return new URL(value);
  } catch {
    fail(`INVALID_${name}`);
  }
}

function apiProjectRef(url) {
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
    fail("INVALID_TEST_SUPABASE_URL_HOST");
  }
  const ref = url.hostname.slice(0, -".supabase.co".length);
  if (!/^[a-z0-9]{20}$/i.test(ref)) fail("INVALID_TEST_SUPABASE_PROJECT_REF");
  return ref;
}

function databaseProjectRef(url, kind) {
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail(`INVALID_${kind}_PROTOCOL`);

  // Direct connection: db.<project-ref>.supabase.co:5432
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (direct) return direct[1];

  // Supabase pooler: the project ref appears in the database username as
  // postgres.<project-ref>. The host itself is shared by many projects, so it
  // cannot identify the target safely.
  try {
    const pooled = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(url.username));
    if (pooled && url.hostname.endsWith(".pooler.supabase.com")) return pooled[1];
  } catch {
    fail(`INVALID_${kind}_USERNAME`);
  }

  fail(`UNRECOGNISED_${kind}_TARGET`);
}

for (const name of REQUIRED) {
  if (!process.env[name]) fail(`MISSING_${name}`);
}

// Reject by full-string search before parsing. This catches a production ref in
// a URL path, username, password-escaped payload or malformed fallback string.
for (const name of ["TEST_SUPABASE_URL", "TEST_DATABASE_URL", "TEST_DIRECT_URL"]) {
  if (process.env[name].includes(PRODUCTION_PROJECT_REF)) fail("PRODUCTION_PROJECT_REF_DETECTED");
}

const apiRef = apiProjectRef(parseUrl("TEST_SUPABASE_URL"));
const databaseRef = databaseProjectRef(parseUrl("TEST_DATABASE_URL"), "TEST_DATABASE_URL");
const directRef = databaseProjectRef(parseUrl("TEST_DIRECT_URL"), "TEST_DIRECT_URL");

if (apiRef === PRODUCTION_PROJECT_REF || databaseRef === PRODUCTION_PROJECT_REF || directRef === PRODUCTION_PROJECT_REF) {
  fail("PRODUCTION_PROJECT_REF_DETECTED");
}
if (new Set([apiRef, databaseRef, directRef]).size !== 1) {
  fail("CONNECTIONS_TARGET_DIFFERENT_PROJECTS");
}

if (process.argv.includes("--require-destructive-confirmation")) {
  if (process.env.DOOLPHIN_DESTRUCTIVE_STAGING_CONFIRMATION !== "RESET_DOOLPHIN_STAGING") {
    fail("DESTRUCTIVE_CONFIRMATION_REQUIRED");
  }
}

console.log("STAGING_TARGET_VERIFIED: disposable non-production Supabase target confirmed");
