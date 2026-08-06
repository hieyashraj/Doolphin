import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma.js";

dotenv.config();

async function check() {
  const requestId = "019fd352-fb47-76c1-a78f-fa0c7b460c54";
  const falKey = process.env.FAL_KEY;
  console.log("Checking status for request:", requestId);

  const testUrls = [
    `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}`,
    `https://queue.fal.run/fal-ai/kling-video/v3/standard/image-to-video/requests/${requestId}`,
    `https://queue.fal.run/fal-ai/kling-video/v1.5/pro/text-to-video/requests/${requestId}`
  ];

  for (const url of testUrls) {
    console.log("\nFetching URL:", url);
    const res = await fetch(url, {
      headers: { Authorization: `Key ${falKey}` }
    });
    console.log("Status:", res.status);
    const body = await res.text();
    console.log("Body:", body.substring(0, 300));

    if (res.ok) {
      const data = JSON.parse(body);
      const videoUrl = data.video?.url || data.videos?.[0]?.url || data.url;
      if (videoUrl) {
        await prisma.creation.update({
          where: { id: "cmsgglmud0000pi9wgl2h2qno" },
          data: {
            status: "COMPLETED",
            currentStage: "completed",
            url: videoUrl
          }
        });
        console.log("✔ Creation updated with video URL:", videoUrl);
        break;
      }
    }
  }
}

check().catch(err => console.error("Check error:", err.message));
