export class IProviderAdapter {
  async validateProviderConfiguration() { throw new Error('Not implemented'); }
  async validateRequest(request) { throw new Error('Not implemented'); }
  async estimateExternalCostMicroUsd(request) { throw new Error('Not implemented'); }
  async prepareAssets(request) { throw new Error('Not implemented'); }
  async buildPayload(request) { throw new Error('Not implemented'); }
  async submit(payload) { throw new Error('Not implemented'); }
  async getStatus(jobId) { throw new Error('Not implemented'); }
  async getResult(jobId) { throw new Error('Not implemented'); }
  async cancel(jobId) { throw new Error('Not implemented'); }
  normalizeStatus(status) { throw new Error('Not implemented'); }
  normalizeError(error) { throw new Error('Not implemented'); }
  extractArtifacts(response) { throw new Error('Not implemented'); }
  verifyWebhook(req) { throw new Error('Not implemented'); }
}
