export class MuapiVeoAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: Math.min(settings.duration || 8, 15),
      resolution: settings.resolution || "720p",
      webhook_url: webhookUrl
    };
  }

  getEndpoint() {
    return "https://api.muapi.ai/api/v1/veo3.1-image-to-video";
  }
}
