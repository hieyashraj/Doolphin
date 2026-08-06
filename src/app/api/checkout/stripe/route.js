import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Stripe from "stripe";

function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("placeholder")) return null;
  return new Stripe(key);
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const stripe = getStripeClient();
    if (!stripe) {
      return NextResponse.json({
        url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/pricing?status=stripe_not_configured`,
        simulated: true
      });
    }

    const { plan } = await req.json();

    if (!plan) {
      return new NextResponse("Plan required", { status: 400 });
    }

    // Create Stripe Checkout Session
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: plan.name,
              description: plan.description,
            },
            unit_amount: Math.round(parseFloat(plan.price.replace("$", "")) * 100) || 0,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/gallery?status=success`,
      cancel_url: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/pricing?status=cancelled`,
      metadata: {
        userId: session.user.id,
        planName: plan.name,
        credits: plan.credits.toString(),
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("[STRIPE_CHECKOUT_ERROR]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
