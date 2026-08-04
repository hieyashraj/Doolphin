export class FalLumaAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      keyframes: {
        frame0: mainImage ? { type: "image", url: mainImage } : undefined
      },
      aspect_ratio: settings.aspect_ratio || "9:16",
      loop: false
    };
  }

  getEndpoint(modelId, webhookUrl) {
    return `https://queue.fal.run/fal-ai/luma-dream-machine/ray-2?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
