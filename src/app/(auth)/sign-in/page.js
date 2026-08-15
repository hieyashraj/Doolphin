"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowRight, FiLock, FiMail } from "react-icons/fi";
import { createClient } from "@/lib/supabase/browser";
import { postSignInDestination } from "@/lib/access/account-state";

export default function SignInPage() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false); const router = useRouter();
  // Supabase must have Google enabled and this explicit public deployment flag
  // set before we expose the OAuth action. The default is deliberately hidden
  // so a partially configured provider cannot become a customer-facing error.
  const googleOAuthEnabled = process.env.NEXT_PUBLIC_SUPABASE_GOOGLE_OAUTH_ENABLED === "true";
  useEffect(() => { router.prefetch("/app"); router.prefetch("/pricing"); }, [router]);
  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const clientPerfId = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
      const authStart = performance.now();
      const auth = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      const clientAuthDurationMs = Math.round(performance.now() - authStart);
      if (auth.error) throw auth.error;
      const syncRes = await fetch("/api/auth/sync", {
        method: "POST",
        headers: {
          "x-doolphin-perf-id": clientPerfId,
          "x-doolphin-auth-duration-ms": String(clientAuthDurationMs),
        },
      });
      if (!syncRes.ok) throw new Error("sync_failed");
      const syncData = await syncRes.json();
      if (!syncData?.ok) throw new Error("sync_unsuccessful");
      const account = syncData.ok ? { ok: syncData.activationStatus === "ACTIVATED" } : await fetch("/api/account");
      const destination = syncData.destination || postSignInDestination(account);
      window.location.replace(destination);
    } catch {
      setError("Unable to sign in. Check your details or reset your password.");
      setSubmitting(false);
    }
  }
  async function google() { setError(""); const result = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } }); if (result.error) setError("Unable to start Google sign in. Please try again."); }
  const field = "w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-3 pl-10 pr-3 text-base outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15 disabled:opacity-60";
  return <main className="min-h-screen bg-[#FAF8ED] px-4 py-10 sm:grid sm:place-items-center"><section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8"><Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link><p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">WELCOME BACK</p><h1 className="mt-2 font-serif text-3xl font-bold">Sign in to your Studio</h1><form onSubmit={submit} className="mt-7 space-y-4" aria-busy={submitting}><label className="block text-sm font-semibold" htmlFor="signin-email">Email<span className="relative mt-1.5 block"><FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" /><input id="signin-email" className={field} type="email" autoComplete="email" required placeholder="you@example.com" disabled={submitting} value={email} onChange={(event) => setEmail(event.target.value)} /></span></label><label className="block text-sm font-semibold" htmlFor="signin-password">Password<span className="relative mt-1.5 block"><FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" /><input id="signin-password" className={field} type="password" autoComplete="current-password" required placeholder="Your password" disabled={submitting} value={password} onChange={(event) => setPassword(event.target.value)} /></span></label>{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}<button className="auth-primary-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-white px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={submitting} aria-busy={submitting}>{submitting ? <span>Signing in…</span> : <><span className="font-bold">Sign in</span> <FiArrowRight /></>}</button></form>{googleOAuthEnabled && <button className="mt-3 min-h-11 w-full rounded-xl border border-[#111111]/15 bg-white px-4 text-sm font-semibold hover:bg-[#FAF8ED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]" onClick={google}>Continue with Google</button>}<p className="mt-6 text-center text-sm text-[#55534E]"><Link className="font-semibold underline" href="/forgot-password">Forgot password?</Link><span className="mx-2">·</span><Link className="font-semibold underline" href="/sign-up">Create account</Link></p></section></main>;
}
