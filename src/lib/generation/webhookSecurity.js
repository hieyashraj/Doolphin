import crypto from "crypto";

export function getMuapiWebhookToken() {
  const secret = process.env.MUAPI_WEBHOOK_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update("doolphin:muapi:webhook:v1").digest("hex");
}

export function buildMuapiWebhookUrl(baseUrl) {
  const token = getMuapiWebhookToken();
  if (!token) throw new Error("MUAPI_WEBHOOK_SECRET or NEXTAUTH_SECRET is required");
  const url = new URL("/api/webhooks/muapi", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function verifyMuapiWebhookUrl(url) {
  const expected = getMuapiWebhookToken();
  const received = new URL(url).searchParams.get("token");
  if (!expected || !received || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
