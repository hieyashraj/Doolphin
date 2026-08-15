import { NextResponse } from "next/server";
import { processPolarBillingEvent } from "@/lib/billing/polarWebhookProcessor";
import { verifyAndParsePolarWebhook, WebhookVerificationError } from "@/lib/billing/polarWebhookSecurity";

export async function POST(request) {
  const rawBody = await request.text();

  let eventPayload;
  try {
    eventPayload = verifyAndParsePolarWebhook(rawBody, request.headers);
  } catch (error) {
    if (error instanceof WebhookVerificationError || error.code === "POLAR_WEBHOOK_SECRET_MISSING") {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await processPolarBillingEvent(eventPayload, request.headers);
    return NextResponse.json(result);
  } catch (error) {
    if (error.code === "IDEMPOTENCY_INTEGRITY_CONFLICT") {
      return NextResponse.json({ error: "Webhook integrity conflict" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || "Webhook processing error" }, { status: 500 });
  }
}
