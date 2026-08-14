/**
 * Centralized, server-owned MuAPI credential resolver.
 * Environment mode comes strictly from trusted server process configuration (DOOLPHIN_ENV / VERCEL_ENV / NODE_ENV),
 * never from client request parameters, headers, or user input.
 */
export function getMuapiApiKey(env = process.env) {
  const isStaging = env.DOOLPHIN_ENV === "staging";
  const isProduction = env.VERCEL_ENV === "production" || (env.NODE_ENV === "production" && env.DOOLPHIN_ENV !== "staging");

  if (isStaging) {
    const sandboxKey = env.MUAPI_API_KEY_SANDBOX;
    if (!sandboxKey || sandboxKey.includes("placeholder")) {
      const error = new Error("MuAPI sandbox credential MUAPI_API_KEY_SANDBOX is missing or invalid in staging.");
      error.code = "SANDBOX_CREDENTIAL_UNAVAILABLE";
      throw error;
    }
    return sandboxKey;
  }

  if (isProduction) {
    const prodKey = env.MUAPI_API_KEY;
    if (!prodKey || prodKey.includes("placeholder")) {
      const error = new Error("MuAPI production credential MUAPI_API_KEY is missing or unconfigured.");
      error.code = "MUAPI_CREDENTIAL_UNAVAILABLE";
      throw error;
    }
    return prodKey;
  }

  // Default local/development mode: Require MUAPI_API_KEY_SANDBOX to fail closed against live production API keys
  const sandboxKey = env.MUAPI_API_KEY_SANDBOX;
  if (!sandboxKey || sandboxKey.includes("placeholder")) {
    const error = new Error("Sandbox provider credential MUAPI_API_KEY_SANDBOX is required for local testing.");
    error.code = "SANDBOX_CREDENTIAL_UNAVAILABLE";
    throw error;
  }
  return sandboxKey;
}
