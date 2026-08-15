import { Providers } from "../providers";
import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { safeAccountState } from "@/lib/access/account-state";
import { newReqId, timed, logPerf } from "@/lib/perf";

export default async function AppLayout({ children }) {
  const reqId = newReqId();
  const layoutStart = performance.now();

  let identity;
  try {
    // [PERF] requireActivatedAccount total (supabase.auth.getUser + user DB + workspace/entitlement)
    identity = await timed(reqId, "layout:requireActivatedAccount", () =>
      requireActivatedAccount(reqId)
    );
  } catch (error) {
    if (error?.code === "UNAUTHENTICATED") redirect("/sign-in?next=/app");
    if (error?.code === "ACTIVATION_REQUIRED") redirect("/pricing");
    redirect("/sign-in?denied=1");
  }

  // [PERF] credit account lookup
  const creditAccount = await timed(reqId, "layout:creditAccount.findUnique", () =>
    prisma.creditAccount.findUnique({
      where: { workspaceId: identity.appUser.defaultWorkspaceId },
      select: { availableCredits: true },
    })
  );

  // [PERF] /app layout total
  logPerf(reqId, "layout:total", layoutStart);

  const initialAccount = safeAccountState({ ...identity, creditAccount });
  return <Providers initialAccount={initialAccount}><AppShell>{children}</AppShell></Providers>;
}
