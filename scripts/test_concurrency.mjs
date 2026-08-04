async function testLiveConcurrency() {
  console.log("==================================================");
  console.log("TESTING LIVE SERVER SIMULTANEOUS CONCURRENCY & IDEMPOTENCY");
  console.log("==================================================\n");

  const idempotencyKey = `live_concurrent_${Date.now()}`;

  const payload = {
    idempotencyKey,
    modelId: "fal-kling-3-std",
    provider: "FAL",
    customFalKey: "fal_key_concurrency_test",
    prompt: "A realistic avatar presenting a cosmetic serum bottle",
    images: ["/avatars/Andrew E1.png"],
    settings: { duration: 5, aspect_ratio: "9:16" }
  };

  console.log("Dispatching 2 SIMULTANEOUS HTTP POST requests to http://localhost:3000/api/generate...");

  const fetchAttempt = () => fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const [res1, res2] = await Promise.all([
    fetchAttempt(),
    fetchAttempt()
  ]);

  const data1 = await res1.json();
  const data2 = await res2.json();

  console.log("\n--- SIMULTANEOUS RESPONSES ---");
  console.log("Request 1 Status:", res1.status, "Body:", data1);
  console.log("Request 2 Status:", res2.status, "Body:", data2);

  const creationId1 = data1.creationId || data1.generationId;
  const creationId2 = data2.creationId || data2.generationId;

  console.log(`Creation ID 1: ${creationId1}`);
  console.log(`Creation ID 2: ${creationId2}`);

  if (data1.success && data2.success) {
    if (creationId1 === creationId2) {
      console.log("[PASS] Both concurrent requests matched the EXACT SAME creation record!");
    } else {
      throw new Error("Concurrency Failure! Different creation IDs were returned for identical idempotency key.");
    }
  }

  console.log("\n==================================================");
  console.log("SIMULTANEOUS CONCURRENCY & IDEMPOTENCY TEST PASSED!");
  console.log("==================================================");
}

testLiveConcurrency().catch(err => {
  console.error("Live concurrency test failed:", err);
  process.exit(1);
});
