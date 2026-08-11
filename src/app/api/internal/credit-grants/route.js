import { NextResponse } from "next/server";
import { processDueGrantSchedules } from "@/lib/entitlements/grants";
export async function POST(request) { if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json({ processed: await processDueGrantSchedules() }); }
