import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request) {
  const { response, user } = await updateSession(request);
  if (request.nextUrl.pathname.startsWith("/app") && !user) {
    const url = request.nextUrl.clone(); url.pathname = "/sign-in"; url.searchParams.set("next", request.nextUrl.pathname); return NextResponse.redirect(url);
  }
  return response;
}
export const config = { matcher: ["/app/:path*", "/sign-in", "/sign-up", "/verify-email", "/api/:path*"] };
