import crypto from "crypto";

export function getMuapiWebhookToken() {
  // This is Doolphin's callback-filter secret, not a provider signature and
  // not an auth-framework secret. MuAPI result data is still authenticated by
  // a server-side result fetch before any durable transition.
  const secret = process.env.MUAPI_WEBHOOK_SECRET;
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update("doolphin:muapi:webhook:v1").digest("hex");
}

export function buildMuapiWebhookUrl(baseUrl) {
  const token = getMuapiWebhookToken();
  if (!token) throw new Error("MUAPI_WEBHOOK_SECRET is required to create a Doolphin callback URL");
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
