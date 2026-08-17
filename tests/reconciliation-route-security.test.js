import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");

test("reconciliation supports both GET (Vercel Cron) and POST (manual/staging), and is gated by a bearer secret rather than environment name", () => {
  // Vercel's native Cron Jobs feature issues GET requests, so GET must reach
  // the same authorized/protected logic as POST — a hard-coded environment
  // gate here previously made reconciliation permanently unreachable in
  // production regardless of how it was invoked. Authorization is by secret
  // bearer token only; a valid CRON_SECRET works identically in every
  // environment, and getMuapiApiKey() below resolves the correct
  // sandbox-vs-production credential for whichever environment is actually
  // running, so this is not an environment-safety regression.
  assert.match(source, /export async function GET\(req\)\s*\{\s*return runReconciliation\(req\);\s*\}/);
  assert.match(source, /export async function POST\(req\)\s*\{\s*return runReconciliation\(req\);\s*\}/);
  assert.doesNotMatch(source, /isStagingEnvironment/);
  assert.match(source, /if \(!authorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(source, /function authorized\(req\) \{\s*const expected = process\.env\.CRON_SECRET;/);
  assert.match(source, /getMuapiApiKey\(\)/);
  assert.doesNotMatch(source, /UGC_API_KEY/);
});

test("a no-op reconciliation does not construct a callback URL or require its filter secret", () => {
  const callbackConstruction = source.indexOf("const webhookUrl = activeJobs.some((job) => !getImageModel(job.internalModelId)) ? buildMuapiWebhookUrl(baseUrl) : null;");
  const activeQuery = source.indexOf("const activeJobs = await prisma.providerJob.findMany");
  assert.ok(activeQuery >= 0 && callbackConstruction > activeQuery);
});
