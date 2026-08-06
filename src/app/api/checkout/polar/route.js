import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * Polar Payments Checkout API Route
 * Generates checkout URLs via Polar.sh API
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { productId } = await req.json();
    const token = process.env.POLAR_ACCESS_TOKEN;

    if (!token || token.includes("placeholder")) {
      // Development simulated response if token not configured yet
      return NextResponse.json({
        url: `https://sandbox.polar.sh/checkout/simulated?product=${productId || "default"}&user=${session.user.id}`,
        simulated: true,
      });
    }

    const isSandbox = token.startsWith("polar_at_") && process.env.NODE_ENV !== "production";
    const baseUrl = isSandbox ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";

    const response = await fetch(`${baseUrl}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        customer_email: session.user.email,
        metadata: {
          userId: session.user.id,
        },
        success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/pricing?success=true`,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Polar API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return NextResponse.json({ url: data.url });
  } catch (err) {
    console.error("[POLAR CHECKOUT ERROR]:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
