"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event) { event.preventDefault(); if (submitting) return; setSubmitting(true); setMessage(""); try { const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` }); setMessage(error ? "We could not send a reset email. Please try again." : "If an account exists, a reset email has been sent."); } catch { setMessage("We could not send a reset email. Please try again."); } finally { setSubmitting(false); } }
  return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Reset password</h1><form className="mt-6 space-y-4" onSubmit={submit} aria-busy={submitting}><label className="sr-only" htmlFor="reset-email">Email</label><input id="reset-email" className="w-full border p-3" type="email" required value={email} disabled={submitting} onChange={event => setEmail(event.target.value)} placeholder="Email" /><button className="w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} aria-busy={submitting}>{submitting ? "Sending…" : "Send reset link"}</button></form>{message && <p className="mt-4 text-sm" role="status">{message}</p>}<p className="mt-6 text-sm"><Link className="underline" href="/sign-in">Back to sign in</Link></p></main>;
}
