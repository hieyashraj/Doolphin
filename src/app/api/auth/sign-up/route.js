import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit } from "@/lib/access/rate-limit";
import { signupCanProceedToVerification } from "@/lib/auth/signup-outcome";

const NEUTRAL_SIGNUP_ERROR = "We couldn’t create a new account with those details. Try signing in or resetting your password.";

export async function POST(request) {
  try {
    const { email, password, acceptedVersions } = await request.json();
    await enforceRateLimit({ scope: "signup", subject: `${request.headers.get("x-forwarded-for") || ""}:${email || ""}`, limit: 5, windowMs: 60 * 60 * 1000 });
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
