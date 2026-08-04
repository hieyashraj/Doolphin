import { IProviderAdapter } from '../contracts.js';

export class LipSyncAdapter extends IProviderAdapter {
  async validateProviderConfiguration() { return true; }
  async validateRequest(request) { return true; }
  async estimateExternalCostMicroUsd(request) { return 1500; }
  async prepareAssets(request) { return request; }
  async buildPayload(request) { return { ...request }; }
  async submit(payload) { return { jobId: 'lipsync-job-123' }; }
  async getStatus(jobId) { return { status: 'completed' }; }
  async getResult(jobId) { return { result: 'video_url' }; }
  async cancel(jobId) { return true; }
  normalizeStatus(status) { return status === 'completed' ? 'completed' : 'processing'; }
  normalizeError(error) { return new Error(error.message); }
  extractArtifacts(response) { return response.data; }
  verifyWebhook(req) { return true; }
}
