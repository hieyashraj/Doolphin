import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit } from "@/lib/access/rate-limit";
import { isDisposableEmailDomain } from "@/lib/access/disposable-email";
import { signupCanProceedToVerification } from "@/lib/auth/signup-outcome";

const NEUTRAL_SIGNUP_ERROR = "We couldn’t create a new account with those details. Try signing in or resetting your password.";
const DISPOSABLE_EMAIL_ERROR = "Temporary or disposable email addresses aren’t supported. Please use a permanent email address.";
const HOUR = 60 * 60 * 1000;

export async function POST(request) {
  try {
    const { email, password, acceptedVersions } = await request.json();
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";

    // Two windows: a strict per-(ip,email) limit against repeated attempts on one
    // account, and a broader per-ip limit so a single client can't rotate through
    // many addresses to enumerate accounts or spam signups.
    await enforceRateLimit({ scope: "signup", subject: `${ip}:${email || ""}`, limit: 5, windowMs: HOUR });
    await enforceRateLimit({ scope: "signup-ip", subject: ip || "unknown", limit: 20, windowMs: HOUR });

    // Reject disposable/temporary inboxes up front (defence in depth with the
    // Supabase Before-User-Created hook). This keeps trial abuse and throwaway
    // signups off the credit ledger. It is safe to be explicit here: naming the
    // reason does not disclose whether any account exists.
    if (isDisposableEmailDomain(email)) return NextResponse.json({ error: DISPOSABLE_EMAIL_ERROR, code: "DISPOSABLE_EMAIL" }, { status: 400 });

    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const result = await client.auth.signUp({ email, password, options: { data: { legal_versions: acceptedVersions || [] } } });

    // Do not reveal whether an arbitrary address is registered. In particular,
    // do not route Supabase's obfuscated duplicate response to the OTP page.
    if (!signupCanProceedToVerification(result)) return NextResponse.json({ error: NEUTRAL_SIGNUP_ERROR }, { status: 400 });
    return NextResponse.json({ next: "verify-email" });
  } catch (error) {
    return NextResponse.json({ error: error.status === 429 ? "Please wait before trying again." : NEUTRAL_SIGNUP_ERROR }, { status: error.status || 500 });
  }
}
