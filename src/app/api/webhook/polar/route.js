import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/entitlements/pricing";
import { materializeAnnualGrantSchedule } from "@/lib/entitlements/grants";

function validSignature(raw, signature) { const secret = process.env.POLAR_WEBHOOK_SECRET; if (!secret || !signature) return false; const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex"); return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); }
export async function POST(request) {
  const raw = await request.text(); const signature = request.headers.get("webhook-signature") || request.headers.get("x-polar-signature");
  if (!validSignature(raw, signature)) return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  let payload; try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  const eventId = payload.id || payload.event_id; const data = payload.data || {}; const planCode = data.metadata?.planCode || data.customer_metadata?.planCode; const plan = PLANS[planCode];
  if (!eventId || !plan || !["order.created", "subscription.created", "subscription.updated"].includes(payload.type)) return NextResponse.json({ received: true });
  try { await prisma.$transaction(async (tx) => {
    const prior = await tx.billingWebhookEvent.findUnique({ where: { polarEventId: eventId } }); if (prior) return;
    await tx.billingWebhookEvent.create({ data: { polarEventId: eventId, eventType: payload.type, payloadJson: JSON.stringify({ type: payload.type, id: eventId }) } });
    const supabaseUserId = data.metadata?.supabaseUserId || data.customer_metadata?.supabaseUserId; const user = await tx.user.findUnique({ where: { supabaseUserId } }); if (!user?.defaultWorkspaceId) throw new Error("UNLINKED_BILLING_IDENTITY");
    const customerId = data.customer_id || data.customer?.id || null; const orderId = data.id || data.order_id; const existingOrder = orderId ? await tx.entitlement.findUnique({ where: { polarOrderId: orderId } }) : null; if (existingOrder) return;
    if (customerId) await tx.billingCustomer.upsert({ where: { polarCustomerId: customerId }, update: { userId: user.id }, create: { userId: user.id, polarCustomerId: customerId } });
    if (planCode === "EXPLORER") { const priorExplorer = await tx.entitlement.findFirst({ where: { planCode: "EXPLORER", OR: [{ userId: user.id }, { workspaceId: user.defaultWorkspaceId }, ...(customerId ? [{ polarCustomerId: customerId }] : [])] } }); if (priorExplorer) throw new Error("EXPLORER_ALREADY_CLAIMED"); }
    const startsAt = new Date(data.created_at || Date.now()); const endsAt = plan.interval === "ANNUAL" ? new Date(Date.UTC(startsAt.getUTCFullYear()+1,startsAt.getUTCMonth(),startsAt.getUTCDate())) : plan.interval === "MONTHLY" ? new Date(Date.UTC(startsAt.getUTCFullYear(),startsAt.getUTCMonth()+1,startsAt.getUTCDate())) : new Date(Date.UTC(startsAt.getUTCFullYear()+10,startsAt.getUTCMonth(),startsAt.getUTCDate()));
    const entitlement = await tx.entitlement.create({ data: { userId: user.id, workspaceId: user.defaultWorkspaceId, planCode, billingInterval: plan.interval, polarCustomerId: customerId, polarOrderId: orderId, startsAt, endsAt, featuresJson: "[]" } });
    await tx.user.update({ where: { id: user.id }, data: { activationStatus: "ACTIVATED", subscriptionStatus: plan.interval === "ONE_TIME" ? "NONE" : "ACTIVE", explorerClaimedAt: planCode === "EXPLORER" ? startsAt : undefined, explorerOrderId: planCode === "EXPLORER" ? orderId : undefined } });
    if (plan.interval === "ANNUAL") { await materializeAnnualGrantSchedule(entitlement, plan.credits, tx); } else { const key = `billing-grant:${entitlement.id}:0`; await tx.creditLedgerEntry.create({ data: { workspaceId: entitlement.workspaceId, userId: user.id, amount: plan.credits, reason: planCode === "EXPLORER" ? "EXPLORER_GRANT" : planCode.startsWith("STARTER") ? "STARTER_MONTHLY_GRANT" : planCode.startsWith("GROWTH") ? "GROWTH_MONTHLY_GRANT" : "AGENCY_MONTHLY_GRANT", sourceId: entitlement.id, idempotencyKey: key } }); await tx.creditAccount.update({ where: { workspaceId: entitlement.workspaceId }, data: { availableCredits: { increment: plan.credits }, lifetimeIssuedCredits: { increment: plan.credits } } }); }
  }); return NextResponse.json({ received: true }); } catch (error) { return NextResponse.json({ error: "Webhook requires review" }, { status: 409 }); }
}
