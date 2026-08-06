import dotenv from "dotenv";
dotenv.config();

async function testGeneration() {
  const falKey = process.env.FAL_KEY;
  console.log("Testing generation request to Fal.ai...");

  const endpointsToTest = [
    "https://queue.fal.run/fal-ai/kling-video/v1.5/pro/text-to-video",
    "https://queue.fal.run/fal-ai/kling-video/v1.5/standard/text-to-video",
    "https://queue.fal.run/fal-ai/bytedance/seedance/v1/lite/image-to-video"
  ];

  for (const ep of endpointsToTest) {
    console.log("\nPosting to endpoint:", ep);
    try {
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

      console.log("HTTP status:", res.status);
      const text = await res.text();
      console.log("Response payload:", text);
    } catch (err) {
      console.error("Fetch error:", err.message);
    }
  }
}

testGeneration();
