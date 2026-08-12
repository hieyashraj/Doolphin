import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";

// Intentionally returns operational state only—never credentials, raw env, or
// billing/provider payloads. Detailed secret-bearing diagnostics stay server logs.
export async function GET() {
  try {
    await requireAdminUser();
    const creations = await prisma.creation.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, currentStage: true, modelId: true, provider: true, createdAt: true } });
    return NextResponse.json({ environment: process.env.NODE_ENV, creations });
  } catch (error) { return NextResponse.json({ error: error.code || "UNAUTHENTICATED" }, { status: error.status || 401 }); }
}
