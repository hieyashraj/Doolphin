"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowRight, FiLock, FiMail } from "react-icons/fi";
import { createClient } from "@/lib/supabase/browser";
import "../auth.css";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const googleOAuthEnabled = process.env.NEXT_PUBLIC_SUPABASE_GOOGLE_OAUTH_ENABLED === "true";

  useEffect(() => {
    router.prefetch("/app");
    router.prefetch("/pricing");

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("denied") === "1") {
        setError("You're signed in, but we're having trouble loading your workspace. Please try again.");
      }
    }
  }, [router]);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("CLIENT_AUTH_TIMEOUT")), 10000)
    );

    try {
      const supabase = createClient();
      const authPromise = supabase.auth.signInWithPassword({ email: email.trim(), password });
      const res = await Promise.race([authPromise, timeoutPromise]);

      if (res?.error) {
        if (res.error.code === "email_not_confirmed") {
          setSubmitting(false);
          window.location.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
          return;
        }
        setError("Email or password is incorrect.");
        setSubmitting(false);
        return;
      }

      const user = res.data?.user;
      const isGoogle = user?.app_metadata?.provider === "google";
      if (user && !user.email_confirmed_at && !isGoogle) {
        setSubmitting(false);
        window.location.replace(`/verify-email?email=${encodeURIComponent(user.email || email.trim())}`);
        return;
      }

      sessionStorage.setItem("doolphin-auth-notice", "welcome-back");
      window.location.replace("/app");
    } catch (err) {
      if (err?.message === "CLIENT_AUTH_TIMEOUT") {
        setError("Sign-in is taking longer than expected. Please try again.");
      } else {
        setError("Email or password is incorrect.");
      }
      setSubmitting(false);
    }
  }

  async function google() {
    setError("");
    const result = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (result.error) setError("Unable to start Google sign in. Please try again.");
  }

  const field = "w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-3 pl-10 pr-3 text-base outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15 disabled:opacity-60";

  return (
    <main className="auth-page">
      <div className="auth-shell has-panel">
      <div className="auth-card-col">
      <section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8">
        <Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link>
        <p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">WELCOME BACK</p>
        <h1 className="mt-2 font-serif text-3xl font-bold">Sign in to your Studio</h1>
        <form onSubmit={submit} className="mt-7 space-y-4" aria-busy={submitting}>
          <label className="block text-sm font-semibold" htmlFor="signin-email">
            Email
            <span className="relative mt-1.5 block">
              <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" />
              <input id="signin-email" className={field} type="email" autoComplete="email" required placeholder="you@example.com" disabled={submitting} value={email} onChange={(e) => setEmail(e.target.value)} />
            </span>
          </label>
          <label className="block text-sm font-semibold" htmlFor="signin-password">
            Password
            <span className="relative mt-1.5 block">
              <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" />
              <input id="signin-password" className={field} type="password" autoComplete="current-password" required placeholder="Your password" disabled={submitting} value={password} onChange={(e) => setPassword(e.target.value)} />
            </span>
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button className="auth-primary-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-white px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={submitting} aria-busy={submitting}>
            {submitting ? <span>Signing in…</span> : <><span className="font-bold">Sign in</span> <FiArrowRight /></>}
          </button>
        </form>
        {googleOAuthEnabled && (
          <button className="mt-3 min-h-11 w-full rounded-xl border border-[#111111]/15 bg-white px-4 text-sm font-semibold hover:bg-[#FAF8ED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]" onClick={google}>
            Continue with Google
          </button>
        )}
        <p className="mt-6 text-center text-sm text-[#55534E]">
          <Link className="font-semibold underline" href="/forgot-password">Forgot password?</Link>
          <span className="mx-2">·</span>
          <Link className="font-semibold underline" href="/sign-up">Create account</Link>
        </p>
      </section>
      </div>
      <aside className="auth-panel" aria-hidden="true">
        <p className="auth-panel-eyebrow">Doolphin Studio</p>
        <p className="auth-panel-wordmark" style={{ marginTop: "12px" }}><span className="auth-panel-mark">d</span>Doolphin</p>
        <h2 className="auth-panel-headline">Pick up right<br />where you left off.</h2>
        <p className="auth-panel-sub">Your scenes, avatars, and renders are waiting. Sign in and keep the idea moving.</p>
        <div className="auth-panel-media">
          <video autoPlay muted loop playsInline poster="/avatars/Shyla E1.png"><source src="/explore/Explore 01.mp4" type="video/mp4" /></video>
        </div>
        <p className="auth-panel-caption">AI video for ideas that deserve to move</p>
      </aside>
      </div>
    </main>
  );
}
