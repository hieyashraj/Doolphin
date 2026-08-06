// WARNING: This script writes to the database. Run only with a specific creation ID, never with userId filter.
import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma.js";

dotenv.config();

async function check() {
  const statusUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511/status";
  const responseUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511";
  const falKey = process.env.FAL_KEY;

  const res = await fetch(statusUrl, {
    headers: { Authorization: `Key ${falKey}` }
  });

  const data = await res.json();
  console.log("Current Fal Status Payload:", JSON.stringify(data, null, 2));

  if (data.status === "COMPLETED") {
    const resVal = await fetch(responseUrl, {
      headers: { Authorization: `Key ${falKey}` }
    });
    const valData = await resVal.json();
    console.log("Final Video Payload:", JSON.stringify(valData, null, 2));

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
    }
  }
}

check().catch(err => console.error("Check error:", err));
