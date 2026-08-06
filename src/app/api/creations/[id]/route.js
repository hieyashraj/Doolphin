import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { downloadVideoSsrfSafe } from "@/lib/downloader";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";

/**
 * Maps internal app modelId to the actual Fal.run model path used in queue endpoints.
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
 * Robustly extracts a valid video/image URL string from provider results.
 * Handles string, array, and nested object payloads across Fal and MuAPI.
 */
function extractVideoUrl(resultData) {
  if (!resultData) return null;
  if (typeof resultData === "string" && (resultData.startsWith("http://") || resultData.startsWith("https://") || resultData.startsWith("data:"))) {
    return resultData;
  }
  if (typeof resultData !== "object") return null;

  // Direct string keys
  const stringKeys = ["url", "video_url", "videoUrl", "video", "result", "output"];
  for (const key of stringKeys) {
    const val = resultData[key];
    if (typeof val === "string" && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("data:"))) {
      return val;
    }
  }

  // Fal primary video object
  if (resultData.video && typeof resultData.video === "object" && typeof resultData.video.url === "string") {
    if (resultData.video.url.startsWith("http")) return resultData.video.url;
  }

  // Nested object / array property checks
  const complexKeys = ["video", "videos", "images", "result", "results", "output", "outputs", "data"];
  for (const key of complexKeys) {
    const val = resultData[key];
    if (Array.isArray(val) && val.length > 0) {
      for (const item of val) {
        const res = extractVideoUrl(item);
        if (res) return res;
      }
    } else if (val && typeof val === "object") {
      const res = extractVideoUrl(val);
      if (res) return res;
    }
  }

  return null;
}

function extractFalVideoResult(resultData) {
  const url = extractVideoUrl(resultData);
  if (url) {
    const isVideo = !url.includes(".jpg") && !url.includes(".jpeg") && !url.includes(".png");
    return {
      url,
      contentType: isVideo ? "video/mp4" : "image/jpeg",
      width: resultData?.video?.width || null,
      height: resultData?.video?.height || null,
      duration: resultData?.video?.duration || null,
      fileSize: resultData?.video?.file_size || null,
    };
  }
  return null;
}

/**
 * Reconciles a FAL creation by querying provider, downloading durably, and updating DB.
 */
async function reconcileFalCreation(creation, apiKey) {
  let statusUrl = creation.statusUrl;
  if (!statusUrl && creation.requestId) {
    const falModelPath = getFalModelPath(creation.modelId) || "fal-ai/kling-video";
    statusUrl = `https://queue.fal.run/${falModelPath}/requests/${creation.requestId}/status`;
  }

  if (!statusUrl) {
    console.error(`[RECONCILE_ERROR] Missing statusUrl and requestId for creation: ${creation.id}`);
    return creation;
  }

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

  const upstreamStatus = String(checkData.status || "").toUpperCase();

  if (upstreamStatus === "COMPLETED" || upstreamStatus === "SUCCEEDED" || upstreamStatus === "OK") {
    const responseUrl = checkData.response_url || creation.responseUrl || statusUrl.replace("/status", "");
    if (!responseUrl) {
      console.error(`[RECONCILE_NO_RESPONSE_URL] Fal COMPLETED but no response_url in status payload`);
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "FAILED",
          currentStage: "failed",
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

    const extracted = extractFalVideoResult(resultData);
    if (!extracted || !extracted.url) {
      console.error(`[RECONCILE_EXTRACT_ERR] Could not extract video URL from result:`, JSON.stringify(resultData).substring(0, 300));
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: {
          status: "FAILED",
          currentStage: "failed",
          errorCode: "PROVIDER_RESULT_INVALID",
          error: `Provider COMPLETED but no video URL found. Result keys: ${Object.keys(resultData || {}).join(", ")}`,
        },
      });
      return updated;
    }

    // Download durably
    let durableUrl = extracted.url;
    try {
      durableUrl = await downloadVideoSsrfSafe(extracted.url, creation.id);
      console.log(`[RECONCILE] Stored durably at: ${durableUrl}`);
    } catch (downloadErr) {
      console.error(`[RECONCILE_DOWNLOAD_WARN] Storage failed, using provider URL directly:`, downloadErr.message);
      durableUrl = extracted.url;
    }

    // Commit credit safely
    if (creation.reservedCredits > 0) {
      await CreditEscrowService.commitCreationCredits({
        userId: creation.userId,
        workspaceId: creation.workspaceId,
        creationId: creation.id,
        amount: creation.reservedCredits,
        idempotencyKey: `commit_${creation.id}`,
      });
    }

    const updated = await prisma.creation.update({
      where: { id: creation.id },
      data: {
        status: "COMPLETED",
        currentStage: "completed",
        stage: "completed",
        url: durableUrl,
      },
    });
    return updated;

  } else if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(upstreamStatus)) {
    if (creation.reservedCredits > 0 && creation.status !== "FAILED" && creation.status !== "failed") {
      await CreditEscrowService.releaseCreationCredits({
        userId: creation.userId,
        workspaceId: creation.workspaceId,
        creationId: creation.id,
        amount: creation.reservedCredits,
        reason: "PROVIDER_GENERATION_FAILED",
        idempotencyKey: `rel_async_${creation.id}`,
      });
    }

    const providerError = typeof checkData.error === "string"
      ? checkData.error
      : JSON.stringify(checkData.error || "Generation failed at provider");

    const updated = await prisma.creation.update({
      where: { id: creation.id },
      data: {
        status: "FAILED",
        currentStage: "failed",
        stage: "failed",
        errorCode: "PROVIDER_GENERATION_FAILED",
        error: providerError,
      },
    });
    return updated;

  } else if (upstreamStatus === "IN_QUEUE" || upstreamStatus === "IN_PROGRESS" || upstreamStatus === "QUEUED" || upstreamStatus === "PROCESSING") {
    const newStatus = (upstreamStatus === "IN_QUEUE" || upstreamStatus === "QUEUED") ? "QUEUED" : "PROCESSING";
    if (creation.status !== newStatus) {
      const updated = await prisma.creation.update({
        where: { id: creation.id },
        data: { status: newStatus, currentStage: "generating" },
      });
      return updated;
    }
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

    let creation = await prisma.creation.findFirst({
      where: {
        id,
        userId: session.user.id, // Strict ownership enforcement
      },
    });

    if (!creation) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    // Reconcile active (non-terminal) creations with provider
    const activeStatuses = ["processing", "pending", "starting", "queued", "in_queue", "in_progress", "draft"];
    const statusLower = (creation.status || "").toLowerCase();
    const isActive = activeStatuses.includes(statusLower);
    const hasRequestId = Boolean(creation.requestId);

    // Detect stale processing jobs (over 20 minutes) and mark them timed out
    const MAX_PROCESSING_MS = 20 * 60 * 1000;
    const ageMs = Date.now() - new Date(creation.createdAt || Date.now()).getTime();
    if (isActive && ageMs > MAX_PROCESSING_MS) {
      console.warn(`[TIMEOUT] Creation ${creation.id} exceeded ${MAX_PROCESSING_MS / 60000}min — marking TIMED_OUT`);
      if (creation.provider === "FAL" && hasRequestId) {
        const apiKey = session.user.falKey || process.env.FAL_KEY;
        if (apiKey && !apiKey.includes("placeholder")) {
          creation = await reconcileFalCreation(creation, apiKey);
        }
      }
      if (activeStatuses.includes((creation.status || "").toLowerCase())) {
        if (creation.reservedCredits > 0) {
          await CreditEscrowService.releaseCreationCredits({
            userId: creation.userId,
            workspaceId: creation.workspaceId,
            creationId: creation.id,
            amount: creation.reservedCredits,
            reason: "PROCESSING_TIMEOUT",
            idempotencyKey: `rel_timeout_${creation.id}`,
          });
        }
        creation = await prisma.creation.update({
          where: { id: creation.id },
          data: {
            status: "FAILED",
            currentStage: "failed",
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
        : (session.user.customApiKey || process.env.MUAPI_API_KEY || process.env.MUAPI_API_KEY_SANDBOX);

      if (apiKey && !apiKey.includes("placeholder")) {
        try {
          if (isFal) {
            creation = await reconcileFalCreation(creation, apiKey);
          } else {
            // MuAPI Polling & Reconciliation
            const checkRes = await fetch(
              `https://api.muapi.ai/api/v1/predictions/${creation.requestId}/result`,
              {
                method: "GET",
                headers: { "Content-Type": "application/json", "x-api-key": apiKey },
                signal: AbortSignal.timeout(10000),
              }
            );

            if (checkRes.ok) {
              const checkData = await checkRes.json();
              const upstreamStatus = String(checkData.status || "").toLowerCase();
              const isFailed = ["failed", "error", "canceled", "cancelled"].includes(upstreamStatus) || Boolean(checkData.error);

              if (isFailed) {
                if (creation.reservedCredits > 0 && creation.status !== "FAILED" && creation.status !== "failed") {
                  await CreditEscrowService.releaseCreationCredits({
                    userId: creation.userId,
                    workspaceId: creation.workspaceId,
                    creationId: creation.id,
                    amount: creation.reservedCredits,
                    reason: "PROVIDER_GENERATION_FAILED",
                    idempotencyKey: `rel_async_${creation.id}`,
                  });
                }

                creation = await prisma.creation.update({
                  where: { id: creation.id },
                  data: {
                    status: "FAILED",
                    currentStage: "failed",
                    stage: "failed",
                    errorCode: "PROVIDER_GENERATION_FAILED",
                    error: checkData.error || "Generation failed",
                  },
                });
              } else {
                // Extract video URL from all potential MuAPI response properties cleanly
                const rawVideoUrl = extractVideoUrl(checkData);

                const isTerminalSuccess = 
                  ["completed", "succeeded", "finished", "success", "ok"].includes(upstreamStatus) || 
                  Boolean(rawVideoUrl);

                if (isTerminalSuccess && rawVideoUrl) {
                  let durableUrl = rawVideoUrl;
                  try {
                    durableUrl = await downloadVideoSsrfSafe(rawVideoUrl, creation.id);
                  } catch (downloadErr) {
                    console.error(`[DOWNLOAD_FALLBACK_WARN] Storage download failed:`, downloadErr.message);
                    durableUrl = rawVideoUrl;
                  }

                  if (creation.reservedCredits > 0) {
                    await CreditEscrowService.commitCreationCredits({
                      userId: creation.userId,
                      workspaceId: creation.workspaceId,
                      creationId: creation.id,
                      amount: creation.reservedCredits,
                      idempotencyKey: `commit_${creation.id}`,
                    });
                  }

                  creation = await prisma.creation.update({
                    where: { id: creation.id },
                    data: {
                      status: "COMPLETED",
                      currentStage: "completed",
                      stage: "completed",
                      url: durableUrl,
                    },
                  });
                }
              }
            }
          }
        } catch (pollErr) {
          console.error("[POLL_ERR] Error reconciling creation with provider:", pollErr.message);
        }
      }
    }

    let parsedInputImages = [];
    if (creation && creation.inputImages) {
      try {
        parsedInputImages = JSON.parse(creation.inputImages);
        if (!Array.isArray(parsedInputImages)) {
          parsedInputImages = [creation.inputImages];
        }
      } catch {
        parsedInputImages = creation.inputImages.split(",").map((url) => url.trim()).filter(Boolean);
      }
    }

    return NextResponse.json({
      id: creation.id,
      status: creation.status,
      stage: creation.currentStage || creation.stage || creation.status,
      url: creation.url,
      error: creation.error,
      errorCode: creation.errorCode,
      modelId: creation.modelId,
      prompt: creation.prompt,
      resolution: creation.resolution,
      aspectRatio: creation.aspectRatio,
      inputImages: parsedInputImages,
    });
  } catch (error) {
    console.error("[CREATION_GET_ERROR]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
