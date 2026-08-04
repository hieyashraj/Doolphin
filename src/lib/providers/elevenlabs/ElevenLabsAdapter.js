import { IProviderAdapter } from '../contracts.js';
import crypto from 'crypto';

export class ElevenLabsAdapter extends IProviderAdapter {
  async validateProviderConfiguration(apiKey) {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    return Boolean(key && !key.includes('placeholder'));
  }

  async validateRequest(request) {
    return { valid: true };
  }

  async estimateExternalCostMicroUsd(request) {
    const textLength = request.text?.length || 100;
    return textLength * 50; // Micro-USD cost estimate per character
  }

  async prepareAssets(request) {
    return request;
  }

  async buildPayload(request) {
    return {
      text: request.text || request.spokenScript || "Authentic AI UGC video ad generated with Doolphin.",
      voiceId: request.voiceId || "21m00Tcm4TlvDq8ikWAM", // Default ElevenLabs Rachel voice
      modelId: request.modelId || "eleven_monolingual_v1"
    };
  }

  async submit(payload, apiKey) {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key || key.includes('placeholder')) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').substring(0, 12);
      return { jobId: `elevenlabs-sim-${hash}`, status: 'completed', simulated: true };
    }

    const voiceId = payload.voiceId || "21m00Tcm4TlvDq8ikWAM";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: payload.text,
        model_id: payload.modelId || "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      jobId: `elevenlabs-live-${Date.now()}`,
      audioBuffer: Buffer.from(audioBuffer),
      status: 'completed'
    };
  }

  async getStatus(jobId) { return 'completed'; }
  async getResult(jobId) { return { status: 'completed' }; }
  async cancel(jobId) { return true; }
  normalizeStatus(status) { return status === 'completed' ? 'succeeded' : 'processing'; }
  normalizeError(error) { return { code: 'ELEVENLABS_ERROR', safeDetail: error.message }; }
  
  extractArtifacts(response) {
    if (response.audioBuffer) {
      return [{ type: 'tts_audio', buffer: response.audioBuffer }];
    }
    return [];
  }
  
  verifyWebhook(req) { return true; }
}
