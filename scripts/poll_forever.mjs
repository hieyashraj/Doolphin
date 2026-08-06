// WARNING: This script writes to the database. Run only with a specific creation ID, never with userId filter.
import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma.js";

dotenv.config();

async function pollForever() {
  const statusUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511/status";
  const responseUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511";
  const falKey = process.env.FAL_KEY;

  console.log("Polling Fal.ai GPU rendering until completion...");

  while (true) {
    try {
      const res = await fetch(statusUrl, {
        headers: { Authorization: `Key ${falKey}` }
      });
      const data = await res.json();
      console.log(`[GPU Render] Status: ${data.status}`);

      if (data.status === "COMPLETED") {
        console.log("\n🎉 RENDERING FINISHED! Fetching result video...");
        const resVal = await fetch(responseUrl, {
          headers: { Authorization: `Key ${falKey}` }
        });
        const valData = await resVal.json();
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
          console.log("✅ Updated database record with video URL:", videoUrl);
          break;
        }
      } else if (data.status === "FAILED") {
        console.error("✖ GPU Render Failed:", data.error);
        await prisma.creation.updateMany({
          where: { requestId: "019fd35a-6f0c-7b33-b913-f9460e1b6511" },
          data: {
            status: "FAILED",
            currentStage: "failed",
            error: data.error || "Generation failed"
          }
        });
        break;
      }
    } catch (err) {
      console.error("Poll error:", err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

pollForever();
