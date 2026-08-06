// WARNING: This script writes to the database. Run only with a specific creation ID, never with userId filter.
import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma.js";

dotenv.config();

async function pollUntilComplete() {
  const statusUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511/status";
  const responseUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511";
  const falKey = process.env.FAL_KEY;

  console.log("Polling Fal.ai GPU render until completion...");

  for (let i = 1; i <= 100; i++) {
    try {
      const res = await fetch(statusUrl, {
        headers: { Authorization: `Key ${falKey}` }
      });
      const data = await res.json();
      console.log(`[Attempt #${i}] GPU Render Status: ${data.status}`);

      if (data.status === "COMPLETED") {
        console.log("\n🎉 GPU RENDERING COMPLETED! Fetching video URL from response_url:", responseUrl);
        const resVal = await fetch(responseUrl, {
          headers: { Authorization: `Key ${falKey}` }
        });
        const valData = await resVal.json();
        console.log("Fal.ai Video Payload:", JSON.stringify(valData, null, 2));

        const videoUrl = valData.video?.url || valData.videos?.[0]?.url || valData.url;
        if (videoUrl) {
          await prisma.creation.updateMany({
            where: { requestId: "019fd35a-6f0c-7b33-b913-f9460e1b6511" },
            data: {
              status: "COMPLETED",
              currentStage: "completed",
              url: videoUrl
            }
          });
          console.log("\n✅ SUCCESS: Updated database record with final generated video URL:", videoUrl);
          break;
        }
      } else if (data.status === "FAILED") {
        console.error("✖ GPU Render Failed:", data.error);
        await prisma.creation.updateMany({
          where: { requestId: "019fd35a-6f0c-7b33-b913-f9460e1b6511" },
          data: {
            status: "FAILED",
            currentStage: "failed",
            error: data.error || "Generation failed on GPU"
          }
        });
        break;
      }
    } catch (err) {
      console.error(`Attempt #${i} error:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

pollUntilComplete().catch(err => console.error("Poll error:", err));
