import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { downloadVideoSsrfSafe } from "@/lib/downloader";

/**
 * Maps internal app modelId to the actual Fal.run model path used in queue endpoints.
 * This is the definitive fix for the status polling bug where creation.modelId
 * (e.g. "fal-kling-3-std") was incorrectly used as the Fal endpoint path
 * (needs to be "fal-ai/kling-video/v3/standard/image-to-video").
 */
function getFalModelPath(modelId) {
  const FAL_MODEL_PATHS = {
    "fal-kling-3-std":           "fal-ai/kling-video/v3/standard/image-to-video",
    "fal-kling-3-pro":           "fal-ai/kling-video/v3/pro/image-to-video",
    "fal-bytedance-seedance-v2": "fal-ai/bytedance/seedance/v1/lite/image-to-video",
    "fal-luma-ray-v2":           "fal-ai/luma-dream-machine/ray-2/image-to-video",
  };
  return FAL_MODEL_PATHS[modelId] || null;
}

/**
 * Extracts a valid video URL from a Fal COMPLETED result payload.
 *
 * Fal Kling result shape (verified from Fal docs & real payloads):
 *   { video: { url: "https://...", content_type: "video/mp4", file_size: 1234567, duration: 5 } }
 *
 * Falls back to images array and top-level url for other Fal models.
 * Returns null if no valid video URL found — caller must mark PROVIDER_RESULT_INVALID.
 */
function extractFalVideoResult(resultData) {
  if (!resultData || typeof resultData !== "object") return null;

  // Primary: video object (Kling, Seedance, Luma)
  if (resultData.video && typeof resultData.video === "object") {
    const v = resultData.video;
    const url = v.url;
    if (url && typeof url === "string" && url.startsWith("https://")) {
      return {
        url,
        contentType: v.content_type || "video/mp4",
        width: v.width || null,
        height: v.height || null,
        duration: v.duration || null,
        fileSize: v.file_size || null,
      };
    }
  }

  // Fallback: videos array
  if (Array.isArray(resultData.videos) && resultData.videos.length > 0) {
    const v = resultData.videos[0];
    const url = typeof v === "string" ? v : v?.url;
    if (url && url.startsWith("https://")) {
      return { url, contentType: "video/mp4", width: null, height: null, duration: null, fileSize: null };
    }
  }

  // Fallback: images array (some image-output models)
  if (Array.isArray(resultData.images) && resultData.images.length > 0) {
    const img = resultData.images[0];
    const url = typeof img === "string" ? img : img?.url;
    if (url && url.startsWith("https://")) {
      return { url, contentType: "image/jpeg", width: null, height: null, duration: null, fileSize: null };
    }
  }

  // Fallback: top-level url
  if (resultData.url && typeof resultData.url === "string" && resultData.url.startsWith("https://")) {
    return { url: resultData.url, contentType: "video/mp4", width: null, height: null, duration: null, fileSize: null };
  }

  return null;
}

/**
 * Reconciles a FAL creation by querying the provider, extracting results,
 * downloading to durable storage, and atomically updating the database.
 *
 * Returns the updated creation object.
 */
async function reconcileFalCreation(creation, apiKey) {
  const falModelPath = getFalModelPath(creation.modelId);
  if (!falModelPath) {
    console.error(`[RECONCILE_ERROR] No Fal model path mapping for modelId: ${creation.modelId}`);
    return creation;
  }

  const statusUrl = `https://queue.fal.run/${falModelPath}/requests/${creation.requestId}/status`;
  console.log(`[RECONCILE] Polling Fal status: ${statusUrl}`);

  let checkRes;
  try {
    checkRes = await fetch(statusUrl, {
      method: "GET",
      headers: { "Authorization": `Key ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (fetchErr) {
    console.error(`[RECONCILE_FETCH_ERR] Status fetch failed:`, fetchErr.message);
    return creation;
  }

  if (!checkRes.ok) {
    const body = await checkRes.text().catch(() => "");
    console.error(`[RECONCILE_HTTP_ERR] Fal status returned HTTP ${checkRes.status}: ${body.substring(0, 200)}`);
    return creation;
  }

  let checkData;
  try {
    checkData = await checkRes.json();
  } catch (parseErr) {
    console.error(`[RECONCILE_PARSE_ERR] Failed to parse Fal status JSON:`, parseErr.message);
    return creation;
  }

  const upstreamStatus = checkData.status; // COMPLETED | FAILED | IN_QUEUE | IN_PROGRESS
  console.log(`[RECONCILE] Fal status for ${creation.id}: ${upstreamStatus} (internal: ${creation.status})`);

  if (upstreamStatus === "COMPLETED") {
    // Fetch the actual result payload
    const responseUrl = checkData.response_url;
    if (!responseUrl) {
      console.error(`[RECONCILE_NO_RESPONSE_URL] Fal COMPLETED but no response_url in status payload`);
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "failed",
          stage: "failed",
          errorCode: "PROVIDER_RESULT_INVALID",
          error: "Provider reported COMPLETED but did not include response_url",
        },
      });
      return updated;
    }

    let resultData;
    try {
      const resultRes = await fetch(responseUrl, {
        method: "GET",
        headers: { "Authorization": `Key ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!resultRes.ok) {
        throw new Error(`Result fetch HTTP ${resultRes.status}`);
      }
      resultData = await resultRes.json();
    } catch (resultErr) {
      console.error(`[RECONCILE_RESULT_ERR] Failed to fetch provider result:`, resultErr.message);
      return creation;
    }

    console.log(`[RECONCILE] Raw result keys: ${Object.keys(resultData || {}).join(", ")}`);

    const extracted = extractFalVideoResult(resultData);
    if (!extracted || !extracted.url) {
      console.error(`[RECONCILE_EXTRACT_ERR] Could not extract video URL from result:`, JSON.stringify(resultData).substring(0, 300));
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "failed",
          stage: "failed",
          errorCode: "PROVIDER_RESULT_INVALID",
          error: `Provider COMPLETED but no video URL found. Result keys: ${Object.keys(resultData || {}).join(", ")}`,
        },
      });
      return updated;
    }

    console.log(`[RECONCILE] Extracted video URL: ${extracted.url.substring(0, 80)}...`);

    // Download and store durably
    let durableUrl = extracted.url;
    try {
      durableUrl = await downloadVideoSsrfSafe(extracted.url, creation.id);
      console.log(`[RECONCILE] Stored durably at: ${durableUrl}`);
    } catch (downloadErr) {
      console.error(`[RECONCILE_DOWNLOAD_WARN] Storage failed, using provider URL directly:`, downloadErr.message);
      // Keep the Fal CDN URL as fallback — it's valid HTTPS
      durableUrl = extracted.url;
    }

    // Commit credit if not already done
    if (creation.reservedCredits > 0) {
      const commitKey = `commit_${creation.id}`;
      try {
        const existing = await prisma.creditLedger.findFirst({
          where: { creationId: creation.id, type: "COMMIT", status: "COMPLETED" },
        });
        if (!existing) {
          await prisma.creditLedger.create({
            data: {
              userId: creation.userId,
              creationId: creation.id,
              attemptId: creation.attemptId || `att_${Date.now()}`,
              amount: creation.reservedCredits,
              type: "COMMIT",
              status: "COMPLETED",
              idempotencyKey: commitKey,
            },
          });
        }
      } catch (ledgerErr) {
        // Non-fatal — credit was already reserved at generation time
        console.error("[RECONCILE_LEDGER_WARN]", ledgerErr.message);
      }
    }

    const updated = await prisma.creation.update({
      where: { id: creation.id },
      data: {
        status: "completed",
        stage: "completed",
        url: durableUrl,
      },
    });
    return updated;

  } else if (upstreamStatus === "FAILED" || upstreamStatus === "ERROR") {
    // Release reserved credits exactly once
    if (creation.reservedCredits > 0 && creation.status !== "failed") {
      try {
        const releaseKey = `rel_async_${creation.id}`;
        const existingRelease = await prisma.creditLedger.findUnique({
          where: { idempotencyKey: releaseKey },
        });
        if (!existingRelease) {
          await prisma.$transaction([
            prisma.creditLedger.create({
              data: {
                userId: creation.userId,
                creationId: creation.id,
                attemptId: creation.attemptId || `att_${Date.now()}`,
                amount: creation.reservedCredits,
                type: "RELEASE",
                status: "ROLLED_BACK",
                idempotencyKey: releaseKey,
              },
            }),
            prisma.user.update({
              where: { id: creation.userId },
              data: { credits: { increment: creation.reservedCredits } },
            }),
          ]);
          console.log(`[RECONCILE] Credits released for failed creation ${creation.id}: ${creation.reservedCredits}`);
        }
      } catch (releaseErr) {
        console.error("[RECONCILE_RELEASE_ERR]", releaseErr.message);
      }
    }

    const providerError = typeof checkData.error === "string"
      ? checkData.error
      : JSON.stringify(checkData.error || "Generation failed at provider");

    const updated = await prisma.creation.update({
      where: { id: creation.id },
      data: {
        status: "failed",
        stage: "failed",
        errorCode: "PROVIDER_GENERATION_FAILED",
        error: providerError,
      },
    });
    return updated;

  } else if (upstreamStatus === "IN_QUEUE" || upstreamStatus === "IN_PROGRESS") {
    // Still processing — update internal status to reflect provider state
    const newStatus = upstreamStatus === "IN_QUEUE" ? "queued" : "processing";
    if (creation.status !== newStatus) {
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: { status: newStatus, stage: "generating" },
      });
      return updated;
    }
    return creation;

  } else if (upstreamStatus) {
    // Unknown status — log but don't get stuck
    console.warn(`[RECONCILE_UNKNOWN_STATUS] Unknown Fal status '${upstreamStatus}' for creation ${creation.id}`);
    return creation;
  }

  return creation;
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let creation = await prisma.creation.findUnique({
      where: {
        id,
        userId: session.user.id, // Strict ownership enforcement
      },
    });

    if (!creation) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    // Reconcile active (non-terminal) creations with provider
    const activeStatuses = ["processing", "pending", "starting", "queued", "in_queue", "in_progress"];
    const isActive = activeStatuses.includes(creation.status);
    const hasRequestId = Boolean(creation.requestId);

    // Detect stale processing jobs (over 20 minutes) and mark them timed out
    const MAX_PROCESSING_MS = 20 * 60 * 1000;
    const ageMs = Date.now() - new Date(creation.createdAt).getTime();
    if (isActive && ageMs > MAX_PROCESSING_MS) {
      console.warn(`[TIMEOUT] Creation ${creation.id} exceeded ${MAX_PROCESSING_MS / 60000}min — marking TIMED_OUT`);
      // Try one final reconciliation; if still non-terminal, mark timed out
      if (creation.provider === "FAL" && hasRequestId) {
        const apiKey = session.user.falKey || process.env.FAL_KEY;
        if (apiKey && !apiKey.includes("placeholder")) {
          creation = await reconcileFalCreation(creation, apiKey);
        }
      }
      if (activeStatuses.includes(creation.status)) {
        // Release credits if still reserved
        if (creation.reservedCredits > 0) {
          try {
            const timeoutKey = `rel_timeout_${creation.id}`;
            const existing = await prisma.creditLedger.findUnique({ where: { idempotencyKey: timeoutKey } });
            if (!existing) {
              await prisma.$transaction([
                prisma.creditLedger.create({
                  data: {
                    userId: creation.userId,
                    creationId: creation.id,
                    attemptId: creation.attemptId || `att_${Date.now()}`,
                    amount: creation.reservedCredits,
                    type: "RELEASE",
                    status: "ROLLED_BACK",
                    idempotencyKey: timeoutKey,
                  },
                }),
                prisma.user.update({
                  where: { id: creation.userId },
                  data: { credits: { increment: creation.reservedCredits } },
                }),
              ]);
            }
          } catch (timeoutCreditErr) {
            console.error("[TIMEOUT_CREDIT_ERR]", timeoutCreditErr.message);
          }
        }
        creation = await prisma.creation.update({
          where: { id: creation.id },
          data: {
            status: "failed",
            stage: "failed",
            errorCode: "PROCESSING_TIMEOUT",
            error: `Generation timed out after ${Math.round(ageMs / 60000)} minutes`,
          },
        });
      }
    } else if (isActive && hasRequestId) {
      const isFal = creation.provider === "FAL";
      const apiKey = isFal
        ? (session.user.falKey || process.env.FAL_KEY)
        : (session.user.customApiKey || process.env.UGC_API_KEY);

      if (apiKey && !apiKey.includes("placeholder")) {
        try {
          if (isFal) {
            creation = await reconcileFalCreation(creation, apiKey);
          } else {
            // MuAPI Polling
            const checkRes = await fetch(
              `https://api.muapi.ai/api/v1/predictions/${creation.requestId}/result`,
              {
                method: "GET",
                headers: { "x-api-key": apiKey },
                signal: AbortSignal.timeout(10000),
              }
            );

            if (checkRes.ok) {
              const checkData = await checkRes.json();
              const upstreamStatus = checkData.status || "processing";

              if (upstreamStatus === "failed") {
                creation = await prisma.creation.update({
                  where: { id: creation.id },
                  data: {
                    status: "failed",
                    stage: "failed",
                    errorCode: "PROVIDER_GENERATION_FAILED",
                    error: checkData.error || "Generation failed",
                  },
                });
              } else if (upstreamStatus === "completed" || (checkData.outputs && checkData.outputs.length > 0)) {
                const outputs = checkData.outputs || [];
                const rawVideoUrl = outputs.length > 0 ? outputs[0] : null;

                let durableUrl = rawVideoUrl;
                if (rawVideoUrl) {
                  try {
                    durableUrl = await downloadVideoSsrfSafe(rawVideoUrl, creation.id);
                  } catch (downloadErr) {
                    console.error(`[DOWNLOAD_FALLBACK_WARN] Storage download failed:`, downloadErr.message);
                    durableUrl = rawVideoUrl;
                  }
                }

                creation = await prisma.creation.update({
                  where: { id: creation.id },
                  data: {
                    status: "completed",
                    stage: "completed",
                    url: durableUrl,
                  },
                });
              } else if (upstreamStatus !== "processing") {
                creation = await prisma.creation.update({
                  where: { id: creation.id },
                  data: { status: upstreamStatus, stage: "generating" },
                });
              }
            }
          }
        } catch (pollErr) {
          console.error("[POLL_ERR] Error reconciling creation with provider:", pollErr.message);
        }
      }
    }

    if (creation && creation.inputImages) {
      let imagesList = [];
      try {
        imagesList = JSON.parse(creation.inputImages);
        if (!Array.isArray(imagesList)) {
          imagesList = [creation.inputImages];
        }
      } catch {
        imagesList = creation.inputImages.split(",").map((url) => url.trim()).filter(Boolean);
      }
      creation.inputImages = imagesList;
    }

    return NextResponse.json(creation);
  } catch (error) {
    console.error("[CREATION_GET_ERROR]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
