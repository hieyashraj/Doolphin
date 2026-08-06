import { validateGenerationRequest } from "../src/lib/validation.js";
import { compileGenerationPrompt } from "../src/lib/promptCompiler.js";

function runUnitTests() {
  console.log("=== RUNNING QA UNIT TESTS FOR 'AUTO' SETTINGS & MODEL RESOLUTIONS ===");

  const testCases = [
    {
      name: "Kling 3.0 Standard - Auto Aspect Ratio & Duration",
      body: {
        modelId: "fal-kling-3-std",
        prompt: "iphone selfie camera video from a car; woman speaking naturally about bedtime routine.",
        spokenScript: "My baby used to get so restless at bedtime, and honestly, those long nights were exhausting.",
        voiceoverText: "My baby used to get so restless at bedtime, and honestly, those long nights were exhausting.",
        additionalInstructions: "Selfie angle with natural lighting",
        settings: { duration: "Auto", resolution: "Auto", aspect_ratio: "Auto" },
        presetCategory: "General",
        generationType: "PRODUCT_AD"
      }
    },
    {
      name: "Grok Video - Auto Aspect Ratio & Resolution",
      body: {
        modelId: "grok-video",
        prompt: "Showcasing luxury skincare bottle product presentation.",
        spokenScript: "Discover the glow with our organic luxury serum formulation.",
        voiceoverText: "Discover the glow with our organic luxury serum formulation.",
        additionalInstructions: "Close up holding product",
        settings: { duration: "Auto", resolution: "Auto", aspect_ratio: "Auto" },
        presetCategory: "product",
        generationType: "PRODUCT_AD"
      }
    },
    {
      name: "Veo 3.1 - Auto Settings & Custom Resolution Mapping",
      body: {
        modelId: "veo-3-1",
        prompt: "Mobile UI app demonstration showcase for fintech app.",
        spokenScript: "Manage your investments seamlessly in one click.",
        voiceoverText: "Manage your investments seamlessly in one click.",
        additionalInstructions: "Demonstrate phone UI tapping motion",
        settings: { duration: "Auto", resolution: "480p", aspect_ratio: "Auto" },
        presetCategory: "app",
        generationType: "APP_STUDIO"
      }
    }
  ];

  for (const test of testCases) {
    console.log(`\nTesting ${test.name}...`);
    const validation = validateGenerationRequest(test.body, { id: "doolphin-default-user" });
    if (!validation.valid) {
      throw new Error(`Validation failed for ${test.name}: ${validation.error}`);
    }
    console.log(`✔ Validation passed: aspect_ratio=${validation.resolvedSettings.aspect_ratio}, duration=${validation.resolvedSettings.duration}, resolution=${validation.resolvedSettings.resolution}`);

    const compiled = compileGenerationPrompt({
      rawPrompt: test.body.prompt,
      spokenScript: test.body.spokenScript,
      sceneMotion: test.body.additionalInstructions,
      avatarName: "AI UGC Actor",
      productName: "Product",
      aspectRatio: validation.resolvedSettings.aspect_ratio,
      duration: validation.resolvedSettings.duration,
      presetCategory: test.body.presetCategory
    });
    
    if (!compiled.compiledPrompt || !compiled.productInterpretation) {
      throw new Error(`Prompt compilation failed for ${test.name}`);
    }
    console.log(`✔ Prompt compiled successfully. Interpretation category: ${compiled.productInterpretation.category}`);
  }

  console.log("\n==========================================");
  console.log("✔ ALL AUTO-SETTINGS QA TESTS PASSED CLEANLY!");
  console.log("==========================================");
}

runUnitTests();
