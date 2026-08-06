import { prisma } from "../src/lib/prisma.js";
import { reconcileFalCreation } from "../src/app/api/creations/[id]/route.js";
import dotenv from "dotenv";

dotenv.config();

async function runReconcile() {
  const creationId = "cmsgglmud0000pi9wgl2h2qno";
  const creation = await prisma.creation.findUnique({ where: { id: creationId } });
  
  if (!creation) {
    console.error("Creation record not found!");
    return;
  }

  console.log("Current record:", {
    id: creation.id,
    status: creation.status,
    requestId: creation.requestId,
    provider: creation.provider
  });

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error("No FAL_KEY found in .env!");
    return;
  }

  console.log("Reconciling with Fal.ai...");
  const updated = await reconcileFalCreation(creation, falKey);
  console.log("Reconciliation complete! Updated record:", {
    id: updated.id,
    status: updated.status,
    url: updated.url,
    error: updated.error,
    errorCode: updated.errorCode
  });
}

runReconcile().catch(err => console.error("Reconcile error:", err));
