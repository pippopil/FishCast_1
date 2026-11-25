import type { WeatherSnapshot } from './types';

function readEnvApiBase(): string {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL;
    return typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

export function getApiBaseUrl(): string {
  return readEnvApiBase();
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return window.location.protocol === 'capacitor:' || window.location.protocol === 'file:';
}

export function getRealtimeWsUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const base = getApiBaseUrl();
  if (base) {
    try {
      const parsed = new URL(base);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/ws`;
    } catch {
      return null;
    }
  }
  if (isCapacitorNative()) {
    // Standalone APK without configured backend URL skips local WS reconnect loop
    return null;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function compassDirection(deg: number): string {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'З';
}

function computeMoonIllumination(): { phase: string; illum: number } {
  const knownNewMoon = Date.UTC(2025, 0, 29, 12, 36, 0);
  const synodicMs = 29.53058867 * 86400000;
  const age = ((((Date.now() - knownNewMoon) % synodicMs) + synodicMs) % synodicMs) / synodicMs;
  const illum = Math.round(((1 - Math.cos(age * 2 * Math.PI)) / 2) * 100);
  if (age < 0.06 || age > 0.94) return { phase: 'Новолуние', illum };
  if (age < 0.22) return { phase: 'Растущий серп', illum };
  if (age < 0.28) return { phase: 'Первая четверть', illum };
  if (age < 0.47) return { phase: 'Растущая луна', illum };
  if (age < 0.53) return { phase: 'Полнолуние', illum };
  if (age < 0.72) return { phase: 'Убывающая луна', illum };
  if (age < 0.78) return { phase: 'Последняя четверть', illum };
  return { phase: 'Стареющий серп', illum };
}

export function buildFallbackWeather(lat = 55.975, lng = 36.825): WeatherSnapshot {
  const month = new Date().getMonth() + 1;
  const air = month >= 6 && month <= 8 ? 21 : month === 5 || month === 9 ? 14 : month === 4 || month === 10 ? 7 : 3;
  const water = Number(Math.max(1.5, air - 1.2).toFixed(1));
  const moon = computeMoonIllumination();
  return {
    lat,
    lng,
    captured_at: new Date().toISOString(),
    pressure_hpa: 1013,
    pressure_mmhg: 760,
    pressure_trend: 'steady',
    pressure_delta_6h: 0,
    pressure_stability_48h: 0.8,
    air_temp_c: air,
    air_temp_delta_48h_c: 0,
    water_temp_c: water,
    avg_air_temp_7d_c: air,
    avg_air_temp_14d_c: air,
    wind_speed_ms: 2.8,
    wind_gusts_ms: 5.0,
    wind_direction_deg: 225,
    wind_direction_label: 'ЮЗ',
    cloud_cover_pct: 55,
    shortwave_radiation_wm2: 180,
    precipitation_mm: 0,
    recent_rain_72h_mm: 0,
    moon_phase: moon.phase,
    moon_illumination: moon.illum,
    source: 'offline-fallback',
  };
}

async function fetchRiverDischargeDirect(
  lat: number,
  lng: number
): Promise<{
  river_discharge_m3s?: number;
  river_discharge_ratio?: number;
  river_discharge_trend?: WeatherSnapshot['river_discharge_trend'];
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url =
      `https://flood-api.open-meteo.com/v1/flood?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&daily=river_discharge&past_days=14&forecast_days=3`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return {};
    const json = (await res.json()) as {
      daily?: { time?: string[]; river_discharge?: Array<number | null> };
    };
    const times = json.daily?.time ?? [];
    const values = json.daily?.river_discharge ?? [];
    if (values.length < 3) return {};
    const todayIso = new Date().toISOString().slice(0, 10);
    let todayIdx = times.indexOf(todayIso);
    if (todayIdx < 0) todayIdx = Math.min(values.length - 1, Math.max(0, values.length - 3));
    const currentQ = values[todayIdx];
    if (typeof currentQ !== 'number' || !Number.isFinite(currentQ) || currentQ < 0) return {};

    const pastVals: number[] = [];
    for (let i = Math.max(0, todayIdx - 14); i < todayIdx; i++) {
      const v = values[i];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) pastVals.push(v);
    }
    if (pastVals.length === 0) return { river_discharge_m3s: Number(currentQ.toFixed(1)) };
    const sorted = [...pastVals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ratio = median > 0.05 ? Number((currentQ / median).toFixed(2)) : 1.0;

    const prevQ = values[Math.max(0, todayIdx - 2)];
    let trend: WeatherSnapshot['river_discharge_trend'] = 'steady';
    if (typeof prevQ === 'number' && Number.isFinite(prevQ)) {
      const pct = (currentQ - prevQ) / Math.max(0.1, prevQ);
      if (pct >= 0.25) trend = 'rising_fast';
      else if (pct >= 0.08) trend = 'rising';
      else if (pct <= -0.08) trend = 'falling';
    }
    return {
      river_discharge_m3s: Number(currentQ.toFixed(1)),
      river_discharge_ratio: ratio,
      river_discharge_trend: trend,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOpenMeteoWeatherDirect(lat: number, lng: number): Promise<WeatherSnapshot> {
  const moon = computeMoonIllumination();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=temperature_2m,precipitation,pressure_msl,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation` +
      `&hourly=temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,shortwave_radiation,precipitation` +
      `&past_days=14&forecast_days=3&wind_speed_unit=ms&timezone=auto`;
    const [res, floodMetrics] = await Promise.all([
      fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer)),
      fetchRiverDischargeDirect(lat, lng),
    ]);
    if (!res.ok) return buildFallbackWeather(lat, lng);
    const data = (await res.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        precipitation?: number;
        pressure_msl?: number;
        surface_pressure?: number;
        cloud_cover?: number;
        wind_speed_10m?: number;
        wind_gusts_10m?: number;
        wind_direction_10m?: number;
        shortwave_radiation?: number;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        pressure_msl?: number[];
        wind_speed_10m?: number[];
        wind_gusts_10m?: number[];
        wind_direction_10m?: number[];
        cloud_cover?: number[];
        shortwave_radiation?: number[];
        precipitation?: number[];
      };
    };
    const cur = data.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return buildFallbackWeather(lat, lng);

    const hTime = data.hourly?.time ?? [];
    const hTemp = data.hourly?.temperature_2m ?? [];
    const hPres = data.hourly?.pressure_msl ?? [];
    const hWind = data.hourly?.wind_speed_10m ?? [];
    const hGust = data.hourly?.wind_gusts_10m ?? [];
    const hWDir = data.hourly?.wind_direction_10m ?? [];
    const hCloud = data.hourly?.cloud_cover ?? [];
    const hRad = data.hourly?.shortwave_radiation ?? [];
    const hPrecip = data.hourly?.precipitation ?? [];

    const curPrefix = (cur.time ?? new Date().toISOString()).slice(0, 13);
    let curIdx = hTime.findIndex((t) => t.startsWith(curPrefix));
    if (curIdx < 0) curIdx = Math.max(0, Math.min(hTime.length - 1, 14 * 24));

    const meanRange = (arr: number[], start: number, end: number): number | undefined => {
      const s = Math.max(0, start);
      const e = Math.min(arr.length, end);
      if (e <= s) return undefined;
      let sum = 0;
      let count = 0;
      for (let i = s; i < e; i++) {
        if (typeof arr[i] === 'number' && !Number.isNaN(arr[i])) {
          sum += arr[i];
          count += 1;
        }
      }
      return count > 0 ? Number((sum / count).toFixed(1)) : undefined;
    };

    const avg7d = meanRange(hTemp, curIdx - 7 * 24, curIdx + 1);
    const avg14d = meanRange(hTemp, curIdx - 14 * 24, curIdx + 1);

    let airTempDelta48h: number | undefined;
    if (curIdx >= 48 && typeof hTemp[curIdx - 48] === 'number') {
      airTempDelta48h = Number((cur.temperature_2m - hTemp[curIdx - 48]).toFixed(1));
    } else if (curIdx >= 24 && typeof hTemp[curIdx - 24] === 'number') {
      airTempDelta48h = Number((cur.temperature_2m - hTemp[curIdx - 24]).toFixed(1));
    }

    let rain72h = 0;
    for (let i = Math.max(0, curIdx - 72); i <= Math.min(hPrecip.length - 1, curIdx); i++) {
      rain72h += Number(hPrecip[i] ?? 0);
    }

    const pressureHpa = Math.round(cur.pressure_msl ?? cur.surface_pressure ?? hPres[curIdx] ?? 1013);
    const pressureMmhg = Math.round(pressureHpa * 0.750062);
    const p6 = curIdx >= 6 && typeof hPres[curIdx - 6] === 'number' ? hPres[curIdx - 6] : pressureHpa;
    const delta6h = Number((pressureHpa - p6).toFixed(1));
    const trend: WeatherSnapshot['pressure_trend'] =
      delta6h >= 1.2 ? 'rising' : delta6h <= -1.2 ? 'falling' : 'steady';

    let stability48h = 0.75;
    const p48Start = Math.max(0, curIdx - 48);
    if (curIdx - p48Start >= 6) {
      let minP = Infinity;
      let maxP = -Infinity;
      for (let i = p48Start; i <= curIdx; i++) {
        const p = hPres[i];
        if (typeof p === 'number') {
          if (p < minP) minP = p;
          if (p > maxP) maxP = p;
        }
      }
      if (minP < Infinity) {
        stability48h = Number(Math.max(0, Math.min(1, 1 - (maxP - minP) / 18)).toFixed(2));
      }
    }

    const hourlyCompact = [];
    const winStart = Math.max(0, curIdx - 48);
    const winEnd = Math.min(hTime.length, curIdx + 76);
    for (let i = winStart; i < winEnd; i++) {
      const gustVal = hGust[i];
      const radVal = hRad[i];
      hourlyCompact.push({
        time: hTime[i],
        temp_c: Number((hTemp[i] ?? cur.temperature_2m).toFixed(1)),
        pressure_hpa: Number((hPres[i] ?? pressureHpa).toFixed(1)),
        wind_speed_ms: Number((hWind[i] ?? cur.wind_speed_10m ?? 3.0).toFixed(1)),
        wind_gusts_ms: typeof gustVal === 'number' ? Number(gustVal.toFixed(1)) : undefined,
        wind_direction_deg: Math.round(hWDir[i] ?? cur.wind_direction_10m ?? 210),
        cloud_cover_pct: Math.round(hCloud[i] ?? cur.cloud_cover ?? 55),
        shortwave_radiation_wm2: typeof radVal === 'number' ? Math.round(radVal) : undefined,
        precipitation_mm: Number((hPrecip[i] ?? 0).toFixed(1)),
      });
    }

    const air = Number(cur.temperature_2m.toFixed(1));
    const windDeg = Math.round(cur.wind_direction_10m ?? 210);
    const curGusts =
      typeof cur.wind_gusts_10m === 'number'
        ? Number(cur.wind_gusts_10m.toFixed(1))
        : typeof hGust[curIdx] === 'number'
          ? Number(hGust[curIdx].toFixed(1))
          : undefined;
    const curRad =
      typeof cur.shortwave_radiation === 'number'
        ? Math.round(cur.shortwave_radiation)
        : typeof hRad[curIdx] === 'number'
          ? Math.round(hRad[curIdx])
          : undefined;

    return {
      lat,
      lng,
      captured_at: new Date().toISOString(),
      pressure_hpa: pressureHpa,
      pressure_mmhg: pressureMmhg,
      pressure_trend: trend,
      pressure_delta_6h: delta6h,
      pressure_stability_48h: stability48h,
      air_temp_c: air,
      air_temp_delta_48h_c: airTempDelta48h,
      water_temp_c: Number(Math.max(1.0, (avg14d ?? air) * 0.78 + 1.4).toFixed(1)),
      avg_air_temp_7d_c: avg7d,
      avg_air_temp_14d_c: avg14d,
      wind_speed_ms: Number((cur.wind_speed_10m ?? 3.0).toFixed(1)),
      wind_gusts_ms: curGusts,
      wind_direction_deg: windDeg,
      wind_direction_label: compassDirection(windDeg),
      cloud_cover_pct: Math.round(cur.cloud_cover ?? hCloud[curIdx] ?? 55),
      shortwave_radiation_wm2: curRad,
      precipitation_mm: Number((cur.precipitation ?? 0).toFixed(1)),
      recent_rain_72h_mm: Number(rain72h.toFixed(1)),
      ...floodMetrics,
      moon_phase: moon.phase,
      moon_illumination: moon.illum,
      hourly: hourlyCompact,
      source: 'open-meteo',
    };
  } catch {
    return buildFallbackWeather(lat, lng);
  }
}

const DIRECT_BLOCKED_WATERWAY_VALUES = new Set([
  'lock_gate',
  'boatyard',
  'dock',
  'fuel',
  'slipway',
  'drain',
  'ditch',
  'waterfall',
  'pressurised',
  'culvert',
  'yes',
]);

function inferDirectWaterType(osmKey: string, osmVal: string, name: string): import('./types').WaterBodyType {
  const lower = name.toLowerCase();
  if (
    osmVal === 'reservoir' ||
    osmVal === 'dam' ||
    osmVal === 'weir' ||
    lower.includes('водохранилищ') ||
    lower.includes('вдхр') ||
    lower.includes('плотин') ||
    lower.includes('платин')
  ) {
    return 'reservoir';
  }
  if (osmVal === 'quarry' || lower.includes('карьер')) return 'quarry';
  if (osmVal === 'oxbow' || lower.includes('стариц')) return 'oxbow';
  if (osmVal === 'pond' || lower.includes('пруд')) return 'pond';
  if (osmKey === 'waterway' || osmVal === 'river' || osmVal === 'canal' || lower.includes('канал') || lower.includes('река')) {
    return 'river';
  }
  return 'lake';
}

function stripRussianHydroPrefix(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:река|речка|р\.|озеро|оз\.|водохранилище|вдхр\.?|пруд|карьер|канал|старица)\s+/i, '')
    .trim();
}

function buildDirectApproxPolygon(lat: number, lng: number, areaHa: number, type: import('./types').WaterBodyType): [number, number][] {
  const radiusM = Math.max(120, Math.min(2600, Math.sqrt((areaHa * 10000) / Math.PI)));
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.25, Math.cos((lat * Math.PI) / 180)));
  const stretch = type === 'river' ? 2.4 : type === 'reservoir' ? 1.5 : 1.15;
  const pts: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([
      Number((lng + Math.cos(a) * dLng * stretch).toFixed(5)),
      Number((lat + Math.sin(a) * dLat).toFixed(5)),
    ]);
  }
  pts.push(pts[0]);
  return pts;
}

function buildDirectRiverCorridor(
  coords: [number, number][],
  halfWidthM = 45
): { polygon: [number, number][]; center: { lat: number; lng: number } } | null {
  if (coords.length < 2) return null;
  const maxPts = 42;
  const step = Math.max(1, Math.floor(coords.length / maxPts));
  const sampled: [number, number][] = [];
  for (let i = 0; i < coords.length; i += step) sampled.push(coords[i]);
  if (sampled[sampled.length - 1] !== coords[coords.length - 1]) {
    sampled.push(coords[coords.length - 1]);
  }
  if (sampled.length < 2) return null;

  const mid = sampled[Math.floor(sampled.length / 2)];
  const cosLat = Math.max(0.25, Math.cos((mid[1] * Math.PI) / 180));
  const dLatPerM = 1 / 111320;
  const dLngPerM = 1 / (111320 * cosLat);

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < sampled.length; i++) {
    const prev = sampled[Math.max(0, i - 1)];
    const next = sampled[Math.min(sampled.length - 1, i + 1)];
    const dx = (next[0] - prev[0]) * cosLat;
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([
      Number((sampled[i][0] + nx * halfWidthM * dLngPerM).toFixed(5)),
      Number((sampled[i][1] + ny * halfWidthM * dLatPerM).toFixed(5)),
    ]);
    right.push([
      Number((sampled[i][0] - nx * halfWidthM * dLngPerM).toFixed(5)),
      Number((sampled[i][1] - ny * halfWidthM * dLatPerM).toFixed(5)),
    ]);
  }
  const poly = [...left, ...right.reverse(), left[0]];
  return {
    polygon: poly,
    center: { lat: Number(mid[1].toFixed(5)), lng: Number(mid[0].toFixed(5)) },
  };
}

interface DirectNominatimItem {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  display_name?: string;
  category?: string;
  class?: string;
  type?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  geojson?: {
    type?: string;
    coordinates?: unknown;
  };
}

function isDirectNominatimWaterItem(item: DirectNominatimItem): boolean {
  const cat = (item.category ?? item.class ?? '').toLowerCase();
  const t = (item.type ?? '').toLowerCase();
  if (DIRECT_BLOCKED_WATERWAY_VALUES.has(t)) return false;
  if (cat === 'waterway') return ['river', 'canal', 'stream', 'riverbank', 'oxbow', 'dam', 'weir'].includes(t);
  if (cat === 'natural') return ['water', 'bay', 'wetland'].includes(t);
  if (cat === 'water') return true;
  if (cat === 'landuse') return t === 'reservoir' || t === 'basin';
  const nameLower = (item.name ?? '').toLowerCase();
  return /водохранилищ|озеро|река|пруд|карьер|канал|плотин|платин/.test(nameLower);
}

function buildWaterBodyFromDirectNominatim(
  item: DirectNominatimItem,
  anchor?: { lat: number; lng: number }
): import('./types').WaterBody | null {
  if (!isDirectNominatimWaterItem(item)) return null;
  const title = (item.name || item.display_name?.split(',')[0] || '').trim();
  if (!title) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const cat = (item.category ?? item.class ?? '').toLowerCase();
  const rawType = (item.type ?? '').toLowerCase();
  const type = inferDirectWaterType(cat, rawType, title);

  let extentKm = 0;
  let areaHa = type === 'reservoir' ? 620 : type === 'lake' ? 30 : type === 'river' ? 65 : 6;
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const [minLatS, maxLatS, minLonS, maxLonS] = item.boundingbox;
    const dLatKm = Math.abs(Number(maxLatS) - Number(minLatS)) * 111;
    const dLngKm = Math.abs(Number(maxLonS) - Number(minLonS)) * 111 * Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    extentKm = Math.hypot(dLatKm, dLngKm);
    if (type === 'river') {
      areaHa = Math.max(18, Math.min(260, Math.round(extentKm * (extentKm >= 60 ? 3.5 : 1.4))));
    } else {
      areaHa = Math.max(2, Math.min(18000, Math.round(dLatKm * dLngKm * 38)));
    }
  }

  let polygon: [number, number][] | null = null;
  let center = { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };

  const gj = item.geojson;
  if (gj?.type === 'Polygon' && Array.isArray(gj.coordinates) && Array.isArray(gj.coordinates[0])) {
    const ring = (gj.coordinates[0] as [number, number][]).filter(
      (c) => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
    );
    if (ring.length >= 4) {
      polygon = ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
    }
  } else if (gj?.type === 'MultiPolygon' && Array.isArray(gj.coordinates)) {
    let bestRing: [number, number][] = [];
    for (const poly of gj.coordinates as [number, number][][][]) {
      const outer = poly?.[0];
      if (Array.isArray(outer) && outer.length > bestRing.length) bestRing = outer;
    }
    if (bestRing.length >= 4) {
      polygon = bestRing.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
    }
  } else if (gj?.type === 'LineString' && Array.isArray(gj.coordinates)) {
    const line = gj.coordinates as [number, number][];
    const corridor = buildDirectRiverCorridor(line, extentKm >= 60 ? 55 : 28);
    if (corridor) {
      polygon = corridor.polygon;
      center = corridor.center;
    }
  } else if (gj?.type === 'MultiLineString' && Array.isArray(gj.coordinates)) {
    const lines = (gj.coordinates as [number, number][][]).filter((l) => Array.isArray(l) && l.length >= 2);
    if (lines.length > 0) {
      // Pick the line closest to anchor (or longest segment if no anchor)
      let chosen = lines[0];
      if (anchor) {
        let bestDist = Infinity;
        for (const l of lines) {
          const mid = l[Math.floor(l.length / 2)];
          const d = Math.hypot(mid[1] - anchor.lat, mid[0] - anchor.lng);
          if (d < bestDist) {
            bestDist = d;
            chosen = l;
          }
        }
      } else {
        chosen = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0]);
      }
      const corridor = buildDirectRiverCorridor(chosen, extentKm >= 60 ? 55 : 28);
      if (corridor) {
        polygon = corridor.polygon;
        center = corridor.center;
      }
    }
  }

  const maxDepth =
    type === 'reservoir'
      ? areaHa >= 500 ? 14 : 9.5
      : type === 'river'
        ? areaHa >= 120 ? 6.0 : areaHa >= 35 ? 3.8 : 2.5
        : type === 'lake'
          ? areaHa >= 150 ? 8.5 : areaHa >= 35 ? 5.0 : 2.8
          : 2.2;

  const osmPrefix = item.osm_type === 'relation' ? 'R' : item.osm_type === 'way' ? 'W' : 'N';
  const osmId = `${osmPrefix}${item.osm_id ?? `${center.lat.toFixed(4)}-${center.lng.toFixed(4)}`}`;
  const region =
    (item.display_name ?? '')
      .split(',')
      .slice(1, 3)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' · ') || 'OpenStreetMap';

  return {
    id: `wb-osm-${osmId}`,
    name: title,
    display_label: title,
    type,
    center,
    polygon: polygon ?? buildDirectApproxPolygon(center.lat, center.lng, areaHa, type),
    area_ha: areaHa,
    source: 'osm',
    confidence: polygon ? 0.92 : 0.84,
    moderation_status: 'verified',
    connected_to: null,
    has_bathymetry: false,
    max_depth_m: maxDepth,
    avg_depth_m: Number((maxDepth * 0.45).toFixed(1)),
    depth_source: 'estimated',
    region,
    external_id: `OSM-${osmId}`,
    ndwi_stability: 'year_round',
    vegetation_index: type === 'reservoir' ? 'low' : 'moderate',
    water_clarity: 'moderate',
    target_zone: center,
  };
}

export interface DirectSearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  water_body_id: string | null;
  lat?: number;
  lng?: number;
  is_water_body?: boolean;
  water_type?: import('./types').WaterBodyType;
}

/**
 * Direct client-side hydro search (Local catalog + Nominatim + Photon) used in
 * standalone Capacitor APK builds and as a live fallback when backend search fails.
 * Handles Russian river/lake prefixes ("река Сейм" -> "Сейм") seamlessly.
 */
export async function searchWaterBodiesDirect(
  rawText: string,
  localWaterBodies: import('./types').WaterBody[],
  anchor?: { lat: number; lng: number }
): Promise<DirectSearchResultItem[]> {
  const query = rawText.trim().replace(/платин/gi, 'плотин');
  if (query.length < 2) return [];
  const lowerQ = query.toLowerCase();
  const strippedQ = stripRussianHydroPrefix(query);
  const lowerStripped = strippedQ.toLowerCase();

  const stopWords = new Set(['в', 'на', 'у', 'под', 'г', 'город', 'городе', 'с', 'село', 'селе', 'р', 'река', 'озеро']);
  const tokens = lowerQ
    .replace(/[.,()«»"']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));

  const out: DirectSearchResultItem[] = [];
  const seen = new Set<string>();
  const pushItem = (item: DirectSearchResultItem) => {
    const key = `${item.title.toLowerCase()}:${item.water_body_id ?? `${item.lat?.toFixed(2)},${item.lng?.toFixed(2)}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  // 1. Local matches first (supports multi-word & Russian declension stems)
  for (const w of localWaterBodies) {
    const hay = `${w.display_label} ${w.region ?? ''}`.toLowerCase();
    const tokenMatch =
      tokens.length > 0 &&
      tokens.every((t) => {
        const stem = t.length >= 5 ? t.slice(0, t.length - 1) : t;
        return hay.includes(t) || hay.includes(stem);
      });
    if (hay.includes(lowerQ) || (lowerStripped.length >= 2 && hay.includes(lowerStripped)) || tokenMatch) {
      pushItem({
        id: w.id,
        title: w.display_label,
        subtitle: `${w.region} · ${w.area_ha} га`,
        water_body_id: w.id,
        lat: w.center.lat,
        lng: w.center.lng,
        is_water_body: true,
        water_type: w.type,
      });
    }
  }

  // 2. Live Nominatim + Photon queries (with both original and stripped prefix)
  const searchTerms = Array.from(
    new Set([query, ...(strippedQ.length >= 2 && strippedQ !== query ? [strippedQ] : [])])
  );

  const nomRequests = searchTerms.map(async (term) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}&format=jsonv2&limit=8&accept-language=ru`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return [] as DirectNominatimItem[];
      const json = (await res.json()) as DirectNominatimItem[];
      return Array.isArray(json) ? json : [];
    } catch {
      return [] as DirectNominatimItem[];
    } finally {
      clearTimeout(t);
    }
  });

  const photonUrl =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(strippedQ.length >= 2 ? strippedQ : query)}&limit=8` +
    (anchor ? `&lat=${anchor.lat.toFixed(4)}&lon=${anchor.lng.toFixed(4)}` : '');

  const photonReq = (async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(photonUrl, { signal: ctrl.signal });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: {
            osm_id?: number;
            osm_type?: string;
            osm_key?: string;
            osm_value?: string;
            name?: string;
            state?: string;
            county?: string;
          };
        }>;
      };
      return json.features ?? [];
    } catch {
      return [];
    } finally {
      clearTimeout(t);
    }
  })();

  const [nomBatches, photonFeatures] = await Promise.all([Promise.all(nomRequests), photonReq]);

  for (const item of nomBatches.flat()) {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const isWater = isDirectNominatimWaterItem(item);
    const title = (item.name || item.display_name?.split(',')[0] || '').trim();
    if (!title) continue;
    const cat = (item.category ?? item.class ?? '').toLowerCase();
    const rawType = (item.type ?? '').toLowerCase();
    const subtitle =
      (item.display_name ?? '')
        .split(',')
        .slice(1, 3)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' · ') || 'OpenStreetMap';

    if (isWater) {
      pushItem({
        id: `nom-${item.osm_type ?? 'w'}-${item.osm_id ?? `${lat}-${lng}`}`,
        title,
        subtitle,
        water_body_id: null,
        lat,
        lng,
        is_water_body: true,
        water_type: inferDirectWaterType(cat, rawType, title),
      });
    }
  }

  for (const feat of photonFeatures) {
    const coords = feat.geometry?.coordinates;
    const p = feat.properties;
    if (!coords || coords.length < 2 || !p?.name) continue;
    const osmKey = (p.osm_key ?? '').toLowerCase();
    const osmVal = (p.osm_value ?? '').toLowerCase();
    if (DIRECT_BLOCKED_WATERWAY_VALUES.has(osmVal)) continue;
    const isWater =
      osmKey === 'water' ||
      osmKey === 'waterway' ||
      (osmKey === 'natural' && osmVal === 'water') ||
      (osmKey === 'landuse' && osmVal === 'reservoir');
    if (!isWater) continue;
    const subtitle = [p.state, p.county].filter(Boolean).slice(0, 2).join(' · ') || 'OpenStreetMap';
    pushItem({
      id: `ph-${p.osm_type ?? 'W'}-${p.osm_id ?? `${coords[1]}-${coords[0]}`}`,
      title: p.name.trim(),
      subtitle,
      water_body_id: null,
      lat: Number(coords[1]),
      lng: Number(coords[0]),
      is_water_body: true,
      water_type: inferDirectWaterType(osmKey, osmVal, p.name),
    });
  }

  return out.slice(0, 10);
}

/**
 * Direct client-side OSM discovery (Nominatim + Photon + Overpass) used automatically
 * in standalone Capacitor Android APK builds and when backend API is unavailable.
 * Supports rivers (including long named rivers like Сейм), lakes, reservoirs, and ponds.
 */
export async function discoverOsmWaterBodiesDirect(params: {
  lat: number;
  lng: number;
  radiusKm?: number;
  query?: string;
  majorOnly?: boolean;
}): Promise<import('./types').WaterBody[]> {
  const { lat, lng, radiusKm = 20, query, majorOnly = false } = params;
  const radiusClamped = Math.max(6, Math.min(35, radiusKm));
  const cleanQuery = (query ?? '').trim();
  const strippedQuery = stripRussianHydroPrefix(cleanQuery);
  const hasExplicitQuery = cleanQuery.length >= 2;

  const photonUrls: string[] = [
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=20&osm_tag=water`,
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=16&osm_tag=natural:water`,
    // Always query rivers AND canals even when majorOnly=true so major rivers (Сейм, Ока, Дон, etc.) are never missed!
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=18&osm_tag=waterway:river&osm_tag=waterway:canal`,
  ];
  if (hasExplicitQuery) {
    const qTerm = strippedQuery.length >= 2 ? strippedQuery : cleanQuery;
    photonUrls.push(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(qTerm)}&limit=10&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&osm_tag=water&osm_tag=natural:water&osm_tag=waterway:river&osm_tag=waterway:canal`
    );
  }

  type DirectPhotonFeature = {
    geometry?: { coordinates?: [number, number] };
    properties?: {
      osm_id?: number;
      osm_type?: string;
      osm_key?: string;
      osm_value?: string;
      name?: string;
      state?: string;
      county?: string;
      extent?: [number, number, number, number];
    };
  };

  const fetchNominatimDirect = async (): Promise<DirectNominatimItem[]> => {
    if (!hasExplicitQuery) return [];
    const queries = Array.from(
      new Set([cleanQuery, ...(strippedQuery.length >= 2 && strippedQuery !== cleanQuery ? [strippedQuery] : [])])
    );
    const batches = await Promise.all(
      queries.map(async (q) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5500);
        try {
          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.002&limit=8&accept-language=ru`;
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) return [] as DirectNominatimItem[];
          const json = (await res.json()) as DirectNominatimItem[];
          return Array.isArray(json) ? json : [];
        } catch {
          return [] as DirectNominatimItem[];
        } finally {
          clearTimeout(t);
        }
      })
    );
    return batches.flat();
  };

  const fetchOverpassDirect = async (): Promise<import('./types').WaterBody[]> => {
    const radiusM = Math.min(20000, radiusClamped * 1000);
    const localRadiusM = Math.min(7000, radiusM);
    const ql = [
      '[out:json][timeout:4];',
      '(',
      `  relation["waterway"~"^(river|canal)$"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
      `  way["waterway"~"^(river|canal|dam|weir)$"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
      `  relation["natural"="water"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
      `  way["natural"="water"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
      ...(majorOnly
        ? []
        : [
            `  way["natural"="water"](around:${localRadiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
            `  way["waterway"~"^(dam|weir)$"](around:${localRadiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
          ]),
      ');',
      'out tags center bb 45;',
    ].join('\n');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(ql)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        elements?: Array<{
          type: 'way' | 'relation';
          id: number;
          tags?: Record<string, string>;
          center?: { lat: number; lon: number };
          bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
        }>;
      };
      const out: import('./types').WaterBody[] = [];
      for (const el of json.elements ?? []) {
        const cLat = el.center?.lat ?? (el.bounds ? (el.bounds.minlat + el.bounds.maxlat) / 2 : undefined);
        const cLng = el.center?.lon ?? (el.bounds ? (el.bounds.minlon + el.bounds.maxlon) / 2 : undefined);
        if (typeof cLat !== 'number' || typeof cLng !== 'number') continue;
        const isDamOrWeir = el.tags?.waterway === 'dam' || el.tags?.waterway === 'weir';
        let name = el.tags?.name?.trim() || '';
        if (!name) {
          if (majorOnly) continue;
          if (isDamOrWeir) {
            name = `Плотина (${cLat.toFixed(3)}, ${cLng.toFixed(3)})`;
          } else if (el.bounds) {
            const dLatKmTmp = Math.abs(el.bounds.maxlat - el.bounds.minlat) * 111;
            const dLngKmTmp = Math.abs(el.bounds.maxlon - el.bounds.minlon) * 111 * Math.max(0.25, Math.cos((cLat * Math.PI) / 180));
            if (dLatKmTmp * dLngKmTmp * 38 < 0.8) continue;
            const kindLabel = el.tags?.water === 'pond' ? 'Пруд' : 'Озеро / пруд';
            name = `${kindLabel} (${cLat.toFixed(3)}, ${cLng.toFixed(3)})`;
          } else {
            continue;
          }
        }
        const key = el.tags?.waterway ? 'waterway' : 'natural';
        const val = (el.tags?.waterway ?? el.tags?.water ?? 'water').toLowerCase();
        const type = inferDirectWaterType(key, val, name);
        const isRelation = el.type === 'relation';
        let areaHa = type === 'river' ? (isRelation ? 140 : 45) : type === 'reservoir' ? 500 : 22;
        if (el.bounds) {
          const dLatKm = Math.abs(el.bounds.maxlat - el.bounds.minlat) * 111;
          const dLngKm = Math.abs(el.bounds.maxlon - el.bounds.minlon) * 111 * Math.max(0.25, Math.cos((cLat * Math.PI) / 180));
          const ext = Math.hypot(dLatKm, dLngKm);
          if (type === 'river') {
            areaHa = Math.max(isRelation ? 110 : 20, Math.min(260, Math.round(ext * (isRelation ? 3.5 : 1.5))));
          } else {
            areaHa = Math.max(2, Math.min(12000, Math.round(dLatKm * dLngKm * 38)));
          }
        }
        const prefix = isRelation ? 'R' : 'W';
        const osmId = `${prefix}${el.id}`;
        const maxDepth = type === 'reservoir' ? 12 : type === 'river' ? (areaHa >= 100 ? 5.5 : 3.2) : 3.5;
        out.push({
          id: `wb-osm-${osmId}`,
          name,
          display_label: name,
          type,
          center: { lat: Number(cLat.toFixed(5)), lng: Number(cLng.toFixed(5)) },
          polygon: buildDirectApproxPolygon(cLat, cLng, areaHa, type),
          area_ha: areaHa,
          source: 'osm',
          confidence: isRelation ? 0.9 : 0.84,
          moderation_status: 'verified',
          connected_to: null,
          has_bathymetry: false,
          max_depth_m: maxDepth,
          avg_depth_m: Number((maxDepth * 0.45).toFixed(1)),
          depth_source: 'estimated',
          region: 'OpenStreetMap',
          external_id: `OSM-${osmId}`,
          ndwi_stability: 'year_round',
          vegetation_index: 'moderate',
          water_clarity: 'moderate',
          target_zone: { lat: Number(cLat.toFixed(5)), lng: Number(cLng.toFixed(5)) },
        });
      }
      return out;
    } catch {
      return [];
    } finally {
      clearTimeout(t);
    }
  };

  const [photonBatches, nomItems, overpassWbs] = await Promise.all([
    Promise.all(
      photonUrls.map(async (u) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        try {
          const res = await fetch(u, { signal: ctrl.signal });
          if (!res.ok) return [] as DirectPhotonFeature[];
          const json = (await res.json()) as { features?: DirectPhotonFeature[] };
          return json.features ?? [];
        } catch {
          return [] as DirectPhotonFeature[];
        } finally {
          clearTimeout(t);
        }
      })
    ),
    fetchNominatimDirect(),
    fetchOverpassDirect(),
  ]);

  const byKey = new Map<string, import('./types').WaterBody>();
  const matchesExplicitQuery = (wb: import('./types').WaterBody): boolean => {
    if (!hasExplicitQuery) return false;
    const lbl = wb.display_label.toLowerCase();
    return (
      lbl.includes(cleanQuery.toLowerCase()) ||
      (strippedQuery.length >= 2 && lbl.includes(strippedQuery.toLowerCase()))
    );
  };

  const addCandidate = (wb: import('./types').WaterBody) => {
    const isQueryMatch = matchesExplicitQuery(wb);
    if (majorOnly && !isQueryMatch) {
      const isMajor =
        (wb.type === 'reservoir' && wb.area_ha >= 40) ||
        (wb.type === 'lake' && wb.area_ha >= 45) ||
        (wb.type === 'river' && (wb.area_ha >= 55 || wb.display_label.toLowerCase().includes('канал'))) ||
        (wb.type === 'quarry' && wb.area_ha >= 35);
      if (!isMajor) return;
    }
    const nameKey = `${wb.display_label.toLowerCase()}:${Math.round(wb.center.lat * 4)}:${Math.round(wb.center.lng * 4)}`;
    const existing = byKey.get(nameKey);
    if (!existing || wb.confidence > existing.confidence) {
      byKey.set(nameKey, wb);
    }
  };

  // 1. Nominatim explicit query hits first (highest geometry accuracy for rivers like Сейм!)
  for (const item of nomItems) {
    const wb = buildWaterBodyFromDirectNominatim(item, { lat, lng });
    if (wb) addCandidate(wb);
  }

  // 2. Overpass nearby river/lake relations & ways
  for (const wb of overpassWbs) {
    addCandidate(wb);
  }

  // 3. Photon reverse & search hits
  for (const feat of photonBatches.flat()) {
    const coords = feat.geometry?.coordinates;
    const props = feat.properties;
    if (!coords || coords.length < 2 || !props?.name) continue;
    const osmKey = (props.osm_key ?? '').toLowerCase();
    const osmVal = (props.osm_value ?? '').toLowerCase();
    if (DIRECT_BLOCKED_WATERWAY_VALUES.has(osmVal)) continue;

    const wbLat = Number(coords[1]);
    const wbLng = Number(coords[0]);
    if (!Number.isFinite(wbLat) || !Number.isFinite(wbLng)) continue;

    const type = inferDirectWaterType(osmKey, osmVal, props.name);
    let areaHa = type === 'reservoir' ? 620 : type === 'lake' ? 24 : type === 'river' ? 60 : 4;
    let extentKm = 0;
    if (Array.isArray(props.extent) && props.extent.length === 4) {
      const [minLon, maxLat, maxLon, minLat] = props.extent;
      const dLatKm = Math.abs(maxLat - minLat) * 111;
      const dLngKm = Math.abs(maxLon - minLon) * 111 * Math.max(0.25, Math.cos((wbLat * Math.PI) / 180));
      extentKm = Math.hypot(dLatKm, dLngKm);
      if (type === 'river') {
        areaHa = Math.max(15, Math.min(260, Math.round(extentKm * (osmVal === 'canal' || extentKm >= 60 ? 4.0 : 1.5))));
      } else {
        areaHa = Math.max(1, Math.min(12000, Math.round(dLatKm * dLngKm * 38)));
      }
    }

    const maxDepth =
      type === 'reservoir'
        ? areaHa >= 500 ? 14 : 9.5
        : type === 'river'
          ? areaHa >= 120 ? 6.0 : areaHa >= 35 ? 3.5 : 2.2
          : type === 'lake'
            ? areaHa >= 150 ? 8.5 : areaHa >= 35 ? 5.0 : 2.8
            : 2.2;
    const osmPrefix = (props.osm_type ?? 'W').toUpperCase();
    const osmId = `${osmPrefix}${props.osm_id ?? `${wbLat.toFixed(4)}-${wbLng.toFixed(4)}`}`;
    const region = [props.state, props.county].filter(Boolean).slice(0, 2).join(' · ') || 'OpenStreetMap';

    addCandidate({
      id: `wb-osm-${osmId}`,
      name: props.name.trim(),
      display_label: props.name.trim(),
      type,
      center: { lat: Number(wbLat.toFixed(5)), lng: Number(wbLng.toFixed(5)) },
      polygon: buildDirectApproxPolygon(wbLat, wbLng, areaHa, type),
      area_ha: areaHa,
      source: 'osm',
      confidence: 0.82,
      moderation_status: 'verified',
      connected_to: null,
      has_bathymetry: false,
      max_depth_m: maxDepth,
      avg_depth_m: Number((maxDepth * 0.45).toFixed(1)),
      depth_source: 'estimated',
      region,
      external_id: `OSM-${osmId}`,
      ndwi_stability: 'year_round',
      vegetation_index: type === 'reservoir' ? 'low' : 'moderate',
      water_clarity: 'moderate',
      target_zone: { lat: Number(wbLat.toFixed(5)), lng: Number(wbLng.toFixed(5)) },
    });
  }

  return Array.from(byKey.values()).slice(0, 28);
}

