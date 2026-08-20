import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * EDGE GATE FOR THE AUTHENTICATED PRODUCT AREA.
 *
 * Access to /app requires three completed steps, in order:
 *   1. signed up or logged in
 *   2. email verified
 *   3. a plan purchased
 *
 * This middleware is DEFENCE IN DEPTH, not the authority. The authority is
 * `requireActivatedAccount()` in src/app/(app)/layout.js, which re-checks all
 * three against the database on every render and cannot be bypassed. That split
 * is deliberate and worth understanding before changing anything here:
 *
 *   - Step 3 is a Prisma query. Prisma cannot run in the edge runtime, and
 *     promoting this file to the node runtime to reach the database would add a
 *     second, independently-drifting definition of "has paid" in front of the
 *     first. One definition, in one place, checked server-side, is safer than
 *     two that can disagree.
 *   - Step 1 IS enforced here, because it is free: `getClaims()` verifies the
 *     JWT locally with no network round trip, so an anonymous request is turned
 *     away at the edge and never spends a server render or a database query.
 *   - Step 2 is enforced here only when the token itself proves the address is
 *     unverified. Proving verification authoritatively needs a full
 *     `auth.getUser()` call to Supabase, and the layout already makes exactly
 *     that call — paying for it twice on every navigation would tax the whole
 *     app to catch a case the next few milliseconds catch anyway.
 *
 * Net effect: unauthenticated traffic is rejected before it costs anything, and
 * everything else is rejected by the layout before a single pixel of the product
 * is rendered.
 */

const SIGN_IN = "/sign-in";
const VERIFY_EMAIL = "/verify-email";

function redirectTo(request, pathname, params = {}) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function middleware(request) {
  // `response` must be created up front and returned unmodified-by-reference so
  // that any refreshed Supabase auth cookies written during getClaims() survive.
  // Building a fresh NextResponse afterwards silently drops the rotated token and
  // logs the user out mid-session.
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Misconfiguration must not become a lockout. With no Supabase config we cannot
  // evaluate step 1 at all, so we defer to the layout, which fails CLOSED. This
  // is not a hole: the layout still refuses to render /app without all three
  // steps satisfied.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  let claims = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    // A malformed or unverifiable token is indistinguishable from no token for
    // gating purposes: treat it as step 1 not satisfied.
    claims = null;
  }

  // STEP 1 — no session at all.
  if (!claims?.sub) {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return redirectTo(request, SIGN_IN, { next });
  }

  // STEP 2 — only act on a definitive negative. Google OAuth identities are
  // verified by the provider and carry no email_confirmed_at, mirroring the
  // exemption in requireAuthenticatedUser().
  const isGoogle = claims.app_metadata?.provider === "google";
  const emailVerified =
    Boolean(claims.email_confirmed_at) ||
    claims.user_metadata?.email_verified === true ||
    claims.email_verified === true;
  const definitivelyUnverified =
    !isGoogle &&
    !emailVerified &&
    (claims.email_confirmed_at === null || claims.user_metadata?.email_verified === false);

  if (definitivelyUnverified) {
    const params = claims.email ? { email: claims.email } : {};
    return redirectTo(request, VERIFY_EMAIL, params);
  }

  // STEP 3 (plan purchased) is evaluated by src/app/(app)/layout.js, which
  // redirects to /pricing when no entitlement is in force.
  return response;
}

export const config = {
  // `:path*` matches zero or more segments, so this covers /app itself as well as
  // every nested studio route.
  matcher: ["/app/:path*"],
};
