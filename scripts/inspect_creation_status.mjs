import { prisma } from "../src/lib/prisma.js";

async function inspect() {
  console.log("=== INSPECTING RECENT CREATIONS ===");
  const list = await prisma.creation.findMany({
    where: { userId: "doolphin-default-user" },
    orderBy: { createdAt: "desc" },
    take: 5
  });

  console.log(`Found ${list.length} recent creations:`);
  list.forEach((c, idx) => {
    console.log(`\n--- Creation #${idx + 1} ---`);
    console.log(`ID: ${c.id}`);
    console.log(`Title: ${c.title}`);
    console.log(`Status: ${c.status}`);
    console.log(`Stage: ${c.currentStage || c.stage}`);
    console.log(`Provider: ${c.provider}`);
    console.log(`Model ID: ${c.modelId}`);
    console.log(`Request ID: ${c.requestId}`);
    console.log(`Provider Job ID: ${c.providerJobId}`);
    console.log(`URL: ${c.url || "(none)"}`);
    console.log(`Error: ${c.error || "(none)"}`);
    console.log(`Error Code: ${c.errorCode || "(none)"}`);
    console.log(`Created At: ${c.createdAt}`);
  });
}

inspect().catch(err => console.error("Inspection error:", err.message));
