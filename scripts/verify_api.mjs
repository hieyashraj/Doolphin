import { POST } from "../src/app/api/generate/route.js";
import { GET as getHealth } from "../src/app/api/health/route.js";

async function verifyRoutes() {
  console.log("==================================================");
  console.log("VERIFYING API ROUTES CONTRACT & BEHAVIOR");
  console.log("==================================================\n");

  // 1. Test /api/health pre-flight diagnostic endpoint
  console.log("--- 1. PRE-FLIGHT HEALTH DIAGNOSTIC ENDPOINT ---");
  const healthRes = await getHealth();
  const healthData = await healthRes.json();
  console.log("[PASS] /api/health returned JSON response:", healthData);
  if (!healthData.diagnostics?.isV3Endpoint) {
    throw new Error("Health diagnostic failed to confirm Kling v3 endpoint");
  }

  // 2. Test /api/generate unconfigured key response (must return 503 JSON, never HTML)
  console.log("\n--- 2. UNCONFIGURED KEY JSON GUARANTEE TEST ---");
  const mockReqUnconfigured = {
    json: async () => ({
      modelId: "fal-kling-3-std",
      provider: "FAL",
      prompt: "Test prompt",
      settings: { duration: 5, aspect_ratio: "9:16" }
    })
  };

  const resUnconfigured = await POST(mockReqUnconfigured);
  const dataUnconfigured = await resUnconfigured.json();
  
  console.log(`[PASS] Response status: ${resUnconfigured.status}`);
  console.log(`[PASS] Response code: ${dataUnconfigured.code}`);
  console.log(`[PASS] Response error message: "${dataUnconfigured.error}"`);
  
  if (resUnconfigured.status !== 503 || dataUnconfigured.code !== "PROVIDER_NOT_CONFIGURED") {
    throw new Error(`Expected 503 PROVIDER_NOT_CONFIGURED, received status ${resUnconfigured.status}`);
  }

  // 3. Test /api/generate invalid request validation (must return 400 or 422 JSON)
  console.log("\n--- 3. INVALID REQUEST VALIDATION TEST ---");
  const mockReqInvalid = {
    json: async () => ({
      modelId: "fal-kling-3-std",
      provider: "FAL",
      prompt: "Test prompt",
      images: ["blob:http://localhost:3000/1234"],
      settings: { duration: 5, aspect_ratio: "9:16" }
    })
  };

  const resInvalid = await POST(mockReqInvalid);
  const dataInvalid = await resInvalid.json();

  console.log(`[PASS] Response status: ${resInvalid.status}`);
  console.log(`[PASS] Response code: ${dataInvalid.code}`);
  console.log(`[PASS] Response error message: "${dataInvalid.error}"`);

  if (resInvalid.status !== 422 || dataInvalid.code !== "IMAGE_UPLOAD_ERROR") {
    throw new Error(`Expected 422 IMAGE_UPLOAD_ERROR, received status ${resInvalid.status}`);
  }

  console.log("\n==================================================");
  console.log("ALL API ROUTE CONTRACT TESTS PASSED");
  console.log("==================================================");
}

verifyRoutes().catch(err => {
  console.error("API verification failed:", err);
  process.exit(1);
});
