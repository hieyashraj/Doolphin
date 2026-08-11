import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

export async function GET() {
  let session; try { const { appUser } = await requireActivatedAccount(); session = { user: { id: appUser.id } }; } catch (error) { return NextResponse.json({ error: error.code || "Activation required" }, { status: error.status || 401 }); }
  try {
    const workspace = await CreditEscrowService.ensureUserWorkspace(session.user.id);
    return NextResponse.json({ workspaceId: workspace.id, availableCredits: workspace.creditAccount.availableCredits, reservedCredits: workspace.creditAccount.reservedCredits });
  } catch {
    return NextResponse.json({ error: "Balance unavailable" }, { status: 503 });
  }
}
