/**
 * An OTP result is final: once Supabase accepts it, failures in our application
 * setup must never be represented as an invalid or expired OTP.
 */
export async function finishVerifiedEmail({ synchronize, recordConsent }) {
  try {
    const sync = await synchronize();
    if (!sync.ok) return { status: "setup-error" };
  } catch {
    return { status: "setup-error" };
  }

  try {
    const consent = await recordConsent();
    if (!consent.ok) return { status: "setup-error" };
  } catch {
    return { status: "setup-error" };
  }

  return { status: "ready" };
}

export async function verifyEmailCode({ verifyOtp, email, token, synchronize, recordConsent }) {
  let error;
  try {
    ({ error } = await verifyOtp({ email, token, type: "email" }));
  } catch (exception) {
    return { status: "verification-error", error: exception };
  }
  if (error) return { status: "invalid-otp", error };
  return { status: "verified", setup: await finishVerifiedEmail({ synchronize, recordConsent }) };
}
