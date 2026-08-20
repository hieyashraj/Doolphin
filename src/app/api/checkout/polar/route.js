import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/access/authorization";
import { PLANS } from "@/lib/entitlements/pricing";
import { TRIAL_PLAN_CODE } from "@/lib/entitlements/plan-catalog";
import { evaluateTrialEligibility, TRIAL_INELIGIBLE } from "@/lib/entitlements/trial";
import { getPolarConfig } from "@/lib/billing/polarEnvironment";
import { prisma } from "@/lib/prisma";

/**
 * Human-readable copy for every refusal, keyed by the machine code the client
 * branches on. The client needs the code to decide where to send the user
 * (sign-in, verification, or nowhere) and the message to explain why, so both
 * travel together on every response.
 */
const REFUSALS = {
  UNAUTHENTICATED: { status: 401, error: "Sign in to continue to checkout." },
  EMAIL_VERIFICATION_REQUIRED: { status: 403, error: "Verify your email before checkout." },
  [TRIAL_INELIGIBLE.ALREADY_CLAIMED]: {
    status: 409,
    error: "You have already used your one-time Explorer trial. Choose a plan to keep creating.",
  },
  [TRIAL_INELIGIBLE.ALREADY_SUBSCRIBED]: {
    status: 409,
    error: "You are already on a plan, so the Explorer trial no longer applies.",
  },
};

function refuse(code, overrides = {}) {
  const refusal = REFUSALS[code] || { status: 400, error: "Checkout is unavailable." };
  return NextResponse.json({ code, error: refusal.error, ...overrides }, { status: refusal.status });
}

export async function POST(request) {
  try {
    const { planCode } = await request.json();
    const plan = PLANS[planCode];
    if (!plan) return NextResponse.json({ code: "UNKNOWN_PLAN", error: "Unknown plan" }, { status: 400 });

    // Steps 1 and 2 of the access gate. Deliberately NOT requireActivatedAccount:
    // step 3 is what this endpoint exists to let the user complete, so demanding
    // it here would make the first purchase impossible.
    const { authUser, appUser } = await requireVerifiedUser();

    // EXPLORER is a one-time trial, not a listed SKU. Checking eligibility BEFORE
    // opening checkout is the difference between declining an offer and taking
    // someone's money for credits the database will then refuse to grant — the
    // Explorer_one_per_user unique index would reject the webhook, leaving a paid
    // order with no entitlement and a refund to process by hand.
    if (planCode === TRIAL_PLAN_CODE) {
      const eligibility = await evaluateTrialEligibility(prisma, appUser);
      if (!eligibility.eligible) return refuse(eligibility.reason);
    }

    let config;
    try {
      config = getPolarConfig();
    } catch (err) {
      return NextResponse.json({ code: "BILLING_CONFIG_ERROR", error: "Billing configuration error", detail: err.message }, { status: 503 });
    }

    // Must resolve environment-specific Polar product UUID from server config
    const productId = config.products?.[planCode];
    if (!productId) {
      // Safe 5xx failure: refuse checkout, execute zero external Polar API requests.
      // The detail names the exact missing variable (never a value) so a missing
      // product ID is diagnosable at a glance instead of a generic dead end.
      const tier = config.env === "production" ? "PRODUCTION" : "SANDBOX";
      return NextResponse.json({
        code: "BILLING_PLAN_UNCONFIGURED",
        error: "Billing plan configuration missing",
        detail: `No Polar product configured for ${planCode} in the ${config.env} environment. Set POLAR_${tier}_PRODUCT_${planCode} (or the generic POLAR_PRODUCT_${planCode}) in Vercel.`,
      }, { status: 503 });
    }

    // Activation is applied asynchronously by the Polar webhook, so a user
    // returning straight from a successful payment can arrive before their
    // entitlement exists. Sending them to /app would hit the layout gate and
    // bounce them to /pricing — looking, to someone who just paid, exactly like
    // the payment failed. `checkout=complete` lets /pricing hold them on a short
    // "finishing activation" state that polls until the webhook lands.
    const returnTo = new URL("/pricing?checkout=complete", new URL(request.url).origin).toString();

    const response = await fetch(`${config.baseUrl}/v1/checkouts/custom/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_id: productId,
        customer_email: authUser.email,
        success_url: returnTo,
        metadata: { supabaseUserId: authUser.id, planCode },
      }),
    });

    if (!response.ok) return NextResponse.json({ code: "CHECKOUT_UNAVAILABLE", error: "Unable to start checkout" }, { status: 502 });
    const checkout = await response.json();
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    if (error?.code && REFUSALS[error.code]) return refuse(error.code);
    return refuse("UNAUTHENTICATED");
  }
}
