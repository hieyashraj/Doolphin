export class FalGenericAdapter {
  constructor(endpointMap) {
    this.endpointMap = endpointMap;
  }

  formatPayload({ prompt, settings = {}, images = [], webhookUrl, audioUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    const payload = {
      prompt,
      fal_webhook: webhookUrl
    };

    if (mainImage) {
      payload.image_url = mainImage;
    }
    if (audioUrl) {
      payload.audio_url = audioUrl;
    }

    if (settings.aspect_ratio && settings.aspect_ratio !== "Auto") {
      payload.aspect_ratio = settings.aspect_ratio;
    }
    if (settings.duration) {
      payload.duration = settings.duration;
    }

    return payload;
  }

  getEndpoint(modelId, webhookUrl, hasImage = false) {
    const isAvatar = modelId === "sadtalker" || modelId === "musetalk";
    let basePath = "";

    if (this.endpointMap) {
      if (typeof this.endpointMap === "string") {
        basePath = this.endpointMap;
      } else {
        basePath = hasImage ? (this.endpointMap.i2v || this.endpointMap.default) : (this.endpointMap.t2v || this.endpointMap.default);
      }
    } else {
      // Default guess
      basePath = `fal-ai/${modelId}`;
    }

    return `https://queue.fal.run/${basePath}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
