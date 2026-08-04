import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request, { params }) {
  try {
    const { id } = params;

    const creation = await prisma.creation.findUnique({
      where: { id },
      include: {
        variants: {
          include: {
            stages: true,
            artifacts: true,
            providerJobs: true,
            assets: true
          }
        },
        assets: true
      }
    });

    if (!creation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ creation }, { status: 200 });
  } catch (error) {
    console.error('Fetch generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
