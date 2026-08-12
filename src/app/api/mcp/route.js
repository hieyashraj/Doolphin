import { NextResponse } from "next/server";

// MCP is intentionally not exposed in the Doolphin v1 customer product.
function disabled() { return NextResponse.json({ code: "MCP_NOT_AVAILABLE", error: "MCP is not available in this product version." }, { status: 404 }); }
export const GET = disabled;
export const POST = disabled;
