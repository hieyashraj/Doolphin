"use client";

import Link from "next/link";
import { useState } from "react";
import { FiArrowRight, FiMail } from "react-icons/fi";
import { createClient } from "@/lib/supabase/browser";
import "../auth.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event) { event.preventDefault(); if (submitting) return; setSubmitting(true); setMessage(""); try { const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` }); setMessage(error ? "We could not send a reset email. Please try again." : "If an account exists, a reset email has been sent."); } catch { setMessage("We could not send a reset email. Please try again."); } finally { setSubmitting(false); } }

  const field = "w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-3 pl-10 pr-3 text-base outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15 disabled:opacity-60";

  return (
    <main className="auth-page">
      <div className="auth-shell has-panel">
        <div className="auth-card-col">
          <section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8">
            <Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link>
            <p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">FORGOT PASSWORD</p>
            <h1 className="mt-2 font-serif text-3xl font-bold">Reset your password</h1>
            <p className="mt-3 text-sm text-[#55534E]">Enter the email tied to your account and we&apos;ll send a secure link to set a new password.</p>
            <form className="mt-7 space-y-4" onSubmit={submit} aria-busy={submitting}>
              <label className="block text-sm font-semibold" htmlFor="reset-email">
                Email
                <span className="relative mt-1.5 block">
                  <FiMail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" />
                  <input id="reset-email" className={field} type="email" required value={email} disabled={submitting} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
                </span>
              </label>
              <button className="auth-primary-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={submitting} aria-busy={submitting}>
                {submitting ? <span>Sending…</span> : <><span className="font-bold">Send reset link</span> <FiArrowRight /></>}
              </button>
            </form>
            {message && <p className="mt-5 rounded-xl border border-[#111111]/15 bg-[#FAF8ED] p-3 text-sm text-[#55534E]" role="status">{message}</p>}
            <p className="mt-6 text-center text-sm text-[#55534E]"><Link className="font-semibold underline" href="/sign-in">Back to sign in</Link></p>
          </section>
        </div>
        <aside className="auth-panel" aria-hidden="true">
          <p className="auth-panel-eyebrow">Account recovery</p>
          <p className="auth-panel-wordmark" style={{ marginTop: "12px" }}><span className="auth-panel-mark">d</span>Doolphin</p>
          <h2 className="auth-panel-headline">Back in the<br />Studio in a tap.</h2>
          <p className="auth-panel-sub">Reset links land in your inbox in seconds. Your projects stay exactly where you left them.</p>
          <div className="auth-panel-media">
            <video autoPlay muted loop playsInline poster="/avatars/Shyla E1.png"><source src="/explore/Explore 01.mp4" type="video/mp4" /></video>
          </div>
          <p className="auth-panel-caption">Secure links expire automatically</p>
        </aside>
      </div>
    </main>
  );
}
