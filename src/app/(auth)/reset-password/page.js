"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function ResetPassword() {
  const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [submitting, setSubmitting] = useState(false); const router = useRouter();
  async function submit(event) { event.preventDefault(); if (submitting) return; setSubmitting(true); setMessage(""); try { const { error } = await createClient().auth.updateUser({ password }); if (error) { setMessage("Unable to reset password. Request a new link."); return; } setMessage("Password reset successfully. Redirecting to sign in…"); router.replace("/sign-in"); } catch { setMessage("Unable to reset password. Request a new link."); } finally { setSubmitting(false); } }
  return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Choose a new password</h1><form className="mt-6 space-y-4" onSubmit={submit} aria-busy={submitting}><label className="sr-only" htmlFor="new-password">New password</label><input id="new-password" className="w-full border p-3" type="password" minLength="8" required disabled={submitting} value={password} onChange={event => setPassword(event.target.value)} placeholder="New password" /><button className="w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} aria-busy={submitting}>{submitting ? "Saving password…" : "Save password"}</button></form>{message && <p className="mt-4 text-sm" role="status">{message}</p>}</main>;
}
