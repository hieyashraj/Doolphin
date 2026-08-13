import { Providers } from "../providers";
import Navbar from "../../components/Navbar";
import { redirect } from "next/navigation";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { safeAccountState } from "@/lib/access/account-state";

export default async function AppLayout({ children }) {
  let identity;
  try { identity = await requireActivatedAccount(); } catch (error) { if (error?.code === "UNAUTHENTICATED") redirect("/sign-in?next=/app"); if (error?.code === "ACTIVATION_REQUIRED") redirect("/pricing"); redirect("/sign-in?denied=1"); }
  const creditAccount = await prisma.creditAccount.findUnique({ where: { workspaceId: identity.appUser.defaultWorkspaceId }, select: { availableCredits: true } });
  const initialAccount = safeAccountState({ ...identity, creditAccount });
  return <Providers initialAccount={initialAccount}><div className="flow-canvas flex h-dvh min-h-dvh w-full gap-2 overflow-hidden bg-[#FAF8ED] p-2 text-[#111111] md:gap-3 md:p-3"><Navbar /><main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main></div></Providers>;
}
