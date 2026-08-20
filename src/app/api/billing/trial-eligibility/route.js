import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/access/authorization";
import { findActiveEntitlement } from "@/lib/access/entitlement";
import { evaluateTrialEligibility } from "@/lib/entitlements/trial";
import { prisma } from "@/lib/prisma";

/**
 * Tells the public pricing page how much of the three-step gate the viewer has
 * completed, so it can render the right call to action.
 *
 * This endpoint is a DISPLAY HINT and is intentionally not a security boundary.
 * It always answers 200, describing the caller rather than refusing them, because
 * "you are not signed in" is a legitimate answer for an anonymous visitor to a
 * public page — not an error. Nothing here can be exploited by lying to it: the
 * authoritative Explorer eligibility check runs again inside
 * POST /api/checkout/polar, and the database's one-Explorer-per-identity unique
 * indexes hold even if that check were somehow skipped.
 *
 * It also reports the caller's current plan so a signed-in subscriber sees
 * "Current plan" on the card they already own instead of being invited to buy it
 * a second time.
 */
const NO_CACHE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    const { appUser } = await requireAuthenticatedUser();

    const [eligibility, activeEntitlement] = await Promise.all([
      evaluateTrialEligibility(prisma, appUser),
      findActiveEntitlement(prisma, { workspaceId: appUser.defaultWorkspaceId, userId: appUser.id }),
    ]);

    return NextResponse.json(
      {
        authenticated: true,
        emailVerified: appUser.activationStatus !== "UNVERIFIED",
        trialEligible: eligibility.eligible,
        trialReason: eligibility.reason,
        activePlanCode: activeEntitlement?.planCode ?? null,
      },
      NO_CACHE
    );
  } catch (error) {
    // Step 2 not done: the account exists but the address is unconfirmed. The
    // page should point at verification rather than at checkout, which would
    // refuse them anyway.
    if (error?.code === "EMAIL_VERIFICATION_REQUIRED") {
      return NextResponse.json(
        { authenticated: true, emailVerified: false, trialEligible: false, trialReason: "EMAIL_VERIFICATION_REQUIRED", activePlanCode: null },
        NO_CACHE
      );
    }
    return NextResponse.json(
      { authenticated: false, emailVerified: false, trialEligible: false, trialReason: null, activePlanCode: null },
      NO_CACHE
    );
  }
}
