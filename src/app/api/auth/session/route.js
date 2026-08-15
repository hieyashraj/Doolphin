import { NextResponse } from "next/server";

// NextAuth session endpoint has been decommissioned in favor of Supabase Auth.
export async function GET() {
  return NextResponse.json(null);
}
