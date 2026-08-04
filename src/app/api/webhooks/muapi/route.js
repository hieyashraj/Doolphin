import { MuApiProviderAdapter } from '../../../../lib/providers/muapi/MuApiProviderAdapter.js';

export async function POST(req) {
  const adapter = new MuApiProviderAdapter();
  
  const isValid = adapter.verifyWebhook(req);
  if (!isValid) {
    return new Response('Invalid Signature', { status: 401 });
  }

  return new Response('OK', { status: 200 });
}
