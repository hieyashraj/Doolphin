export class FalKlingAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl, audioUrl, avatarImageUrl, useAvatar }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    const payload = {
      prompt,
      aspect_ratio: (settings.aspect_ratio && settings.aspect_ratio !== "Auto") ? settings.aspect_ratio : "9:16",
      duration: String(Math.min(settings.duration || 5, 15)),
      generate_audio: settings.generate_audio !== false,
      webhook_url: webhookUrl
    };

    if (useAvatar && avatarImageUrl) {
      payload.image_url = avatarImageUrl;
    } else if (mainImage) {
      payload.image_url = mainImage;
    }

    if (audioUrl) {
      payload.audio_url = audioUrl;
    }

    return payload;
  }

  getEndpoint(modelId, webhookUrl, hasImage = false, useAvatar = false) {
    if (useAvatar) {
      return `https://queue.fal.run/fal-ai/kling-video/v2/avatar?fal_webhook=${encodeURIComponent(webhookUrl)}`;
    }
    const isPro = modelId && modelId.includes("pro");
    const mode = isPro ? "pro" : "standard";
    const subPath = hasImage ? "image-to-video" : "text-to-video";
    const version = (modelId && modelId.includes("v1.5")) ? "v1.5" : "v3";
    
    return `https://queue.fal.run/fal-ai/kling-video/${version}/${mode}/${subPath}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
