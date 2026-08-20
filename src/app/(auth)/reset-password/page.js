"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowRight, FiLock } from "react-icons/fi";
import { createClient } from "@/lib/supabase/browser";
import "../auth.css";

export default function ResetPassword() {
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [submitting, setSubmitting] = useState(false); const router = useRouter();
  async function submit(event) { event.preventDefault(); if (submitting) return; setSubmitting(true); setMessage(""); try { const { error } = await createClient().auth.updateUser({ password }); if (error) { setMessage("Unable to reset password. Request a new link."); return; } setMessage("Password reset successfully. Redirecting to sign in…"); router.replace("/sign-in"); } catch { setMessage("Unable to reset password. Request a new link."); } finally { setSubmitting(false); } }

  const field = "w-full rounded-xl border border-[#111111]/15 bg-[#FAF8ED] py-3 pl-10 pr-3 text-base outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#111111]/15 disabled:opacity-60";

  return (
    <main className="auth-page">
      <div className="auth-shell has-panel">
        <div className="auth-card-col">
          <section className="w-full max-w-md rounded-[28px] border border-[#111111]/15 bg-white p-6 shadow-xl sm:p-8">
            <Link href="/" className="font-serif text-2xl font-bold">Doolphin</Link>
            <p className="mt-8 text-xs font-bold tracking-[.16em] text-[#77746D]">SECURE YOUR ACCOUNT</p>
            <h1 className="mt-2 font-serif text-3xl font-bold">Choose a new password</h1>
            <p className="mt-3 text-sm text-[#55534E]">Pick something strong and memorable — at least 8 characters. You&apos;ll be signed in right after.</p>
            <form className="mt-7 space-y-4" onSubmit={submit} aria-busy={submitting}>
              <label className="block text-sm font-semibold" htmlFor="new-password">
                New password
                <span className="relative mt-1.5 block">
                  <FiLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#77746D]" />
                  <input id="new-password" className={field} type="password" minLength="8" required disabled={submitting} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" />
                </span>
              </label>
              <button className="auth-primary-btn flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition disabled:cursor-wait" disabled={submitting} aria-busy={submitting}>
                {submitting ? <span>Saving password…</span> : <><span className="font-bold">Save password</span> <FiArrowRight /></>}
              </button>
            </form>
            {message && <p className="mt-5 rounded-xl border border-[#111111]/15 bg-[#FAF8ED] p-3 text-sm text-[#55534E]" role="status">{message}</p>}
            <p className="mt-6 text-center text-sm text-[#55534E]"><Link className="font-semibold underline" href="/sign-in">Back to sign in</Link></p>
          </section>
        </div>
        <aside className="auth-panel" aria-hidden="true">
          <p className="auth-panel-eyebrow">Almost done</p>
          <p className="auth-panel-wordmark" style={{ marginTop: "12px" }}><span className="auth-panel-mark">d</span>Doolphin</p>
          <h2 className="auth-panel-headline">One password<br />and you&apos;re in.</h2>
          <p className="auth-panel-sub">Set a fresh password and jump straight back into your scenes, avatars, and renders.</p>
          <div className="auth-panel-media">
            <video autoPlay muted loop playsInline poster="/avatars/Shyla E1.png"><source src="/explore/Explore 01.mp4" type="video/mp4" /></video>
          </div>
          <p className="auth-panel-caption">Your work is safe and waiting</p>
        </aside>
      </div>
    </main>
  );
}
