import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export function updateSession(request) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, { cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => { items.forEach(({ name, value, options }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  // getUser validates the cookie with Auth; proxy remains only an optimistic guard.
  return supabase.auth.getUser().then(({ data }) => ({ response, user: data.user })).catch(() => ({ response, user: null }));
}
