/**
 * Canonical JSON Error Contract for Doolphin Platform.
 * Section 22 Compliance.
 */

export const ERROR_CODES = {
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_AUTHENTICATION_ERROR: "PROVIDER_AUTHENTICATION_ERROR",
  PROVIDER_BAD_REQUEST: "PROVIDER_BAD_REQUEST",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_NETWORK_ERROR: "PROVIDER_NETWORK_ERROR",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_RESULT_INVALID: "PROVIDER_RESULT_INVALID",
  MODEL_PRICING_UNVERIFIED: "MODEL_PRICING_UNVERIFIED",
  MODEL_CAPABILITY_UNSUPPORTED: "MODEL_CAPABILITY_UNSUPPORTED",
  PRODUCT_FIDELITY_UNSUPPORTED: "PRODUCT_FIDELITY_UNSUPPORTED",
  APP_UI_FIDELITY_UNSUPPORTED: "APP_UI_FIDELITY_UNSUPPORTED",
  INVALID_ASSET: "INVALID_ASSET",
  ASSET_VALIDATION_FAILED: "ASSET_VALIDATION_FAILED",
  STORAGE_FAILED: "STORAGE_FAILED",
  FINAL_ARTIFACT_INVALID: "FINAL_ARTIFACT_INVALID",
  CREDIT_RESERVATION_FAILED: "CREDIT_RESERVATION_FAILED",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  BUDGET_LIMIT_EXCEEDED: "BUDGET_LIMIT_EXCEEDED",
  CIRCUIT_BREAKER_OPEN: "CIRCUIT_BREAKER_OPEN",
  SUBMISSION_UNKNOWN: "SUBMISSION_UNKNOWN",
  JOB_TIMED_OUT: "JOB_TIMED_OUT",
  JOB_CANCELLED: "JOB_CANCELLED",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  DATABASE_ERROR: "DATABASE_ERROR",
  QUEUE_DISPATCH_FAILED: "QUEUE_DISPATCH_FAILED",
  WEBHOOK_SIGNATURE_INVALID: "WEBHOOK_SIGNATURE_INVALID",
  WEBHOOK_REPLAY_REJECTED: "WEBHOOK_REPLAY_REJECTED",
};

export class AppError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? 400;
    this.creationId = options.creationId ?? undefined;
    this.variantId = options.variantId ?? undefined;
    this.stage = options.stage ?? undefined;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.creationId && { creationId: this.creationId }),
        ...(this.variantId && { variantId: this.variantId }),
        ...(this.stage && { stage: this.stage }),
      },
    };
  }
}

export function formatErrorResponse(error, fallbackCode = ERROR_CODES.DATABASE_ERROR, statusCode = 500) {
  if (error instanceof AppError) {
    return {
      status: error.statusCode,
      body: error.toJSON(),
    };
  }

  const safeMessage = process.env.NODE_ENV === "production" ? "An internal platform error occurred." : error.message;

  return {
    status: statusCode,
    body: {
      success: false,
      error: {
        code: fallbackCode,
        message: safeMessage,
        retryable: false,
      },
    },
  };
}
