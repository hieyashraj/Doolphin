import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma.js";

dotenv.config();

async function checkQueue() {
  const requestId = "019fd352-fb47-76c1-a78f-fa0c7b460c54";
  const falKey = process.env.FAL_KEY;

  console.log("Checking request ID:", requestId);

  // Fal.ai Queue API status endpoints
  const statusEndpoints = [
    `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}/status`,
    `https://queue.fal.run/fal-ai/kling-video/v3/standard/text-to-video/requests/${requestId}`,
    `https://rest.fal.ai/v1/requests/${requestId}/status`,
    `https://rest.fal.ai/v1/requests/${requestId}`
  ];

  for (const url of statusEndpoints) {
    try {
      console.log("\nTrying GET:", url);
      const res = await fetch(url, {
        headers: {
          "Authorization": `Key ${falKey}`,
          "Accept": "application/json"
        }
      });
      console.log("HTTP status:", res.status);
      const text = await res.text();
      console.log("Body:", text.substring(0, 300));

      if (res.ok) {
        const data = JSON.parse(text);
        if (data.status === "COMPLETED" || data.video || data.response_url) {
          const videoUrl = data.video?.url || data.videos?.[0]?.url || data.url;
          if (videoUrl) {
            await prisma.creation.update({
              where: { id: "cmsgglmud0000pi9wgl2h2qno" },
              data: { status: "COMPLETED", currentStage: "completed", url: videoUrl }
            });
            console.log("🎉 SUCCESS! Updated creation record with video URL:", videoUrl);
            break;
          }
        }
      }
    } catch (err) {
      console.error("Error for URL:", err.message);
    }
  }
}

checkQueue().catch(err => console.error("CheckQueue error:", err));
