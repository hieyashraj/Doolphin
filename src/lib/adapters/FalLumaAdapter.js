export class FalLumaAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    const payload = {
      prompt,
      aspect_ratio: (settings.aspect_ratio && settings.aspect_ratio !== "Auto") ? settings.aspect_ratio : "9:16",
      loop: false
    };
    if (mainImage) {
      payload.image_url = mainImage;
    }
    return payload;
  }

  getEndpoint(modelId, webhookUrl, hasImage = false) {
    const subPath = hasImage ? "image-to-video" : "text-to-video";
    return `https://queue.fal.run/fal-ai/luma-dream-machine/ray-2/${subPath}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
