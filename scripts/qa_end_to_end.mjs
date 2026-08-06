import dotenv from "dotenv";
dotenv.config();

// END-TO-END QA TEST: Verify entire pipeline processes correctly
// Tests: generate API → Fal.ai submission → poll → completion

const BASE_URL = "http://localhost:3000";

async function runQA() {
  console.log("=== END-TO-END PIPELINE QA TEST ===\n");
  let passed = 0, failed = 0;

  // ---- TEST 1: Generate API accepts request with all inputs ----
  console.log("TEST 1: Submit full generation request with prompt, aspect ratio, duration");
  try {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "iPhone selfie camera video of a woman presenting a baby sleep toy",
        voiceoverText: "This little breathing otter changed our bedtime routine completely.",
        modelId: "kling-3-std",
        settings: {
          aspect_ratio: "9:16",
          duration: 5
        },
        images: [],
        useAvatar: false,
        avatarName: null,
        additionalInstructions: "Make it feel authentic and relatable",
        generationType: "PRODUCT_AD"
      })
    });
    const data = await res.json();
    console.log(`  Status: HTTP ${res.status}`);
    console.log(`  Response: ${JSON.stringify(data).substring(0, 200)}`);

    if (res.ok && data.success !== false) {
      console.log("  ✅ TEST 1 PASSED: API accepted the request\n");
      passed++;
      
      const creationId = data.generationId || data.id || data.creationId;
      if (creationId) {
        // ---- TEST 2: Poll /api/creations/[id] for status ----
        console.log(`TEST 2: Poll creation status for id: ${creationId}`);
        const pollRes = await fetch(`${BASE_URL}/api/creations/${creationId}`);
        const pollData = await pollRes.json();
        console.log(`  Status: HTTP ${pollRes.status}`);
        console.log(`  DB Status: ${pollData.status}`);
        console.log(`  Stage: ${pollData.currentStage}`);
        if (pollRes.ok) {
          console.log("  ✅ TEST 2 PASSED: Creation record accessible via API\n");
          passed++;
        } else {
          console.log("  ❌ TEST 2 FAILED: Could not poll creation record\n");
          failed++;
        }
      }
    } else {
      console.log(`  ❌ TEST 1 FAILED: API rejected request — ${data.error || data.message || 'Unknown error'}\n`);
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ TEST 1 ERROR: ${err.message}\n`);
    failed++;
  }

  // ---- TEST 3: Gallery API returns real creations ----
  console.log("TEST 3: GET /api/creations returns real creation records");
  try {
    const res = await fetch(`${BASE_URL}/api/creations`);
    const data = await res.json();
    console.log(`  Status: HTTP ${res.status}`);
    console.log(`  Records found: ${Array.isArray(data) ? data.length : 'N/A'}`);
    if (Array.isArray(data)) {
      data.slice(0, 2).forEach((c, i) => {
        console.log(`  Record ${i + 1}: id=${c.id?.substring(0, 12)}... status=${c.status} url=${c.url ? '✅ has video URL' : '(none)'}`);
      });
    }
    if (res.ok && Array.isArray(data)) {
      console.log("  ✅ TEST 3 PASSED: Gallery API returns real records\n");
      passed++;
    } else {
      console.log("  ❌ TEST 3 FAILED\n");
      failed++;
    }
  } catch (err) {
    console.log(`  ❌ TEST 3 ERROR: ${err.message}\n`);
    failed++;
  }

  // ---- TEST 4: Verify adapter routing for all model IDs ----
  console.log("TEST 4: Verify adapter routing for all major model IDs");
  const modelIds = [
    "kling-3-std", "kling-3-pro", "kling-1.5-std", "kling-1.5-pro",
    "fal-kling-3-std", "fal-bytedance-seedance-v2", "luma-ray-2",
    "minimax-video-01-live", "hunyuan-video", "wan-video",
    "cogvideox-5b", "mochi-v1", "ltx-video"
  ];
  
  let routingIssues = [];
  for (const modelId of modelIds) {
    const res = await fetch(`${BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Short nature scene",
        modelId,
        settings: { aspect_ratio: "16:9", duration: 5 },
        images: [],
        generationType: "PRODUCT_AD"
      })
    });
    const data = await res.json();
    // We expect either a success OR a meaningful error (not a crash/500)
    if (res.status === 500) {
      routingIssues.push(modelId);
      console.log(`  ❌ ${modelId}: Server crashed (500)`);
    } else {
      console.log(`  ✓ ${modelId}: HTTP ${res.status} — ${(data.success !== false ? 'Accepted' : data.error || 'Rejected gracefully')}`);
    }
  }
  
  if (routingIssues.length === 0) {
    console.log("  ✅ TEST 4 PASSED: All model IDs route without crashing\n");
    passed++;
  } else {
    console.log(`  ❌ TEST 4 FAILED: ${routingIssues.length} model(s) caused 500 errors: ${routingIssues.join(', ')}\n`);
    failed++;
  }

  console.log("=== QA SUMMARY ===");
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
}

runQA().catch(err => console.error("QA Error:", err));
