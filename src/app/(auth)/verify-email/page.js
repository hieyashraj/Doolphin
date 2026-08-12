"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { finishVerifiedEmail, verifyEmailCode } from "@/lib/auth/verification-flow";

const CONSENT = ["legal_terms_v1", "legal_privacy_v1"];
const SETUP_ERROR = "Your email has been verified, but we could not finish setting up your account. Please try again.";

function logOtpError(operation, error) {
  console.error(`Email OTP ${operation} failed`, { code: error?.code, name: error?.name, status: error?.status });
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const email = params.get("email")?.trim() || "";
  const oauth = params.get("oauth") === "1";

  const synchronize = () => fetch("/api/auth/sync", { method: "POST" });
  const recordConsent = () => fetch("/api/legal/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versions: CONSENT }) });

  async function continueAfterVerification() {
    setSettingUp(true);
    setMessage("Your email is verified. Finishing account setup…");
    setMessageType("success");
    const result = await finishVerifiedEmail({ synchronize, recordConsent });
    setSettingUp(false);
    if (result.status === "ready") {
      sessionStorage.removeItem("doolphin_pending_consent");
      router.replace("/pricing");
      return;
    }
    setMessage(SETUP_ERROR);
    setMessageType("error");
  }

  // A user who already has an active confirmed session should never be asked to
  // consume an old OTP again. This also makes a revisited verification URL safe.
  useEffect(() => {
    let active = true;
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (active && user?.email_confirmed_at) {
        setVerified(true);
        continueAfterVerification();
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function verify(event) {
    event.preventDefault();
    if (verifying || verified) return;
    setVerifying(true);
    setMessage("");
    const token = code.trim();
    const client = createClient();
    const result = await verifyEmailCode({ verifyOtp: client.auth.verifyOtp.bind(client.auth), email, token, synchronize, recordConsent });
    setVerifying(false);
    if (result.status === "verification-error") {
      logOtpError("verification", result.error);
      setMessage("We could not verify that code right now. Please try again.");
      setMessageType("error");
      return;
    }
    if (result.status === "invalid-otp") {
      logOtpError("verification", result.error);
      setMessage("That verification code is invalid or expired. Request a new code and try again.");
      setMessageType("error");
      return;
    }
    setVerified(true); // irreversible client state after Supabase accepts the OTP
    if (result.setup.status === "ready") {
      sessionStorage.removeItem("doolphin_pending_consent");
      router.replace("/pricing");
      return;
    }
    setMessage(SETUP_ERROR);
    setMessageType("error");
  }

  async function resend() {
    if (resending || verified) return;
    setResending(true);
    setMessage("");
    let error;
    try {
      ({ error } = await createClient().auth.resend({ type: "signup", email }));
    } catch (exception) {
      error = exception;
    }
    setResending(false);
    if (error) {
      logOtpError("resend", error);
      setMessage("Please wait before requesting another code.");
      setMessageType("error");
      return;
    }
    setCode("");
    setMessage("A new verification code has been sent.");
    setMessageType("success");
  }

  const notice = message && <p className={`mt-4 text-sm ${messageType === "error" ? "text-red-700" : "text-green-800"}`} role={messageType === "error" ? "alert" : "status"}>{message}</p>;
  if (oauth) return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Confirm your account</h1><p className="mt-3">By continuing, you agree to the current Terms and Privacy Policy.</p><button className="mt-6 w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={settingUp} aria-busy={settingUp} onClick={continueAfterVerification}>{settingUp ? "Continuing…" : "Agree and continue"}</button>{notice}</main>;

  return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Verify your email</h1><p className="mt-3">{verified ? "Your email is verified. You can finish account setup below." : `Enter the code we sent to ${email || "your email address"}.`}</p>{!verified && <form className="mt-6 space-y-4" onSubmit={verify}><label className="sr-only" htmlFor="verification-code">Verification code</label><input id="verification-code" className="w-full border p-3 tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code" maxLength="6" required disabled={verifying} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /><button className="w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={verifying} aria-busy={verifying}>{verifying ? "Verifying…" : "Verify code"}</button></form>}{verified && <button className="mt-6 w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={settingUp} aria-busy={settingUp} onClick={continueAfterVerification}>{settingUp ? "Finishing setup…" : "Continue to pricing"}</button>}{!verified && <button className="mt-4 text-sm underline disabled:cursor-not-allowed disabled:opacity-60" disabled={resending} aria-busy={resending} onClick={resend}>{resending ? "Sending…" : "Resend code"}</button>}{notice}{verified && <p className="mt-4 text-sm"><Link className="underline" href="/sign-in">Sign in instead</Link></p>}</main>;
}

export default function VerifyEmailPage() { return <Suspense fallback={null}><VerifyEmailContent /></Suspense>; }
