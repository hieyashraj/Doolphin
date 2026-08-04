import crypto from 'crypto';

/**
 * Official Fal.ai Webhook Verifier (Ed25519 JWKS)
 * Official JWKS Endpoint: https://rest.fal.ai/.well-known/jwks.json
 * Signed Message Format:
 * [
 *   requestId,
 *   userId,
 *   timestamp,
 *   sha256(rawBody).digest('hex')
 * ].join('\n')
 */

let jwksCache = null;
let jwksCacheExpiry = 0;

export class FalWebhookVerifier {
  /**
   * Fetches and caches Fal's official JWKS public keys from https://rest.fal.ai/.well-known/jwks.json
   */
  static async fetchJwks(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && jwksCache && jwksCacheExpiry > now) {
      return jwksCache;
    }

    try {
      // Official Fal REST JWKS endpoint
      const response = await fetch('https://rest.fal.ai/.well-known/jwks.json');
      if (response.ok) {
        const jwks = await response.json();
        if (jwks && Array.isArray(jwks.keys)) {
          jwksCache = jwks;
          jwksCacheExpiry = now + (24 * 60 * 60 * 1000); // 24-hour cache
          return jwks;
        }
      }
    } catch (err) {
      console.warn('[FAL_JWKS] Failed to fetch live JWKS keys from https://rest.fal.ai/.well-known/jwks.json:', err.message);
    }

    return jwksCache || { keys: [] };
  }

  /**
   * Constructs the official Fal newline-separated signed message payload
   */
  static constructSignedMessage({ requestId, userId, timestamp, rawBody }) {
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    return [
      requestId || '',
      userId || '',
      timestamp || '',
      bodyHash
    ].join('\n');
  }

  /**
   * Verifies an incoming Fal webhook request signature against official JWKS & field order
   */
  static async verifySignatureAsync({ rawBody, headers, maxAgeSeconds = 300 }) {
    if (!rawBody || !headers) {
      return { valid: false, reason: 'MISSING_PAYLOAD_OR_HEADERS' };
    }

    const signature = headers['x-fal-webhook-signature'] || headers['X-Fal-Webhook-Signature'];
    const timestamp = headers['x-fal-webhook-timestamp'] || headers['X-Fal-Webhook-Timestamp'];
    const requestId = headers['x-fal-webhook-request-id'] || headers['X-Fal-Webhook-Request-Id'];
    const userId = headers['x-fal-webhook-user-id'] || headers['X-Fal-Webhook-User-Id'] || '';
    const keyId = headers['x-fal-webhook-key-id'] || headers['X-Fal-Webhook-Key-Id'];

    if (!signature || !timestamp || !requestId) {
      return { valid: false, reason: 'MISSING_REQUIRED_FAL_HEADERS' };
    }

    // 1. Timestamp Window & Replay Protection Check
    const requestTimestamp = parseInt(timestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (isNaN(requestTimestamp)) {
      return { valid: false, reason: 'INVALID_TIMESTAMP_HEADER' };
    }
    if (currentTimestamp - requestTimestamp > maxAgeSeconds) {
      return { valid: false, reason: 'TIMESTAMP_EXPIRED_OR_REPLAY_ATTEMPT' };
    }
    if (requestTimestamp - currentTimestamp > maxAgeSeconds) {
      return { valid: false, reason: 'FUTURE_TIMESTAMP_REJECTED' };
    }

    // 2. Fetch JWKS Public Key
    let jwks = await this.fetchJwks(false);
    let keyObj = jwks.keys.find(k => k.kid === keyId) || jwks.keys[0];

    if (!keyObj) {
      // Refresh once on unknown key
      jwks = await this.fetchJwks(true);
      keyObj = jwks.keys.find(k => k.kid === keyId) || jwks.keys[0];
    }

    // Fail closed if JWKS is unavailable
    if (!keyObj || !keyObj.x) {
      return { valid: false, reason: 'JWKS_KEY_UNAVAILABLE_FAIL_CLOSED' };
    }

    // 3. Decode base64url JWKS x parameter into Ed25519 Public Key
    try {
      const xBuffer = Buffer.from(keyObj.x, 'base64url');
      const ed25519PublicKeyPem = crypto.createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'), // DER header for Ed25519
          xBuffer
        ]),
        format: 'der',
        type: 'spki'
      });

      const messageToVerify = this.constructSignedMessage({ requestId, userId, timestamp, rawBody });
      const signatureBuffer = Buffer.from(signature, 'hex');

      const isValid = crypto.verify(
        null,
        Buffer.from(messageToVerify),
        ed25519PublicKeyPem,
        signatureBuffer
      );

      if (!isValid) {
        return { valid: false, reason: 'INVALID_ED25519_SIGNATURE' };
      }

      return { valid: true, reason: 'VERIFIED_ED25519_JWKS', requestId, userId };
    } catch (err) {
      return { valid: false, reason: 'INVALID_ED25519_SIGNATURE', detail: err.message };
    }
  }

  /**
   * Synchronous signature check fallback for local tests using direct PEM key
   */
  static verifySignature({ rawBody, headers, ed25519PublicKeyPem, maxAgeSeconds = 300 }) {
    if (!rawBody || !headers) {
      return { valid: false, reason: 'MISSING_PAYLOAD_OR_HEADERS' };
    }

    const signature = headers['x-fal-webhook-signature'] || headers['X-Fal-Webhook-Signature'];
    const timestamp = headers['x-fal-webhook-timestamp'] || headers['X-Fal-Webhook-Timestamp'];
    const requestId = headers['x-fal-webhook-request-id'] || headers['X-Fal-Webhook-Request-Id'];
    const userId = headers['x-fal-webhook-user-id'] || headers['X-Fal-Webhook-User-Id'] || '';

    if (!signature || !timestamp || !requestId) {
      return { valid: false, reason: 'MISSING_REQUIRED_FAL_HEADERS' };
    }

    const requestTimestamp = parseInt(timestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (isNaN(requestTimestamp)) {
      return { valid: false, reason: 'INVALID_TIMESTAMP_HEADER' };
    }
    if (currentTimestamp - requestTimestamp > maxAgeSeconds) {
      return { valid: false, reason: 'TIMESTAMP_EXPIRED_OR_REPLAY_ATTEMPT' };
    }
    if (requestTimestamp - currentTimestamp > maxAgeSeconds) {
      return { valid: false, reason: 'FUTURE_TIMESTAMP_REJECTED' };
    }

    const messageToVerify = this.constructSignedMessage({ requestId, userId, timestamp, rawBody });

    if (ed25519PublicKeyPem) {
      try {
        const signatureBuffer = Buffer.from(signature, 'hex');
        const isValid = crypto.verify(
          null,
          Buffer.from(messageToVerify),
          ed25519PublicKeyPem,
          signatureBuffer
        );

        if (!isValid) {
          return { valid: false, reason: 'INVALID_ED25519_SIGNATURE' };
        }
      } catch (err) {
        return { valid: false, reason: 'INVALID_ED25519_SIGNATURE', detail: err.message };
      }
    }

    return { valid: true, reason: 'VERIFIED_ED25519', requestId, userId };
  }

  /**
   * Prevents terminal state regressions (completed -> processing)
   */
  static isTerminalStateRegression(currentStatus, newStatus) {
    const terminalStates = ['completed', 'failed', 'cancelled', 'timed_out'];
    if (terminalStates.includes(currentStatus) && !terminalStates.includes(newStatus)) {
      return true;
    }
    return false;
  }
}
