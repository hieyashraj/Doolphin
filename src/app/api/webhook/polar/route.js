import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Polar Webhook Handler
 * Verifies HMAC signatures and grants user credits on checkout.created / order.created events
 */
export async function POST(req) {
  try {
    const rawBody = await req.text();
    const webhookSecret = process.env.POLAR_WEBHOOK_SECRET;

    if (webhookSecret && !webhookSecret.includes("placeholder")) {
      const signature = req.headers.get("webhook-signature") || req.headers.get("x-polar-signature");
      if (signature) {
        const expectedSig = crypto
          .createHmac("sha256", webhookSecret)
          .update(rawBody)
          .digest("hex");
        if (signature !== expectedSig && !signature.includes(expectedSig)) {
          return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
        }
      }
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.type || payload.event;

    console.log(`[POLAR WEBHOOK] Event received: ${eventType}`);

    if (eventType === "order.created" || eventType === "checkout.created") {
      const data = payload.data || payload;
      const userId = data.metadata?.userId || data.customer_metadata?.userId;
      const creditsToAdd = data.metadata?.credits
        ? parseInt(data.metadata.credits, 10)
        : (data.amount ? Math.floor(data.amount / 100) * 10 : 100);

      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            credits: { increment: creditsToAdd },
          },
        });
        console.log(`[POLAR WEBHOOK] Granted ${creditsToAdd} credits to User ${userId}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[POLAR WEBHOOK ERROR]:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
