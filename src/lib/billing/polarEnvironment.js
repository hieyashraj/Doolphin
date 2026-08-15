// Centralized server-owned Polar environment resolver.
// Rejects implicit NODE_ENV guessing, loose rules, or generic legacy secrets.

export function getPolarConfig() {
  const polarEnv = process.env.POLAR_ENV;
  const doolphinEnv = process.env.DOOLPHIN_ENV;
  const vercelEnv = process.env.VERCEL_ENV;

  // Staging / Local Staging Billing:
  // Must have DOOLPHIN_ENV=staging and POLAR_ENV=sandbox
  // VERCEL_ENV may be "preview" on Vercel or absent in local staging execution
  // Must NEVER be "production"
  const isStaging =
    doolphinEnv === "staging" &&
    polarEnv === "sandbox" &&
    vercelEnv !== "production";

  if (isStaging) {
    const token = process.env.POLAR_SANDBOX_ACCESS_TOKEN;
    const webhookSecret = process.env.POLAR_SANDBOX_WEBHOOK_SECRET;

    if (!token || !webhookSecret) {
      const err = new Error("Polar sandbox credentials incomplete: POLAR_SANDBOX_ACCESS_TOKEN and POLAR_SANDBOX_WEBHOOK_SECRET required");
      err.code = "POLAR_CONFIG_INCOMPLETE";
      throw err;
    }

    const products = {
      EXPLORER: process.env.POLAR_SANDBOX_PRODUCT_EXPLORER || null,
      STARTER_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_STARTER_MONTHLY || null,
      STARTER_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_STARTER_ANNUAL || null,
      GROWTH_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_GROWTH_MONTHLY || null,
      GROWTH_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_GROWTH_ANNUAL || null,
      AGENCY_MONTHLY: process.env.POLAR_SANDBOX_PRODUCT_AGENCY_MONTHLY || null,
      AGENCY_ANNUAL: process.env.POLAR_SANDBOX_PRODUCT_AGENCY_ANNUAL || null,
    };

    return {
      env: "sandbox",
      baseUrl: "https://sandbox-api.polar.sh",
      token,
      webhookSecret,
      products,
    };
  }

  // Production Billing:
  // Must have DOOLPHIN_ENV=production, POLAR_ENV=production, VERCEL_ENV=production
  const isProduction =
    doolphinEnv === "production" &&
    polarEnv === "production" &&
    vercelEnv === "production";

  if (isProduction) {
    const token = process.env.POLAR_PRODUCTION_ACCESS_TOKEN;
    const webhookSecret = process.env.POLAR_PRODUCTION_WEBHOOK_SECRET;

    if (!token || !webhookSecret) {
      const err = new Error("Polar production credentials incomplete: POLAR_PRODUCTION_ACCESS_TOKEN and POLAR_PRODUCTION_WEBHOOK_SECRET required");
      err.code = "POLAR_CONFIG_INCOMPLETE";
      throw err;
    }

    const products = {
      EXPLORER: process.env.POLAR_PRODUCTION_PRODUCT_EXPLORER || null,
      STARTER_MONTHLY: process.env.POLAR_PRODUCTION_PRODUCT_STARTER_MONTHLY || null,
      STARTER_ANNUAL: process.env.POLAR_PRODUCTION_PRODUCT_STARTER_ANNUAL || null,
      GROWTH_MONTHLY: process.env.POLAR_PRODUCTION_PRODUCT_GROWTH_MONTHLY || null,
      GROWTH_ANNUAL: process.env.POLAR_PRODUCTION_PRODUCT_GROWTH_ANNUAL || null,
      AGENCY_MONTHLY: process.env.POLAR_PRODUCTION_PRODUCT_AGENCY_MONTHLY || null,
      AGENCY_ANNUAL: process.env.POLAR_PRODUCTION_PRODUCT_AGENCY_ANNUAL || null,
    };

    return {
      env: "production",
      baseUrl: "https://api.polar.sh",
      token,
      webhookSecret,
      products,
    };
  }

  // Contradictory, unconfigured, or ambiguous environment signals -> FAIL CLOSED
  const err = new Error(`Ambiguous or unconfigured Polar environment. POLAR_ENV="${polarEnv}", DOOLPHIN_ENV="${doolphinEnv}", VERCEL_ENV="${vercelEnv}"`);
  err.code = "POLAR_CONFIG_AMBIGUOUS";
  throw err;
}
