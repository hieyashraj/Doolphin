export class PaidStageExecutor {
  constructor(budgetService, db) {
    this.budgetService = budgetService;
    this.db = db;
  }

  async executeStage(userId, stageId, provider, payload) {
    const isIdempotent = await this.checkIdempotency(stageId);
    if (!isIdempotent) {
      throw new Error('Stage has already been executed');
    }

    const estimatedCost = await provider.estimateExternalCostMicroUsd(payload);
    await this.budgetService.reserveFunds(userId, estimatedCost);

    try {
      const submissionLock = await this.acquireSubmissionLock(stageId);
      if (!submissionLock) throw new Error('Failed to acquire submission lock');

      const result = await provider.submit(payload);
      return result;
    } catch (error) {
      if (this.isUnknownSubmissionError(error)) {
        await this.handleUnknownSubmission(stageId, error);
      }
      throw error;
    }
  }

  async checkIdempotency(stageId) {
    // Check DB for existing stage
    return true; 
  }

  async acquireSubmissionLock(stageId) {
    return true; 
  }

  isUnknownSubmissionError(error) {
    return error.code === 'ECONNRESET' || error.message.includes('timeout');
  }

  async handleUnknownSubmission(stageId, error) {
    // Log for manual review, zero auto-retries
    console.error(`Submission unknown for stage ${stageId}:`, error);
  }
}
