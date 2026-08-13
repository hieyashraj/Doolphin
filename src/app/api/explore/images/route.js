import { NextResponse } from "next/server";
import { EXPLORE_IMAGES } from "@/lib/explore-images-data";

export async function GET() {
  return NextResponse.json({
    images: EXPLORE_IMAGES
  });
}
