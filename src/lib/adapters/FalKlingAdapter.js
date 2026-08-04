export class FalKlingAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    const payload = {
      prompt,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: String(Math.min(settings.duration || 5, 15)),
      generate_audio: settings.generate_audio !== false, // Fal.ai Kling 3.0 v3 native ambient audio flag
      webhook_url: webhookUrl
    };

    if (mainImage) {
      payload.image_url = mainImage;
    }

    return payload;
  }

  getEndpoint(modelId, webhookUrl) {
    const isPro = modelId && modelId.includes("pro");
    const mode = isPro ? "pro" : "standard";
    const subPath = "image-to-video";
    
    return `https://queue.fal.run/fal-ai/kling-video/v3/${mode}/${subPath}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
