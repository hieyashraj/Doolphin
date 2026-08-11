import crypto from "crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getMockSession as getRequestSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { R2StorageService } from "@/lib/storage/r2StorageService";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

const ANALYZER_ENDPOINT = "https://api.muapi.ai/api/v1/gemini-2-5-flash";
const RESULT_ENDPOINT = "https://api.muapi.ai/api/v1/predictions";
const ANALYSIS_REVISION = "gemini-2.5-flash.asset-v1";
const analysisSchema = z.object({
  identity: z.string().trim().min(1).max(200),
  suggestedName: z.string().trim().min(1).max(100),
  visibleText: z.array(z.string().max(500)).max(100),
  deviceType: z.enum(["mobile", "tablet", "desktop", "browser", "mixed", "none", "unknown"]),
  productViewType: z.enum(["front", "back", "packaging", "detail", "usage", "none", "unknown"]),
  peoplePresent: z.number().int().min(0).max(100),
  lighting: z.string().max(300),
  framing: z.string().max(300),
  cameraAngle: z.string().max(300),
  environment: z.string().max(300),
  colors: z.array(z.string().max(100)).max(30),
  pacingCues: z.array(z.string().max(200)).max(30),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(500)).max(30),
});

const ANALYSIS_PROMPT = `Analyze this single UGC video input asset. Return only valid JSON with this exact shape:
{"identity":"short subject/product/app identity","suggestedName":"human-readable alias","visibleText":["OCR text"],"deviceType":"mobile|tablet|desktop|browser|mixed|none|unknown","productViewType":"front|back|packaging|detail|usage|none|unknown","peoplePresent":0,"lighting":"short","framing":"short","cameraAngle":"short","environment":"short","colors":["short"],"pacingCues":["short"],"confidence":0.0,"warnings":["short"]}
Do not invent unreadable text. peoplePresent must be an integer and confidence must be from 0 to 1.`;

function parseAnalysisOutput(payload) {
  const candidates = [payload?.outputs, payload?.output, payload?.result, payload?.data];
  let text = candidates.find((value) => typeof value === "string");
  if (!text) {
    const nested = candidates.flatMap((value) => Array.isArray(value) ? value : [value]).find((value) => typeof value?.text === "string");
    text = nested?.text;
  }
  if (!text) throw new Error("Analyzer returned no structured text");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Analyzer output did not contain JSON");
  const value = JSON.parse(match[0]);
  value.peoplePresent = Math.max(0, Number.parseInt(value.peoplePresent || 0, 10));
  value.confidence = Math.max(0, Math.min(1, Number(value.confidence || 0)));
  return analysisSchema.parse(value);
}

async function ownedAsset(id, userId) {
  return prisma.uploadedAsset.findFirst({ where: { id, userId } });
}

async function handleAnalysisSubmission(_req, { params }) {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const asset = await ownedAsset(id, session.user.id);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (asset.validationStatus !== "VALID" || !asset.validatedAt) return NextResponse.json({ error: "Asset must pass media validation before analysis" }, { status: 422 });
  if (asset.analysisConfirmedAt) return NextResponse.json({ status: "CONFIRMED", analysis: JSON.parse(asset.analysisJson || "{}"), revision: asset.analysisRevision });
  if (["PROCESSING", "COMPLETED"].includes(asset.analysisStatus)) return NextResponse.json({ status: asset.analysisStatus, analysis: asset.analysisJson ? JSON.parse(asset.analysisJson) : null }, { status: 202 });

  if (asset.mediaType === "VIDEO") {
    const analysis = { identity: "App screen recording", suggestedName: asset.originalFileName.slice(0, 100), visibleText: [], deviceType: "unknown", productViewType: "none", peoplePresent: 0, lighting: "n/a", framing: "screen capture", cameraAngle: "n/a", environment: "digital interface", colors: [], pacingCues: [], confidence: 0, warnings: ["Confirm the device type and screen sequence manually."] };
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "COMPLETED", analysisRevision: `${ANALYSIS_REVISION}.recording-manual`, analysisJson: JSON.stringify(analysis) } });
    return NextResponse.json({ status: "COMPLETED", analysis, revision: `${ANALYSIS_REVISION}.recording-manual` });
  }

  const apiKey = process.env.MUAPI_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) return NextResponse.json({ error: "MuAPI analyzer is not configured" }, { status: 503 });
  const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);
  if (!workspace?.id || workspace.id === "ws_default_fallback") return NextResponse.json({ error: "Durable workspace billing is unavailable" }, { status: 503 });
  try {
    await CreditEscrowService.chargeImmediate({ workspaceId: workspace.id, amount: 1, idempotencyKey: `asset_analysis_${asset.id}`, userId: session.user.id, reasonCode: "ASSET_ANALYSIS" });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Insufficient credits for analysis" }, { status: error.statusCode || 402 });
  }
  await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "SUBMITTING", analysisWorkspaceId: workspace.id, analysisCreditsCharged: 1 } });
  const imageUrl = await R2StorageService.generateSignedUrl({ storageKey: asset.storageKey, expiresInSeconds: 3600 });
  let response;
  let result;
  try {
    response = await fetch(ANALYZER_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey }, body: JSON.stringify({ prompt: ANALYSIS_PROMPT, image_url: imageUrl, system_prompt: "Return strict JSON only." }), signal: AbortSignal.timeout(30000) });
    result = await response.json().catch(() => ({}));
  } catch {
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "SUBMISSION_UNKNOWN" } });
    return NextResponse.json({ error: "Analysis submission state is unknown; automatic retry stopped to prevent duplicate billing" }, { status: 503 });
  }
  if (!response.ok || !result.request_id) {
    await CreditEscrowService.refundImmediate({ workspaceId: workspace.id, amount: 1, idempotencyKey: `refund_asset_analysis_${asset.id}`, userId: session.user.id, reasonCode: "ASSET_ANALYSIS_REJECTED" });
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "FAILED", analysisCreditsCharged: 0 } });
    return NextResponse.json({ error: "Asset analysis submission failed; the analysis credit was refunded" }, { status: 502 });
  }
  await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "PROCESSING", providerRequestId: result.request_id, analysisRevision: ANALYSIS_REVISION } });
  return NextResponse.json({ status: "PROCESSING", requestId: result.request_id }, { status: 202 });
}

export async function POST(req, context) {
  try { return await handleAnalysisSubmission(req, context); }
  catch (error) {
    console.error("[ASSET_ANALYSIS_SUBMISSION_ERROR]", error);
    return NextResponse.json({ error: "Asset analysis is temporarily unavailable; no automatic retry was made" }, { status: 503 });
  }
}

export async function GET(_req, { params }) {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let asset = await ownedAsset(id, session.user.id);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (["COMPLETED", "CONFIRMED", "FAILED"].includes(asset.analysisStatus) || asset.analysisConfirmedAt) {
    return NextResponse.json({ status: asset.analysisConfirmedAt ? "CONFIRMED" : asset.analysisStatus, analysis: asset.analysisJson ? JSON.parse(asset.analysisJson) : null, revision: asset.analysisRevision });
  }
  if (!asset.providerRequestId) return NextResponse.json({ status: "PENDING" });
  const apiKey = process.env.MUAPI_API_KEY;
  const response = await fetch(`${RESULT_ENDPOINT}/${encodeURIComponent(asset.providerRequestId)}/result`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(15000) });
  const result = await response.json().catch(() => ({}));
  const providerStatus = String(result.status || "").toLowerCase();
  if (["failed", "error", "cancelled"].includes(providerStatus)) {
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "FAILED", analysisJson: JSON.stringify({ error: String(result.error || "Analysis failed") }) } });
    return NextResponse.json({ status: "FAILED", error: "Asset analysis failed" }, { status: 502 });
  }
  if (providerStatus !== "completed") return NextResponse.json({ status: "PROCESSING" }, { status: 202 });
  try {
    const analysis = parseAnalysisOutput(result);
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "COMPLETED", analysisJson: JSON.stringify(analysis), analysisRevision: `${ANALYSIS_REVISION}.${crypto.createHash("sha256").update(JSON.stringify(analysis)).digest("hex").slice(0, 12)}` } });
    asset = await ownedAsset(id, session.user.id);
    return NextResponse.json({ status: "COMPLETED", analysis, revision: asset.analysisRevision });
  } catch (error) {
    await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "FAILED", analysisJson: JSON.stringify({ error: error.message }) } });
    return NextResponse.json({ status: "FAILED", error: "Analyzer returned invalid structured data" }, { status: 502 });
  }
}

export async function PATCH(req, { params }) {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const asset = await ownedAsset(id, session.user.id);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (asset.analysisStatus !== "COMPLETED" || !asset.analysisJson) return NextResponse.json({ error: "Analysis is not ready" }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const parsed = analysisSchema.safeParse({ ...JSON.parse(asset.analysisJson), ...(body.confirmedAnalysis || {}) });
  if (!parsed.success) return NextResponse.json({ error: "Confirmed analysis contains invalid or incomplete fields" }, { status: 422 });
  const analysis = parsed.data;
  const revision = `${ANALYSIS_REVISION}.confirmed.${crypto.createHash("sha256").update(JSON.stringify(analysis)).digest("hex").slice(0, 12)}`;
  await prisma.uploadedAsset.update({ where: { id }, data: { analysisStatus: "CONFIRMED", analysisJson: JSON.stringify(analysis), analysisRevision: revision, analysisConfirmedAt: new Date() } });
  return NextResponse.json({ status: "CONFIRMED", analysis, revision });
}
