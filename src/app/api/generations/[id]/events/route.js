import { requireActivatedAccount } from "@/lib/access/authorization";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  let appUser; try { ({ appUser } = await requireActivatedAccount()); } catch (error) { return new Response(error.code || "UNAUTHENTICATED", { status: error.status || 401 }); }
  const { id } = await params;
  const owned = await prisma.creation.findFirst({ where: { id, userId: appUser.id }, select: { id: true } });
  if (!owned) return new Response("Not found", { status: 404 });
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ message: "connected" })}\n\n`));
      const interval = setInterval(async () => {
        try {
          const creation = await prisma.creation.findFirst({ where: { id, userId: appUser.id }, select: { status: true, currentStage: true, progressValue: true } });
          if (!creation) throw new Error("Creation no longer available");
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(creation)}\n\n`));
          if (["COMPLETED", "PARTIAL_COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "QUARANTINED"].includes(creation.status)) { clearInterval(interval); controller.close(); }
        } catch { clearInterval(interval); controller.close(); }
      }, 5000);
      request.signal.addEventListener("abort", () => clearInterval(interval));
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
