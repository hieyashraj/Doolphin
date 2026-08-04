import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(request) {
  try {
    const { creationId, role, mediaType, storageKey } = await request.json();

    const asset = await prisma.creationAsset.create({
      data: {
        creationId,
        role,
        mediaType,
        storageKey
      }
    });

    return NextResponse.json({ success: true, asset }, { status: 200 });
  } catch (error) {
    console.error('Upload complete error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
