import crypto from "node:crypto";
import { getMuapiApiKey } from "../generation/muapiCredentials.js";
import { getProviderCatalog, clearCatalogMemoryCache } from "./catalogStore.js";

const DEFAULT_NETWORK_TIMEOUT_MS = 3000;

export function computeCatalogHash(catalogData) {
  if (!catalogData || typeof catalogData !== "object") return "";
  const { provenance, ...specOnly } = catalogData;
  const serialized = JSON.stringify(specOnly);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function validateProviderModelEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.providerModelId !== "string" || !entry.providerModelId) return false;
  if (typeof entry.endpoint !== "string" || !entry.endpoint) return false;

  const isDynamic = Boolean(entry.dynamic_pricing ?? entry.dynamicPricing);

  if (entry.cost !== undefined && entry.cost !== null) {
    if (typeof entry.cost === "object") {
      const amount = Number(entry.cost.amount ?? entry.cost.cost ?? entry.cost.price);
      if (!isDynamic && (isNaN(amount) || amount < 0)) {
        return false;
      }
    } else if (typeof entry.cost === "number" && entry.cost < 0) {
      return false;
    }
  } else if (!isDynamic) {
    return false;
  }

  if (!entry.inputSchema && !entry.input_schema) return false;
  return true;
}

export function validateProviderCatalogPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { valid: false, reason: "Payload is not an object" };
  }
  const models = Array.isArray(payload.models) ? payload.models : Array.isArray(payload.data) ? payload.data : null;
  if (!models || models.length === 0) {
    return { valid: false, reason: "Payload contains no models array or empty array" };
  }

  for (const model of models) {
    if (!validateProviderModelEntry(model)) {
      return { valid: false, reason: `Model entry '${model?.providerModelId || model?.id || "unknown"}' failed validation` };
    }
  }

  return { valid: true, models };
}

export async function fetchLiveMuapiCatalog({
  fetchImpl = fetch,
  env = process.env,
  endpoint = "https://api.muapi.ai/api/v1/models",
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
} = {}) {
  let headers = { Accept: "application/json" };
  try {
    const apiKey = getMuapiApiKey(env);
    if (apiKey && !apiKey.includes("placeholder")) {
      headers["x-api-key"] = apiKey;
    }
  } catch {
    // Credentials optional for public catalog endpoints
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        success: false,
        code: "PROVIDER_SPEC_UNAVAILABLE",
        status: response.status,
        error: `HTTP ${response.status} when fetching MU API model catalog`,
      };
    }

    const payload = await response.json();
    const validation = validateProviderCatalogPayload(payload);

    if (!validation.valid) {
      return {
        success: false,
        code: "PROVIDER_SPEC_UNAVAILABLE",
        error: validation.reason,
      };
    }

    const nowIso = new Date().toISOString();
    const catalogData = {
      revision: payload.revision || `muapi-live-${Date.now()}`,
      fetchedAt: nowIso,
      models: validation.models,
      provenance: {
        source: "LIVE_PROVIDER",
        loadedAt: nowIso,
        providerFetchedAt: nowIso,
        validationStatus: "VALID",
        stale: false,
        configHash: computeCatalogHash(validation.models),
      },
    };

    return { success: true, catalog: catalogData };
  } catch (error) {
    clearTimeout(timer);
    return {
      success: false,
      code: "PROVIDER_SPEC_UNAVAILABLE",
      error: error.name === "AbortError" ? `MU API catalog fetch timed out after ${timeoutMs}ms` : error.message,
    };
  }
}

export async function resolveAuthoritativeProviderSpec(providerModelId, {
  fetchImpl = fetch,
  env = process.env,
  forceRefresh = false,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
} = {}) {
  const nowIso = new Date().toISOString();

  // 1. Attempt Live Refresh if forced or missing
  if (forceRefresh) {
    const liveRes = await fetchLiveMuapiCatalog({ fetchImpl, env, timeoutMs });
    if (liveRes.success) {
      const match = liveRes.catalog.models.find(
        (m) => m.providerModelId === providerModelId || m.id === providerModelId
      );
      if (match) {
        return {
          success: true,
          spec: match,
          provenance: {
            source: "LIVE_PROVIDER",
            loadedAt: nowIso,
            providerFetchedAt: nowIso,
            providerSpecHash: computeCatalogHash(match),
            stale: false,
          },
        };
      }
    }
  }

  // 2. Check Store / Memory / Bootstrap Cache (via getProviderCatalog)
  const storeRes = await getProviderCatalog({ forceRefresh: false });
  const storeModels = Array.isArray(storeRes?.catalog?.models) ? storeRes.catalog.models : [];
  const storeMatch = storeModels.find(
    (m) => m.providerModelId === providerModelId || m.id === providerModelId
  );

  if (storeMatch) {
    const source = storeRes.source === "LIVE_PROVIDER"
      ? "LIVE_PROVIDER"
      : storeRes.source === "DURABLE_LKG"
      ? "DURABLE_LKG"
      : "BOOTSTRAP";

    return {
      success: true,
      spec: storeMatch,
      provenance: {
        source,
        loadedAt: nowIso,
        providerFetchedAt: storeRes?.catalog?.fetchedAt || null,
        providerSpecHash: computeCatalogHash(storeMatch),
        stale: source === "BOOTSTRAP",
      },
    };
  }

  // 3. Local Fallback provenance
  return {
    success: false,
    code: "PROVIDER_SPEC_UNAVAILABLE",
    provenance: {
      source: "LOCAL_FALLBACK",
      loadedAt: nowIso,
      providerFetchedAt: null,
      stale: true,
    },
  };
}

export async function syncAndGetProviderCatalog({
  fetchImpl = fetch,
  env = process.env,
  forceRefresh = false,
  ttlMs = 60 * 60 * 1000,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
} = {}) {
  if (forceRefresh) {
    clearCatalogMemoryCache();
  }

  if (forceRefresh) {
    const liveResult = await fetchLiveMuapiCatalog({ fetchImpl, env, timeoutMs });
    if (liveResult.success) {
      return { catalog: liveResult.catalog, source: "LIVE_PROVIDER" };
    }
    console.warn("[ProviderCatalog] Live refresh failed; falling back to last-known-good:", liveResult.error);
  }

  return getProviderCatalog({ forceRefresh: false, ttlMs });
}
