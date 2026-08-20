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
    // THE AUTHORITATIVE THREE-STEP GATE. Nothing inside /app renders unless
    // requireActivatedAccount() succeeds, so typing the URL directly cannot get
    // anyone past it — there is no client-side check to skip and no cached shell
    // to leak. src/middleware.js turns away anonymous traffic earlier as an
    // optimisation, but this is the boundary that actually holds.
    //
    // Each code maps to the one place the user can resolve it:
    //   UNAUTHENTICATED           -> step 1, sign in (and come back here)
    //   EMAIL_VERIFICATION_...    -> step 2, enter the code we emailed
    //   ACTIVATION_REQUIRED       -> step 3, buy a plan. Covers "never paid",
    //                                "subscription lapsed" and "refunded".
    //   ACCOUNT_DENIED            -> suspended or inconsistent records; not
    //                                self-serviceable, so do NOT loop them
    //                                through /pricing where payment would not
    //                                fix anything.
    if (error?.code === "UNAUTHENTICATED") redirect("/sign-in?next=/app");
    if (error?.code === "EMAIL_VERIFICATION_REQUIRED") redirect("/verify-email");
    if (error?.code === "ACTIVATION_REQUIRED") redirect("/pricing?next=/app");
    if (error?.code === "ACCOUNT_DENIED") redirect("/sign-in?denied=1");
    // Unrecognised failures fail CLOSED. An unexpected error must never be
    // allowed to fall through into a rendered studio.
    redirect("/sign-in?denied=1");
  }

  logPerf(reqId, "layout:total", layoutStart);

  const initialAccount = safeAccountState({ ...identity, creditAccount: identity.creditAccount });
  return <Providers initialAccount={initialAccount}><AppShell>{children}</AppShell></Providers>;
}
