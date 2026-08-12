import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { authUser, appUser } = await requireActivatedAccount();
    const account = appUser.defaultWorkspaceId ? await prisma.creditAccount.findUnique({ where: { workspaceId: appUser.defaultWorkspaceId }, select: { availableCredits: true } }) : null;
    return NextResponse.json({ user: { name: appUser.name || authUser.email?.split("@")[0] || "Doolphin Creator", email: authUser.email || "", credits: account?.availableCredits || 0 } });
  } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
}
