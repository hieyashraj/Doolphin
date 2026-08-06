import dotenv from "dotenv";

dotenv.config();

async function testFastGen() {
  const falKey = process.env.FAL_KEY;
  console.log("Submitting request to fal-ai/kling-video/v1.5/pro/text-to-video...");

  const ep = "https://queue.fal.run/fal-ai/kling-video/v1.5/pro/text-to-video";
  const res = await fetch(ep, {
    method: "POST",
    headers: {
      "Authorization": `Key ${falKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt: "A beautiful serene sunset over calm ocean waves with gentle motion",
      aspect_ratio: "16:9",
      duration: "5"
    })
  });

  const data = await res.json();
  console.log("Fal Kling Pro Response:", JSON.stringify(data, null, 2));

  if (data.status_url) {
    console.log("\nPolling Fal status URL:", data.status_url);
    for (let i = 1; i <= 60; i++) {
      const statusRes = await fetch(data.status_url, {
        headers: { Authorization: `Key ${falKey}` }
      });
      const statusData = await statusRes.json();
      console.log(`[Attempt #${i}] Status: ${statusData.status}`);

      if (statusData.status === "COMPLETED") {
        const resultRes = await fetch(data.response_url, {
          headers: { Authorization: `Key ${falKey}` }
        });
        const resultData = await resultRes.json();
        console.log("Result data:", JSON.stringify(resultData, null, 2));

        const videoUrl = resultData.video?.url || resultData.videos?.[0]?.url || resultData.url;
        if (videoUrl) {
          console.log("\n🎉 VIDEO GENERATION COMPLETED SUCCESSFULLY!");
          console.log("Generated Video URL:", videoUrl);
          break;
        }
      } else if (statusData.status === "FAILED") {
        console.error("✖ Job Failed on Fal.ai:", statusData.error);
        break;
      }
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

testFastGen().catch(err => console.error("Fast gen error:", err));
