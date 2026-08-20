import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// /admin renders customer emails, credit balances and provider state. It shipped
// with no access check at all. These are source-level guards: they assert the
// gate is present so a future refactor cannot silently remove it, and they run
// with zero dependencies (no DB, no Supabase), so they always execute in CI.

const adminPage = fs.readFileSync(new URL("../src/app/admin/page.js", import.meta.url), "utf8");
const proxy = fs.readFileSync(new URL("../src/proxy.js", import.meta.url), "utf8");

test("the admin page authorises with requireAdminUser before any data query", () => {
  assert.match(adminPage, /requireAdminUser/, "admin page must call requireAdminUser");
  const gateAt = adminPage.indexOf("requireAdminUser(");
  const firstQueryAt = adminPage.search(/prisma\.\w+\.find/);
  assert.ok(gateAt > -1 && firstQueryAt > -1, "expected both a gate and a query");
  assert.ok(gateAt < firstQueryAt, "the isAdmin gate must run before any customer data is read");
});

test("a non-admin gets a 404 and an anonymous visitor is sent to sign in", () => {
  assert.match(adminPage, /notFound\(\)/, "a non-admin must 404, not see the console");
  assert.match(adminPage, /redirect\("\/sign-in\?next=\/admin"\)/, "an unauthenticated visitor is sent to sign in");
});

test("the edge proxy matches /admin and turns away anonymous traffic", () => {
  assert.match(proxy, /"\/admin\/:path\*"/, "proxy matcher must include /admin");
  assert.match(proxy, /startsWith\("\/admin"\)/, "proxy must recognise the /admin area");
});
