import { NextResponse } from "next/server";

// No Stripe products are active for Doolphin v1. Reject legacy deliveries so
// they cannot mutate billing state through obsolete code.
export async function POST() {
  return NextResponse.json({
    code: "LEGACY_STRIPE_WEBHOOK_DISABLED",
    error: "Stripe webhooks are not accepted in this product version.",
  }, { status: 410 });
}
