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
// TEST-ON-YOUR-REAL-DOMAIN ESCAPE HATCH:
// Preview deployments get a NEW url on every push, which is impossible to pin a
// Polar webhook to. To validate the full sandbox flow on your STABLE production
// URL (so one registered webhook keeps working), set POLAR_TEST_MODE=true. It
// forces the SANDBOX tier even on the production deployment.
//
//   * It can only ever select TEST billing, so it can NEVER take real money.
//   * Polar shows a visible "test mode" banner on the checkout while it is on.
//   * REMOVE IT (and add your POLAR_PRODUCTION_* keys) before charging real
//     customers, or every "purchase" on your live site will be a free test order.
//   A warning is logged on every production request while it is enabled.
//
// CREDENTIALS are read tier-first with a generic fallback, so whichever names you
// already added to Vercel are picked up:
//   live:    POLAR_PRODUCTION_*   then  POLAR_*
//   sandbox: POLAR_SANDBOX_*       then  POLAR_*
//
// If the resolved tier is missing an access token or webhook secret, it FAILS
// CLOSED (throws) — checkout refuses rather than guessing. A wrong-tier token
// can only ever fail the Polar API call; it can never silently mischarge.

const PLAN_CODES = [
  "EXPLORER",
  "STARTER_MONTHLY",
  "STARTER_ANNUAL",
  "GROWTH_MONTHLY",
  "GROWTH_ANNUAL",
  "AGENCY_MONTHLY",
  "AGENCY_ANNUAL",
];

function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test((value || "").trim());
}

export function getPolarConfig() {
  const env = process.env;
  const forceSandbox = isTruthyFlag(env.POLAR_TEST_MODE);
  const onProductionDeploy = env.VERCEL_ENV === "production";
  const isProduction = onProductionDeploy && !forceSandbox;
  const tier = isProduction ? "PRODUCTION" : "SANDBOX";

  // Loud breadcrumb: forcing test billing on the live deployment is intentional
  // for validation but must not be left on for real customers.
  if (forceSandbox && onProductionDeploy) {
    console.warn("[polar] POLAR_TEST_MODE is ON: the production deployment is using SANDBOX billing. Remove POLAR_TEST_MODE before charging real customers.");
  }

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
