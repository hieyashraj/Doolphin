import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(request, { params }) {
  try {
    const { id } = params;

    const creation = await prisma.creation.update({
      where: { id },
      data: { status: 'cancelled' }
    });

    // Also cancel variants and release credits in a real implementation
    // Enqueue a cancellation event if it's currently processing

    await prisma.queueOutbox.create({
      data: {
        topic: 'generations',
        payload: JSON.stringify({
          action: 'cancel',
          creationId: id
        }),
        status: 'pending'
      }
    });

    return NextResponse.json({ success: true, creation }, { status: 200 });
  } catch (error) {
    console.error('Cancel generation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
