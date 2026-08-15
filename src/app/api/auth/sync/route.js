import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { linkSupabaseIdentity } from "@/lib/access/identity";
import { newReqId, timed, logPerf } from "@/lib/perf";

export async function POST(request) {
  const reqId = newReqId();
  const routeStart = performance.now();

  const clientPerfId = request?.headers?.get("x-doolphin-perf-id") || undefined;
  const rawDuration = request?.headers?.get("x-doolphin-auth-duration-ms");
  const parsedDuration = rawDuration ? Number(rawDuration) : NaN;
  const clientAuthDurationMs = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? Math.round(parsedDuration) : undefined;

  try {
    const supabase = await createClient();

    // [PERF] Supabase auth.getUser()
    const { data: { user } } = await timed(reqId, "sync:supabase.auth.getUser", () =>
      supabase.auth.getUser()
    );

    if (!user?.email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    // [PERF] linkSupabaseIdentity (user/identity DB lookup + workspace provisioning)
    const appUser = await timed(reqId, "sync:linkSupabaseIdentity", () =>
      linkSupabaseIdentity({
        supabaseUserId: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name,
      })
    );

    const destination = appUser.activationStatus === "ACTIVATED" ? "/app" : "/pricing";

    // [PERF] /api/auth/sync total
    logPerf(reqId, "sync:total", routeStart, {
      destination,
      activationStatus: appUser.activationStatus,
      ...(clientPerfId ? { clientPerfId } : {}),
      ...(clientAuthDurationMs !== undefined ? { clientAuthDurationMs } : {}),
    });

    return NextResponse.json({ ok: true, activationStatus: appUser.activationStatus, destination, userId: appUser.id });
  } catch {
    logPerf(reqId, "sync:total", routeStart, {
      error: true,
      ...(clientPerfId ? { clientPerfId } : {}),
      ...(clientAuthDurationMs !== undefined ? { clientAuthDurationMs } : {}),
    });
    return NextResponse.json({ error: "Unable to synchronize account" }, { status: 409 });
  }
}
