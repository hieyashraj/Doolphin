async function testLiveServer() {
  console.log("==================================================");
  console.log("TESTING RUNNING LOCALHOST SERVER ON PORT 3000");
  console.log("==================================================\n");

  // 1. Health check
  console.log("--- 1. TESTING GET /api/health ---");
  const healthRes = await fetch("http://localhost:3000/api/health");
  console.log("Health Status Code:", healthRes.status);
  console.log("Health Content-Type:", healthRes.headers.get("content-type"));
  const healthData = await healthRes.json();
  console.log("Health Body:", healthData);

  // 2. Generate POST with unconfigured key (must return 503 JSON, never HTML)
  console.log("\n--- 2. TESTING POST /api/generate (UNCONFIGURED FAL_KEY) ---");
  const genRes = await fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "fal-kling-3-std",
      provider: "FAL",
      prompt: "Test prompt",
      settings: { duration: 5, aspect_ratio: "9:16" }
    })
  });
  console.log("Generate Status Code:", genRes.status);
  console.log("Generate Content-Type:", genRes.headers.get("content-type"));
  const genData = await genRes.json();
  console.log("Generate Body:", genData);

  // 3. Generate POST with custom key & invalid image (must return 422 IMAGE_UPLOAD_ERROR JSON)
  console.log("\n--- 3. TESTING POST /api/generate (CUSTOM KEY + INVALID BLOB URL) ---");
  const genInvalidRes = await fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customFalKey: "fal_key_test_value",
      modelId: "fal-kling-3-std",
      provider: "FAL",
      prompt: "Test prompt",
      images: ["blob:http://localhost:3000/test-blob-id"],
      settings: { duration: 5, aspect_ratio: "9:16" }
    })
  });
  console.log("Generate Invalid Status Code:", genInvalidRes.status);
  console.log("Generate Invalid Content-Type:", genInvalidRes.headers.get("content-type"));
  const genInvalidData = await genInvalidRes.json();
  console.log("Generate Invalid Body:", genInvalidData);
}

testLiveServer().catch(err => {
  console.error("Live server test failed:", err);
  process.exit(1);
});
