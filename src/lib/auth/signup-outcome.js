/**
 * With confirm-email enabled Supabase deliberately returns an obfuscated user
 * (with no identities) for an existing confirmed email.  Keep that distinction
 * server-side and return the same neutral response as other failed signups.
 */
export function signupCanProceedToVerification({ data, error }) {
  return !error && Array.isArray(data?.user?.identities) && data.user.identities.length > 0;
}
