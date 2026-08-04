import { IProviderAdapter } from '../contracts.js';
import crypto from 'crypto';

export class ElevenLabsAdapter extends IProviderAdapter {
  async validateProviderConfiguration() { return true; }
  async validateRequest(request) { return true; }
  async estimateExternalCostMicroUsd(request) { return 500; }
  async prepareAssets(request) { return request; }
  async buildPayload(request) { return { ...request }; }
  async submit(payload) { 
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return { jobId: `elevenlabs-${hash}` }; 
  }
  async getStatus(jobId) { return { status: 'completed' }; }
  async getResult(jobId) { return { result: 'audio_url' }; }
  async cancel(jobId) { return true; }
  normalizeStatus(status) { return status === 'done' ? 'completed' : 'processing'; }
  normalizeError(error) { return new Error(error.message); }
  extractArtifacts(response) { return response.data; }
  verifyWebhook(req) { return true; }
}
