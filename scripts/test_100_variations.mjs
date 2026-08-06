import fs from "fs";
import path from "path";
import { validateGenerationRequest } from "../src/lib/validation.js";
import { compileGenerationPrompt } from "../src/lib/promptCompiler.js";
import { getProviderAdapter } from "../src/lib/adapters/index.js";

// Master 105 Combinatoric Variations Generator
export function generateTestVariations() {
  const models = [
    "fal-kling-3-std",
    "seedance-2",
    "fal-bytedance-seedance-v2",
    "grok-video",
    "veo-3-1",
    "fal-luma-ray-v2"
  ];

  const presets = [
    { category: "General", type: "PRODUCT_AD" },
    { category: "product", type: "PRODUCT_AD" },
    { category: "app", type: "APP_STUDIO" }
  ];

  const durations = [5, 7, 8, 12, 15, "Auto"];
  const aspectRatios = ["9:16", "16:9", "1:1", "4:3", "Auto"];
  const resolutions = ["480p", "720p", "1080p", "4k", "Auto"];

  const imageSets = [
    { name: "No Image", urls: [] },
    { name: "Product Image", urls: ["/studios/product_sample.png"] },
    { name: "App Screen Image", urls: ["/studios/app_screen_sample.png"] },
    { name: "Dual Image (Avatar + Product)", urls: ["/studios/avatar_sample.png", "/studios/product_sample.png"] }
  ];

  const textVariations = [
    {
      prompt: "iphone selfie camera video from a car; the woman is in the car making the video.",
      spokenScript: "My baby used to get so restless at bedtime, and these gentle breathing motions calm her down.",
      additionalInstructions: "Natural selfie camera angle with ambient lighting"
    },
    {
      prompt: "Showcasing luxury organic face serum with close-up bottle details.",
      spokenScript: "Transform your morning skincare routine with instant hydration.",
      additionalInstructions: "Macro focus on dropper application"
    },
    {
      prompt: "Mobile app walkthrough demonstrating instant money transfer feature.",
      spokenScript: "Send money globally in under 3 seconds with zero extra fees.",
      additionalInstructions: "Smooth phone screen tap animations"
    }
  ];

  const variations = [];
  let idCounter = 1;

  for (let m = 0; m < models.length; m++) {
    for (let p = 0; p < presets.length; p++) {
      for (let d = 0; d < durations.length; d++) {
        for (let a = 0; a < aspectRatios.length; a++) {
          for (let r = 0; r < resolutions.length; r++) {
            const imgSet = imageSets[(m + p + d + a + r) % imageSets.length];
            const textVar = textVariations[(m + d + r) % textVariations.length];
            
            variations.push({
              id: idCounter,
              name: `Variation #${idCounter}: [${models[m]}] | ${presets[p].category} | ${durations[d]}s | ${aspectRatios[a]} | ${resolutions[r]} | ${imgSet.name}`,
              modelId: models[m],
              preset: presets[p].category,
              requestedDuration: durations[d],
              requestedRatio: aspectRatios[a],
              requestedResolution: resolutions[r],
              imageInputName: imgSet.name,
              payload: {
                modelId: models[m],
                provider: models[m].startsWith("fal-") ? "FAL" : "MUAPI",
                prompt: textVar.prompt,
                spokenScript: textVar.spokenScript,
                voiceoverText: textVar.spokenScript,
                additionalInstructions: textVar.additionalInstructions,
                images: imgSet.urls,
                avatarName: "AI UGC Creator",
                productName: presets[p].category === "app" ? "Fintech App" : "Bedtime Otter",
                presetCategory: presets[p].category,
                generationType: presets[p].type,
                settings: {
                  duration: durations[d],
                  aspect_ratio: aspectRatios[a],
                  resolution: resolutions[r],
                  mode: "standard"
                }
              }
            });

            idCounter++;
            if (variations.length >= 105) break;
          }
          if (variations.length >= 105) break;
        }
        if (variations.length >= 105) break;
      }
      if (variations.length >= 105) break;
    }
    if (variations.length >= 105) break;
  }

  return variations;
}

export async function runVariationTest(test) {
  const userId = "doolphin-default-user";
  const { payload } = test;

  // Step 1: Validate Request & Resolve Settings
  const valResult = validateGenerationRequest(payload, { id: userId });
  if (!valResult.valid) {
    return { success: false, step: "Validation", error: valResult.error, code: valResult.code };
  }

  // Step 2: Compile Prompt & Structured Scene Plan
  const compiled = compileGenerationPrompt({
    rawPrompt: payload.prompt,
    spokenScript: payload.spokenScript,
    sceneMotion: payload.additionalInstructions,
    avatarName: payload.avatarName,
    productName: payload.productName,
    aspectRatio: valResult.resolvedSettings.aspect_ratio,
    duration: valResult.resolvedSettings.duration,
    presetCategory: payload.presetCategory
  });

  if (!compiled.compiledPrompt || !compiled.productInterpretation) {
    return { success: false, step: "PromptCompilation", error: "Failed to compile prompt or product interpretation" };
  }

  // Step 3: Provider Adapter Format Payload
  let providerPayload;
  try {
    const adapter = getProviderAdapter(payload.modelId);
    providerPayload = adapter.formatPayload({
      prompt: compiled.compiledPrompt,
      settings: {
        ...payload.settings,
        aspect_ratio: valResult.resolvedSettings.aspect_ratio,
        duration: valResult.resolvedSettings.duration,
        resolution: valResult.resolvedSettings.resolution
      },
      images: valResult.processedImages,
      webhookUrl: "http://localhost:3000/api/webhooks/fal"
    });
  } catch (adapterErr) {
    return { success: false, step: "ProviderAdapter", error: adapterErr.message };
  }

  if (!providerPayload || !providerPayload.prompt) {
    return { success: false, step: "ProviderAdapter", error: "Adapter generated empty payload or missing prompt" };
  }

  return {
    success: true,
    resolvedAspect: valResult.resolvedSettings.aspect_ratio,
    resolvedDuration: valResult.resolvedSettings.duration,
    resolvedResolution: valResult.resolvedSettings.resolution,
    provider: payload.provider
  };
}

async function main() {
  console.log("=== EXECUTING COMPLETE 105 VARIATIONS TEST MATRIX ===");
  const variations = generateTestVariations();
  const results = [];

  for (const test of variations) {
    const res = await runVariationTest(test);
    const resultObj = {
      id: test.id,
      modelId: test.modelId,
      preset: test.preset,
      requestedDuration: test.requestedDuration,
      requestedRatio: test.requestedRatio,
      requestedResolution: test.requestedResolution,
      imageInputName: test.imageInputName,
      resolvedAspect: res.resolvedAspect,
      resolvedDuration: res.resolvedDuration,
      resolvedResolution: res.resolvedResolution,
      status: res.success ? "PASS (100%)" : "FAIL",
      error: res.error || null
    };

    results.push(resultObj);
    console.log(`[${test.id}/105] ${test.name} => ${resultObj.status}`);
  }

  const resultsPath = path.join(process.cwd(), "scripts", "test_105_results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved complete 105 results log to ${resultsPath}`);
}

main();
