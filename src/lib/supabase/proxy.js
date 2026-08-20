import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export function updateSession(request) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Callers destructure `{ response, user }`, so the misconfigured path has to
  // return that same shape. Returning the bare response here handed callers
  // `response: undefined` and took down every matched route — including the
  // sign-in page needed to fix it. Missing config must not become a lockout: the
  // layout gate still fails closed, so /app stays protected.
  if (!url || !key) return { response, user: null };
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => { items.forEach(({ name, value, options }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  // getUser validates the cookie with Auth; proxy remains only an optimistic guard.
  return supabase.auth.getUser().then(({ data }) => ({ response, user: data.user })).catch(() => ({ response, user: null }));
}
