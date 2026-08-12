import { NextResponse } from "next/server";

// Deliberately retained as a tombstone so old clients get a clear v1 response.
// Doolphin uses platform-owned, server-only provider credentials.
function disabled() { return NextResponse.json({ code: "CUSTOMER_PROVIDER_KEYS_DISABLED", error: "Customer-managed provider credentials are not available." }, { status: 410 }); }
export const GET = disabled;
export const POST = disabled;
export const DELETE = disabled;
