import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function requireSession() {
  return getServerSession(authOptions);
}

export async function GET() {
  const session = await requireSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    success: true,
    keyMode: "platform",
    muapiConfigured: Boolean(process.env.MUAPI_API_KEY),
    falConfigured: Boolean(process.env.FAL_KEY),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
  });
}

export async function POST() {
  const session = await requireSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    success: false,
    code: "PLATFORM_KEYS_ONLY",
    error: "Provider keys are managed as server-only deployment secrets and cannot be stored from the browser.",
  }, { status: 403 });
}

export async function DELETE() {
  const session = await requireSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    success: false,
    code: "PLATFORM_KEYS_ONLY",
    error: "Provider keys cannot be changed from the browser.",
  }, { status: 403 });
}
