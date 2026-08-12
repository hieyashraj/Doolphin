import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";
import { safeAccountState } from "@/lib/access/account-state";

export async function GET() {
  try {
    const { authUser, appUser } = await requireActivatedAccount();
    const account = appUser.defaultWorkspaceId ? await prisma.creditAccount.findUnique({ where: { workspaceId: appUser.defaultWorkspaceId }, select: { availableCredits: true } }) : null;
    return NextResponse.json({ user: safeAccountState({ authUser, appUser, creditAccount: account }) });
  } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
}
