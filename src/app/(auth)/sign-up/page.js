"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const TERMS = "legal_terms_v1";
const PRIVACY = "legal_privacy_v1";
const NEUTRAL_SIGNUP_ERROR = "We couldn’t create a new account with those details. Try signing in or resetting your password.";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    if (password !== confirm) return setError("Passwords do not match.");
    if (!accepted) return setError("Please acknowledge the Terms and Privacy Policy.");
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, acceptedVersions: [TERMS, PRIVACY] }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || NEUTRAL_SIGNUP_ERROR);
        return;
      }
      sessionStorage.setItem("doolphin_pending_consent", JSON.stringify([TERMS, PRIVACY]));
      router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError(NEUTRAL_SIGNUP_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="mx-auto max-w-md p-8"><h1 className="font-serif text-4xl font-bold">Create account</h1><form onSubmit={submit} className="mt-6 space-y-4" aria-busy={submitting}><label className="sr-only" htmlFor="signup-email">Email</label><input id="signup-email" className="w-full border p-3" type="email" required placeholder="Email" disabled={submitting} value={email} onChange={event => setEmail(event.target.value)} /><label className="sr-only" htmlFor="signup-password">Password</label><input id="signup-password" className="w-full border p-3" type="password" minLength="8" required placeholder="Password" disabled={submitting} value={password} onChange={event => setPassword(event.target.value)} /><label className="sr-only" htmlFor="signup-confirm">Confirm password</label><input id="signup-confirm" className="w-full border p-3" type="password" required placeholder="Confirm password" disabled={submitting} value={confirm} onChange={event => setConfirm(event.target.value)} /><label className="block text-sm"><input type="checkbox" disabled={submitting} checked={accepted} onChange={event => setAccepted(event.target.checked)} /> By creating an account, you agree to the <Link className="underline" href="/terms">Terms</Link> and <Link className="underline" href="/privacy">Privacy Policy</Link>.</label>{error && <p className="text-red-700" role="alert">{error}</p>}<button className="w-full rounded bg-black p-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting} aria-busy={submitting}>{submitting ? "Creating account…" : "Create account"}</button></form>{error && <p className="mt-4 text-sm"><Link className="underline" href="/sign-in">Sign in</Link> · <Link className="underline" href="/forgot-password">Forgot password?</Link></p>}</main>;
}
