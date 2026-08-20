"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { createClient } from "@/lib/supabase/browser";
import { finishVerifiedEmail, verifyEmailCode } from "@/lib/auth/verification-flow";
import "../auth.css";

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

  const notice = message && <p className={`mt-5 rounded-xl border p-3 text-sm ${messageType === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`} role={messageType === "error" ? "alert" : "status"}>{message}</p>;
  const codeField = "w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-3 px-4 text-center text-lg font-semibold tracking-[0.5em] outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15 disabled:opacity-60";
  const panel = (
    <aside className="auth-panel" aria-hidden="true">
      <p className="auth-panel-eyebrow">Check your inbox</p>
      <p className="auth-panel-wordmark" style={{ marginTop: "12px" }}><span className="auth-panel-mark">d</span>Doolphin</p>
      <h2 className="auth-panel-headline">Your code arrives<br />in seconds.</h2>
      <p className="auth-panel-sub">We just sent a six-digit code to your inbox. Drop it in and your Studio is ready to roll.</p>
      <div className="auth-panel-media">
        <video autoPlay muted loop playsInline poster="/avatars/Shyla E1.png"><source src="/explore/Explore 01.mp4" type="video/mp4" /></video>
      </div>
      <p className="auth-panel-caption">Made for creators shipping video daily</p>
    </aside>
  );

  if (oauth) return (
    <main className="auth-page">
      <div className="auth-shell has-panel">
        <div className="auth-card-col">
          <section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8">
            <Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link>
            <p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">ONE LAST STEP</p>
            <h1 className="mt-2 font-serif text-3xl font-bold">Confirm your account</h1>
            <p className="mt-3 text-sm text-[#55534E]">By continuing, you agree to the current Terms and Privacy Policy.</p>
            <button className="auth-primary-btn mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={settingUp} aria-busy={settingUp} onClick={continueAfterVerification}>{settingUp ? <span>Continuing…</span> : <><span className="font-bold">Agree and continue</span> <FiArrowRight /></>}</button>
            {notice}
          </section>
        </div>
        {panel}
      </div>
    </main>
  );

  return (
    <main className="auth-page">
      <div className="auth-shell has-panel">
        <div className="auth-card-col">
          <section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8">
            <Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link>
            <p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">ONE LAST STEP</p>
            <h1 className="mt-2 font-serif text-3xl font-bold">Verify your email</h1>
            <p className="mt-3 text-sm text-[#55534E]">{verified ? "Your email is verified. You can finish account setup below." : <>Enter the 6-digit code we sent to <span className="font-semibold text-[#111111]">{email || "your email address"}</span>.</>}</p>
            {!verified && <form className="mt-7 space-y-4" onSubmit={verify}><label className="sr-only" htmlFor="verification-code">Verification code</label><input id="verification-code" className={codeField} inputMode="numeric" autoComplete="one-time-code" maxLength="6" required disabled={verifying} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="••••••" /><button className="auth-primary-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={verifying} aria-busy={verifying}>{verifying ? <span>Verifying…</span> : <><span className="font-bold">Verify code</span> <FiArrowRight /></>}</button></form>}
            {verified && <button className="auth-primary-btn mt-7 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={settingUp} aria-busy={settingUp} onClick={continueAfterVerification}>{settingUp ? <span>Finishing setup…</span> : <><span className="font-bold">Continue to pricing</span> <FiArrowRight /></>}</button>}
            {!verified && <button className="mt-4 text-sm font-semibold text-[#55534E] underline underline-offset-2 hover:text-[#111111] disabled:cursor-not-allowed disabled:opacity-60" disabled={resending} aria-busy={resending} onClick={resend}>{resending ? "Sending…" : "Resend code"}</button>}
            {notice}
            {verified && <p className="mt-4 text-sm text-[#55534E]"><Link className="font-semibold underline" href="/sign-in">Sign in instead</Link></p>}
          </section>
        </div>
        {panel}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() { return <Suspense fallback={null}><VerifyEmailContent /></Suspense>; }
