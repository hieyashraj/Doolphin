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
  return <Providers initialAccount={initialAccount}><div className="flow-canvas flex h-screen w-screen overflow-hidden text-[#111111] bg-[#FAF8ED]"><Navbar /><main className="flex-1 flex flex-col min-h-0 overflow-hidden relative z-10 p-2 md:p-3 pl-0">{children}</main></div></Providers>;
}
