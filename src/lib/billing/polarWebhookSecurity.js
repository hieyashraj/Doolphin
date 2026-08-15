import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { getPolarConfig } from "./polarEnvironment.js";

export { WebhookVerificationError };

export function verifyAndParsePolarWebhook(rawBody, headersObj) {
  const config = getPolarConfig();
  if (!config?.webhookSecret) {
    const err = new Error("Webhook secret unconfigured");
    err.code = "POLAR_WEBHOOK_SECRET_MISSING";
    throw err;
  }

  // Ensure headersObj is formatted properly for validateEvent
  const headers = {};
  if (headersObj && typeof headersObj.get === "function") {
    for (const key of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const val = headersObj.get(key);
      if (val) headers[key] = val;
    }
  } else if (headersObj && typeof headersObj === "object") {
    for (const [k, v] of Object.entries(headersObj)) {
      headers[k.toLowerCase()] = v;
    }
  }

  // Official @polar-sh/sdk/webhooks validation against raw body & headers
  const event = validateEvent(rawBody, headers, config.webhookSecret);
  return event;
}
