import type {
  BathymetryPoint,
  BiteForecastResponse,
  CatchReport,
  FishSpecies,
  KnotGuide,
  SyncQueueItem,
  WaterBody,
  WaterBodyAccessPoint,
  WaterBodyAnalysis,
  WeatherSnapshot,
} from '../lib/types';

const DB_NAME = 'fishcast_offline_v1';
const DB_VERSION = 3;

export interface KnotsCacheMeta {
  count: number;
  cached_at: string;
}

export interface SpeciesCacheMeta {
  count: number;
  cached_at: string;
  source: 'network' | 'seed';
}

export interface SpeciesSWRResult {
  species: FishSpecies[];
  source: 'cache' | 'network' | 'fallback';
  isStale: boolean;
  revalidated: boolean;
  meta: SpeciesCacheMeta | null;
}

export const DEFAULT_SPECIES_STALE_MS = 15 * 60 * 1000;
let inFlightSpeciesRevalidation: Promise<{ species: FishSpecies[]; meta: SpeciesCacheMeta } | null> | null = null;

export interface OfflineStorageStats {
  indexedDbUsedBytes: number;
  storageQuotaBytes: number | null;
  storageEstimateUsedBytes: number | null;
  waterBodiesCount: number;
  speciesCount: number;
  knotsCount: number;
  reportsCount: number;
  mapTilesCount: number;
  mapTilesBytes: number;
  offlineRegionsCount: number;
  referencesUpdatedAt: string | null;
  waterBodiesUpdatedAt: string | null;
}

export interface StoredMapTile {
  url: string;
  z: number;
  x: number;
  y: number;
  data: ArrayBuffer;
  size_bytes: number;
  stored_at: string;
}

interface CachedWaterBodyBundle {
  water_body: WaterBody;
  access_points: WaterBodyAccessPoint[];
  depth_points: BathymetryPoint[];
  analysis: WaterBodyAnalysis;
  forecast?: BiteForecastResponse;
  cached_at: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'local_id' });
      }
      if (!db.objectStoreNames.contains('local_diary')) {
        db.createObjectStore('local_diary', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('map_tiles')) {
        const tileStore = db.createObjectStore('map_tiles', { keyPath: 'url' });
        tileStore.createIndex('by_zoom', 'z', { unique: false });
      }
      if (!db.objectStoreNames.contains('knots')) {
        const knotsStore = db.createObjectStore('knots', { keyPath: 'id' });
        knotsStore.createIndex('by_difficulty', 'difficulty', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Graceful no-op if IndexedDB blocked
  }
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export const offlineDb = {
  async saveWaterBodies(items: WaterBody[]): Promise<void> {
    await kvSet('water_bodies', items);
    await kvSet('water_bodies_updated_at', new Date().toISOString());
  },
  async getWaterBodies(): Promise<WaterBody[]> {
    return (await kvGet<WaterBody[]>('water_bodies')) ?? [];
  },

  async saveKnotsCache(knots: KnotGuide[]): Promise<KnotsCacheMeta> {
    const meta: KnotsCacheMeta = {
      count: knots.length,
      cached_at: new Date().toISOString(),
    };
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['knots', 'kv'], 'readwrite');
        const knotsStore = tx.objectStore('knots');
        knotsStore.clear();
        for (const knot of knots) {
          knotsStore.put(knot);
        }
        const kvStore = tx.objectStore('kv');
        kvStore.put(knots, 'knots');
        kvStore.put(meta, 'knots_cache_meta');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      await kvSet('knots', knots);
      await kvSet('knots_cache_meta', meta);
    }
    return meta;
  },

  async getKnotsCache(): Promise<KnotGuide[]> {
    try {
      const db = await openDb();
      const items = await new Promise<KnotGuide[]>((resolve, reject) => {
        const tx = db.transaction('knots', 'readonly');
        const req = tx.objectStore('knots').getAll();
        req.onsuccess = () => resolve((req.result as KnotGuide[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      if (items.length > 0) return items;
    } catch {
      // Fall back to kv store below
    }
    return (await kvGet<KnotGuide[]>('knots')) ?? [];
  },

  async getKnotById(id: string): Promise<KnotGuide | null> {
    try {
      const db = await openDb();
      const item = await new Promise<KnotGuide | null>((resolve, reject) => {
        const tx = db.transaction('knots', 'readonly');
        const req = tx.objectStore('knots').get(id);
        req.onsuccess = () => resolve((req.result as KnotGuide) ?? null);
        req.onerror = () => reject(req.error);
      });
      if (item) return item;
    } catch {
      // Fallback below
    }
    const all = (await kvGet<KnotGuide[]>('knots')) ?? [];
    return all.find((k) => k.id === id) ?? null;
  },

  async getKnotsCacheMeta(): Promise<KnotsCacheMeta | null> {
    return kvGet<KnotsCacheMeta>('knots_cache_meta');
  },

  async saveSpeciesCache(
    species: FishSpecies[],
    source: 'network' | 'seed' = 'network'
  ): Promise<SpeciesCacheMeta> {
    const meta: SpeciesCacheMeta = {
      count: species.length,
      cached_at: new Date().toISOString(),
      source,
    };
    await Promise.all([
      kvSet('species', species),
      kvSet('species_cache_meta', meta),
      kvSet('references_updated_at', meta.cached_at),
    ]);
    return meta;
  },

  async getSpeciesCache(): Promise<{ species: FishSpecies[]; meta: SpeciesCacheMeta | null }> {
    const [species, meta] = await Promise.all([
      kvGet<FishSpecies[]>('species'),
      kvGet<SpeciesCacheMeta>('species_cache_meta'),
    ]);
    return {
      species: Array.isArray(species) ? species : [],
      meta: meta ?? null,
    };
  },

  async revalidateSpeciesCache(
    fetcher: () => Promise<FishSpecies[]>
  ): Promise<{ species: FishSpecies[]; meta: SpeciesCacheMeta } | null> {
    if (inFlightSpeciesRevalidation) {
      return inFlightSpeciesRevalidation;
    }
    inFlightSpeciesRevalidation = (async () => {
      try {
        const fresh = await fetcher();
        if (Array.isArray(fresh) && fresh.length > 0) {
          const meta = await this.saveSpeciesCache(fresh, 'network');
          return { species: fresh, meta };
        }
        return null;
      } catch {
        return null;
      } finally {
        inFlightSpeciesRevalidation = null;
      }
    })();
    return inFlightSpeciesRevalidation;
  },

  /**
   * Stale-While-Revalidate (SWR) loader for `speciesList` in IndexedDB.
   * Immediately serves cached species if present, and forces a background revalidation
   * against the server whenever online + stale (or when `forceRevalidate` is requested on reconnect).
   */
  async getSpeciesListSWR(options: {
    fetcher: () => Promise<FishSpecies[]>;
    fallback: FishSpecies[];
    isOnline: boolean;
    forceRevalidate?: boolean;
    staleAfterMs?: number;
    onRevalidated?: (fresh: FishSpecies[], meta: SpeciesCacheMeta) => void;
  }): Promise<SpeciesSWRResult> {
    const {
      fetcher,
      fallback,
      isOnline,
      forceRevalidate = false,
      staleAfterMs = DEFAULT_SPECIES_STALE_MS,
      onRevalidated,
    } = options;

    const { species: cached, meta } = await this.getSpeciesCache();
    const cachedAtMs = meta?.cached_at ? Date.parse(meta.cached_at) : NaN;
    const isExpired = !Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > staleAfterMs;
    const isStale = cached.length === 0 || meta?.source === 'seed' || isExpired || forceRevalidate;

    if (cached.length > 0) {
      if (isOnline && isStale) {
        void this.revalidateSpeciesCache(fetcher).then((res) => {
          if (res) {
            onRevalidated?.(res.species, res.meta);
          }
        });
      }
      return {
        species: cached,
        source: 'cache',
        isStale,
        revalidated: false,
        meta,
      };
    }

    // Cold cache: fetch immediately if online, else seed fallback
    if (isOnline) {
      const freshRes = await this.revalidateSpeciesCache(fetcher);
      if (freshRes) {
        onRevalidated?.(freshRes.species, freshRes.meta);
        return {
          species: freshRes.species,
          source: 'network',
          isStale: false,
          revalidated: true,
          meta: freshRes.meta,
        };
      }
    }

    const fallbackMeta = await this.saveSpeciesCache(fallback, 'seed');
    return {
      species: fallback,
      source: 'fallback',
      isStale: true,
      revalidated: false,
      meta: fallbackMeta,
    };
  },

  async saveSpeciesAndKnots(species: FishSpecies[], knots: KnotGuide[]): Promise<KnotsCacheMeta> {
    await this.saveSpeciesCache(species, 'network');
    const meta = await this.saveKnotsCache(knots);
    await kvSet('references_updated_at', meta.cached_at);
    return meta;
  },
  async getSpeciesAndKnots(): Promise<{ species: FishSpecies[]; knots: KnotGuide[] }> {
    const [species, knots] = await Promise.all([
      kvGet<FishSpecies[]>('species'),
      this.getKnotsCache(),
    ]);
    return { species: species ?? [], knots };
  },

  async saveLastOpenedWaterBody(bundle: CachedWaterBodyBundle): Promise<void> {
    await kvSet('last_water_body', bundle);
    await kvSet(`wb_bundle_${bundle.water_body.id}`, bundle);
  },
  async getLastOpenedWaterBody(id?: string): Promise<CachedWaterBodyBundle | null> {
    if (id) {
      const specific = await kvGet<CachedWaterBodyBundle>(`wb_bundle_${id}`);
      if (specific) return specific;
    }
    return kvGet<CachedWaterBodyBundle>('last_water_body');
  },

  async saveWeather(weather: WeatherSnapshot): Promise<void> {
    await kvSet('last_weather', weather);
  },
  async getWeather(): Promise<WeatherSnapshot | null> {
    return kvGet<WeatherSnapshot>('last_weather');
  },

  async saveReportsCache(reports: CatchReport[]): Promise<void> {
    await kvSet('reports_cache', reports);
  },
  async getReportsCache(): Promise<CatchReport[]> {
    return (await kvGet<CatchReport[]>('reports_cache')) ?? [];
  },

  async enqueueOperation(item: SyncQueueItem): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore
    }
  },

  async getQueue(): Promise<SyncQueueItem[]> {
    try {
      const db = await openDb();
      return await new Promise<SyncQueueItem[]>((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readonly');
        const req = tx.objectStore('sync_queue').getAll();
        req.onsuccess = () => resolve((req.result as SyncQueueItem[]) ?? []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  },

  async removeQueueItem(localId: string): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sync_queue', 'readwrite');
        tx.objectStore('sync_queue').delete(localId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore
    }
  },

  async updateQueueItem(item: SyncQueueItem): Promise<void> {
    await this.enqueueOperation(item);
  },

  async saveFavoriteIds(ids: string[]): Promise<void> {
    await kvSet('favorite_water_body_ids', ids);
  },
  async getFavoriteIds(): Promise<string[]> {
    return (await kvGet<string[]>('favorite_water_body_ids')) ?? [];
  },

  async saveAlertSettings(settings: import('../lib/types').BiteAlertSettings): Promise<void> {
    await kvSet('bite_alert_settings', settings);
  },
  async getAlertSettings(): Promise<import('../lib/types').BiteAlertSettings | null> {
    return kvGet<import('../lib/types').BiteAlertSettings>('bite_alert_settings');
  },

  async saveAlertHistory(entries: import('../lib/types').BiteAlertLogEntry[]): Promise<void> {
    await kvSet('bite_alert_history', entries.slice(0, 30));
  },
  async getAlertHistory(): Promise<import('../lib/types').BiteAlertLogEntry[]> {
    return (await kvGet<import('../lib/types').BiteAlertLogEntry[]>('bite_alert_history')) ?? [];
  },

  async saveOfflineRegions(regions: import('../lib/types').OfflineMapRegion[]): Promise<void> {
    await kvSet('offline_map_regions', regions);
  },
  async getOfflineRegions(): Promise<import('../lib/types').OfflineMapRegion[]> {
    return (await kvGet<import('../lib/types').OfflineMapRegion[]>('offline_map_regions')) ?? [];
  },

  async putMapTile(tile: StoredMapTile): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('map_tiles', 'readwrite');
        tx.objectStore('map_tiles').put(tile);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful no-op if IndexedDB unavailable
    }
  },

  async getMapTile(url: string): Promise<StoredMapTile | null> {
    try {
      const db = await openDb();
      return await new Promise<StoredMapTile | null>((resolve, reject) => {
        const tx = db.transaction('map_tiles', 'readonly');
        const req = tx.objectStore('map_tiles').get(url);
        req.onsuccess = () => resolve((req.result as StoredMapTile) ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  },

  async deleteMapTiles(urls: string[]): Promise<void> {
    if (urls.length === 0) return;
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('map_tiles', 'readwrite');
        const store = tx.objectStore('map_tiles');
        for (const u of urls) {
          store.delete(u);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Graceful no-op
    }
  },

  async getMapTilesStats(): Promise<{ count: number; totalBytes: number }> {
    try {
      const db = await openDb();
      return await new Promise<{ count: number; totalBytes: number }>((resolve, reject) => {
        const tx = db.transaction('map_tiles', 'readonly');
        const req = tx.objectStore('map_tiles').openCursor();
        let count = 0;
        let totalBytes = 0;
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as Partial<StoredMapTile>;
            count++;
            totalBytes += typeof val.size_bytes === 'number' ? val.size_bytes : 0;
            cursor.continue();
          } else {
            resolve({ count, totalBytes });
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return { count: 0, totalBytes: 0 };
    }
  },

  async getSeedVersion(): Promise<number | null> {
    return kvGet<number>('seed_data_version');
  },

  async setSeedVersion(version: number): Promise<void> {
    await kvSet('seed_data_version', version);
  },

  async clearStaleSeedCaches(): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const key = String(cursor.key);
            if (
              key === 'water_bodies' ||
              key === 'reports_cache' ||
              key === 'last_water_body' ||
              key.startsWith('wb_bundle_')
            ) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Graceful no-op if IndexedDB unavailable
    }
  },

  async getStorageStats(): Promise<OfflineStorageStats> {
    const empty: OfflineStorageStats = {
      indexedDbUsedBytes: 0,
      storageQuotaBytes: null,
      storageEstimateUsedBytes: null,
      waterBodiesCount: 0,
      speciesCount: 0,
      knotsCount: 0,
      reportsCount: 0,
      mapTilesCount: 0,
      mapTilesBytes: 0,
      offlineRegionsCount: 0,
      referencesUpdatedAt: null,
      waterBodiesUpdatedAt: null,
    };

    const estimateJsonBytes = (value: unknown): number => {
      try {
        const serialized = JSON.stringify(value);
        if (!serialized) return 0;
        if (typeof TextEncoder !== 'undefined') {
          return new TextEncoder().encode(serialized).length;
        }
        return serialized.length * 2;
      } catch {
        return 0;
      }
    };

    let storageQuotaBytes: number | null = null;
    let storageEstimateUsedBytes: number | null = null;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (typeof est.quota === 'number') storageQuotaBytes = est.quota;
        if (typeof est.usage === 'number') storageEstimateUsedBytes = est.usage;
      } catch {
        // Ignore storage estimate permission errors
      }
    }

    try {
      const db = await openDb();

      const kvStats = await new Promise<{
        bytes: number;
        waterBodiesCount: number;
        speciesCount: number;
        knotsKvCount: number;
        reportsCount: number;
        offlineRegionsCount: number;
        referencesUpdatedAt: string | null;
        waterBodiesUpdatedAt: string | null;
      }>((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').openCursor();
        let bytes = 0;
        let waterBodiesCount = 0;
        let speciesCount = 0;
        let knotsKvCount = 0;
        let reportsCount = 0;
        let offlineRegionsCount = 0;
        let referencesUpdatedAt: string | null = null;
        let knotsCachedAt: string | null = null;
        let waterBodiesUpdatedAt: string | null = null;

        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const key = String(cursor.key);
            const val = cursor.value;
            bytes += estimateJsonBytes(val);
            if (key === 'water_bodies' && Array.isArray(val)) waterBodiesCount = val.length;
            else if (key === 'species' && Array.isArray(val)) speciesCount = val.length;
            else if (key === 'knots' && Array.isArray(val)) knotsKvCount = val.length;
            else if (key === 'reports_cache' && Array.isArray(val)) reportsCount = val.length;
            else if (key === 'offline_map_regions' && Array.isArray(val)) offlineRegionsCount = val.length;
            else if (key === 'references_updated_at' && typeof val === 'string') referencesUpdatedAt = val;
            else if (key === 'knots_cache_meta' && val && typeof (val as KnotsCacheMeta).cached_at === 'string') {
              knotsCachedAt = (val as KnotsCacheMeta).cached_at;
            } else if (key === 'water_bodies_updated_at' && typeof val === 'string') {
              waterBodiesUpdatedAt = val;
            }
            cursor.continue();
          } else {
            resolve({
              bytes,
              waterBodiesCount,
              speciesCount,
              knotsKvCount,
              reportsCount,
              offlineRegionsCount,
              referencesUpdatedAt: referencesUpdatedAt ?? knotsCachedAt,
              waterBodiesUpdatedAt,
            });
          }
        };
        req.onerror = () => reject(req.error);
      });

      const [tileStats, knotsStoreStats, queueBytes] = await Promise.all([
        this.getMapTilesStats(),
        new Promise<{ count: number; bytes: number }>((resolve) => {
          try {
            const tx = db.transaction('knots', 'readonly');
            const req = tx.objectStore('knots').getAll();
            req.onsuccess = () => {
              const items = (req.result as KnotGuide[]) ?? [];
              resolve({ count: items.length, bytes: estimateJsonBytes(items) });
            };
            req.onerror = () => resolve({ count: 0, bytes: 0 });
          } catch {
            resolve({ count: 0, bytes: 0 });
          }
        }),
        new Promise<number>((resolve) => {
          try {
            const tx = db.transaction('sync_queue', 'readonly');
            const req = tx.objectStore('sync_queue').getAll();
            req.onsuccess = () => resolve(estimateJsonBytes(req.result ?? []));
            req.onerror = () => resolve(0);
          } catch {
            resolve(0);
          }
        }),
      ]);

      return {
        indexedDbUsedBytes: kvStats.bytes + tileStats.totalBytes + knotsStoreStats.bytes + queueBytes,
        storageQuotaBytes,
        storageEstimateUsedBytes,
        waterBodiesCount: kvStats.waterBodiesCount,
        speciesCount: kvStats.speciesCount,
        knotsCount: Math.max(knotsStoreStats.count, kvStats.knotsKvCount),
        reportsCount: kvStats.reportsCount,
        mapTilesCount: tileStats.count,
        mapTilesBytes: tileStats.totalBytes,
        offlineRegionsCount: kvStats.offlineRegionsCount,
        referencesUpdatedAt: kvStats.referencesUpdatedAt,
        waterBodiesUpdatedAt: kvStats.waterBodiesUpdatedAt,
      };
    } catch {
      return {
        ...empty,
        storageQuotaBytes,
        storageEstimateUsedBytes,
      };
    }
  },
};
