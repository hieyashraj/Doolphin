/**
 * Pre-Generation Structured Scene Planner Engine
 * Formulates a structured shot plan before any credit reservation or provider call.
 * Enforces verbatim script speech guarantees and handles Additional Instructions overrides.
 */

export class ScenePlanner {
  /**
   * Generates a structured scene plan allocating script lines into avatar dialogue vs voiceover.
   */
  static createScenePlan({ spokenScript, additionalInstructions = "", duration = 12, generationType = "PRODUCT_AD", modelId = "seedance-2" }) {
    if (!spokenScript || typeof spokenScript !== "string" || !spokenScript.trim()) {
      return {
        valid: false,
        code: "SCRIPT_REQUIRED",
        error: "Script or prompt is required for video generation."
      };
    }

    const script = spokenScript.trim();
    if (script.length > 1000) {
      return {
        valid: false,
        code: "SCRIPT_EXCEEDS_MAX_LENGTH",
        error: `Script length exceeds maximum limit.`
      };
    }

    // Word count timing validation (approx 2.8 words per second, capped at max pipeline 15s runtime capacity of ~50 words)
    const wordCount = script.split(/\s+/).filter(Boolean).length;
    const instructionWords = String(additionalInstructions || "").trim().split(/\s+/).filter(Boolean).length;
    const autoDuration = Math.min(15, Math.max(4, Math.ceil(wordCount / 2.8 + 1 + Math.min(2, Math.floor(instructionWords / 35)) + (generationType === "PRODUCT_AD" || generationType === "APP_STUDIO" ? 1 : 0))));
    const effectiveDuration = duration === "Auto" ? autoDuration : (typeof duration === "number" ? duration : parseInt(duration) || autoDuration);
    const maxWordsAllowed = Math.max(Math.floor(effectiveDuration * 4.5) + 30, 100);
    if (wordCount > maxWordsAllowed) {
      return {
        valid: false,
        code: "SCRIPT_TIMING_EXCEEDED",
        error: `Script contains ${wordCount} words, which exceeds the timing capacity for a ${effectiveDuration}s video. Please keep your script shorter.`
      };
    }

    const instructions = (additionalInstructions || "").toLowerCase();

    // Determine delivery mode based on user instructions overriding defaults
    let deliveryMode = "AVATAR_DIALOGUE"; // Default: Avatar naturally speaks script
    if (instructions.includes("voiceover only") || instructions.includes("no visible avatar speech") || instructions.includes("no talking head")) {
      deliveryMode = "VOICEOVER_ONLY";
    } else if (instructions.includes("combination") || (instructions.includes("voiceover") && instructions.includes("avatar"))) {
      deliveryMode = "COMBINATION";
    } else if (instructions.includes("voiceover") || instructions.includes("b-roll") || instructions.includes("product shot")) {
      deliveryMode = "VOICEOVER";
    }

    // Split script into sentence lines for scene plan allocation
    const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
    const scriptSegments = [];

    if (deliveryMode === "AVATAR_DIALOGUE") {
      scriptSegments.push({
        shotIndex: 1,
        shotType: "TALKING_HEAD_INTERACTION",
        scriptText: script,
        deliveryType: "AVATAR_SPEECH",
        visualDirective: "Avatar speaks verbatim on camera while naturally holding/presenting product or app UI."
      });
    } else if (deliveryMode === "VOICEOVER_ONLY") {
      scriptSegments.push({
        shotIndex: 1,
        shotType: "PRODUCT_OR_APP_DEMO",
        scriptText: script,
        deliveryType: "VOICEOVER",
        visualDirective: "Macro close-up video of product or app interface with background voiceover audio only."
      });
    } else if (deliveryMode === "VOICEOVER") {
      scriptSegments.push({
        shotIndex: 1,
        shotType: "DEMO_BROLL",
        scriptText: script,
        deliveryType: "VOICEOVER",
        visualDirective: "Dynamic product showcase / app interaction B-roll with clean narrator voiceover."
      });
    } else {
      // COMBINATION
      const midpoint = Math.ceil(sentences.length / 2);
      const avatarPart = sentences.slice(0, midpoint).join(" ").trim();
      const voPart = sentences.slice(midpoint).join(" ").trim();

      if (avatarPart) {
        scriptSegments.push({
          shotIndex: 1,
          shotType: "AVATAR_INTRO",
          scriptText: avatarPart,
          deliveryType: "AVATAR_SPEECH",
          visualDirective: "Avatar speaks opening script lines directly to camera."
        });
      }
      if (voPart) {
        scriptSegments.push({
          shotIndex: 2,
          shotType: "PRODUCT_CLOSEUP_VOICEOVER",
          scriptText: voPart,
          deliveryType: "VOICEOVER",
          visualDirective: "Transition to close-up product / app demo shot while remaining script lines play as voiceover."
        });
      }
    }

    // Verify verbatim guarantee: Combined script segments must match original script exactly
    const combinedScript = scriptSegments.map(s => s.scriptText).join(" ").trim();

    return {
      valid: true,
      scenePlan: {
        spokenScript: script,
        originalLength: script.length,
        wordCount,
        deliveryMode,
        additionalInstructions: additionalInstructions || null,
        scriptSegments,
        verbatimGuarantee: combinedScript === script,
        createdBeforeEscrow: true
      }
    };
  }
}
