import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("v1 provider-key endpoint is a credential-free 410 tombstone", () => {
  const source = read("src/app/api/user/apikey/route.js");
  assert.match(source, /status:\s*410/);
  assert.match(source, /CUSTOMER_PROVIDER_KEYS_DISABLED/);
  assert.doesNotMatch(source, /process\.env|muapiConfigured|falConfigured|elevenLabsConfigured/);
});

test("v1 MCP endpoint is disabled for both customer methods", () => {
  const source = read("src/app/api/mcp/route.js");
  assert.match(source, /status:\s*404/);
  assert.match(source, /export const GET = disabled/);
  assert.match(source, /export const POST = disabled/);
  assert.doesNotMatch(source, /getMockSession|next-auth/);
});

test("legacy Stripe endpoints are tombstones and cannot accept client plan data", () => {
  for (const path of ["src/app/api/checkout/route.js", "src/app/api/checkout/stripe/route.js", "src/app/api/webhook/stripe/route.js"]) {
    const source = read(path);
    assert.match(source, /status:\s*410/);
    assert.doesNotMatch(source, /from\s+["']stripe|BillingService|checkout\.sessions\.create|req\.json/);
  }
});

test("admin diagnostics uses explicit first-party Supabase admin authorization and safe projection", () => {
  const source = read("src/app/api/admin/diagnostics/route.js");
  const authorization = read("src/lib/access/authorization.js");
  assert.match(source, /requireAdminUser\(\)/);
  assert.match(authorization, /isAdmin/);
  assert.match(authorization, /ADMIN_ACCESS_DENIED", 403/);
  assert.doesNotMatch(source, /process\.env\.(?:MUAPI|FAL|ELEVENLABS|SUPABASE|DATABASE|POLAR)|creditTransactions|compiledPrompt|idempotencyKey/);
});
