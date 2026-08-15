import { NextResponse } from "next/server";

// NextAuth has been decommissioned in favor of Supabase Auth.
export async function GET() {
  return NextResponse.json({ error: "NextAuth has been decommissioned. Use Supabase Auth." }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "NextAuth has been decommissioned. Use Supabase Auth." }, { status: 410 });
}
