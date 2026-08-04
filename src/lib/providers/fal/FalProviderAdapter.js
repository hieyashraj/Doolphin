import { IProviderAdapter } from '../contracts.js';
import { FalWebhookVerifier } from './FalWebhookVerifier.js';

export class FalProviderAdapter extends IProviderAdapter {
  async validateProviderConfiguration(apiKey) {
    const key = apiKey || process.env.FAL_KEY;
    return Boolean(key && !key.includes('placeholder'));
  }

  async validateRequest(request) {
    return { valid: true };
  }

  async estimateExternalCostMicroUsd(request) {
    const duration = request.duration || 5;
    const isFast = request.modelId?.includes('fast');
    const rate = isFast ? 241900 : 303400; // micro-USD per second
    return rate * duration;
  }

  async prepareAssets(request) {
    return request;
  }

  async buildPayload(request, assets = {}, webhookUrl = '') {
    return {
      prompt: request.prompt || 'Authentic AI UGC video',
      image_url: assets.actor_reference || assets.primary_product || '',
      duration: request.duration || 5,
      aspect_ratio: request.aspectRatio || '9:16',
      webhook_url: webhookUrl
    };
  }

  /**
   * Submits a paid inference request to Fal queue API.
   * Includes X-Fal-No-Retry: 1 header to disable platform-level paid retries.
   */
  async submit(payload, apiKey) {
    const key = apiKey || process.env.FAL_KEY;
    const endpoint = payload.endpoint || 'https://fal.run/bytedance/seedance-2.0/fast/reference-to-video';

    const headers = {
      'Authorization': `Key ${key}`,
      'Content-Type': 'application/json',
      'X-Fal-No-Retry': '1' // Strictly disable automatic paid platform retries
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fal API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      providerRequestId: data.request_id || data.id,
      status: data.status || 'submitted'
    };
  }

  async getStatus(providerRequestId, apiKey) {
    const key = apiKey || process.env.FAL_KEY;
    const response = await fetch(`https://rest.fal.ai/requests/${providerRequestId}/status`, {
      headers: { 'Authorization': `Key ${key}` }
    });

    if (!response.ok) {
      throw new Error(`Fal status check error: ${response.status}`);
    }

    const data = await response.json();
    return this.normalizeStatus(data.status);
  }

  async getResult(providerRequestId, apiKey) {
    const key = apiKey || process.env.FAL_KEY;
    const response = await fetch(`https://rest.fal.ai/requests/${providerRequestId}`, {
      headers: { 'Authorization': `Key ${key}` }
    });

    if (!response.ok) {
      throw new Error(`Fal result fetch error: ${response.status}`);
    }

    return await response.json();
  }

  async cancel(providerRequestId, apiKey) {
    const key = apiKey || process.env.FAL_KEY;
    const response = await fetch(`https://rest.fal.ai/requests/${providerRequestId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}` }
    });
    return response.ok;
  }

  normalizeStatus(status) {
    const s = (status || '').toUpperCase();
    if (s === 'OK' || s === 'COMPLETED') return 'succeeded';
    if (s === 'IN_PROGRESS' || s === 'IN_QUEUE') return 'processing';
    if (s === 'FAILED') return 'failed';
    return 'submitted';
  }

  normalizeError(error) {
    return { code: 'FAL_PROVIDER_ERROR', safeDetail: error.message || 'Fal provider execution error' };
  }

  extractArtifacts(response) {
    const videoUrl = response.video?.url || response.payload?.video?.url || response.url;
    return videoUrl ? [{ type: 'raw_provider_video', url: videoUrl }] : [];
  }

  verifyWebhook(req) {
    return FalWebhookVerifier.verifySignature(req);
  }
}
