import { NextResponse } from "next/server";

/**
 * Legacy endpoint intentionally disabled. Paid generation now requires an immutable
 * preflight quote followed by POST /api/generations.
 */
export async function POST() {
  return NextResponse.json({
    success: false,
    code: "LEGACY_ENDPOINT_DISABLED",
    error: "Run POST /api/preflight and submit the returned quoteId to POST /api/generations.",
  }, { status: 410 });
}
