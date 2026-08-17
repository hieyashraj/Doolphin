import crypto from "node:crypto";
import { getMuapiApiKey } from "../generation/muapiCredentials.js";
import { getProviderCatalog, clearCatalogMemoryCache } from "./catalogStore.js";
import { validateProviderEndpointOrigin, resolveTrustedExecutionUrl } from "./execution/muapiExecutor.js";

const DEFAULT_NETWORK_TIMEOUT_MS = 3000;
const DEFAULT_SPEC_TTL_MS = 60 * 60 * 1000; // 1 hour memory TTL

// In-Memory Exact-Model Provider Spec Cache
let exactModelCache = new Map();

export function clearExactModelMemoryCache() {
  exactModelCache.clear();
  clearCatalogMemoryCache();
}

export function computeCatalogHash(catalogData) {
  if (!catalogData || typeof catalogData !== "object") return "";
  const { provenance, ...specOnly } = catalogData;
  const serialized = JSON.stringify(specOnly);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function validateProviderModelEntry(entry) {
  if (!entry || typeof entry !== "object") return false;

  const providerModelId = entry.providerModelId || entry.id || entry.name;
  if (typeof providerModelId !== "string" || !providerModelId.trim()) return false;

  const rawEndpoint = entry.endpoint;
  if (!validateProviderEndpointOrigin(rawEndpoint)) return false;

  const inputSchema = entry.inputSchema || entry.input_schema;
  if (!inputSchema || typeof inputSchema !== "object" || Object.keys(inputSchema).length === 0) return false;

  const rawDynamic = entry.dynamic_pricing !== undefined ? entry.dynamic_pricing : entry.dynamicPricing;
  if (typeof rawDynamic !== "boolean") return false;

  if (rawDynamic === true) {
    const estEndpoint = entry.estimateEndpoint || entry.estimate_endpoint;
    if (!validateProviderEndpointOrigin(estEndpoint)) return false;
  } else {
    const rawCost = entry.cost;
    if (rawCost === undefined || rawCost === null) return false;
    if (typeof rawCost === "object") {
      const amount = Number(rawCost.amount ?? rawCost.cost ?? rawCost.price);
      if (isNaN(amount) || amount < 0) return false;
    } else if (typeof rawCost === "number") {
      if (isNaN(rawCost) || rawCost < 0) return false;
    } else return false;
  }

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

export async function fetchLiveSingleMuapiModel(providerModelId, {
  fetchImpl = fetch,
  env = process.env,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
} = {}) {
  const singleUrl = `https://api.muapi.ai/api/v1/models/${encodeURIComponent(providerModelId)}`;
  let headers = { Accept: "application/json" };
  try {
    const apiKey = getMuapiApiKey(env);
    if (apiKey && !apiKey.includes("placeholder")) {
      headers["x-api-key"] = apiKey;
    }
  } catch {
    // Optional credentials
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(singleUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      const payload = await response.json();
      const rawEntry = payload.model || payload.data || payload;

      if (rawEntry && typeof rawEntry === "object") {
        const id = rawEntry.providerModelId || rawEntry.id || rawEntry.name || providerModelId;
        const rawDynamic = rawEntry.dynamic_pricing !== undefined ? rawEntry.dynamic_pricing : rawEntry.dynamicPricing;

        if (typeof rawDynamic === "boolean") {
          const rawEndpoint = rawEntry.endpoint;
          const rawEstEndpoint = rawEntry.estimateEndpoint || rawEntry.estimate_endpoint;

          let normalizedEndpoint = null;
          if (validateProviderEndpointOrigin(rawEndpoint)) {
            normalizedEndpoint = resolveTrustedExecutionUrl(rawEndpoint);
          }

          let normalizedEstEndpoint = null;
          if (rawDynamic && validateProviderEndpointOrigin(rawEstEndpoint)) {
            normalizedEstEndpoint = resolveTrustedExecutionUrl(rawEstEndpoint);
          }

          const normalizedEntry = {
            providerModelId: id,
            endpoint: normalizedEndpoint,
            cost: rawEntry.cost,
            dynamicPricing: rawDynamic,
            estimateEndpoint: normalizedEstEndpoint,
            inputSchema: rawEntry.inputSchema || rawEntry.input_schema,
            outputSchema: rawEntry.outputSchema || rawEntry.output_schema,
            description: rawEntry.description,
            category: rawEntry.category,
            family: rawEntry.family,
          };

          if (validateProviderModelEntry(normalizedEntry)) {
            return { success: true, spec: normalizedEntry };
          }
        }
      }
    }
  } catch {
    clearTimeout(timer);
  }

  // Fallback to catalog list query
  const catalogRes = await fetchLiveMuapiCatalog({ fetchImpl, env, timeoutMs });
  if (catalogRes.success) {
    const match = catalogRes.catalog.models.find(
      (m) => m.providerModelId === providerModelId || m.id === providerModelId
    );
    if (match) {
      return { success: true, spec: match };
    }
  }

  return { success: false };
}

/**
 * Authoritative Provider Spec Resolver with Cold-Path Auto-Fetch on Cache Miss.
 */
export async function resolveAuthoritativeProviderSpec(providerModelId, {
  fetchImpl = fetch,
  env = process.env,
  forceRefresh = false,
  ttlMs = DEFAULT_SPEC_TTL_MS,
  timeoutMs = DEFAULT_NETWORK_TIMEOUT_MS,
} = {}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Exact-Model Memory Cache Check
  if (!forceRefresh && exactModelCache.has(providerModelId)) {
    const cached = exactModelCache.get(providerModelId);
    if (cached.expiresAt > now) {
      return {
        success: true,
        spec: cached.spec,
        provenance: cached.provenance,
      };
    }
  }

  // 2. Automatic Live Cold-Path Fetch on Cache Miss
  const liveRes = await fetchLiveSingleMuapiModel(providerModelId, { fetchImpl, env, timeoutMs });
  if (liveRes.success) {
    const spec = liveRes.spec;
    const providerSpecHash = computeCatalogHash(spec);
    const provenance = {
      source: "LIVE_PROVIDER",
      loadedAt: nowIso,
      providerFetchedAt: nowIso,
      providerSpecHash,
      stale: false,
    };

    exactModelCache.set(providerModelId, {
      spec,
      provenance,
      expiresAt: now + ttlMs,
    });

    return {
      success: true,
      spec,
      provenance,
    };
  }

  // 3. Check Store / Bootstrap Catalog
  const storeRes = await getProviderCatalog({ forceRefresh: false });
  const storeModels = Array.isArray(storeRes?.catalog?.models) ? storeRes.catalog.models : [];
  const storeMatch = storeModels.find(
    (m) => m.providerModelId === providerModelId || m.id === providerModelId
  );

  if (storeMatch) {
    const source = storeRes.source === "LIVE_PROVIDER" ? "LIVE_PROVIDER" : "BOOTSTRAP";
    const providerSpecHash = computeCatalogHash(storeMatch);
    const provenance = {
      source,
      loadedAt: nowIso,
      providerFetchedAt: storeRes?.catalog?.fetchedAt || null,
      providerSpecHash,
      stale: source === "BOOTSTRAP",
    };

    exactModelCache.set(providerModelId, {
      spec: storeMatch,
      provenance,
      expiresAt: now + ttlMs,
    });

    return {
      success: true,
      spec: storeMatch,
      provenance,
    };
  }

  // 4. Local Fallback provenance (non-authoritative)
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
    clearExactModelMemoryCache();
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
