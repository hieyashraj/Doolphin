import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/access/authorization";
import { PLANS } from "@/lib/entitlements/pricing";

const productEnvName = (code) => `POLAR_PRODUCT_${code}`;
export async function POST(request) {
  try {
    const { planCode } = await request.json();
    const plan = PLANS[planCode];
    if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    const { authUser } = await requireVerifiedUser();
    const token = process.env.POLAR_ACCESS_TOKEN;
    const productId = process.env[productEnvName(planCode)];
    // Never fall through to a production charge. Sandbox must be explicitly enabled.
    if (process.env.POLAR_ENV !== "sandbox" || !token || !productId) return NextResponse.json({ error: "Billing is not configured yet" }, { status: 503 });
    const response = await fetch("https://sandbox-api.polar.sh/v1/checkouts/custom/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, customer_email: authUser.email, metadata: { supabaseUserId: authUser.id, planCode } }) });
    if (!response.ok) return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
    const checkout = await response.json();
    return NextResponse.json({ url: checkout.url });
  } catch (error) { return NextResponse.json({ error: error.code === "EMAIL_VERIFICATION_REQUIRED" ? "Verify your email before checkout" : "Authentication required" }, { status: error.status || 401 }); }
}
