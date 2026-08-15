import { Providers } from "../providers";
import AppShell from "@/components/AppShell";
import { redirect } from "next/navigation";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { safeAccountState } from "@/lib/access/account-state";
import { newReqId, timed, logPerf } from "@/lib/perf";

export default async function AppLayout({ children }) {
  const reqId = newReqId();
  const layoutStart = performance.now();

  let identity;
  try {
    identity = await timed(reqId, "layout:requireActivatedAccount", () =>
      requireActivatedAccount(reqId)
    );
  } catch (error) {
    if (error?.code === "UNAUTHENTICATED") redirect("/sign-in?next=/app");
    if (error?.code === "EMAIL_VERIFICATION_REQUIRED") redirect("/verify-email");
    if (error?.code === "ACTIVATION_REQUIRED") redirect("/pricing");
    if (error?.code === "ACCOUNT_DENIED") redirect("/sign-in?denied=1");
    redirect("/sign-in?denied=1");
  }

  logPerf(reqId, "layout:total", layoutStart);

  const initialAccount = safeAccountState({ ...identity, creditAccount: identity.creditAccount });
  return <Providers initialAccount={initialAccount}><AppShell>{children}</AppShell></Providers>;
}
