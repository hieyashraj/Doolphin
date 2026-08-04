export class MuapiGrokAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      images_list: images,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: Math.min(settings.duration || 6, 15),
      resolution: settings.resolution || "720p",
      mode: settings.mode || "normal",
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/grok-imagine-image-to-video";
  }
}
