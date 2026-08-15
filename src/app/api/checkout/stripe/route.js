import { NextResponse } from "next/server";

// This route previously accepted client-provided plan data. It is retained as
// a tombstone so old clients cannot create an uncontrolled Stripe charge.
export async function POST() {
  return NextResponse.json({
    code: "LEGACY_STRIPE_CHECKOUT_DISABLED",
    error: "Stripe checkout is not available in this product version.",
  }, { status: 410 });
}
