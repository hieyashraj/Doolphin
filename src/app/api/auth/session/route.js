import { NextResponse } from "next/server";
import { getMockSession } from "@/lib/getMockSession";

export async function GET(req) {
  const session = await getMockSession();
  return NextResponse.json(session);
}
