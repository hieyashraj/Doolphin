import { getMuapiApiKey } from "../src/lib/generation/muapiCredentials.js";

async function verifyAuthContract() {
  console.log("=== MU API Auth Contract Verification ===");

  const endpoints = [
    { name: "GET /api/v1/models", url: "https://api.muapi.ai/api/v1/models", method: "GET" },
    { name: "GET /api/v1/models/seedance-2-omni-reference-no-video-fast", url: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast", method: "GET" },
    {
      name: "POST /api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
      url: "https://api.muapi.ai/api/v1/models/seedance-2-omni-reference-no-video-fast/estimate-cost",
      method: "POST",
      body: JSON.stringify({ prompt: "Verification prompt", duration: 5 }),
    },
  ];

  let apiKey;
  try {
    apiKey = getMuapiApiKey(process.env);
  } catch (err) {
    console.log("Credential resolution warning:", err.message);
  }

  for (const ep of endpoints) {
    console.log(`\nTesting ${ep.name}...`);

    // 1. Unauthenticated Request
    try {
      const headers = { Accept: "application/json" };
      if (ep.method === "POST") headers["Content-Type"] = "application/json";

      const resUnauth = await fetch(ep.url, {
        method: ep.method,
        headers,
        body: ep.body || undefined,
      });

      console.log(`  Unauthenticated Response: HTTP ${resUnauth.status} ${resUnauth.statusText}`);
    } catch (err) {
      console.log(`  Unauthenticated Error: ${err.message}`);
    }

    // 2. Authenticated Request (if API key available)
    if (apiKey && !apiKey.includes("placeholder")) {
      try {
        const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
        if (ep.method === "POST") headers["Content-Type"] = "application/json";

        const resAuth = await fetch(ep.url, {
          method: ep.method,
          headers,
          body: ep.body || undefined,
        });

        console.log(`  Authenticated Response: HTTP ${resAuth.status} ${resAuth.statusText}`);
      } catch (err) {
        console.log(`  Authenticated Error: ${err.message}`);
      }
    }
  }
}

verifyAuthContract().catch(console.error);
