import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { FalWebhookVerifier } from '../../../../lib/providers/fal/FalWebhookVerifier.js';

export async function POST(req) {
  try {
    const rawBody = await req.text();
    const headers = Object.fromEntries(req.headers.entries());

    // 1. Verify Ed25519 Signature & Timestamp Window
    const verification = await FalWebhookVerifier.verifySignatureAsync({ rawBody, headers });
    if (!verification.valid) {
      console.warn('[FAL_WEBHOOK_REJECTED]', verification.reason);
      return new Response(`Unauthorized: ${verification.reason}`, { status: 401 });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON Body', { status: 400 });
    }

    const providerRequestId = headers['x-fal-webhook-request-id'] || payload.request_id || payload.id;
    const gatewayRequestId = headers['x-fal-webhook-gateway-id'] || `gw_${Date.now()}`;
    const payloadHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const incomingStatus = payload.status || 'OK';

    // 2. Persistent Webhook Event Identity Check (WebhookInbox)
    const existingInboxEvent = await prisma.webhookInbox.findUnique({
      where: { providerRequestId }
    });

    if (existingInboxEvent) {
      console.log('[FAL_WEBHOOK_DUPLICATE_IGNORED]', { providerRequestId, status: incomingStatus });
      // Return HTTP 200 OK immediately without performing any duplicated business actions
      return NextResponse.json({ success: true, duplicate: true, message: 'Event already processed' }, { status: 200 });
    }

    // 3. Atomically Record Webhook Inbox Event
    await prisma.webhookInbox.create({
      data: {
        provider: 'fal',
        providerRequestId,
        payload: rawBody,
        status: 'processed'
      }
    });

    // 4. Update Creation & Variant State (Guarding against terminal state regressions)
    const providerJob = await prisma.providerJob.findFirst({
      where: { providerRequestId }
    });

    if (providerJob) {
      const variant = await prisma.creationVariant.findUnique({
        where: { id: providerJob.creationVariantId }
      });

      if (variant && FalWebhookVerifier.isTerminalStateRegression(variant.status, incomingStatus.toLowerCase())) {
        console.warn('[FAL_WEBHOOK_REGRESSION_BLOCKED]', { variantId: variant.id, currentStatus: variant.status, incomingStatus });
        return NextResponse.json({ success: true, regressionBlocked: true }, { status: 200 });
      }

      if (incomingStatus === 'OK' || incomingStatus === 'COMPLETED') {
        const videoUrl = payload.payload?.video?.url || payload.video?.url;
        await prisma.$transaction([
          prisma.providerJob.update({
            where: { id: providerJob.id },
            data: { canonicalStatus: 'succeeded', completedAt: new Date() }
          }),
          prisma.creationVariant.update({
            where: { id: providerJob.creationVariantId },
            data: { status: 'completed' }
          })
        ]);
      }
    }

    return NextResponse.json({ success: true, processed: true }, { status: 200 });

  } catch (error) {
    console.error('[FAL_WEBHOOK_FATAL_ERROR]', error);
    return new Response(`Server Error: ${error.message}`, { status: 500 });
  }
}
