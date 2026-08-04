import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { validateGenerationRequest } from "@/lib/validation";
import { compileGenerationPrompt } from "@/lib/promptCompiler";
import { getProviderAdapter } from "@/lib/adapters";

export async function POST(req) {
  let reservedCreationId = null;
  let reservedAmount = 0;
  let userId = null;
  let attemptId = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    const session = await getServerSession();

    if (!session?.user) {
      return NextResponse.json({
        success: false,
        code: "UNAUTHORIZED",
        error: "Authentication required",
        requestId: attemptId
      }, { status: 401 });
    }

    userId = session.user.id;
    let body = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        code: "INVALID_REQUEST",
        error: "Invalid JSON request payload body",
        requestId: attemptId
      }, { status: 400 });
    }

    const {
      modelId,
      provider,
      prompt,
      settings = {},
      images = [],
      generateVoiceover,
      voiceoverVoice,
      voiceoverText,
      customApiKey,
      customFalKey,
      idempotencyKey: clientKey
    } = body;

    const currentProvider = provider || (modelId?.startsWith("fal-") ? "FAL" : "MUAPI");
    const idempotencyKey = clientKey || `${userId}:${modelId}:${attemptId}`;

    console.log("[LOG:generate.request.received]", { attemptId, userId, modelId, provider: currentProvider, idempotencyKey });

    // Server-side Idempotency Check: Prevent duplicate jobs for identical idempotencyKey
    const existingCreation = await prisma.creation.findFirst({
      where: { userId, idempotencyKey }
    });

    if (existingCreation) {
      console.log("[LOG:generate.idempotent.match]", { attemptId, creationId: existingCreation.id, status: existingCreation.status });
      if (existingCreation.status === "failed") {
        return NextResponse.json({
          success: false,
          code: existingCreation.errorCode || "GENERATION_FAILED",
          error: existingCreation.error || "Generation request failed previously.",
          generationId: existingCreation.id,
          requestId: existingCreation.requestId || attemptId,
          idempotent: true
        }, { status: 400 });
      }

      const isTerminal = existingCreation.status === "completed";
      return NextResponse.json({
        success: true,
        creationId: existingCreation.id,
        requestId: existingCreation.requestId || existingCreation.providerJobId || attemptId,
        status: existingCreation.status || "preparing",
        stage: existingCreation.stage || existingCreation.status || "queued",
        idempotent: true
      }, { status: isTerminal ? 200 : 202 });
    }

    // 1. Check API Key Configuration
    let apiKey;
    let isUsingCustomKey = false;

    if (currentProvider === "FAL") {
      const key = customFalKey || session.user.falKey;
      isUsingCustomKey = Boolean(key && key.trim().length > 0);
      apiKey = isUsingCustomKey ? key.trim() : process.env.FAL_KEY;
    } else {
      const key = customApiKey || session.user.customApiKey;
      isUsingCustomKey = Boolean(key && key.trim().length > 0);
      apiKey = isUsingCustomKey ? key.trim() : process.env.UGC_API_KEY;
    }

    const falConfigured = Boolean(apiKey && !apiKey.includes("placeholder"));
    console.log("[LOG:generate.key.diagnostic]", { attemptId, provider: currentProvider, falConfigured, isUsingCustomKey });

    if (!apiKey || apiKey.includes("placeholder")) {
      return NextResponse.json({
        success: false,
        code: "PROVIDER_NOT_CONFIGURED",
        error: `${currentProvider} API Key is missing or unconfigured. Live generation is currently blocked.`,
        retriable: false,
        requestId: attemptId,
        generationId: null
      }, { status: 503 });
    }

    // 2. Server-Side Request & Capability Validation (includes prepareProviderImage & SSRF safety)
    const validation = validateGenerationRequest(body, session.user);
    if (!validation.valid) {
      console.log("[LOG:generate.validation.failed]", { attemptId, code: validation.code, error: validation.error });
      return NextResponse.json({
        success: false,
        code: validation.code,
        error: validation.error,
        retriable: false,
        requestId: attemptId,
        generationId: null
      }, { status: validation.status || 400 });
    }

    console.log("[LOG:generate.validation.completed]", { attemptId, valid: true, processedImageCount: validation.processedImages.length });

    // 3. Calculate Credit Requirements
    let requiredCredits = 10;
    const duration = Math.min(typeof settings.duration === "number" ? settings.duration : 5, 15);
    const resolution = settings.resolution || "720p";

    if (currentProvider === "FAL") {
      requiredCredits = duration * 40;
    } else {
      if (modelId === "grok-video") {
        const rate = resolution === "720p" ? 10 : 5;
        requiredCredits = duration * rate;
      } else if (modelId === "veo-3-1") {
        let rate = 500;
        if (resolution === "1080p") rate = 650;
        else if (resolution === "4k") rate = 740;
        requiredCredits = duration * rate;
      } else if (modelId === "happy-horse") {
        requiredCredits = duration * 36;
      } else if (modelId === "seedance-2") {
        requiredCredits = duration * 50;
      }
    }

    if (isUsingCustomKey) {
      requiredCredits = 0;
    }

    // Check Credit Balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true }
    });

    if (!user || user.credits < requiredCredits) {
      return NextResponse.json({
        success: false,
        code: "INSUFFICIENT_CREDITS",
        error: `Insufficient credits. Required: ${requiredCredits}, Available: ${user?.credits || 0}.`,
        retriable: false,
        requestId: attemptId
      }, { status: 403 });
    }

    // 4. Server-Side Prompt Compilation & Placeholder Resolution
    const avatarName = body.avatarName || "AI UGC Actor";
    const productName = body.productName || "Product";
    const compiledResult = compileGenerationPrompt({
      rawPrompt: prompt,
      spokenScript: voiceoverText || prompt,
      sceneMotion: body.sceneMotion || "",
      avatarName,
      productName,
      aspectRatio: settings.aspect_ratio || "9:16",
      duration,
      presetCategory: body.presetCategory || ""
    });

    // 5. Initial Creation Record Creation (with DB unique constraint race handler)
    let creation;
    try {
      creation = await prisma.creation.create({
        data: {
          userId,
          type: "video",
          title: compiledResult.compiledPrompt.substring(0, 50) + "...",
          prompt: prompt,
          compiledPrompt: compiledResult.compiledPrompt,
          productInterpretation: JSON.stringify(compiledResult.productInterpretation),
          status: "processing",
          stage: "preparing",
          modelId,
          provider: currentProvider,
          aspectRatio: settings.aspect_ratio || "9:16",
          resolution,
          duration,
          mode: settings.mode,
          inputImages: validation.processedImages.length > 0 ? JSON.stringify(validation.processedImages) : null,
          idempotencyKey,
          attemptId,
          reservedCredits: requiredCredits
        }
      });
    } catch (createErr) {
      if (createErr.code === "P2002" || createErr.message?.includes("Unique constraint failed")) {
        const existing = await prisma.creation.findFirst({
          where: { userId, idempotencyKey }
        });
        if (existing) {
          console.log("[LOG:generate.idempotent.race_handled]", { attemptId, creationId: existing.id });
          return NextResponse.json({
            success: existing.status !== "failed",
            creationId: existing.id,
            requestId: existing.requestId || attemptId,
            status: existing.status || "preparing",
            stage: existing.stage || "queued",
            idempotent: true
          }, { status: existing.status === "failed" ? 400 : 202 });
        }
      }
      throw createErr;
    }

    reservedCreationId = creation.id;
    reservedAmount = requiredCredits;

    // 6. Transactional Credit Ledger Reservation
    if (requiredCredits > 0) {
      await prisma.$transaction([
        prisma.creditLedger.create({
          data: {
            userId,
            creationId: creation.id,
            attemptId,
            amount: requiredCredits,
            type: "RESERVE",
            status: "PENDING",
            idempotencyKey: `res_${idempotencyKey}`
          }
        }),
        prisma.user.update({
          where: { id: userId },
          data: { credits: { decrement: requiredCredits } }
        })
      ]);
      console.log("[LOG:generate.credits.reserved]", { attemptId, amount: requiredCredits });
    }

    // 7. Format Payload via Provider-Specific Adapter
    const webhookUrl = `${process.env.WEBHOOK_URL || "http://localhost:3000"}/api/webhook/${currentProvider.toLowerCase()}`;
    const adapter = getProviderAdapter(modelId);
    const providerPayload = adapter.formatPayload({
      prompt: compiledResult.compiledPrompt,
      settings: { ...settings, duration },
      images: validation.processedImages,
      webhookUrl
    });

    const endpoint = adapter.getEndpoint(modelId, webhookUrl);

    console.log("[LOG:generate.provider.submission.started]", { attemptId, endpoint, modelId });

    // 8. Upstream Provider Execution
    let upstreamResponse;
    let headers = { "Content-Type": "application/json" };
    if (currentProvider === "FAL") {
      headers["Authorization"] = `Key ${apiKey}`;
    } else {
      headers["x-api-key"] = apiKey;
    }

    try {
      upstreamResponse = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(providerPayload)
      });
    } catch (networkErr) {
      console.log("[LOG:generate.provider.submission.failed]", { attemptId, error: networkErr.message });
      if (reservedAmount > 0) {
        await rollbackCredits(userId, reservedCreationId, attemptId, reservedAmount, idempotencyKey);
        console.log("[LOG:generate.credits.released]", { attemptId, reservedCreationId });
      }

      await prisma.creation.update({
        where: { id: creation.id },
        data: { status: "failed", stage: "failed", errorCode: "PROVIDER_NETWORK_ERROR", error: networkErr.message }
      });

      return NextResponse.json({
        success: false,
        code: "PROVIDER_NETWORK_ERROR",
        error: `Provider network request failed: ${networkErr.message}`,
        retriable: true,
        requestId: attemptId,
        generationId: creation.id
      }, { status: 504 });
    }

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      const status = upstreamResponse.status;
      let errorCode = "PROVIDER_ERROR";

      if (status === 401 || status === 403) {
        errorCode = "PROVIDER_AUTHENTICATION_ERROR";
      } else if (status === 400 || status === 422) {
        errorCode = "PROVIDER_BAD_REQUEST";
      } else if (status === 429) {
        errorCode = "PROVIDER_RATE_LIMITED";
      } else if (status >= 500) {
        errorCode = "PROVIDER_SERVER_ERROR";
      }

      console.log("[LOG:generate.provider.submission.failed]", { attemptId, status, errorCode, errorText: errorText.substring(0, 100) });

      if (reservedAmount > 0) {
        await rollbackCredits(userId, reservedCreationId, attemptId, reservedAmount, idempotencyKey);
        console.log("[LOG:generate.credits.released]", { attemptId, reservedCreationId });
      }

      await prisma.creation.update({
        where: { id: creation.id },
        data: { status: "failed", stage: "failed", errorCode, error: errorText }
      });

      return NextResponse.json({
        success: false,
        code: errorCode,
        error: `Provider API failed with status ${status}: ${errorText}`,
        retriable: status >= 500,
        requestId: attemptId,
        generationId: creation.id
      }, { status: status === 401 || status === 403 ? 502 : status === 429 ? 429 : 400 });
    }

    const data = await upstreamResponse.json();
    const providerJobId = data.request_id || data.id;

    console.log("[LOG:generate.provider.submission.accepted]", { attemptId, providerJobId });

    // Commit Transactional Credit Ledger & Update Creation Record
    await prisma.$transaction([
      prisma.creation.update({
        where: { id: creation.id },
        data: {
          requestId: providerJobId,
          providerJobId,
          status: "processing",
          stage: "queued"
        }
      }),
      ...(reservedAmount > 0 ? [
        prisma.creditLedger.update({
          where: { idempotencyKey: `res_${idempotencyKey}` },
          data: { type: "COMMIT", status: "COMPLETED" }
        })
      ] : [])
    ]);

    console.log("[LOG:generate.response.sent]", { attemptId, success: true });

    return NextResponse.json({
      success: true,
      creationId: creation.id,
      requestId: providerJobId,
      stage: "queued"
    });

  } catch (error) {
    console.error("[GENERATE_FATAL_ERROR]", error);

    if (reservedCreationId && reservedAmount > 0 && userId) {
      try {
        await rollbackCredits(userId, reservedCreationId, attemptId, reservedAmount, `${userId}:fatal:${attemptId}`);
        console.log("[LOG:generate.credits.released]", { attemptId, reservedCreationId });
      } catch (_) {}
    }

    return NextResponse.json({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      error: error.message || "Internal Server Error",
      retriable: true,
      requestId: attemptId,
      generationId: reservedCreationId
    }, { status: 500 });
  }
}

async function rollbackCredits(userId, creationId, attemptId, amount, idempotencyKey) {
  try {
    await prisma.$transaction([
      prisma.creditLedger.create({
        data: {
          userId,
          creationId,
          attemptId,
          amount,
          type: "RELEASE",
          status: "ROLLED_BACK",
          idempotencyKey: `rel_${idempotencyKey}_${Date.now()}`
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: amount } }
      })
    ]);
  } catch (err) {
    console.error("[CREDIT_ROLLBACK_ERROR]", err);
  }
}
