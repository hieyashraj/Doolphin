import { NextResponse } from "next/server";
import { processDueGrantSchedules } from "@/lib/entitlements/grants";

// Vercel's native Cron Jobs feature issues a GET request and automatically
// attaches `Authorization: Bearer $CRON_SECRET` for routes protected by an
// env var of that exact name — so GET must be supported, not just POST, or a
// `crons` entry in vercel.json pointing here would silently never fire.
async function run(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ processed: await processDueGrantSchedules() });
}

export async function GET(request) { return run(request); }
export async function POST(request) { return run(request); }
