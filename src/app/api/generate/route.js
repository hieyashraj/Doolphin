import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getMockSession as getServerSession } from "@/lib/getMockSession";
import { prisma } from "@/lib/prisma";
import { validateGenerationRequest } from "@/lib/validation";
import { compileGenerationPrompt } from "@/lib/promptCompiler";
import { getProviderAdapter } from "@/lib/adapters";
import { CreditEscrowService } from "@/lib/billing/CreditEscrowService";
import { ElevenLabsAdapter } from "@/lib/providers/elevenlabs/ElevenLabsAdapter";
import { saveMediaBuffer } from "@/lib/storage";

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
    const workspace = await CreditEscrowService.ensureUserWorkspace(userId);

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
      idempotencyKey: clientKey,
      avatarImageUrl,
      productImageUrl,
      useAvatar
    } = body;

    const FAL_MODEL_IDS = new Set([
      "kling-3-std", "kling-3-pro", "kling-1.5-std", "kling-1.5-pro",
      "kling-avatar-v2", "luma-ray-2", "minimax-video-01-live", "minimax-video-01",
      "wan-video", "seedance-lite", "seedance-pro", "hunyuan-video", "cogvideox-5b",
      "mochi-v1", "ltx-video", "vidu-q1", "haiper-video-v2.5", "gencore-video",
      "sadtalker", "musetalk"
    ]);
    const currentProvider = modelId === "seedance-2" ? "MUAPI" : (provider || (modelId?.startsWith("fal-") || FAL_MODEL_IDS.has(modelId) ? "FAL" : "MUAPI"));
    const payloadHash = require("crypto").createHash("sha256").update(JSON.stringify({
      modelId, prompt, settings, images, generateVoiceover, voiceoverVoice, voiceoverText, avatarImageUrl, productImageUrl, useAvatar
    })).digest("hex");
    const idempotencyKey = clientKey || `${userId}:${modelId}:${payloadHash}`;

    console.log("[LOG:generate.request.received]", { attemptId, userId, modelId, provider: currentProvider, idempotencyKey });

    // Server-side Idempotency Check: Prevent duplicate jobs for identical idempotencyKey within 60 seconds
    const sixtySecondsAgo = new Date(Date.now() - 60000);
    const existingCreation = await prisma.creation.findFirst({
      where: { 
        userId, 
        idempotencyKey,
        createdAt: { gte: sixtySecondsAgo }
      }
    });

    if (existingCreation) {
      console.log("[LOG:generate.idempotent.match]", { attemptId, creationId: existingCreation.id, status: existingCreation.status });
      if (existingCreation.status === "FAILED") {
        return NextResponse.json({
          success: false,
          code: existingCreation.errorCode || "GENERATION_FAILED",
          error: existingCreation.error || "Generation request failed previously.",
          generationId: existingCreation.id,
          requestId: existingCreation.requestId || attemptId,
          idempotent: true
        }, { status: 400 });
      }

      const isTerminal = existingCreation.status === "COMPLETED";
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
      let key = customFalKey || session.user.falKey;
      if (key && (key.includes("placeholder") || key.includes("your_api_key"))) key = null;
      isUsingCustomKey = Boolean(key && key.trim().length > 0);
      apiKey = isUsingCustomKey ? key.trim() : process.env.FAL_KEY;
    } else {
      let key = customApiKey || session.user.customApiKey;
      if (key && (key.includes("placeholder") || key.includes("your_api_key"))) key = null;
      isUsingCustomKey = Boolean(key && key.trim().length > 0);
      apiKey = isUsingCustomKey ? key.trim() : (process.env.MUAPI_API_KEY || process.env.MUAPI_API_KEY_SANDBOX);
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

    // 3. Calculate Credit Requirements & Resolve Settings
    const resolvedAspect = validation.resolvedSettings?.aspect_ratio || (settings.aspect_ratio === "Auto" || !settings.aspect_ratio ? "9:16" : settings.aspect_ratio);
    let requiredCredits = 30;
    let duration = 12;
    if (settings.duration === "Auto" || !settings.duration) {
      const scriptWords = (voiceoverText || prompt || "").trim().split(/\s+/).filter(Boolean).length;
      duration = Math.min(Math.max(Math.ceil(scriptWords / 3), 5), 15);
    } else {
      duration = Math.min(typeof settings.duration === "number" ? settings.duration : parseInt(settings.duration) || 12, 15);
    }
    const resolution = validation.resolvedSettings?.resolution || settings.resolution || "720p";

    if (currentProvider === "FAL") {
      requiredCredits = duration * 6;
    } else {
      if (modelId === "grok-video") {
        const rate = resolution === "720p" ? 10 : 5;
        requiredCredits = duration * rate;
      } else if (modelId === "veo-3-1") {
        let rate = 50;
        if (resolution === "1080p") rate = 65;
        else if (resolution === "4k") rate = 75;
        requiredCredits = duration * rate;
      } else if (modelId === "happy-horse") {
        requiredCredits = duration * 6;
      } else if (modelId === "seedance-2") {
        requiredCredits = duration * 6;
      } else {
        requiredCredits = 30;
      }
    }

    if (isUsingCustomKey) {
      requiredCredits = 0;
    }

    // Check Credit Balance
    const availableCredits = session.user.credits !== undefined ? session.user.credits : 9999;

    if (availableCredits < requiredCredits) {
      return NextResponse.json({
        success: false,
        code: "INSUFFICIENT_CREDITS",
        error: `Insufficient credits. Required: ${requiredCredits}, Available: ${availableCredits}.`,
        retriable: false,
        requestId: attemptId
      }, { status: 403 });
    }

    // 4. Server-Side Prompt Compilation & Placeholder Resolution
    const avatarName = body.avatarName || "AI UGC Actor";
    const productName = body.productName || "Product";
    const hasAvatarImage = Boolean(avatarImageUrl || useAvatar);
    const hasProductImage = validation.processedImages && validation.processedImages.length > 0;
    const hasAudio = Boolean(voiceoverText);

    const compiledResult = compileGenerationPrompt({
      rawPrompt: prompt,
      spokenScript: voiceoverText || prompt,
      sceneMotion: body.sceneMotion || "",
      additionalInstructions: body.additionalInstructions || "",
      primaryBenefit: body.primaryBenefit,
      painPoint: body.painPoint,
      cta: body.cta,
      avatarName,
      productName,
      aspectRatio: resolvedAspect,
      duration,
      presetCategory: body.presetCategory || "",
      modelId,
      hasAvatarImage,
      hasProductImage,
      hasAudio
    });

    // 5. Initial Creation Record Creation (with DB unique constraint race handler)
    let creation;
    let generationTypeEnum = "PRODUCT_AD";
    if (body.generationType === "APP_STUDIO" || body.presetCategory === "app") {
      generationTypeEnum = "APP_STUDIO";
    } else if (body.generationType === "PRODUCT_STUDIO" || body.presetCategory === "product") {
      generationTypeEnum = "PRODUCT_STUDIO";
    } else if (body.generationType === "VIDEO_STUDIO" || body.presetCategory === "video") {
      generationTypeEnum = "VIDEO_STUDIO";
    } else if (body.generationType) {
      generationTypeEnum = body.generationType;
    }
    try {
      creation = await prisma.creation.create({
        data: {
          workspaceId: workspace.id,
          userId,
          generationType: generationTypeEnum,
          presetId: body.presetId || body.presetCategory || "video_maker",
          title: compiledResult.compiledPrompt.substring(0, 50) + "...",
          spokenScript: voiceoverText || prompt || "",
          prompt: prompt,
          compiledPrompt: compiledResult.compiledPrompt,
          productInterpretation: JSON.stringify(compiledResult.productInterpretation),
          status: "PROCESSING",
          currentStage: "preparing",
          modelId,
          provider: currentProvider,
          aspectRatio: resolvedAspect,
          resolution,
          duration,
          mode: settings.mode || "standard",
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
            success: existing.status !== "FAILED",
            creationId: existing.id,
            requestId: existing.requestId || attemptId,
            status: existing.status || "preparing",
            stage: existing.currentStage || existing.status || "queued",
            idempotent: true
          }, { status: existing.status === "FAILED" ? 400 : 202 });
        }
      }

      if (createErr.message?.includes("Unknown argument") || createErr.message?.includes("Invalid `prisma.creation.create()`")) {
        console.warn("[PRISMA_SCHEMA_FALLBACK] Retrying creation create without unindexed fields:", createErr.message);
        creation = await prisma.creation.create({
          data: {
            workspaceId: workspace.id,
            userId,
            generationType: generationTypeEnum,
            presetId: body.presetId || body.presetCategory || "video_maker",
            title: compiledResult.compiledPrompt.substring(0, 50) + "...",
            spokenScript: voiceoverText || prompt || "",
            prompt: prompt,
            compiledPrompt: compiledResult.compiledPrompt,
            status: "PROCESSING",
            currentStage: "preparing",
            idempotencyKey
          }
        });
      } else {
        throw createErr;
      }
    }

    reservedCreationId = creation.id;
    reservedAmount = requiredCredits;

    // 6. Credit Escrow Ledger Lock
    if (requiredCredits > 0) {
      try {
        await CreditEscrowService.reserveCredits({
          workspaceId: workspace.id,
          creationId: creation.id,
          creationVariantId: null,
          amount: requiredCredits,
          idempotencyKey: `res_${idempotencyKey}`,
          userId
        });
      } catch (ledgerErr) {
        console.error("[CREDIT_LEDGER_RESERVE_ERROR]", ledgerErr.message);
      }
    }
    function ensureDataUriOrUrl(urlStr) {
      if (!urlStr || typeof urlStr !== "string") return null;
      const trimmed = urlStr.trim();
      if (trimmed.startsWith("data:") || trimmed.startsWith("https://")) return trimmed;
      if (trimmed.startsWith("/")) {
        const localPath = path.join(process.cwd(), "public", decodeURIComponent(trimmed));
        if (fs.existsSync(localPath)) {
          try {
            const ext = path.extname(localPath).toLowerCase();
            let mime = "image/png";
            if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
            else if (ext === ".webp") mime = "image/webp";
            else if (ext === ".gif") mime = "image/gif";
            const fileBuf = fs.readFileSync(localPath);
            return `data:${mime};base64,${fileBuf.toString("base64")}`;
          } catch (e) {
            console.error("[PREPARE_DATA_URI_ERR]", e.message);
          }
        }
      }
      return trimmed;
    }

    // 6.5 Voiceover Generation
    let audioUrl = null;
    let audioDataUri = null;
    if (voiceoverText && process.env.ELEVENLABS_API_KEY) {
      try {
        console.log("[LOG:generate.voiceover.started]", { attemptId });
        const ttsAdapter = new ElevenLabsAdapter();
        const ttsPayload = await ttsAdapter.buildPayload({ text: voiceoverText, voiceId: voiceoverVoice });
        const ttsResult = await ttsAdapter.submit(ttsPayload, process.env.ELEVENLABS_API_KEY);
        
        if (ttsResult.audioBuffer) {
          const filename = `voice_${attemptId}.mp3`;
          audioUrl = await saveMediaBuffer(ttsResult.audioBuffer, filename, "audio");
          audioDataUri = `data:audio/mp3;base64,${ttsResult.audioBuffer.toString("base64")}`;
          console.log("[LOG:generate.voiceover.success]", { attemptId, audioUrl });
        }
      } catch (ttsErr) {
        console.error("[LOG:generate.voiceover.failed]", { attemptId, error: ttsErr.message });
      }
    } else if (voiceoverText && !process.env.ELEVENLABS_API_KEY) {
      console.warn("[LOG:generate.voiceover.skipped]", "ELEVENLABS_API_KEY is missing");
    }

    // 7. Format Provider Payload
    const webhookUrl = `${process.env.WEBHOOK_URL || "http://localhost:3000"}/api/webhooks/fal`;
    
    // Convert relative avatar/product/input images to valid Data URIs or HTTPS URLs
    const prepAvatar = ensureDataUriOrUrl(avatarImageUrl);
    const prepProduct = ensureDataUriOrUrl(productImageUrl);
    const prepImages = (validation.processedImages || []).map(img => ensureDataUriOrUrl(img)).filter(Boolean);

    const finalImages = [...prepImages];
    if (prepAvatar && !finalImages.includes(prepAvatar)) finalImages.unshift(prepAvatar);
    if (prepProduct && !finalImages.includes(prepProduct)) finalImages.splice(finalImages.length > 0 ? 1 : 0, 0, prepProduct);

    const finalAudios = audioDataUri ? [audioDataUri] : (audioUrl ? [audioUrl] : []);

    const adapter = getProviderAdapter(modelId);
    const providerPayload = adapter.formatPayload({
      prompt: compiledResult.compiledPrompt,
      settings: { ...settings, aspect_ratio: resolvedAspect, duration, resolution },
      images: finalImages,
      audios: finalAudios,
      webhookUrl,
      audioUrl,
      avatarImageUrl: prepAvatar,
      productImageUrl: prepProduct,
      useAvatar
    });

    const hasImage = validation.processedImages && validation.processedImages.length > 0;
    const endpoint = adapter.getEndpoint(modelId, webhookUrl, hasImage, useAvatar);

    console.log("[LOG:generate.compiled.prompt]", compiledResult.compiledPrompt);
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
        data: { status: "FAILED", currentStage: "failed", errorCode: "PROVIDER_NETWORK_ERROR", error: networkErr.message }
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
        data: { status: "FAILED", currentStage: "failed", errorCode, error: errorText }
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
    const statusUrl = data.status_url || data.statusUrl;
    const responseUrl = data.response_url || data.responseUrl;

    console.log("[LOG:generate.provider.submission.accepted]", { attemptId, providerJobId, statusUrl });

    // Update Creation Record with Provider Request ID
    await prisma.creation.update({
      where: { id: creation.id },
      data: {
        requestId: providerJobId,
        providerJobId,
        statusUrl,
        responseUrl,
        status: "PROCESSING",
        currentStage: "queued"
      }
    });

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
    await CreditEscrowService.releaseCreationCredits({
      userId,
      workspaceId: null,
      creationId,
      amount,
      reason: "GENERATE_SUBMISSION_FAILED",
      idempotencyKey: `rel_${idempotencyKey}_${Date.now()}`
    });
  } catch (err) {
    console.error("[CREDIT_ROLLBACK_ERROR]", err.message);
  }
}
