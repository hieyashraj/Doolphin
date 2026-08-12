import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/entitlements/pricing";
import { materializeAnnualGrantSchedule } from "@/lib/entitlements/grants";
import { grantCreditsIdempotently, IdempotencyIntegrityConflict, isUniqueViolation } from "@/lib/entitlements/ledger";

function validSignature(raw, signature) { const secret = process.env.POLAR_WEBHOOK_SECRET; if (!secret || !signature) return false; const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex"); return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); }
function grantReason(code) { return code === "EXPLORER" ? "EXPLORER_GRANT" : code.startsWith("STARTER") ? "STARTER_MONTHLY_GRANT" : code.startsWith("GROWTH") ? "GROWTH_MONTHLY_GRANT" : "AGENCY_MONTHLY_GRANT"; }
function canonical(payload) { const data = payload.data || {}; const planCode = data.metadata?.planCode || data.customer_metadata?.planCode; return { eventId: payload.id || payload.event_id, eventType: payload.type, planCode, supabaseUserId: data.metadata?.supabaseUserId || data.customer_metadata?.supabaseUserId, customerId: data.customer_id || data.customer?.id || null, orderId: data.id || data.order_id || null, createdAt: data.created_at || null }; }
function sameOperation(stored, operation) { try { const value = JSON.parse(stored.payloadJson); return Object.entries(operation).every(([key, item]) => value[key] === item); } catch { return false; } }
async function finalize(entitlement, operation, db) {
  if (entitlement.billingInterval === "ANNUAL") { await materializeAnnualGrantSchedule(entitlement, PLANS[entitlement.planCode].credits, db); return { status: "PROCESSED", entitlement }; }
  const grant = await grantCreditsIdempotently({ workspaceId: entitlement.workspaceId, userId: entitlement.userId, amount: PLANS[entitlement.planCode].credits, reason: grantReason(entitlement.planCode), sourceId: entitlement.id, idempotencyKey: `billing-grant:${entitlement.id}:0` }, db);
  return { ...grant, entitlement };
}

export async function processPolarBillingEvent(payload, db = prisma) {
  const operation = canonical(payload); const plan = PLANS[operation.planCode];
  if (!operation.eventId || !operation.orderId || !plan || !["order.created", "subscription.created", "subscription.updated"].includes(operation.eventType)) return { status: "IGNORED" };
  const prior = await db.billingWebhookEvent.findUnique({ where: { polarEventId: operation.eventId } });
  if (prior) {
    if (!sameOperation(prior, operation)) throw new IdempotencyIntegrityConflict("Polar event id conflicts with a different operation");
    const entitlement = await db.entitlement.findUnique({ where: { polarOrderId: operation.orderId } });
    if (!entitlement) throw new IdempotencyIntegrityConflict("Previously accepted Polar event has no matching entitlement");
    return { ...(await finalize(entitlement, operation, db)), status: "ALREADY_PROCESSED" };
  }
  try {
    const entitlement = await db.$transaction(async (tx) => {
      await tx.billingWebhookEvent.create({ data: { polarEventId: operation.eventId, eventType: operation.eventType, payloadJson: JSON.stringify(operation) } });
      const user = await tx.user.findUnique({ where: { supabaseUserId: operation.supabaseUserId } });
      if (!user?.defaultWorkspaceId) throw new IdempotencyIntegrityConflict("Billing identity is not linked to a workspace");
      if (operation.customerId) await tx.billingCustomer.upsert({ where: { polarCustomerId: operation.customerId }, update: { userId: user.id }, create: { userId: user.id, polarCustomerId: operation.customerId } });
      if (operation.planCode === "EXPLORER") { const claimed = await tx.entitlement.findFirst({ where: { planCode: "EXPLORER", OR: [{ userId: user.id }, { workspaceId: user.defaultWorkspaceId }, ...(operation.customerId ? [{ polarCustomerId: operation.customerId }] : [])] } }); if (claimed) throw new IdempotencyIntegrityConflict("Explorer has already been claimed by an eligibility identity"); }
      const startsAt = new Date(operation.createdAt || Date.now()); const endsAt = plan.interval === "ANNUAL" ? new Date(Date.UTC(startsAt.getUTCFullYear() + 1, startsAt.getUTCMonth(), startsAt.getUTCDate())) : plan.interval === "MONTHLY" ? new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + 1, startsAt.getUTCDate())) : new Date(Date.UTC(startsAt.getUTCFullYear() + 10, startsAt.getUTCMonth(), startsAt.getUTCDate()));
      const created = await tx.entitlement.create({ data: { userId: user.id, workspaceId: user.defaultWorkspaceId, planCode: operation.planCode, billingInterval: plan.interval, polarCustomerId: operation.customerId, polarOrderId: operation.orderId, startsAt, endsAt, featuresJson: "[]" } });
      await tx.user.update({ where: { id: user.id }, data: { activationStatus: "ACTIVATED", subscriptionStatus: plan.interval === "ONE_TIME" ? "NONE" : "ACTIVE", explorerClaimedAt: operation.planCode === "EXPLORER" ? startsAt : undefined, explorerOrderId: operation.planCode === "EXPLORER" ? operation.orderId : undefined } });
      return created;
    });
    const result = await finalize(entitlement, operation, db);
    await db.billingWebhookEvent.update({ where: { polarEventId: operation.eventId }, data: { processedAt: new Date() } });
    return result;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.billingWebhookEvent.findUnique({ where: { polarEventId: operation.eventId } });
    if (existing) {
      if (!sameOperation(existing, operation)) throw new IdempotencyIntegrityConflict("Polar event id conflicts with a different operation");
      const entitlement = await db.entitlement.findUnique({ where: { polarOrderId: operation.orderId } });
      if (!entitlement) throw new IdempotencyIntegrityConflict("Duplicate Polar event has no matching entitlement");
      await finalize(entitlement, operation, db);
      return { status: "ALREADY_PROCESSED", entitlement };
    }
    const entitlement = await db.entitlement.findUnique({ where: { polarOrderId: operation.orderId } });
    if (entitlement && entitlement.userId && entitlement.workspaceId && entitlement.planCode === operation.planCode && entitlement.polarCustomerId === operation.customerId) return { ...(await finalize(entitlement, operation, db)), status: "ALREADY_PROCESSED" };
    throw new IdempotencyIntegrityConflict("A unique billing constraint conflicts with a different operation");
  }
}

export async function POST(request) {
  const raw = await request.text(); const signature = request.headers.get("webhook-signature") || request.headers.get("x-polar-signature");
  if (!validSignature(raw, signature)) return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  let payload; try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  try { return NextResponse.json(await processPolarBillingEvent(payload)); } catch (error) { return NextResponse.json({ error: error.code === "IDEMPOTENCY_INTEGRITY_CONFLICT" ? "Webhook integrity conflict" : "Webhook requires review" }, { status: 409 }); }
}
