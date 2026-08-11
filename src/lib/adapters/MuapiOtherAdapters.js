export class MuapiSeedanceAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl }) {
    if (!prompt?.trim()) throw new Error("Seedance prompt is required");
    if (!Array.isArray(images) || images.length < 1 || images.length > 9) {
      throw new Error("Seedance Omni Reference requires 1-9 ordered image references");
    }

    const validAspectRatios = ["16:9", "9:16", "4:3", "3:4"];
    if (!validAspectRatios.includes(settings.aspect_ratio)) {
      throw new Error(`Unsupported Seedance aspect ratio '${settings.aspect_ratio}'`);
    }
    if (settings.resolution !== "720p") throw new Error("This endpoint profile is locked to its native 720p output");
    if (!Number.isInteger(settings.duration) || settings.duration < 4 || settings.duration > 15) {
      throw new Error("Seedance duration must be an integer from 4 to 15 seconds");
    }

    return {
      prompt: prompt.trim(),
      images_list: images,
      aspect_ratio: settings.aspect_ratio,
      duration: settings.duration,
      webhook_url: webhookUrl,
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
