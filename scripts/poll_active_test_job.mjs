import dotenv from "dotenv";
dotenv.config();

async function pollTestJob() {
  const statusUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511/status";
  const responseUrl = "https://queue.fal.run/fal-ai/kling-video/requests/019fd35a-6f0c-7b33-b913-f9460e1b6511";
  const falKey = process.env.FAL_KEY;

  console.log("Polling Fal status URL:", statusUrl);

  for (let i = 1; i <= 30; i++) {
    const res = await fetch(statusUrl, {
      headers: { Authorization: `Key ${falKey}` }
    });
    const data = await res.json();
    console.log(`[Attempt #${i}] Status: ${data.status} | Logs: ${data.logs ? data.logs.length : 0}`);

    if (data.status === "COMPLETED") {
      console.log("\nJob COMPLETED! Fetching final video payload from response_url:", responseUrl);
      const resVal = await fetch(responseUrl, {
        headers: { Authorization: `Key ${falKey}` }
      });
      const valData = await resVal.json();
      console.log("Final Video Payload:", JSON.stringify(valData, null, 2));
      break;
    } else if (data.status === "FAILED") {
      console.error("Job FAILED on Fal.ai:", data.error);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

pollTestJob();
