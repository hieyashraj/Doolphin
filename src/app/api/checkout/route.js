import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { BillingService } from "@/lib/services/billing";

export async function POST(req) {
  try {
    const session = await getServerSession();
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized. Please sign in." }, { status: 401 });
    }

    const { planId } = await req.json();
    if (!planId) {
      return NextResponse.json({ error: "Missing planId parameter" }, { status: 400 });
    }

    const checkoutUrl = await BillingService.createCheckoutSession(session.user.id, planId);
    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    console.error("Checkout route error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
