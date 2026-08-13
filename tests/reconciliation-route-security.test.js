import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/app/api/internal/reconcile/route.js", import.meta.url), "utf8");

test("reconciliation rejects GET and is server-gated to staging before mutation", () => {
  assert.match(source, /export async function GET\(\)\s*\{\s*return NextResponse\.json\(\{ error: "Method not allowed" \}, \{ status: 405/);
  assert.match(source, /export async function POST\(req\)/);
  assert.match(source, /if \(!isStagingEnvironment\(\)\) return NextResponse\.json\(\{ error: "Unavailable" \}, \{ status: 404 \}\)/);
  assert.match(source, /if \(!authorized\(req\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(source, /if \(!process\.env\.MUAPI_API_KEY\) return NextResponse\.json\(\{ error: "Sandbox provider credential required" \}, \{ status: 503 \}\)/);
  assert.doesNotMatch(source, /UGC_API_KEY/);
});

test("a no-op reconciliation does not construct a callback URL or require its filter secret", () => {
  const callbackConstruction = source.indexOf("const webhookUrl = activeJobs.some((job) => !getImageModel(job.internalModelId)) ? buildMuapiWebhookUrl(baseUrl) : null;");
  const activeQuery = source.indexOf("const activeJobs = await prisma.providerJob.findMany");
  assert.ok(activeQuery >= 0 && callbackConstruction > activeQuery);
});
