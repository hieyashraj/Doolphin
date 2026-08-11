import { NextResponse } from "next/server";
import { getMockSession as getRequestSession } from "@/lib/getMockSession";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

export async function GET() {
  const session = await getRequestSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);
    return NextResponse.json({ workspaceId: workspace.id, availableCredits: workspace.creditAccount.availableCredits, reservedCredits: workspace.creditAccount.reservedCredits });
  } catch {
    return NextResponse.json({ error: "Balance unavailable" }, { status: 503 });
  }
}
