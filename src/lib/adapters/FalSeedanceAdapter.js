export class FalSeedanceAdapter {
  formatPayload({ prompt, settings, images, webhookUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    return {
      prompt,
      image_url: mainImage,
      images_list: images,
      aspect_ratio: settings.aspect_ratio || "9:16",
      duration: Math.min(settings.duration || 5, 15),
      fal_webhook: webhookUrl
    };
  }

  getEndpoint(modelId, webhookUrl) {
    return `https://queue.fal.run/fal-ai/bytedance/seedance-v2?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
