export class MuapiSeedanceAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      images_list: images,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: Math.min(settings.duration || 5, 15),
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/seedance-2-image-to-video";
  }
}

export class MuapiHappyHorseAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: Math.min(settings.duration || 5, 15),
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/happy-horse-1-image-to-video-720p";
  }
}
