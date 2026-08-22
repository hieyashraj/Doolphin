// Static JSON import keeps the bootstrap fallback available to both Next build
// compilers. `fs.readFileSync(new URL(...))` becomes a Webpack asset URL at
// build time and breaks route collection before Product Studio can preflight.
import bootstrapCatalogRaw from "./catalog/bootstrap-catalog.json" with { type: "json" };

const nowIso = new Date().toISOString();
const bootstrapCatalog = Object.freeze({
  ...bootstrapCatalogRaw,
  provenance: Object.freeze({
    source: "BOOTSTRAP",
    loadedAt: nowIso,
    providerFetchedAt: null,
    validationStatus: "VALID",
    stale: true,
  }),
});

/**
 * 3-Level Catalog Resolution Hierarchy:
 * Level 1: Fast In-Memory Process Cache (with configurable TTL, default 1 hour)
 * Level 2: Durable CatalogStore Abstraction (durable DB/external store interface)
 * Level 3: Bundled Bootstrap Snapshot (src/lib/models/catalog/bootstrap-catalog.json)
 *
 * NOTE: Production code MUST NEVER write to src/ or the deployed filesystem.
 */

let memoryCache = {
  data: null,
  expiresAt: 0,
};

export class CatalogStoreAbstraction {
  async getDurableCatalog() {
    return null;
  }

  async saveDurableCatalog(_catalogData) {
    return true;
  }
}

const defaultCatalogStore = new CatalogStoreAbstraction();

export async function getProviderCatalog({
  forceRefresh = false,
  ttlMs = 60 * 60 * 1000,
  store = defaultCatalogStore,
} = {}) {
  const now = Date.now();

  // Level 1: Memory Cache
  if (!forceRefresh && memoryCache.data && memoryCache.expiresAt > now) {
    return { catalog: memoryCache.data, source: memoryCache.data.provenance?.source || "MEMORY_CACHE" };
  }

  // Level 2: Durable CatalogStore Abstraction
  try {
    const durableCatalog = await store.getDurableCatalog();
    if (durableCatalog && Array.isArray(durableCatalog.models) && durableCatalog.models.length > 0) {
      memoryCache = { data: durableCatalog, expiresAt: now + ttlMs };
      return { catalog: durableCatalog, source: "DURABLE_STORE" };
    }
  } catch (error) {
    console.warn("[ProviderCatalogStore] Level 2 durable store read warning:", error.message);
  }

  // Level 3: Bundled Bootstrap Snapshot (Immutable Fallback)
  memoryCache = { data: bootstrapCatalog, expiresAt: now + ttlMs };
  return { catalog: bootstrapCatalog, source: "BOOTSTRAP" };
}

export function clearCatalogMemoryCache() {
  memoryCache = { data: null, expiresAt: 0 };
}
