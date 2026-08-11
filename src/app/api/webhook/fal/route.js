import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "FAL webhooks are disabled until a FAL model is exposed through the canonical model registry." },
    { status: 410 }
  );
}
