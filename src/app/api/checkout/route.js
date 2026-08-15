import { NextResponse } from "next/server";

// Legacy NextAuth/Stripe checkout is intentionally unavailable. All checkout
// preparation is through the authenticated, server-plan-validated Polar route.
export async function POST() {
  return NextResponse.json({
    code: "LEGACY_CHECKOUT_DISABLED",
    error: "Use the current Doolphin checkout flow.",
  }, { status: 410 });
}
