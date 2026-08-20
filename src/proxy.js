import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * EDGE GUARD FOR THE AUTHENTICATED PRODUCT AREA.
 *
 * (Next.js 16 renamed `middleware.js` to `proxy.js`. There must be exactly one of
 * these files — shipping both is a hard build error, so do not reintroduce a
 * `src/middleware.js`.)
 *
 * Access to /app requires three completed steps, in order:
 *   1. signed up or logged in
 *   2. email verified
 *   3. a plan purchased
 *
 * Steps 1 and 2 are handled here. Step 3 is NOT, and deliberately so: it is a
 * Prisma query, Prisma cannot run in the edge runtime, and putting a second
 * definition of "has paid" in front of the real one is how the two drift apart.
 *
 * This guard is DEFENCE IN DEPTH, not the authority. The authority is
 * `requireActivatedAccount()` in src/app/(app)/layout.js, which re-checks all
 * three against the database on every render of /app and cannot be bypassed by
 * typing a URL. What this file buys is turning traffic away before it costs a
 * server render or a database round trip, and keeping the auth cookie fresh.
 */
export async function proxy(request) {
  const { response, user } = await updateSession(request);

  // /app and /admin are gated. The other matched paths are here purely so the
  // Supabase session cookie gets refreshed while the user moves around;
  // redirecting them would break the auth pages themselves (and /verify-email
  // would redirect to itself forever). API routes must keep returning JSON
  // errors, not redirects.
  const path = request.nextUrl.pathname;
  const isAdminArea = path.startsWith("/admin");
  if (!path.startsWith("/app") && !isAdminArea) return response;

  // STEP 1 — no session at all.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // /admin needs an isAdmin lookup that only Prisma can do, and Prisma cannot
  // run at the edge. So the proxy stops here for /admin — it has turned away
  // anonymous traffic, and src/app/admin/page.js is the authority that verifies
  // the isAdmin flag and 404s a non-admin. Email/plan steps below are /app-only:
  // an admin account is not required to hold a purchased plan.
  if (isAdminArea) return response;

  // STEP 2 — email not confirmed. `updateSession` already performs a full
  // `auth.getUser()` to validate the cookie, so `email_confirmed_at` is already
  // in hand and this check costs nothing extra.
  //
  // Google identities are verified by the provider and carry no
  // `email_confirmed_at`; this exemption mirrors requireAuthenticatedUser() so
  // the two gates cannot disagree and bounce an OAuth user in a loop.
  const isGoogle = user.app_metadata?.provider === "google";
  if (!user.email_confirmed_at && !isGoogle) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    url.search = "";
    if (user.email) url.searchParams.set("email", user.email);
    return NextResponse.redirect(url);
  }

  // STEP 3 (plan purchased) is enforced by src/app/(app)/layout.js, which
  // redirects to /pricing when no entitlement is in force.
  return response;
}

export const config = { matcher: ["/app/:path*", "/admin/:path*", "/sign-in", "/sign-up", "/verify-email", "/api/:path*"] };
