import prisma from '@/lib/prisma';

export async function GET(request, { params }) {
  const { id } = params;

  // Set headers for SSE
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(`data: ${JSON.stringify({ message: 'Connected to SSE' })}\n\n`);

      // Mock polling for updates (In production, use Redis PubSub)
      const interval = setInterval(async () => {
        try {
          const creation = await prisma.creation.findUnique({
            where: { id },
            select: { status: true }
          });

          if (creation) {
            controller.enqueue(`data: ${JSON.stringify({ status: creation.status })}\n\n`);
            
            if (['completed', 'failed', 'cancelled', 'timed_out'].includes(creation.status)) {
              clearInterval(interval);
              controller.close();
            }
          }
        } catch (error) {
          console.error('SSE polling error:', error);
          clearInterval(interval);
          controller.close();
        }
      }, 5000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
      });
    }
  });

  return new Response(stream, { headers });
}
