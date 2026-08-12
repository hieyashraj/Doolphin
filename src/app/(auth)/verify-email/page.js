"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

const CONSENT = ["legal_terms_v1", "legal_privacy_v1"];

function logOtpError(operation, error) {
  // Never include the email address or OTP in client-side Preview logs.
  console.error(`Email OTP ${operation} failed`, {
    code: error?.code,
    name: error?.name,
    status: error?.status,
  });
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const email = params.get("email")?.trim() || "";
  const oauth = params.get("oauth") === "1";

  async function finish() {
    const sync = await fetch("/api/auth/sync", { method: "POST" });
    if (!sync.ok) {
      setMessage("Unable to synchronize your account.");
      return;
    }
    const consent = await fetch("/api/legal/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versions: CONSENT }),
    });
    if (!consent.ok) {
      setMessage("You must accept the current Terms and Privacy Policy.");
      return;
    }
    sessionStorage.removeItem("doolphin_pending_consent");
    router.replace("/pricing");
  }

  async function verify(event) {
    event.preventDefault();
    const token = code.trim();
    const { error } = await createClient().auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) {
      logOtpError("verification", error);
      setMessage("That verification code is invalid or expired. Request a new code and try again.");
      return;
    }
    await finish();
  }

  async function resend() {
    const { error } = await createClient().auth.resend({ type: "signup", email });
    if (error) {
      logOtpError("resend", error);
      setMessage("Please wait before requesting another code.");
      return;
    }
    setCode("");
    setMessage("A new verification code has been sent.");
  }

  if (oauth) {
    return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Confirm your account</h1><p className="mt-3">By continuing, you agree to the current Terms and Privacy Policy.</p><button className="mt-6 w-full rounded bg-black p-3 text-white" onClick={finish}>Agree and continue</button>{message && <p className="mt-4 text-sm">{message}</p>}</main>;
  }

  return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Verify your email</h1><p className="mt-3">Enter the code we sent to {email || "your email address"}.</p><form className="mt-6 space-y-4" onSubmit={verify}><input className="w-full border p-3 tracking-[0.5em]" inputMode="numeric" maxLength="6" required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /><button className="w-full rounded bg-black p-3 text-white">Verify code</button></form><button className="mt-4 text-sm underline" onClick={resend}>Resend code</button>{message && <p className="mt-4 text-sm">{message}</p>}</main>;
}

export default function VerifyEmailPage() {
  return <Suspense fallback={null}><VerifyEmailContent /></Suspense>;
}
