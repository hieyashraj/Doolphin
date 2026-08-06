export class FalSeedanceAdapter {
  formatPayload({ prompt, settings = {}, images = [], webhookUrl, audioUrl }) {
    const mainImage = images && images.length > 0 ? images[0] : undefined;
    const payload = {
      prompt,
      fal_webhook: webhookUrl
    };
    if (mainImage) payload.image_url = mainImage;
    if (images.length > 0) payload.images_list = images;
    if (settings.aspect_ratio && settings.aspect_ratio !== "Auto") payload.aspect_ratio = settings.aspect_ratio;
    if (settings.duration) payload.duration = Math.min(settings.duration, 15);
    
    if (audioUrl) {
      payload.audios = [{ audio_url: audioUrl }];
    }
    
    return payload;
  }

  getEndpoint(modelId, webhookUrl) {
    const isPro = modelId && modelId.includes("pro");
    const mode = isPro ? "pro" : "lite";
    return `https://queue.fal.run/fal-ai/bytedance/seedance/v1/${mode}/image-to-video?fal_webhook=${encodeURIComponent(webhookUrl)}`;
  }
}
