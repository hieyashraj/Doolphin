import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request, { params }) {
  try {
    const { id, variantId } = params;

    // Validate ownership/access here

    const variant = await prisma.creationVariant.findUnique({
      where: { id: variantId },
      include: { artifacts: true }
    });

    if (!variant || variant.creationId !== id) {
      return NextResponse.json({ error: 'Not found or mismatch' }, { status: 404 });
    }

    // Mock presigned URL generation
    // In production, use AWS S3 getSignedUrl or equivalent
    const downloadUrls = variant.artifacts.map(artifact => ({
      type: artifact.type,
      url: `https://storage.mock.com/download/${artifact.storageKey}?token=mock_presigned_token_1hr`
    }));

    return NextResponse.json({ downloadUrls }, { status: 200 });
  } catch (error) {
    console.error('Download presign error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
