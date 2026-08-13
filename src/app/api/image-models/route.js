import { NextResponse } from "next/server";
import { requireActivatedAccount } from "@/lib/access/authorization";
import { listImageModels } from "@/lib/generation-models/imageRegistry";

export async function GET() {
  try { await requireActivatedAccount(); }
  catch (error) { return NextResponse.json({ error:error.code || "UNAUTHENTICATED" }, { status:error.status || 401 }); }
  return NextResponse.json({ models:listImageModels() }, { headers:{ "Cache-Control":"private, no-store" } });
}
