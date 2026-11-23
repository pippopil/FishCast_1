import type { LatLng, MapBbox, OfflineMapRegion, WaterBody } from './types';
import { offlineDb } from '../utils/offlineDb';

export const OFFLINE_TILE_CACHE_NAME = 'fishcast-offline-map-tiles-v1';

export interface PresetMapRegion {
  id: string;
  name: string;
  description: string;
  bbox: MapBbox;
}

export const PRESET_MAP_REGIONS: PresetMapRegion[] = [
  {
    id: 'region-istra',
    name: 'Истринское вдхр. и р. Истра',
    description: 'Истринское вдхр., Бужарово, Лучинское и плёсы р. Истра',
    bbox: { north: 56.08, south: 55.89, east: 36.93, west: 36.68 },
  },
  {
    id: 'region-senezh-trostenskoe',
    name: 'Сенеж, Тростенское и Глубокое',
    description: 'Северно-западный озёрный пояс Подмосковья',
    bbox: { north: 56.23, south: 55.74, east: 37.08, west: 36.32 },
  },
  {
    id: 'region-west-reservoirs',
    name: 'Озернинское, Рузское и Можайское',
    description: 'Западный каскад водохранилищ и карьеры у д. Сычёво',
    bbox: { north: 56.00, south: 55.52, east: 36.42, west: 35.72 },
  },
];

export interface TileCoord {
  z: number;
  x: number;
  y: number;
  url: string;
}

export function lonToTileX(lng: number, zoom: number): number {
  const n = 2 ** zoom;
  const clampedLng = Math.max(-180, Math.min(179.999999, lng));
  return Math.max(0, Math.min(n - 1, Math.floor(((clampedLng + 180) / 360) * n)));
}

export function latToTileY(lat: number, zoom: number): number {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return Math.max(0, Math.min(n - 1, y));
}

export function osmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function computeTileCoordsForBbox(
  bbox: MapBbox,
  minZoom: number,
  maxZoom: number,
  maxTiles = 220
): TileCoord[] {
  const coords: TileCoord[] = [];
  const zLow = Math.max(0, Math.min(minZoom, maxZoom));
  const zHigh = Math.min(16, Math.max(minZoom, maxZoom));

  for (let z = zLow; z <= zHigh; z++) {
    const xMin = lonToTileX(Math.min(bbox.west, bbox.east), z);
    const xMax = lonToTileX(Math.max(bbox.west, bbox.east), z);
    const yMin = latToTileY(Math.max(bbox.north, bbox.south), z);
    const yMax = latToTileY(Math.min(bbox.north, bbox.south), z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        coords.push({ z, x, y, url: osmTileUrl(z, x, y) });
        if (coords.length >= maxTiles) {
          return coords;
        }
      }
    }
  }
  return coords;
}

export function estimateRegionTileCount(bbox: MapBbox, minZoom: number, maxZoom: number, maxTiles = 220): number {
  let total = 0;
  const zLow = Math.max(0, Math.min(minZoom, maxZoom));
  const zHigh = Math.min(16, Math.max(minZoom, maxZoom));
  for (let z = zLow; z <= zHigh; z++) {
    const xMin = lonToTileX(Math.min(bbox.west, bbox.east), z);
    const xMax = lonToTileX(Math.max(bbox.west, bbox.east), z);
    const yMin = latToTileY(Math.max(bbox.north, bbox.south), z);
    const yMax = latToTileY(Math.min(bbox.north, bbox.south), z);
    total += (xMax - xMin + 1) * (yMax - yMin + 1);
    if (total >= maxTiles) return maxTiles;
  }
  return total;
}

export function isPointInBbox(pt: LatLng, bbox: MapBbox, paddingDeg = 0.03): boolean {
  const south = Math.min(bbox.south, bbox.north) - paddingDeg;
  const north = Math.max(bbox.south, bbox.north) + paddingDeg;
  const west = Math.min(bbox.west, bbox.east) - paddingDeg;
  const east = Math.max(bbox.west, bbox.east) + paddingDeg;
  return pt.lat >= south && pt.lat <= north && pt.lng >= west && pt.lng <= east;
}

export function bboxToPolygonRing(bbox: MapBbox): [number, number][] {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
}

export function normalizeBboxSelection(a: LatLng, b: LatLng): MapBbox {
  const minSpan = 0.015;
  let south = Math.min(a.lat, b.lat);
  let north = Math.max(a.lat, b.lat);
  let west = Math.min(a.lng, b.lng);
  let east = Math.max(a.lng, b.lng);

  if (north - south < minSpan) {
    const midLat = (north + south) / 2;
    south = midLat - minSpan / 2;
    north = midLat + minSpan / 2;
  }
  if (east - west < minSpan) {
    const midLng = (east + west) / 2;
    west = midLng - minSpan / 2;
    east = midLng + minSpan / 2;
  }

  return {
    north: Number(Math.min(85, north).toFixed(4)),
    south: Number(Math.max(-85, south).toFixed(4)),
    east: Number(Math.min(180, east).toFixed(4)),
    west: Number(Math.max(-180, west).toFixed(4)),
  };
}

export async function downloadOfflineMapRegion(params: {
  id: string;
  name: string;
  bbox: MapBbox;
  minZoom: number;
  maxZoom: number;
  waterBodies: WaterBody[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<OfflineMapRegion> {
  const { id, name, bbox, minZoom, maxZoom, waterBodies, signal, onProgress } = params;
  const tiles = computeTileCoordsForBbox(bbox, minZoom, maxZoom, 220);
  const total = tiles.length;
  let completed = 0;
  let cachedCount = 0;
  let sizeBytes = 0;

  const hasCaches = typeof caches !== 'undefined';
  const cache = hasCaches ? await caches.open(OFFLINE_TILE_CACHE_NAME) : null;

  const concurrency = 6;
  let idx = 0;

  const worker = async () => {
    while (idx < tiles.length) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const tile = tiles[idx++];
      try {
        const existingIdb = await offlineDb.getMapTile(tile.url);
        if (existingIdb && existingIdb.data && existingIdb.data.byteLength > 0) {
          sizeBytes += existingIdb.size_bytes || existingIdb.data.byteLength;
          cachedCount++;
        } else {
          const perTileController = new AbortController();
          const timeoutId = setTimeout(() => perTileController.abort(), 4500);
          const onOuterAbort = () => perTileController.abort();
          signal?.addEventListener('abort', onOuterAbort, { once: true });
          try {
            const res = await fetch(tile.url, { mode: 'cors', signal: perTileController.signal });
            if (res.ok) {
              const buffer = await res.clone().arrayBuffer();
              await offlineDb.putMapTile({
                url: tile.url,
                z: tile.z,
                x: tile.x,
                y: tile.y,
                data: buffer,
                size_bytes: buffer.byteLength,
                stored_at: new Date().toISOString(),
              });
              if (cache) {
                try {
                  await cache.put(tile.url, res);
                } catch {
                  // IndexedDB remains primary storage
                }
              }
              sizeBytes += buffer.byteLength;
              cachedCount++;
            }
          } finally {
            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onOuterAbort);
          }
        }
      } catch (err) {
        if (signal?.aborted) {
          throw err;
        }
        // Individual tile timeout or network error should not abort the remaining region tiles
      } finally {
        completed++;
        onProgress?.(completed, total);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tiles.length)) }, () => worker()));

  const coveredWaterBodyIds = waterBodies
    .filter((wb) => isPointInBbox(wb.center, bbox))
    .map((wb) => wb.id);

  return {
    id,
    name,
    bbox,
    min_zoom: minZoom,
    max_zoom: maxZoom,
    tile_count: total,
    cached_tiles: cachedCount,
    size_bytes: sizeBytes,
    water_body_ids: coveredWaterBodyIds,
    downloaded_at: new Date().toISOString(),
  };
}

export async function removeOfflineRegionTiles(
  regionToRemove: OfflineMapRegion,
  remainingRegions: OfflineMapRegion[]
): Promise<void> {
  const keepUrls = new Set<string>();
  for (const reg of remainingRegions) {
    for (const tile of computeTileCoordsForBbox(reg.bbox, reg.min_zoom, reg.max_zoom, 220)) {
      keepUrls.add(tile.url);
    }
  }
  const removeTiles = computeTileCoordsForBbox(
    regionToRemove.bbox,
    regionToRemove.min_zoom,
    regionToRemove.max_zoom,
    220
  );
  const urlsToDelete = removeTiles.filter((t) => !keepUrls.has(t.url)).map((t) => t.url);

  await offlineDb.deleteMapTiles(urlsToDelete);

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
      await Promise.all(urlsToDelete.map((u) => cache.delete(u)));
    } catch {
      // Graceful no-op if Cache Storage unavailable
    }
  }
}
