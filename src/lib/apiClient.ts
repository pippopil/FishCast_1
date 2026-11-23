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
  'dam',
  'weir',
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
  if (osmVal === 'reservoir' || lower.includes('водохранилищ') || lower.includes('вдхр')) return 'reservoir';
  if (osmVal === 'quarry' || lower.includes('карьер')) return 'quarry';
  if (osmVal === 'oxbow' || lower.includes('стариц')) return 'oxbow';
  if (osmVal === 'pond' || lower.includes('пруд')) return 'pond';
  if (osmKey === 'waterway' || osmVal === 'river' || osmVal === 'canal' || lower.includes('канал') || lower.includes('река')) {
    return 'river';
  }
  return 'lake';
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

/**
 * Direct client-side OSM discovery (Photon reverse/search) used automatically
 * in standalone Capacitor Android APK builds when no backend API URL is configured.
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
  const urls: string[] = [
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=20&osm_tag=water`,
    `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=16&osm_tag=natural:water`,
  ];
  if (!majorOnly) {
    urls.push(
      `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${Math.min(18, radiusClamped)}&limit=14&osm_tag=waterway:river&osm_tag=waterway:canal`
    );
  } else {
    urls.push(
      `https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&radius=${radiusClamped}&limit=14&osm_tag=waterway:canal`
    );
  }
  if (query && query.trim().length >= 2) {
    const enc = encodeURIComponent(query.trim());
    urls.push(
      `https://photon.komoot.io/api/?q=${enc}&limit=10&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&osm_tag=water&osm_tag=natural:water&osm_tag=waterway:river&osm_tag=waterway:canal`
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

  const results = await Promise.all(
    urls.map(async (u) => {
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
  );

  const byKey = new Map<string, import('./types').WaterBody>();
  for (const feat of results.flat()) {
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
    let areaHa = type === 'reservoir' ? 620 : type === 'lake' ? 24 : type === 'river' ? 25 : 4;
    let extentKm = 0;
    if (Array.isArray(props.extent) && props.extent.length === 4) {
      const [minLon, maxLat, maxLon, minLat] = props.extent;
      const dLatKm = Math.abs(maxLat - minLat) * 111;
      const dLngKm = Math.abs(maxLon - minLon) * 111 * Math.cos((wbLat * Math.PI) / 180);
      extentKm = Math.hypot(dLatKm, dLngKm);
      if (type === 'river') {
        areaHa = Math.max(6, Math.min(260, Math.round(extentKm * (osmVal === 'canal' || extentKm >= 75 ? 4.5 : 1.1))));
      } else {
        areaHa = Math.max(1, Math.min(12000, Math.round(dLatKm * dLngKm * 38)));
      }
    }

    const maxDepth =
      type === 'reservoir'
        ? areaHa >= 500 ? 14 : 9.5
        : type === 'river'
          ? areaHa >= 120 ? 6.0 : areaHa >= 35 ? 3.2 : 2.0
          : type === 'lake'
            ? areaHa >= 150 ? 8.5 : areaHa >= 35 ? 5.0 : 2.8
            : 2.2;
    const osmPrefix = (props.osm_type ?? 'W').toUpperCase();
    const osmId = `${osmPrefix}${props.osm_id ?? `${wbLat.toFixed(4)}-${wbLng.toFixed(4)}`}`;
    const region = [props.state, props.county].filter(Boolean).slice(0, 2).join(' · ') || 'OpenStreetMap';

    const wb: import('./types').WaterBody = {
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
      region,
      external_id: `OSM-${osmId}`,
      ndwi_stability: 'year_round',
      vegetation_index: type === 'reservoir' ? 'low' : 'moderate',
      water_clarity: 'moderate',
    };

    if (majorOnly) {
      const isMajor =
        (wb.type === 'reservoir' && wb.area_ha >= 40) ||
        (wb.type === 'lake' && wb.area_ha >= 45) ||
        (wb.type === 'river' && (wb.area_ha >= 90 || wb.display_label.toLowerCase().includes('канал'))) ||
        (wb.type === 'quarry' && wb.area_ha >= 35);
      if (!isMajor) continue;
    }

    const nameKey = `${wb.display_label.toLowerCase()}:${Math.round(wbLat * 5)}:${Math.round(wbLng * 5)}`;
    if (!byKey.has(nameKey)) {
      byKey.set(nameKey, wb);
    }
  }

  return Array.from(byKey.values()).slice(0, 24);
}
