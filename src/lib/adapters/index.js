import { FalSeedanceAdapter } from "./FalSeedanceAdapter.js";
import { FalKlingAdapter } from "./FalKlingAdapter.js";
import { FalLumaAdapter } from "./FalLumaAdapter.js";
import { MuapiGrokAdapter } from "./MuapiGrokAdapter.js";
import { MuapiVeoAdapter } from "./MuapiVeoAdapter.js";
import { MuapiSeedanceAdapter, MuapiHappyHorseAdapter } from "./MuapiOtherAdapters.js";

export function getProviderAdapter(modelId) {
  switch (modelId) {
    case "grok-video":
      return new MuapiGrokAdapter();
    case "veo-3-1":
      return new MuapiVeoAdapter();
    case "happy-horse":
      return new MuapiHappyHorseAdapter();
    case "seedance-2":
      return new MuapiSeedanceAdapter();
    case "fal-bytedance-seedance-v2":
      return new FalSeedanceAdapter();
    case "fal-kling-3-std":
      return new FalKlingAdapter();
    case "fal-luma-ray-v2":
      return new FalLumaAdapter();
    default:
      return new MuapiGrokAdapter();
  }
}
