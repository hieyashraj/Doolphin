export class MuapiSeedanceAdapter {
  formatPayload({ prompt, settings = {}, images = [], audios = [], webhookUrl }) {
    let finalPrompt = prompt || "";
    
    // Automatically append references if they aren't explicitly in the prompt but arrays are provided
    images.forEach((img, i) => {
      const tag = `@image${i + 1}`;
      if (!finalPrompt.includes(tag)) {
        finalPrompt += ` ${tag}`;
      }
    });

    audios.forEach((audio, i) => {
      const tag = `@audio${i + 1}`;
      if (!finalPrompt.includes(tag)) {
        finalPrompt += ` ${tag}`;
      }
    });

    // Ensure valid aspect ratio according to enum
    const validAspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
    let aspectRatio = settings.aspect_ratio;
    if (!validAspectRatios.includes(aspectRatio)) {
      aspectRatio = "16:9"; // Default fallback
    }

    // Ensure duration is between 4 and 15
    const duration = Math.max(4, Math.min(settings.duration || 5, 15));

    return {
      prompt: finalPrompt.trim(),
      images: images.slice(0, 9),
      audios: audios.slice(0, 3),
      aspect_ratio: aspectRatio,
      duration: duration,
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/seedance-2-omni-reference-no-video-fast";
  }
}

export class MuapiHappyHorseAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      aspect_ratio: (settings.aspect_ratio && settings.aspect_ratio !== "Auto") ? settings.aspect_ratio : "9:16",
      duration: Math.min(settings.duration || 5, 15),
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/happy-horse-1-image-to-video-720p";
  }
}
