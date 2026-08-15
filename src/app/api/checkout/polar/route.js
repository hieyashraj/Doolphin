import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/access/authorization";
import { PLANS } from "@/lib/entitlements/pricing";
import { getPolarConfig } from "@/lib/billing/polarEnvironment";

export async function POST(request) {
  try {
    const { planCode } = await request.json();
    const plan = PLANS[planCode];
    if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });

    const { authUser } = await requireVerifiedUser();
    let config;
    try {
      config = getPolarConfig();
    } catch (err) {
      return NextResponse.json({ error: "Billing configuration error", detail: err.message }, { status: 503 });
    }

    // Must resolve environment-specific Polar product UUID from server config
    const productId = config.products?.[planCode];
    if (!productId) {
      // Safe 5xx failure: refuse checkout, execute zero external Polar API requests
      return NextResponse.json({ error: "Billing plan configuration missing" }, { status: 503 });
    }

    const response = await fetch(`${config.baseUrl}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        customer_email: authUser.email,
        metadata: { supabaseUserId: authUser.id, planCode },
      }),
    });

    if (!response.ok) return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
    const checkout = await response.json();
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    return NextResponse.json(
      { error: error.code === "EMAIL_VERIFICATION_REQUIRED" ? "Verify your email before checkout" : "Authentication required" },
      { status: error.status || 401 }
    );
  }
}
