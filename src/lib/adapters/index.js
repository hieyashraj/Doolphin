import { FalSeedanceAdapter } from "./FalSeedanceAdapter.js";
import { FalKlingAdapter } from "./FalKlingAdapter.js";
import { FalLumaAdapter } from "./FalLumaAdapter.js";
import { FalGenericAdapter } from "./FalGenericAdapter.js";
import { MuapiGrokAdapter } from "./MuapiGrokAdapter.js";
import { MuapiVeoAdapter } from "./MuapiVeoAdapter.js";
import { MuapiSeedanceAdapter, MuapiHappyHorseAdapter } from "./MuapiOtherAdapters.js";

export function getProviderAdapter(modelId) {
  // All Kling variants (kling-*, fal-kling-*, kling-avatar-*)
  if (modelId && (modelId.startsWith("kling-") || modelId.startsWith("fal-kling-"))) {
    return new FalKlingAdapter();
  }
  
  if (modelId === "luma-ray-2" || modelId === "fal-luma-ray-v2") {
    return new FalLumaAdapter();
  }

  if (modelId === "seedance-lite" || modelId === "seedance-pro" || modelId === "fal-bytedance-seedance-v2") {
    return new FalSeedanceAdapter();
  }

  switch (modelId) {
    case "minimax-video-01-live":
      return new FalGenericAdapter("fal-ai/minimax/video-01-live");
    case "minimax-video-01":
      return new FalGenericAdapter("fal-ai/minimax/video-01");
    case "wan-video":
      return new FalGenericAdapter({ t2v: "fal-ai/wan-t2v", i2v: "fal-ai/wan-i2v" });
    case "hunyuan-video":
      return new FalGenericAdapter("fal-ai/hunyuan-video");
    case "cogvideox-5b":
      return new FalGenericAdapter("fal-ai/cogvideox-5b");
    case "mochi-v1":
      return new FalGenericAdapter("fal-ai/mochi-v1");
    case "ltx-video":
      return new FalGenericAdapter("fal-ai/ltx-video");
    case "vidu-q1":
      return new FalGenericAdapter("fal-ai/vidu/q1/image-to-video");
    case "haiper-video-v2.5":
      return new FalGenericAdapter("fal-ai/haiper-video-v2.5");
    case "gencore-video":
      return new FalGenericAdapter("fal-ai/gencore/video");
    case "sadtalker":
      return new FalGenericAdapter("fal-ai/sadtalker");
    case "musetalk":
      return new FalGenericAdapter("fal-ai/musetalk");

    case "grok-video":
      return new MuapiGrokAdapter();
    case "veo-3-1":
      return new MuapiVeoAdapter();
    case "happy-horse":
      return new MuapiHappyHorseAdapter();
    case "seedance-2":
      return new MuapiSeedanceAdapter();
    default:
      return new MuapiGrokAdapter();
  }
}
