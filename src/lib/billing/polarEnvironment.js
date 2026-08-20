// Server-owned Polar environment resolver.
//
// THE ENVIRONMENT IS DETECTED AUTOMATICALLY from VERCEL_ENV — the one variable
// Vercel already sets for every deployment — so there is nothing to configure to
// switch between test and live billing, and no DOOLPHIN_ENV / POLAR_ENV flags to
// remember:
//
//   VERCEL_ENV === "production"   ->  LIVE Polar   (https://api.polar.sh)
//   anything else (preview/dev)   ->  SANDBOX Polar (https://sandbox-api.polar.sh)
//
// This makes it structurally impossible to run sandbox billing on the live
// domain, or live billing on a preview — without anyone remembering a flag.
//
// CREDENTIALS are read tier-first with a generic fallback, so whichever names you
// already added to Vercel are picked up:
//   live:    POLAR_PRODUCTION_*   then  POLAR_*
//   sandbox: POLAR_SANDBOX_*       then  POLAR_*
//
// If the resolved tier is missing an access token or webhook secret, it FAILS
// CLOSED (throws) — checkout refuses rather than guessing. A wrong-tier token
// (e.g. a sandbox token on the live domain) can only ever fail the Polar API
// call; it can never silently mischarge.

const PLAN_CODES = [
  "EXPLORER",
  "STARTER_MONTHLY",
  "STARTER_ANNUAL",
  "GROWTH_MONTHLY",
  "GROWTH_ANNUAL",
  "AGENCY_MONTHLY",
  "AGENCY_ANNUAL",
];

export function getPolarConfig() {
  const env = process.env;
  const isProduction = env.VERCEL_ENV === "production";
  const tier = isProduction ? "PRODUCTION" : "SANDBOX";

  // Tier-specific name first, then the generic POLAR_* name.
  const pick = (suffix) => env[`POLAR_${tier}_${suffix}`] || env[`POLAR_${suffix}`] || null;

  const token = pick("ACCESS_TOKEN");
  const webhookSecret = pick("WEBHOOK_SECRET");

  if (!token || !webhookSecret) {
    const err = new Error(
      `Polar ${tier.toLowerCase()} credentials incomplete: an access token and webhook secret are required ` +
        `(POLAR_${tier}_ACCESS_TOKEN + POLAR_${tier}_WEBHOOK_SECRET, or the generic POLAR_ACCESS_TOKEN + POLAR_WEBHOOK_SECRET).`
    );
    err.code = "POLAR_CONFIG_INCOMPLETE";
    throw err;
  }

  const products = {};
  for (const code of PLAN_CODES) products[code] = pick(`PRODUCT_${code}`);

  return {
    env: isProduction ? "production" : "sandbox",
    baseUrl: isProduction ? "https://api.polar.sh" : "https://sandbox-api.polar.sh",
    token,
    webhookSecret,
    products,
  };
}
