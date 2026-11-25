import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import {
  buildBiteForecastMetadata,
  buildSplitRouteMetrics,
  computeFIndexForecast,
  decodePolyline6,
  estimateWaterTempC,
  findInteriorWaterPoint,
  haversineMeters,
  windDegreesToLabel,
} from '../lib/fishLogic.ts';
import type {
  BiteForecastResponse,
  CatchReport,
  FishSpecies,
  HourlyWeatherPoint,
  LatLng,
  RouteMultiResult,
  WaterBody,
  WaterBodyAccessPoint,
  WaterBodyInhabitingSpecies,
  WaterBodyType,
  WeatherSnapshot,
} from '../lib/types.ts';
import {
  getRegionById,
  isMajorWaterBody,
  matchesWaterBodyRegion,
} from '../lib/regions.ts';
import { store } from './store.ts';

function computeMoonPhase(date: Date): { label: string; illumination: number } {
  // Simple synodic calculation (new moon reference Jan 11 2024)
  const synodic = 29.53058867;
  const ref = new Date('2024-01-11T11:57:00Z').getTime();
  const days = (date.getTime() - ref) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const frac = phase / synodic;
  const illumination = Math.round((1 - Math.cos(frac * 2 * Math.PI)) * 50);

  if (frac < 0.06 || frac > 0.94) return { label: 'Новолуние', illumination };
  if (frac < 0.22) return { label: 'Растущий серп', illumination };
  if (frac < 0.28) return { label: 'Первая четверть', illumination };
  if (frac < 0.47) return { label: 'Растущая луна', illumination };
  if (frac < 0.53) return { label: 'Полнолуние', illumination };
  if (frac < 0.72) return { label: 'Убывающая луна', illumination };
  if (frac < 0.78) return { label: 'Последняя четверть', illumination };
  return { label: 'Стареющий серп', illumination };
}

async function fetchRiverDischarge(
  lat: number,
  lng: number
): Promise<{
  river_discharge_m3s?: number;
  river_discharge_ratio?: number;
  river_discharge_trend?: WeatherSnapshot['river_discharge_trend'];
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const url =
      `https://flood-api.open-meteo.com/v1/flood?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&daily=river_discharge&past_days=14&forecast_days=7`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return {};
    const json = (await res.json()) as {
      daily?: {
        time?: string[];
        river_discharge?: Array<number | null>;
      };
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
    if (pastVals.length === 0) {
      return { river_discharge_m3s: Number(currentQ.toFixed(1)) };
    }

    const sorted = [...pastVals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ratio = median > 0.05 ? Number((currentQ / median).toFixed(2)) : 1.0;

    const prevIdx = Math.max(0, todayIdx - 2);
    const prevQ = values[prevIdx];
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
    clearTimeout(timeout);
  }
}

export async function fetchWeatherViaProxy(lat: number, lng: number): Promise<WeatherSnapshot> {
  const key = `${lat.toFixed(2)}:${lng.toFixed(2)}`;
  const cached = store.weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, source: 'open-meteo-cached' };
  }

  const now = new Date();
  const moon = computeMoonPhase(now);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=temperature_2m,precipitation,pressure_msl,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation` +
      `&hourly=temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,shortwave_radiation,precipitation` +
      `&past_days=14&forecast_days=7&wind_speed_unit=ms&timezone=auto`;

    const [weatherRes, floodMetrics] = await Promise.all([
      fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout)),
      fetchRiverDischarge(lat, lng),
    ]);

    if (weatherRes.ok) {
      const OpenMeteoResponseSchema = z.object({
        current: z
          .object({
            time: z.string().optional(),
            temperature_2m: z.number().optional(),
            precipitation: z.number().optional(),
            pressure_msl: z.number().optional(),
            surface_pressure: z.number().optional(),
            cloud_cover: z.number().optional(),
            wind_speed_10m: z.number().optional(),
            wind_gusts_10m: z.number().optional(),
            wind_direction_10m: z.number().optional(),
            shortwave_radiation: z.number().optional(),
          })
          .optional(),
        hourly: z
          .object({
            time: z.array(z.string()).optional(),
            temperature_2m: z.array(z.number().nullable()).optional(),
            pressure_msl: z.array(z.number().nullable()).optional(),
            wind_speed_10m: z.array(z.number().nullable()).optional(),
            wind_gusts_10m: z.array(z.number().nullable()).optional(),
            wind_direction_10m: z.array(z.number().nullable()).optional(),
            cloud_cover: z.array(z.number().nullable()).optional(),
            shortwave_radiation: z.array(z.number().nullable()).optional(),
            precipitation: z.array(z.number().nullable()).optional(),
          })
          .optional(),
      });

      const rawJson: unknown = await weatherRes.json();
      const parsedWeather = OpenMeteoResponseSchema.safeParse(rawJson);
      const json = parsedWeather.success ? parsedWeather.data : null;
      const cur = json?.current;
      if (cur && typeof cur.temperature_2m === 'number') {
        const hTime = json?.hourly?.time ?? [];
        const hTemp = (json?.hourly?.temperature_2m ?? []).map((v) => (typeof v === 'number' ? v : Number.NaN));
        const hPres = (json?.hourly?.pressure_msl ?? []).map((v) => (typeof v === 'number' ? v : Number.NaN));
        const hWind = (json?.hourly?.wind_speed_10m ?? []).map((v) => (typeof v === 'number' ? v : Number.NaN));
        const hGust = json?.hourly?.wind_gusts_10m ?? [];
        const hWDir = (json?.hourly?.wind_direction_10m ?? []).map((v) => (typeof v === 'number' ? v : Number.NaN));
        const hCloud = (json?.hourly?.cloud_cover ?? []).map((v) => (typeof v === 'number' ? v : Number.NaN));
        const hRad = json?.hourly?.shortwave_radiation ?? [];
        const hPrecip = (json?.hourly?.precipitation ?? []).map((v) => (typeof v === 'number' ? v : 0));

        // Locate current hour index in the 17-day hourly array
        const curPrefix = (cur.time ?? now.toISOString()).slice(0, 13);
        let curIdx = hTime.findIndex((t) => t.startsWith(curPrefix));
        if (curIdx < 0) {
          curIdx = Math.max(0, Math.min(hTime.length - 1, 14 * 24));
        }

        // Compute 7-day and 14-day mean air temperatures for thermal water inertia
        const sliceMean = (arr: number[], start: number, end: number): number | undefined => {
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

        const avg7d = sliceMean(hTemp, curIdx - 7 * 24, curIdx + 1);
        const avg14d = sliceMean(hTemp, curIdx - 14 * 24, curIdx + 1);

        // Diurnal-free 48h air temperature front shock (same clock hour 48h ago)
        let airTempDelta48h: number | undefined;
        if (curIdx >= 48 && typeof hTemp[curIdx - 48] === 'number') {
          airTempDelta48h = Number((cur.temperature_2m - hTemp[curIdx - 48]).toFixed(1));
        } else if (curIdx >= 24 && typeof hTemp[curIdx - 24] === 'number') {
          airTempDelta48h = Number((cur.temperature_2m - hTemp[curIdx - 24]).toFixed(1));
        }

        // Cumulative rainfall over last 72 hours (for river turbidity)
        let rain72h = 0;
        for (let i = Math.max(0, curIdx - 72); i <= Math.min(hPrecip.length - 1, curIdx); i++) {
          rain72h += Number(hPrecip[i] ?? 0);
        }

        // Current 6h barometric delta and 48h stability
        const curHPres = Number.isFinite(hPres[curIdx]) ? hPres[curIdx] : undefined;
        const pressureHpa = Math.round(cur.pressure_msl ?? cur.surface_pressure ?? curHPres ?? 1014);
        const pressureMmhg = Math.round(pressureHpa * 0.75006);
        const p6Ago = curIdx >= 6 && Number.isFinite(hPres[curIdx - 6]) ? hPres[curIdx - 6] : pressureHpa;
        const delta6h = Number((pressureHpa - p6Ago).toFixed(1));
        const trend: WeatherSnapshot['pressure_trend'] =
          delta6h >= 1.2 ? 'rising' : delta6h <= -1.2 ? 'falling' : 'steady';

        let stability48h = 0.75;
        const p48Start = Math.max(0, curIdx - 48);
        if (curIdx - p48Start >= 6) {
          let minP = Infinity;
          let maxP = -Infinity;
          for (let i = p48Start; i <= curIdx; i++) {
            const p = hPres[i];
            if (Number.isFinite(p)) {
              if (p < minP) minP = p;
              if (p > maxP) maxP = p;
            }
          }
          if (minP < Infinity) {
            stability48h = Number(Math.max(0, Math.min(1, 1 - (maxP - minP) / 18)).toFixed(2));
          }
        }

        // Keep compact window: 48h past + 168h future (~220 hourly points for 7-day forecast)
        const hourlyCompact: HourlyWeatherPoint[] = [];
        const winStart = Math.max(0, curIdx - 48);
        const winEnd = Math.min(hTime.length, curIdx + 172);
        for (let i = winStart; i < winEnd; i++) {
          const gustVal = hGust[i];
          const radVal = hRad[i];
          const tVal = Number.isFinite(hTemp[i]) ? hTemp[i] : cur.temperature_2m;
          const pVal = Number.isFinite(hPres[i]) ? hPres[i] : pressureHpa;
          const wVal = Number.isFinite(hWind[i]) ? hWind[i] : (cur.wind_speed_10m ?? 3.2);
          const wdVal = Number.isFinite(hWDir[i]) ? hWDir[i] : (cur.wind_direction_10m ?? 220);
          const cVal = Number.isFinite(hCloud[i]) ? hCloud[i] : (cur.cloud_cover ?? 55);
          hourlyCompact.push({
            time: hTime[i],
            temp_c: Number(tVal.toFixed(1)),
            pressure_hpa: Number(pVal.toFixed(1)),
            wind_speed_ms: Number(wVal.toFixed(1)),
            wind_gusts_ms: typeof gustVal === 'number' ? Number(gustVal.toFixed(1)) : undefined,
            wind_direction_deg: Math.round(wdVal),
            cloud_cover_pct: Math.round(cVal),
            shortwave_radiation_wm2: typeof radVal === 'number' ? Math.round(radVal) : undefined,
            precipitation_mm: Number((hPrecip[i] ?? 0).toFixed(1)),
          });
        }

        const airTemp = Number(cur.temperature_2m.toFixed(1));
        const windDeg = Math.round(cur.wind_direction_10m ?? 220);
        const curHGust = hGust[curIdx];
        const curHRad = hRad[curIdx];
        const curGusts =
          typeof cur.wind_gusts_10m === 'number'
            ? Number(cur.wind_gusts_10m.toFixed(1))
            : typeof curHGust === 'number'
              ? Number(curHGust.toFixed(1))
              : undefined;
        const curRad =
          typeof cur.shortwave_radiation === 'number'
            ? Math.round(cur.shortwave_radiation)
            : typeof curHRad === 'number'
              ? Math.round(curHRad)
              : undefined;

        const baseSnapshot: WeatherSnapshot = {
          lat,
          lng,
          captured_at: now.toISOString(),
          pressure_hpa: pressureHpa,
          pressure_mmhg: pressureMmhg,
          pressure_trend: trend,
          pressure_delta_6h: delta6h,
          pressure_stability_48h: stability48h,
          air_temp_c: airTemp,
          air_temp_delta_48h_c: airTempDelta48h,
          water_temp_c: Number(Math.max(1.0, (avg14d ?? airTemp) * 0.78 + 1.4).toFixed(1)),
          avg_air_temp_7d_c: avg7d,
          avg_air_temp_14d_c: avg14d,
          wind_speed_ms: Number((cur.wind_speed_10m ?? 3.2).toFixed(1)),
          wind_gusts_ms: curGusts,
          wind_direction_deg: windDeg,
          wind_direction_label: windDegreesToLabel(windDeg),
          cloud_cover_pct: Math.round(cur.cloud_cover ?? hCloud[curIdx] ?? 55),
          shortwave_radiation_wm2: curRad,
          precipitation_mm: Number((cur.precipitation ?? 0).toFixed(1)),
          recent_rain_72h_mm: Number(rain72h.toFixed(1)),
          ...floodMetrics,
          moon_phase: moon.label,
          moon_illumination: moon.illumination,
          hourly: hourlyCompact,
          source: 'open-meteo',
        };
        baseSnapshot.water_temp_c = estimateWaterTempC(baseSnapshot).waterTempC;

        store.weatherCache.set(key, { data: baseSnapshot, expiresAt: Date.now() + 30 * 60 * 1000 });
        return baseSnapshot;
      }
    }
  } catch {
    // Graceful fallback below if Open-Meteo unreachable in sandbox or offline
  }

  const fallback: WeatherSnapshot = {
    lat,
    lng,
    captured_at: now.toISOString(),
    pressure_hpa: 1015,
    pressure_mmhg: 761,
    pressure_trend: 'steady',
    pressure_delta_6h: 0,
    pressure_stability_48h: 0.82,
    air_temp_c: 4.5,
    air_temp_delta_48h_c: 0,
    water_temp_c: 5.8,
    avg_air_temp_7d_c: 4.8,
    avg_air_temp_14d_c: 5.4,
    wind_speed_ms: 3.8,
    wind_gusts_ms: 6.2,
    wind_direction_deg: 235,
    wind_direction_label: 'ЮЗ',
    cloud_cover_pct: 60,
    shortwave_radiation_wm2: 140,
    precipitation_mm: 0.0,
    recent_rain_72h_mm: 2.5,
    moon_phase: moon.label,
    moon_illumination: moon.illumination,
    source: 'offline-fallback',
  };
  store.weatherCache.set(key, { data: fallback, expiresAt: Date.now() + 10 * 60 * 1000 });
  return fallback;
}

export async function fetchBiteForecastViaProxy(params: {
  lat: number;
  lng: number;
  species: FishSpecies;
  dateStr?: string;
  waterBody?: WaterBody | null;
  reports?: CatchReport[];
}): Promise<BiteForecastResponse> {
  const { lat, lng, species, dateStr, waterBody = null, reports } = params;
  const baseDate = dateStr ? new Date(dateStr) : new Date();
  const dayKey = baseDate.toISOString().slice(0, 10);
  const wbKey = waterBody?.id ?? 'generic';
  const cacheKey = `${lat.toFixed(2)}:${lng.toFixed(2)}:${species.id}:${wbKey}:${dayKey}`;

  const cached = store.forecastCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  const weather = await fetchWeatherViaProxy(lat, lng);
  const meta = buildBiteForecastMetadata({
    weather,
    species,
    waterBody,
    reports,
    baseDate,
  });

  // Attempt Actigator API if key is configured on server
  const actigatorKey = process.env.ACTIGATOR_API_KEY;
  if (actigatorKey && actigatorKey.trim().length > 5) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        `https://api.actigator.com/v1/forecast?lat=${lat}&lng=${lng}&species=${species.id}&date=${dayKey}`,
        {
          headers: { Authorization: `Bearer ${actigatorKey}` },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (res.ok) {
        const external = (await res.json()) as Partial<BiteForecastResponse>;
        if (Array.isArray(external.slots) && external.slots.length > 0) {
          const response: BiteForecastResponse = {
            lat,
            lng,
            fish_id: species.id,
            fish_name: species.name,
            water_body_id: waterBody?.id ?? null,
            source: 'actigator',
            cached: false,
            disclaimer:
              'Прогноз рассчитан моделью Actigator. Результат носит вероятностный характер и не гарантирует клёв.',
            slots: external.slots,
            ...meta,
          };
          store.forecastCache.set(cacheKey, { data: response, expiresAt: Date.now() + 65 * 60 * 1000 });
          return response;
        }
      }
    } catch {
      // Fallback to Open-Meteo model below
    }
  }

  const slots = computeFIndexForecast({ species, weather, baseDate, waterBody, reports });
  const response: BiteForecastResponse = {
    lat,
    lng,
    fish_id: species.id,
    fish_name: species.name,
    water_body_id: waterBody?.id ?? null,
    source: 'open-meteo-fallback',
    cached: false,
    disclaimer:
      'Расчёт на базе почасовых данных Open-Meteo (14 дн. истории + 3 дн. прогноза), барометрической динамики, инерции воды, астрономии и калибровки по отчётам. Носит вероятностный характер.',
    slots,
    ...meta,
  };
  store.forecastCache.set(cacheKey, { data: response, expiresAt: Date.now() + 65 * 60 * 1000 });
  return response;
}

async function fetchValhallaRoute(params: {
  from: LatLng;
  to: LatLng;
  costing: 'auto' | 'pedestrian';
  avoidUnpaved?: boolean;
  timeoutMs?: number;
}): Promise<{ distance_m: number; duration_s: number; geometry: [number, number][] } | null> {
  const { from, to, costing, avoidUnpaved = true, timeoutMs = 4500 } = params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body =
      costing === 'auto'
        ? {
            locations: [
              { lat: from.lat, lon: from.lng },
              { lat: to.lat, lon: to.lng },
            ],
            costing: 'auto',
            costing_options: {
              auto: {
                exclude_unpaved: avoidUnpaved,
                use_tracks: avoidUnpaved ? 0 : 0.6,
              },
            },
            directions_options: { units: 'km' },
          }
        : {
            locations: [
              { lat: from.lat, lon: from.lng },
              { lat: to.lat, lon: to.lng },
            ],
            costing: 'pedestrian',
            directions_options: { units: 'km' },
          };

    const res = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FishCastAI/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      trip?: {
        summary?: { length?: number; time?: number };
        legs?: Array<{ shape?: string }>;
      };
    };
    const shape = data.trip?.legs?.[0]?.shape;
    const lengthKm = data.trip?.summary?.length;
    const durationS = data.trip?.summary?.time;
    if (!shape || typeof lengthKm !== 'number' || typeof durationS !== 'number') return null;
    const coords = decodePolyline6(shape, 320);
    if (coords.length < 2) return null;
    return {
      distance_m: Math.max(20, Math.round(lengthKm * 1000)),
      duration_s: Math.max(10, Math.round(durationS)),
      geometry: coords,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOsrmDrivingRoute(params: {
  from: LatLng;
  to: LatLng;
  timeoutMs?: number;
}): Promise<{ distance_m: number; duration_s: number; geometry: [number, number][] } | null> {
  const { from, to, timeoutMs = 4000 } = params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FishCastAI/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const route = data.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (
      data.code !== 'Ok' ||
      !route ||
      typeof route.distance !== 'number' ||
      typeof route.duration !== 'number' ||
      !Array.isArray(coords) ||
      coords.length < 2
    ) {
      return null;
    }
    return {
      distance_m: Math.max(50, Math.round(route.distance)),
      duration_s: Math.max(15, Math.round(route.duration)),
      geometry: coords,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOrsDrivingRoute(params: {
  apiKey: string;
  from: LatLng;
  to: LatLng;
  avoidUnpaved: boolean;
  timeoutMs?: number;
}): Promise<{ distance_m: number; duration_s: number; geometry: [number, number][] } | null> {
  const { apiKey, from, to, avoidUnpaved, timeoutMs = 4000 } = params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        ...(avoidUnpaved ? { options: { avoid_features: ['unpavedroads'] } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{
        properties?: { summary?: { distance?: number; duration?: number } };
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const feature = data.features?.[0];
    const summary = feature?.properties?.summary;
    const coords = feature?.geometry?.coordinates;
    if (
      !summary ||
      typeof summary.distance !== 'number' ||
      typeof summary.duration !== 'number' ||
      !Array.isArray(coords) ||
      coords.length < 2
    ) {
      return null;
    }
    return {
      distance_m: Math.max(50, Math.round(summary.distance)),
      duration_s: Math.max(15, Math.round(summary.duration)),
      geometry: coords,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function computeMultiRouteViaProxy(params: {
  origin: LatLng;
  waterBody: WaterBody;
  accessPoints: WaterBodyAccessPoint[];
  avoidUnpaved: boolean;
  simulateQuotaExceeded?: boolean;
}): Promise<RouteMultiResult> {
  const { origin, waterBody, accessPoints, avoidUnpaved, simulateQuotaExceeded } = params;
  const cacheKey = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}->${waterBody.id}:unpaved=${avoidUnpaved}`;

  if (!simulateQuotaExceeded) {
    const cached = store.routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const quotaOk = !simulateQuotaExceeded && store.trackYandexQuota('route');
  const orsKey = process.env.ORS_API_KEY;
  const yandexRoutingKey = process.env.YANDEX_ROUTING_API_KEY;

  // Deterministic split route calculation baseline
  const baseResult = buildSplitRouteMetrics({
    origin,
    waterBody,
    accessPoints,
    avoidUnpaved,
    quotaExceeded: !quotaOk,
  });

  if (quotaOk && baseResult.driving_available && baseResult.access_point && baseResult.driving_segment) {
    const ap = baseResult.access_point;
    let resolved = false;

    // 1) Optional free-tier OpenRouteService key (supports avoid_features: unpavedroads)
    if (orsKey && orsKey.trim().length > 5) {
      const orsRoute = await fetchOrsDrivingRoute({
        apiKey: orsKey.trim(),
        from: origin,
        to: ap,
        avoidUnpaved,
      });
      if (orsRoute) {
        baseResult.driving_segment.distance_m = orsRoute.distance_m;
        baseResult.driving_segment.duration_s = orsRoute.duration_s;
        baseResult.driving_segment.geometry = orsRoute.geometry;
        baseResult.source = 'ors-osm';
        resolved = true;
      }
    }

    // 2) Completely free zero-key Valhalla FOSSGIS (OSM + unpaved avoidance)
    if (!resolved) {
      const valhallaDrive = await fetchValhallaRoute({
        from: origin,
        to: ap,
        costing: 'auto',
        avoidUnpaved,
      });
      if (valhallaDrive) {
        baseResult.driving_segment.distance_m = valhallaDrive.distance_m;
        baseResult.driving_segment.duration_s = valhallaDrive.duration_s;
        baseResult.driving_segment.geometry = valhallaDrive.geometry;
        baseResult.source = 'valhalla-osm';
        resolved = true;
      }
    }

    // 3) Completely free zero-key OSRM Public backup
    if (!resolved) {
      const osrmDrive = await fetchOsrmDrivingRoute({
        from: origin,
        to: ap,
      });
      if (osrmDrive) {
        baseResult.driving_segment.distance_m = osrmDrive.distance_m;
        baseResult.driving_segment.duration_s = osrmDrive.duration_s;
        baseResult.driving_segment.geometry = osrmDrive.geometry;
        baseResult.source = 'osrm-public';
        resolved = true;
      }
    }

    // 4) Optional Yandex Routing fallback only if key explicitly provided
    if (!resolved && yandexRoutingKey && yandexRoutingKey.trim().length > 5) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const waypoints = `${origin.lat},${origin.lng}|${ap.lat},${ap.lng}`;
        const yUrl = `https://api.routing.yandex.net/v2/route?apikey=${encodeURIComponent(yandexRoutingKey)}&waypoints=${encodeURIComponent(waypoints)}&mode=driving&avoid_unpaved=${avoidUnpaved}`;
        const res = await fetch(yUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const yData = (await res.json()) as {
            route?: { legs?: Array<{ steps?: Array<{ length?: number; duration?: number; polyline?: { points?: [number, number][] } }> }> };
          };
          const legs = yData.route?.legs;
          if (legs && legs.length > 0) {
            let totalDist = 0;
            let totalDur = 0;
            const pts: [number, number][] = [];
            for (const leg of legs) {
              for (const step of leg.steps ?? []) {
                totalDist += step.length ?? 0;
                totalDur += step.duration ?? 0;
                for (const p of step.polyline?.points ?? []) {
                  pts.push([p[1], p[0]]);
                }
              }
            }
            if (totalDist > 0) {
              baseResult.driving_segment.distance_m = Math.round(totalDist);
              baseResult.driving_segment.duration_s = Math.round(totalDur);
              if (pts.length >= 2) baseResult.driving_segment.geometry = pts;
              baseResult.source = 'yandex-routing';
              resolved = true;
            }
          }
        }
      } catch {
        // Keep deterministic fallback
      }
    }

    // Also enrich walking trail geometry via free Valhalla pedestrian if within 12 km
    if (resolved && baseResult.walking_segment.distance_m <= 12000) {
      const walkRoute = await fetchValhallaRoute({
        from: ap,
        to: baseResult.target_point,
        costing: 'pedestrian',
        timeoutMs: 2500,
      });
      if (walkRoute && walkRoute.distance_m <= 20000) {
        baseResult.walking_segment.distance_m = walkRoute.distance_m;
        baseResult.walking_segment.duration_s = walkRoute.duration_s;
        baseResult.walking_segment.geometry = walkRoute.geometry;
      }
    }
  }

  if (quotaOk) {
    store.routeCache.set(cacheKey, { data: baseResult, expiresAt: Date.now() + 20 * 60 * 1000 });
  }
  return baseResult;
}

export async function recognizeFishPhotoViaGemini(params: {
  base64Data: string;
  mimeType: string;
}): Promise<{
  recognized: boolean;
  species_id: string | null;
  species_name: string | null;
  confidence: number;
  release_advice: string;
  requires_manual_choice: boolean;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  const knownNames = store.species.map((s) => `${s.id}: ${s.name}`).join(', ');

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return {
      recognized: false,
      species_id: null,
      species_name: null,
      confidence: 0,
      release_advice:
        'Автоматическое распознавание недоступно без серверного ключа vision-сервиса. Выберите вид рыбы вручную.',
      requires_manual_choice: true,
    };
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.base64Data,
            },
          },
          {
            text: `Определи вид пресноводной рыбы на фото из списка: ${knownNames}. Верни confidence от 0 до 1. Если на фото не рыба или уверенность низкая, поставь confidence ниже 0.5.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            species_id: { type: Type.STRING },
            species_name: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
          required: ['species_id', 'species_name', 'confidence'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      species_id?: string;
      species_name?: string;
      confidence?: number;
    };
    const conf = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const matched = store.species.find((s) => s.id === parsed.species_id) ?? null;

    if (!matched || conf < 0.65) {
      return {
        recognized: false,
        species_id: matched?.id ?? null,
        species_name: matched?.name ?? parsed.species_name ?? null,
        confidence: conf,
        release_advice:
          'Уверенность распознавания ниже порога. Пожалуйста, подтвердите или выберите вид рыбы вручную.',
        requires_manual_choice: true,
      };
    }

    return {
      recognized: true,
      species_id: matched.id,
      species_name: matched.name,
      confidence: conf,
      release_advice: `${matched.release_note} (Не является юридической консультацией.)`,
      requires_manual_choice: false,
    };
  } catch {
    return {
      recognized: false,
      species_id: null,
      species_name: null,
      confidence: 0,
      release_advice: 'Не удалось распознать фото. Пожалуйста, выберите вид рыбы вручную.',
      requires_manual_choice: true,
    };
  }
}

const OSM_SPECIES_TOKENS: Array<{ id: string; patterns: RegExp }> = [
  { id: 'pike', patterns: /(?:^|[^\p{L}])(щук\p{L}*|pike|esox)(?:$|[^\p{L}])/iu },
  { id: 'zander', patterns: /(?:^|[^\p{L}])(судак\p{L}*|zander|sander|lucioperca)(?:$|[^\p{L}])/iu },
  { id: 'perch', patterns: /(?:^|[^\p{L}])(окун\p{L}*|perch|perca)(?:$|[^\p{L}])/iu },
  { id: 'bream', patterns: /(?:^|[^\p{L}])(лещ\p{L}*|подлещик\p{L}*|bream|abramis)(?:$|[^\p{L}])/iu },
  { id: 'carp', patterns: /(?:^|[^\p{L}])(карп\p{L}*|сазан\p{L}*|carp|cyprinus)(?:$|[^\p{L}])/iu },
  { id: 'crucian', patterns: /(?:^|[^\p{L}])(карас\p{L}*|crucian|carassius)(?:$|[^\p{L}])/iu },
  { id: 'roach', patterns: /(?:^|[^\p{L}])(плотв\p{L}*|сорог\p{L}*|roach|rutilus)(?:$|[^\p{L}])/iu },
  { id: 'catfish', patterns: /(?:^|[^\p{L}])(сом\p{L}*|catfish|silurus)(?:$|[^\p{L}])/iu },
  { id: 'asp', patterns: /(?:^|[^\p{L}])(жерех\p{L}*|asp|leuciscus aspius)(?:$|[^\p{L}])/iu },
  { id: 'chub', patterns: /(?:^|[^\p{L}])(голавл\p{L}*|chub|squalius)(?:$|[^\p{L}])/iu },
  { id: 'burbot', patterns: /(?:^|[^\p{L}])(налим\p{L}*|burbot|lota)(?:$|[^\p{L}])/iu },
  { id: 'tench', patterns: /(?:^|[^\p{L}])(лин[ьяею]\p{L}*|tench|tinca)(?:$|[^\p{L}])/iu },
  { id: 'trout', patterns: /(?:^|[^\p{L}])(форел\p{L}*|trout|oncorhynchus|salmo)(?:$|[^\p{L}])/iu },
];

function parseOsmMetersValue(raw?: string): number | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(',', '.');
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = Number(match[1]);
  if (!Number.isFinite(val) || val < 0.3 || val > 150) return null;
  return Number(val.toFixed(1));
}

export interface ParsedOsmWaterMetadata {
  max_depth_m: number | null;
  avg_depth_m: number | null;
  depth_source?: WaterBody['depth_source'];
  fishing_access?: WaterBody['fishing_access'];
  fishing_access_note?: string;
  inhabiting_species?: WaterBodyInhabitingSpecies[];
}

/**
 * Extracts real bathymetry depth (`max_depth`, `depth`), fishing legality
 * (`fishing`, `access`, `fee`, `leisure=fishing`), and `species` tags from OSM elements.
 */
export function parseOsmWaterTags(tags?: Record<string, string | undefined>): ParsedOsmWaterMetadata {
  if (!tags) return { max_depth_m: null, avg_depth_m: null };

  const maxDepth = parseOsmMetersValue(tags.max_depth ?? tags['water:max_depth']);
  const avgDepth = parseOsmMetersValue(tags.depth ?? tags['water:depth']);
  let resolvedMax: number | null = maxDepth;
  let resolvedAvg: number | null = avgDepth;
  if (resolvedMax === null && resolvedAvg !== null) {
    resolvedMax = Number(Math.min(150, resolvedAvg * 1.6).toFixed(1));
  } else if (resolvedMax !== null && resolvedAvg === null) {
    resolvedAvg = Number(Math.max(0.3, resolvedMax * 0.48).toFixed(1));
  }
  const depthSource: WaterBody['depth_source'] | undefined =
    resolvedMax !== null || resolvedAvg !== null ? 'osm' : undefined;

  const fishing = (tags.fishing ?? '').toLowerCase().trim();
  const access = (tags.access ?? '').toLowerCase().trim();
  const fee = (tags.fee ?? '').toLowerCase().trim();
  const leisure = (tags.leisure ?? '').toLowerCase().trim();

  let fishingAccess: WaterBody['fishing_access'] | undefined;
  let fishingAccessNote: string | undefined;

  if (fishing === 'no' || fishing === 'private' || access === 'private' || access === 'no') {
    fishingAccess = 'forbidden';
    fishingAccessNote = 'По тегам OSM лов запрещён или частная территория';
  } else if (fishing === 'permit' || access === 'permit' || fee === 'yes') {
    fishingAccess = 'paid';
    fishingAccessNote = 'По тегам OSM требуется путёвка / платный водоём';
  } else if (fishing === 'yes' || leisure === 'fishing') {
    fishingAccess = 'allowed';
    fishingAccessNote = 'По тегам OSM любительская рыбалка разрешена';
  }

  const rawSpecies = [tags.species, tags['species:ru'], tags.fish, tags['fishing:species']]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(';');

  let inhabitingSpecies: WaterBodyInhabitingSpecies[] | undefined;
  if (rawSpecies) {
    const found: WaterBodyInhabitingSpecies[] = [];
    for (const token of OSM_SPECIES_TOKENS) {
      if (token.patterns.test(rawSpecies)) {
        found.push({
          species_id: token.id,
          abundance: 'regular',
          note: 'Указано в тегах OpenStreetMap',
        });
      }
    }
    if (found.length > 0) inhabitingSpecies = found;
  }

  return {
    max_depth_m: resolvedMax,
    avg_depth_m: resolvedAvg,
    depth_source: depthSource,
    fishing_access: fishingAccess,
    fishing_access_note: fishingAccessNote,
    inhabiting_species: inhabitingSpecies,
  };
}

export function inferWaterBodyTypeFromOsm(
  tags: Record<string, string | undefined>,
  name?: string | null
): WaterBodyType {
  const lower = (name ?? '').toLowerCase();
  const water = (tags.water ?? '').toLowerCase();
  const waterway = (tags.waterway ?? '').toLowerCase();
  const landuse = (tags.landuse ?? '').toLowerCase();

  if (
    water === 'reservoir' ||
    landuse === 'reservoir' ||
    waterway === 'dam' ||
    waterway === 'weir' ||
    lower.includes('водохранилище') ||
    lower.includes('вдхр') ||
    lower.includes('плотин') ||
    lower.includes('платин')
  ) {
    return 'reservoir';
  }
  if (water === 'oxbow' || lower.includes('старица')) return 'oxbow';
  if (water === 'quarry' || landuse === 'quarry' || lower.includes('карьер')) return 'quarry';
  if (water === 'pond' || lower.includes('пруд')) return 'pond';
  if (water === 'lake' || lower.includes('озеро') || lower.startsWith('оз.')) return 'lake';
  if (
    waterway === 'river' ||
    waterway === 'canal' ||
    waterway === 'stream' ||
    water === 'river' ||
    water === 'canal' ||
    lower.includes('канал') ||
    lower.includes('река') ||
    lower.startsWith('р.')
  ) {
    return 'river';
  }
  return 'lake';
}

function defaultDepthForType(
  type: WaterBodyType,
  areaHa?: number | null,
  options?: { isCanalOrMajorRiver?: boolean; isStream?: boolean }
): { max: number; avg: number; area: number } {
  const area = typeof areaHa === 'number' && Number.isFinite(areaHa) && areaHa > 0 ? areaHa : null;
  switch (type) {
    case 'reservoir': {
      const a = area ?? 650;
      if (a >= 600) return { max: 14, avg: 5.2, area: a };
      if (a >= 120) return { max: 9.5, avg: 4.0, area: a };
      return { max: 6.0, avg: 2.6, area: a };
    }
    case 'lake': {
      const a = area ?? 18;
      if (a >= 180) return { max: 9.0, avg: 3.8, area: a };
      if (a >= 35) return { max: 5.2, avg: 2.4, area: a };
      return { max: 3.0, avg: 1.5, area: a };
    }
    case 'quarry': {
      const a = area ?? 12;
      return { max: a >= 25 ? 9.0 : 6.5, avg: a >= 25 ? 4.2 : 3.0, area: a };
    }
    case 'river': {
      if (options?.isStream) return { max: 1.4, avg: 0.7, area: area ?? 6 };
      if (options?.isCanalOrMajorRiver) return { max: 6.5, avg: 3.0, area: area ?? 160 };
      const a = area ?? 22;
      if (a >= 120) return { max: 6.0, avg: 2.8, area: a };
      if (a >= 35) return { max: 3.4, avg: 1.6, area: a };
      return { max: 2.0, avg: 1.0, area: a };
    }
    case 'oxbow':
      return { max: 2.4, avg: 1.2, area: area ?? 3.0 };
    case 'pond':
    default: {
      const a = area ?? 2.0;
      return { max: a >= 8 ? 3.2 : 2.1, avg: a >= 8 ? 1.6 : 1.1, area: a };
    }
  }
}

function computePolygonAreaHa(ring: [number, number][]): number {
  if (!ring || ring.length < 4) return 0;
  const avgLat = ring.reduce((sum, pt) => sum + pt[1], 0) / ring.length;
  const kx = 111320 * (Math.cos((avgLat * Math.PI) / 180) || 1);
  const ky = 110540;
  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * kx;
    const y1 = ring[i][1] * ky;
    const x2 = ring[i + 1][0] * kx;
    const y2 = ring[i + 1][1] * ky;
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.max(0.2, Number((Math.abs(area2) / 20000).toFixed(1)));
}

function downsampleRing(ring: [number, number][], maxVertices = 260): [number, number][] {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const raw = ring.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))] as [number, number]);
  let sampled: [number, number][];
  if (raw.length <= maxVertices) {
    sampled = raw;
  } else {
    const step = (raw.length - 1) / (maxVertices - 1);
    sampled = [];
    for (let i = 0; i < maxVertices - 1; i++) {
      sampled.push(raw[Math.round(i * step)]);
    }
    sampled.push(raw[raw.length - 1]);
  }
  if (sampled.length >= 3) {
    const f = sampled[0];
    const l = sampled[sampled.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) {
      sampled.push([f[0], f[1]]);
    }
  }
  return sampled;
}

function buildPolygonFromLineNodes(
  nodes: Array<{ lat: number; lon: number }>,
  halfWidthM = 28
): { polygon: [number, number][]; center: LatLng; lengthKm: number } {
  const deduped: Array<{ lat: number; lon: number }> = [];
  let totalLengthM = 0;
  for (const n of nodes) {
    const prev = deduped[deduped.length - 1];
    if (!prev) {
      deduped.push(n);
    } else {
      const segM = haversineMeters({ lat: prev.lat, lng: prev.lon }, { lat: n.lat, lng: n.lon });
      if (segM >= 35) {
        totalLengthM += segM;
        deduped.push(n);
      }
    }
  }
  const step = Math.max(1, Math.floor(deduped.length / 75));
  const sampled: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < deduped.length; i += step) {
    sampled.push(deduped[i]);
  }
  if (deduped.length > 0 && sampled[sampled.length - 1] !== deduped[deduped.length - 1]) {
    sampled.push(deduped[deduped.length - 1]);
  }
  if (sampled.length < 2) {
    const pt = nodes[0] ?? { lat: 55.975, lon: 36.825 };
    const r = 0.0008;
    return {
      center: { lat: Number(pt.lat.toFixed(5)), lng: Number(pt.lon.toFixed(5)) },
      lengthKm: 0.3,
      polygon: [
        [Number((pt.lon - r).toFixed(6)), Number(pt.lat.toFixed(6))],
        [Number(pt.lon.toFixed(6)), Number((pt.lat - r * 0.7).toFixed(6))],
        [Number((pt.lon + r).toFixed(6)), Number(pt.lat.toFixed(6))],
        [Number(pt.lon.toFixed(6)), Number((pt.lat + r * 0.7).toFixed(6))],
        [Number((pt.lon - r).toFixed(6)), Number(pt.lat.toFixed(6))],
      ],
    };
  }

  const refLat = sampled.reduce((s, p) => s + p.lat, 0) / sampled.length;
  const kx = 111320 * (Math.cos((refLat * Math.PI) / 180) || 1);
  const ky = 110540;
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < sampled.length; i++) {
    const pPrev = sampled[Math.max(0, i - 1)];
    const pNext = sampled[Math.min(sampled.length - 1, i + 1)];
    const dx = (pNext.lon - pPrev.lon) * kx;
    const dy = (pNext.lat - pPrev.lat) * ky;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const dLon = (nx * halfWidthM) / kx;
    const dLat = (ny * halfWidthM) / ky;
    left.push([Number((sampled[i].lon + dLon).toFixed(5)), Number((sampled[i].lat + dLat).toFixed(5))]);
    right.unshift([Number((sampled[i].lon - dLon).toFixed(5)), Number((sampled[i].lat - dLat).toFixed(5))]);
  }
  const ring = [...left, ...right, left[0]];
  const mid = sampled[Math.floor(sampled.length / 2)];
  return {
    polygon: ring,
    center: { lat: Number(mid.lat.toFixed(5)), lng: Number(mid.lon.toFixed(5)) },
    lengthKm: Number((totalLengthM / 1000).toFixed(2)),
  };
}

function buildClosedPolygonFromNodes(nodes: Array<{ lat: number; lon: number }>): [number, number][] {
  const coords = nodes.map((n) => [n.lon, n.lat] as [number, number]);
  const ring = downsampleRing(coords, 220);
  if (ring.length >= 4) return ring;
  return buildPolygonFromLineNodes(nodes).polygon;
}

export function buildWaterBodyFromGeocodeFeature(params: {
  id: string;
  title: string;
  subtitle?: string;
  lat: number;
  lng: number;
  type: WaterBodyType;
  areaHa?: number;
  isCanalOrMajorRiver?: boolean;
  isStream?: boolean;
}): WaterBody {
  const defaults = defaultDepthForType(params.type, params.areaHa, {
    isCanalOrMajorRiver: params.isCanalOrMajorRiver,
    isStream: params.isStream,
  });
  // Compact octagon marker when exact shoreline geometry is unavailable (never draw fake bounding-box rectangles over dry land)
  const rLng = 0.0011;
  const rLat = 0.0007;
  const polygon: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    polygon.push([
      Number((params.lng + Math.cos(a) * rLng).toFixed(5)),
      Number((params.lat + Math.sin(a) * rLat).toFixed(5)),
    ]);
  }
  polygon.push(polygon[0]);

  return {
    id: params.id,
    name: params.title,
    display_label: params.title,
    type: params.type,
    center: { lat: Number(params.lat.toFixed(5)), lng: Number(params.lng.toFixed(5)) },
    polygon,
    area_ha: Math.round(defaults.area * 10) / 10,
    source: 'osm',
    confidence: 0.84,
    moderation_status: 'verified',
    connected_to: null,
    has_bathymetry: false,
    max_depth_m: defaults.max,
    avg_depth_m: defaults.avg,
    region: params.subtitle || 'OpenStreetMap',
    external_id: params.id,
    ndwi_stability: 'year_round',
    vegetation_index: 'moderate',
    water_clarity: 'moderate',
    target_zone: { lat: Number(params.lat.toFixed(5)), lng: Number(params.lng.toFixed(5)) },
  };
}

interface OverpassElement {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

interface NominatimLookupItem {
  osm_type?: 'way' | 'relation' | 'node';
  osm_id?: number;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  geojson?: {
    type?: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString' | 'Point';
    coordinates?: unknown;
  };
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    state?: string;
    county?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
}

const NON_FISHABLE_WATERWAY_VALUES = new Set([
  'dam',
  'weir',
  'lock_gate',
  'boatyard',
  'dock',
  'drain',
  'ditch',
  'waterfall',
  'fuel',
  'pressurised',
  'sanitary_dump_station',
  'water_point',
  'fish_pass',
  'yes',
]);

const VALID_WATER_VALUES = new Set([
  'water',
  'reservoir',
  'lake',
  'pond',
  'oxbow',
  'basin',
  'quarry',
  'lagoon',
  'river',
  'canal',
  'riverbank',
  'stream',
]);

export function isPhotonWaterFeature(props?: PhotonFeature['properties']): boolean {
  if (!props?.name) return false;
  const k = (props.osm_key ?? '').toLowerCase();
  const v = (props.osm_value ?? '').toLowerCase();
  if (NON_FISHABLE_WATERWAY_VALUES.has(v)) return false;
  if (k === 'water') return true;
  if (k === 'landuse' && v === 'reservoir') return true;
  if (k === 'natural' && ['water', 'bay'].includes(v)) return true;
  if (k === 'waterway') return ['river', 'canal', 'stream', 'oxbow', 'riverbank'].includes(v);
  return VALID_WATER_VALUES.has(v);
}

function isMajorRiverOrCanal(name: string, osmType: string | undefined, extentKm: number, osmVal?: string): boolean {
  const lower = name.toLowerCase();
  if (osmVal === 'canal' || lower.includes('канал')) return true;
  if (osmType === 'R' && extentKm >= 75) return true;
  if (extentKm >= 95) return true;
  return false;
}

function extractGeometryFromNominatim(
  item: NominatimLookupItem,
  anchor: LatLng,
  type: WaterBodyType,
  majorWaterway = false
): {
  polygon: [number, number][];
  polygon_rings?: [number, number][][];
  center: LatLng;
  areaHa?: number;
  lengthKm?: number;
} | null {
  const g = item.geojson;
  if (!g || !g.coordinates) return null;

  if (g.type === 'Polygon') {
    const coords = g.coordinates as [number, number][][];
    if (!Array.isArray(coords) || coords.length === 0 || coords[0].length < 4) return null;
    const rings = coords.map((r) => downsampleRing(r, 260)).filter((r) => r.length >= 4);
    if (rings.length === 0) return null;
    const center = findInteriorWaterPoint(rings, anchor);
    const areaHa = computePolygonAreaHa(rings[0]);
    return {
      polygon: rings[0],
      ...(rings.length > 1 ? { polygon_rings: rings } : {}),
      center,
      areaHa,
    };
  }

  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates as [number, number][][][];
    if (!Array.isArray(polys) || polys.length === 0) return null;
    // Choose the polygon with the largest actual outer area (or total area summed across parts)
    let totalAreaHa = 0;
    let bestRings: [number, number][][] | null = null;
    let bestScore = -1;
    for (const poly of polys) {
      if (!poly || poly.length === 0 || poly[0].length < 4) continue;
      const rings = poly.map((r) => downsampleRing(r, 260)).filter((r) => r.length >= 4);
      if (rings.length === 0) continue;
      const aHa = computePolygonAreaHa(rings[0]);
      totalAreaHa += aHa;
      const pt = findInteriorWaterPoint(rings, anchor);
      const distKm = haversineMeters(anchor, pt) / 1000;
      const score = aHa / (1 + distKm * 0.08);
      if (score > bestScore) {
        bestScore = score;
        bestRings = rings;
      }
    }
    if (!bestRings) return null;
    const center = findInteriorWaterPoint(bestRings, anchor);
    return {
      polygon: bestRings[0],
      ...(bestRings.length > 1 ? { polygon_rings: bestRings } : {}),
      center,
      areaHa: Math.max(0.5, Number(totalAreaHa.toFixed(1))),
    };
  }

  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    const rawLines =
      g.type === 'LineString'
        ? [g.coordinates as [number, number][]]
        : (g.coordinates as [number, number][][]);
    // Pick the longest continuous segment near anchor (within 24 km), falling back to the nearest segment
    let bestLine: [number, number][] = [];
    let bestDist = Infinity;
    let totalRelationLenKm = 0;
    for (const line of rawLines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      for (let i = 1; i < line.length; i++) {
        totalRelationLenKm +=
          haversineMeters({ lat: line[i - 1][1], lng: line[i - 1][0] }, { lat: line[i][1], lng: line[i][0] }) / 1000;
      }
      const nearPts = line.filter((pt) => haversineMeters(anchor, { lat: pt[1], lng: pt[0] }) <= 24000);
      const candidate = nearPts.length >= 2 ? nearPts : line;
      let minLineDist = Infinity;
      for (const pt of candidate) {
        const d = haversineMeters(anchor, { lat: pt[1], lng: pt[0] });
        if (d < minLineDist) minLineDist = d;
      }
      if (minLineDist < bestDist || (Math.abs(minLineDist - bestDist) < 1500 && candidate.length > bestLine.length)) {
        bestDist = minLineDist;
        bestLine = candidate;
      }
    }
    if (bestLine.length >= 2) {
      const effectiveLenKm = Math.max(totalRelationLenKm, 1);
      const isLargeChannel = majorWaterway || effectiveLenKm >= 95;
      const isMediumRiver = !isLargeChannel && effectiveLenKm >= 38;
      const halfWidthM = isLargeChannel ? 42 : isMediumRiver ? 18 : 10;
      const buf = buildPolygonFromLineNodes(
        bestLine.map(([lon, lat]) => ({ lat, lon })),
        halfWidthM
      );
      const sampledLenKm = Math.max(buf.lengthKm, Math.min(effectiveLenKm, isLargeChannel ? 45 : 22));
      const estimatedHa = Math.max(
        3,
        Math.min(
          isLargeChannel ? 420 : isMediumRiver ? 75 : 26,
          Math.round((sampledLenKm * 1000 * halfWidthM * 2) / 10000)
        )
      );
      return {
        polygon: buf.polygon,
        center: buf.center,
        areaHa: estimatedHa,
        lengthKm: Number(Math.max(buf.lengthKm, totalRelationLenKm).toFixed(1)),
      };
    }
  }

  return null;
}

function buildWaterBodyFromPhotonFeature(
  feat: PhotonFeature,
  nomMap: Map<string, NominatimLookupItem>,
  anchor: LatLng
): WaterBody | null {
  const coords = feat.geometry?.coordinates;
  const props = feat.properties;
  if (!coords || coords.length < 2 || !props?.name || !isPhotonWaterFeature(props)) return null;

  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  const osmKey = (props.osm_key ?? '').toLowerCase();
  const osmVal = (props.osm_value ?? '').toLowerCase();
  const osmTypeUpper = (props.osm_type ?? 'W').toUpperCase();
  const type = inferWaterBodyTypeFromOsm(
    {
      waterway: osmKey === 'waterway' ? osmVal : undefined,
      water: osmKey === 'water' || osmKey === 'natural' ? osmVal : undefined,
      landuse: osmKey === 'landuse' ? osmVal : undefined,
    },
    props.name
  );

  let extentKm = 0;
  let bboxApproxHa: number | undefined;
  if (Array.isArray(props.extent) && props.extent.length === 4) {
    const [minLon, maxLat, maxLon, minLat] = props.extent;
    const dLatKm = Math.abs(maxLat - minLat) * 111;
    const dLngKm = Math.abs(maxLon - minLon) * 111 * Math.cos((lat * Math.PI) / 180);
    extentKm = Math.hypot(dLatKm, dLngKm);
    const approxHa =
      type === 'river'
        ? Math.max(4, Math.min(260, Math.round(extentKm * (osmVal === 'canal' || extentKm >= 75 ? 4.5 : 1.1))))
        : Math.round(dLatKm * dLngKm * 38);
    if (approxHa >= 1 && approxHa <= 50000) bboxApproxHa = approxHa;
  }

  const isStream = osmVal === 'stream';
  const majorWaterway = type === 'river' && isMajorRiverOrCanal(props.name, osmTypeUpper, extentKm, osmVal);

  const osmTagKey = `${osmTypeUpper}${props.osm_id ?? ''}`;
  const nomItem = props.osm_id ? nomMap.get(osmTagKey) : undefined;
  const extracted = nomItem
    ? extractGeometryFromNominatim(nomItem, anchor, type, majorWaterway)
    : null;

  const finalMajor =
    majorWaterway ||
    (type === 'river' && ((extracted?.lengthKm ?? 0) >= 95 || (extracted?.areaHa ?? 0) >= 160));
  const finalAreaHa = extracted?.areaHa ?? bboxApproxHa;
  const defaults = defaultDepthForType(type, finalAreaHa, {
    isCanalOrMajorRiver: finalMajor,
    isStream,
  });

  const region = [props.state, props.county].filter(Boolean).slice(0, 2).join(' · ') || 'OpenStreetMap';
  const osmTagId = `${osmTypeUpper}${props.osm_id ?? `${lat.toFixed(4)}-${lng.toFixed(4)}`}`;
  const center = extracted?.center ?? { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) };

  const base = buildWaterBodyFromGeocodeFeature({
    id: `wb-osm-${osmTagId}`,
    title: props.name.trim(),
    subtitle: region,
    lat: center.lat,
    lng: center.lng,
    type,
    areaHa: defaults.area,
    isCanalOrMajorRiver: finalMajor,
    isStream,
  });

  return {
    ...base,
    center,
    target_zone: center,
    polygon: extracted?.polygon ?? base.polygon,
    ...(extracted?.polygon_rings ? { polygon_rings: extracted.polygon_rings } : {}),
    area_ha: Math.round(defaults.area * 10) / 10,
    max_depth_m: defaults.max,
    avg_depth_m: defaults.avg,
    external_id: `OSM-${osmTagId}`,
    confidence: extracted ? 0.92 : 0.8,
  };
}

function buildWaterBodyFromNominatimSearchItem(
  item: NominatimLookupItem,
  anchor: LatLng
): WaterBody | null {
  const title = item.name?.trim();
  if (!title || !item.osm_id || !item.osm_type || item.osm_type === 'node') return null;
  const cat = (item.category ?? '').toLowerCase();
  const rawType = (item.type ?? '').toLowerCase();
  if (NON_FISHABLE_WATERWAY_VALUES.has(rawType)) return null;
  const isWaterCat =
    cat === 'waterway' ||
    cat === 'water' ||
    (cat === 'natural' && ['water', 'bay'].includes(rawType)) ||
    (cat === 'landuse' && rawType === 'reservoir') ||
    VALID_WATER_VALUES.has(rawType);
  if (!isWaterCat) return null;

  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = inferWaterBodyTypeFromOsm(
    {
      waterway: cat === 'waterway' ? rawType : undefined,
      water: cat === 'water' || cat === 'natural' ? rawType : undefined,
      landuse: cat === 'landuse' ? rawType : undefined,
    },
    title
  );

  let extentKm = 0;
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const [minLatS, maxLatS, minLonS, maxLonS] = item.boundingbox;
    const dLatKm = Math.abs(Number(maxLatS) - Number(minLatS)) * 111;
    const dLngKm = Math.abs(Number(maxLonS) - Number(minLonS)) * 111 * Math.cos((lat * Math.PI) / 180);
    extentKm = Math.hypot(dLatKm, dLngKm);
  }
  const osmPrefix = item.osm_type === 'relation' ? 'R' : 'W';
  const isStream = rawType === 'stream';
  const majorWaterway = type === 'river' && isMajorRiverOrCanal(title, osmPrefix, extentKm, rawType);
  const extracted = extractGeometryFromNominatim(item, anchor, type, majorWaterway);
  if (!extracted) return null;

  const finalMajor =
    majorWaterway ||
    (type === 'river' && ((extracted.lengthKm ?? 0) >= 95 || (extracted.areaHa ?? 0) >= 160));
  const defaults = defaultDepthForType(type, extracted.areaHa, {
    isCanalOrMajorRiver: finalMajor,
    isStream,
  });

  const osmTagId = `${osmPrefix}${item.osm_id}`;
  const region =
    (item.display_name ?? '')
      .split(',')
      .slice(1, 3)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' · ') || 'OpenStreetMap';

  const base = buildWaterBodyFromGeocodeFeature({
    id: `wb-osm-${osmTagId}`,
    title,
    subtitle: region,
    lat: extracted.center.lat,
    lng: extracted.center.lng,
    type,
    areaHa: defaults.area,
    isCanalOrMajorRiver: finalMajor,
    isStream,
  });

  return {
    ...base,
    center: extracted.center,
    target_zone: extracted.center,
    polygon: extracted.polygon,
    ...(extracted.polygon_rings ? { polygon_rings: extracted.polygon_rings } : {}),
    area_ha: Math.round(defaults.area * 10) / 10,
    max_depth_m: defaults.max,
    avg_depth_m: defaults.avg,
    external_id: `OSM-${osmTagId}`,
    confidence: 0.94,
  };
}

async function fetchPhotonFeatures(url: string, timeoutMs = 4000): Promise<PhotonFeature[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FishCastAI/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: PhotonFeature[] };
    return Array.isArray(json.features) ? json.features : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNominatimLookup(osmIds: string[]): Promise<Map<string, NominatimLookupItem>> {
  const map = new Map<string, NominatimLookupItem>();
  if (osmIds.length === 0) return map;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const url = `https://nominatim.openstreetmap.org/lookup?osm_ids=${osmIds.slice(0, 30).join(',')}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.001`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FishCastAI/1.0' },
      signal: controller.signal,
    });
    if (!res.ok) return map;
    const items = (await res.json()) as NominatimLookupItem[];
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item.osm_type && item.osm_id) {
          const prefix = item.osm_type === 'relation' ? 'R' : item.osm_type === 'way' ? 'W' : 'N';
          map.set(`${prefix}${item.osm_id}`, item);
        }
      }
    }
  } catch {
    // Graceful fallback if Nominatim unreachable
  } finally {
    clearTimeout(timer);
  }
  return map;
}

async function fetchNominatimSearch(queryText: string): Promise<NominatimLookupItem[]> {
  if (!queryText || queryText.trim().length < 2) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryText.trim())}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.001&limit=6`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FishCastAI/1.0', 'Accept-Language': 'ru,en' },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const items = (await res.json()) as NominatimLookupItem[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassMetadata(
  lat: number,
  lng: number,
  radiusM: number,
  majorOnly = false
): Promise<OverpassElement[]> {
  // Fast tags+center+bb query (includes RELATIONS for reservoirs, large lakes, canals, major rivers, plus dams & local lakes)
  const localRadiusM = Math.min(7000, radiusM);
  const qlLines = [
    '[out:json][timeout:5];',
    '(',
    `  relation["water"~"^(reservoir|lake|canal|river)$"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    `  relation["natural"="water"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    `  relation["landuse"="reservoir"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    `  relation["waterway"~"^(river|canal)$"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    `  way["natural"="water"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    `  way["waterway"~"^(river|canal|dam|weir)$"]["name"](around:${radiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
    ...(majorOnly
      ? []
      : [
          `  way["natural"="water"](around:${localRadiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
          `  way["waterway"~"^(dam|weir)$"](around:${localRadiusM},${lat.toFixed(4)},${lng.toFixed(4)});`,
        ]),
    ');',
    'out tags center bb 80;',
  ];
  const body = `data=${encodeURIComponent(qlLines.join('\n'))}`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3200);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'FishCastAI/1.0',
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { elements?: OverpassElement[] };
      if (Array.isArray(json.elements) && json.elements.length > 0) {
        return json.elements;
      }
    } catch {
      // Try mirror endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

export async function discoverOsmWaterBodies(params: {
  lat: number;
  lng: number;
  radiusKm?: number;
  queryText?: string;
  regionId?: string;
  majorOnly?: boolean;
}): Promise<WaterBody[]> {
  const regionDef = params.regionId && params.regionId !== 'all' ? getRegionById(params.regionId) : null;
  const anchor: LatLng = { lat: params.lat, lng: params.lng };
  const majorOnly = Boolean(params.majorOnly);
  const maxRadius = regionDef ? 45 : 28;
  const radiusKm = Math.max(6, Math.min(maxRadius, Math.round(params.radiusKm ?? (regionDef ? 28 : 16))));
  const wideRadiusKm = Math.min(regionDef ? 55 : 35, radiusKm + 14);
  const cleanQuery = (params.queryText ?? '').replace(/["\\[\]]/g, '').trim();
  const strippedQuery = cleanQuery
    .replace(/^(?:река|речка|р\.|озеро|оз\.|водохранилище|вдхр\.?|пруд|карьер|канал|старица)\s+/i, '')
    .trim();

  // 1) Fast zero-key Photon OSM discovery:
  //    CRITICAL: Photon indexes major reservoirs & lakes under `osm_tag=water` (NOT `natural:water`)!
  //    Always include `waterway:river` so major rivers (Сейм, Ока, Дон, Десна, etc.) are never missed!
  const photonUrls: string[] = [
    `https://photon.komoot.io/reverse?lat=${params.lat.toFixed(4)}&lon=${params.lng.toFixed(4)}&radius=${wideRadiusKm}&osm_tag=water&limit=25`,
    `https://photon.komoot.io/reverse?lat=${params.lat.toFixed(4)}&lon=${params.lng.toFixed(4)}&radius=${radiusKm}&osm_tag=natural:water&limit=18`,
    `https://photon.komoot.io/reverse?lat=${params.lat.toFixed(4)}&lon=${params.lng.toFixed(4)}&radius=${wideRadiusKm}&osm_tag=waterway:river&osm_tag=waterway:canal&limit=20`,
  ];
  if (cleanQuery.length >= 2 && cleanQuery.length <= 60) {
    const qBase = strippedQuery.length >= 2 ? strippedQuery : cleanQuery;
    const qWithRegion =
      regionDef && !qBase.toLowerCase().includes(regionDef.shortName.toLowerCase().slice(0, 5))
        ? `${qBase} ${regionDef.osmQueryHint}`
        : qBase;
    photonUrls.push(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(qWithRegion)}&lat=${params.lat.toFixed(4)}&lon=${params.lng.toFixed(4)}&osm_tag=water&osm_tag=waterway&osm_tag=natural:water&limit=12`
    );
    if (qWithRegion !== qBase) {
      photonUrls.push(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(qBase)}&osm_tag=water&osm_tag=waterway&osm_tag=natural:water&limit=10`
      );
    }
  } else if (regionDef) {
    photonUrls.push(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(`водохранилище ${regionDef.osmQueryHint}`)}&lat=${regionDef.center.lat.toFixed(4)}&lon=${regionDef.center.lng.toFixed(4)}&osm_tag=water&limit=15`
    );
  }

  // Targeted Nominatim searches: explicit query (both original and stripped prefix) + featured major reservoirs
  const nominatimQueries: string[] = [];
  if (cleanQuery.length >= 2) {
    nominatimQueries.push(cleanQuery);
    if (strippedQuery.length >= 2 && strippedQuery !== cleanQuery) {
      nominatimQueries.push(strippedQuery);
    }
    if (regionDef && !cleanQuery.toLowerCase().includes(regionDef.shortName.toLowerCase().slice(0, 5))) {
      nominatimQueries.push(`${cleanQuery}, ${regionDef.osmQueryHint}`);
    }
  } else if (regionDef) {
    nominatimQueries.push(...(regionDef.featuredQueries ?? []).slice(0, majorOnly ? 4 : 2));
  }

  // 2) Parallel Overpass relation+way metadata + Nominatim direct search
  const radiusM = Math.min(25000, radiusKm * 1000);
  const [photonBatches, overpassElements, nominatimSearchBatches] = await Promise.all([
    Promise.all(photonUrls.map((u) => fetchPhotonFeatures(u))),
    fetchOverpassMetadata(params.lat, params.lng, radiusM, majorOnly),
    Promise.all(nominatimQueries.map((q) => fetchNominatimSearch(q))),
  ]);
  const nominatimSearchItems = nominatimSearchBatches.flat();

  // Collect OSM IDs for batch exact-geometry lookup via Nominatim (prioritize relations & reservoirs/canals first!)
  const prioritizedLookupIds: Array<{ key: string; priority: number }> = [];
  const seenLookupIds = new Set<string>();
  const pushLookupId = (key: string, priority: number) => {
    if (seenLookupIds.has(key)) return;
    seenLookupIds.add(key);
    prioritizedLookupIds.push({ key, priority });
  };

  // Relations from Overpass get highest priority (major reservoirs, canals, rivers intersecting viewport)
  for (const el of overpassElements) {
    const rawName = el.tags?.name?.trim();
    if (!rawName) continue;
    const prefix = el.type === 'relation' ? 'R' : 'W';
    const type = inferWaterBodyTypeFromOsm(el.tags ?? {}, rawName);
    const prio =
      (el.type === 'relation' ? 20 : 5) +
      (type === 'reservoir' ? 30 : type === 'lake' ? 14 : type === 'river' ? 12 : 4);
    pushLookupId(`${prefix}${el.id}`, prio);
  }

  for (const batch of photonBatches) {
    for (const feat of batch) {
      const p = feat.properties;
      if (!isPhotonWaterFeature(p) || !p?.osm_id) continue;
      const t = (p.osm_type ?? '').toUpperCase();
      if (t !== 'W' && t !== 'R') continue;
      const v = (p.osm_value ?? '').toLowerCase();
      const prio =
        (t === 'R' ? 18 : 6) +
        (v === 'reservoir' ? 32 : v === 'canal' ? 24 : v === 'river' ? 16 : v === 'lake' ? 14 : 4);
      pushLookupId(`${t}${p.osm_id}`, prio);
    }
  }

  prioritizedLookupIds.sort((a, b) => b.priority - a.priority);
  const nomMap = await fetchNominatimLookup(prioritizedLookupIds.slice(0, 30).map((x) => x.key));

  // Also index any Nominatim search results into nomMap
  for (const item of nominatimSearchItems) {
    if (item.osm_type && item.osm_id && item.osm_type !== 'node') {
      const prefix = item.osm_type === 'relation' ? 'R' : 'W';
      nomMap.set(`${prefix}${item.osm_id}`, item);
    }
  }

  const lowerQuery = cleanQuery.toLowerCase();
  const deduped = new Map<string, { wb: WaterBody; rankScore: number; dist: number }>();

  const addCandidate = (wb: WaterBody) => {
    const nameKey = wb.display_label.toLowerCase();
    const dist = haversineMeters(anchor, wb.center);
    const matchesQuery =
      lowerQuery.length >= 2 &&
      (nameKey.includes(lowerQuery) || lowerQuery.includes(nameKey));

    // Prioritize query match, reservoirs, large lakes/rivers/canals, and exact polygon geometry
    const typeWeight =
      wb.type === 'reservoir'
        ? 45
        : wb.type === 'lake' && wb.area_ha >= 20
          ? 26
          : wb.type === 'river' && wb.area_ha >= 60
            ? 28
            : wb.type === 'river'
              ? 14
              : wb.type === 'quarry'
                ? 12
                : 6;
    const geomWeight = wb.polygon.length > 10 ? 15 : 0;
    const areaWeight = Math.min(25, Math.log10(Math.max(1, wb.area_ha)) * 8);
    const distPenalty = Math.min(40, dist / 1500);
    const rankScore = (matchesQuery ? 120 : 0) + typeWeight + geomWeight + areaWeight - distPenalty;

    const existing = deduped.get(nameKey);
    if (!existing || rankScore > existing.rankScore) {
      deduped.set(nameKey, { wb, rankScore, dist });
    }
  };

  // Direct Nominatim search hits first (handles huge reservoirs, canals, and long rivers like Сейм / Канал им. Москвы)
  for (const item of nominatimSearchItems) {
    const wb = buildWaterBodyFromNominatimSearchItem(item, anchor);
    if (wb) addCandidate(wb);
  }

  // Overpass hits enriched with Nominatim multipolygons/linestrings
  for (const el of overpassElements) {
    const isDamOrWeir = el.tags?.waterway === 'dam' || el.tags?.waterway === 'weir';
    let rawName = el.tags?.name?.trim() || '';
    if (!rawName) {
      if (majorOnly) continue;
      // Include unnamed local lakes, ponds, and dams when discovering nearby water bodies
      const cLatTmp = el.center?.lat ?? (el.bounds ? (el.bounds.minlat + el.bounds.maxlat) / 2 : undefined);
      const cLngTmp = el.center?.lon ?? (el.bounds ? (el.bounds.minlon + el.bounds.maxlon) / 2 : undefined);
      if (typeof cLatTmp !== 'number' || typeof cLngTmp !== 'number') continue;
      if (isDamOrWeir) {
        rawName = `Плотина (${cLatTmp.toFixed(3)}, ${cLngTmp.toFixed(3)})`;
      } else if (el.bounds) {
        const dLatKm = Math.abs(el.bounds.maxlat - el.bounds.minlat) * 111;
        const dLngKm = Math.abs(el.bounds.maxlon - el.bounds.minlon) * 111 * Math.cos((cLatTmp * Math.PI) / 180);
        const estHa = dLatKm * dLngKm * 38;
        if (estHa < 0.8) continue;
        const kindLabel = el.tags?.water === 'pond' ? 'Пруд' : el.tags?.water === 'reservoir' ? 'Водоём / плотина' : 'Озеро / пруд';
        rawName = `${kindLabel} (${cLatTmp.toFixed(3)}, ${cLngTmp.toFixed(3)})`;
      } else {
        continue;
      }
    }
    const prefix = el.type === 'relation' ? 'R' : 'W';
    const osmTagKey = `${prefix}${el.id}`;
    const type = inferWaterBodyTypeFromOsm(el.tags ?? {}, rawName);
    const nomItem = nomMap.get(osmTagKey);

    let centerLat = el.center?.lat;
    let centerLng = el.center?.lon;
    if ((typeof centerLat !== 'number' || typeof centerLng !== 'number') && el.bounds) {
      centerLat = (el.bounds.minlat + el.bounds.maxlat) / 2;
      centerLng = (el.bounds.minlon + el.bounds.maxlon) / 2;
    }
    if (typeof centerLat !== 'number' || typeof centerLng !== 'number') continue;

    let extentKm = 0;
    let bboxApproxHa: number | undefined;
    if (el.bounds) {
      const dLatKm = Math.abs(el.bounds.maxlat - el.bounds.minlat) * 111;
      const dLngKm = Math.abs(el.bounds.maxlon - el.bounds.minlon) * 111 * Math.cos((centerLat * Math.PI) / 180);
      extentKm = Math.hypot(dLatKm, dLngKm);
      const approxHa =
        type === 'river'
          ? Math.max(
              4,
              Math.min(
                260,
                Math.round(
                  extentKm *
                    (el.tags?.waterway === 'canal' || el.tags?.water === 'canal' || extentKm >= 75 ? 4.5 : 1.1)
                )
              )
            )
          : Math.round(dLatKm * dLngKm * 38);
      if (approxHa >= 1 && approxHa <= 50000) bboxApproxHa = approxHa;
    }

    const isStream = el.tags?.waterway === 'stream';
    const majorWaterway =
      type === 'river' && isMajorRiverOrCanal(rawName, prefix, extentKm, el.tags?.waterway ?? el.tags?.water);
    const extracted = nomItem ? extractGeometryFromNominatim(nomItem, anchor, type, majorWaterway) : null;

    let polygon: [number, number][];
    let polygonRings: [number, number][][] | undefined;
    let interiorCenter: LatLng = extracted?.center ?? {
      lat: Number(centerLat.toFixed(5)),
      lng: Number(centerLng.toFixed(5)),
    };

    if (extracted) {
      polygon = extracted.polygon;
      polygonRings = extracted.polygon_rings;
    } else if (el.geometry && el.geometry.length >= 2) {
      if (type === 'river') {
        const buf = buildPolygonFromLineNodes(el.geometry, majorWaterway ? 42 : 14);
        polygon = buf.polygon;
        interiorCenter = buf.center;
      } else {
        polygon = buildClosedPolygonFromNodes(el.geometry);
        interiorCenter = findInteriorWaterPoint([polygon], interiorCenter);
      }
    } else {
      polygon = buildWaterBodyFromGeocodeFeature({
        id: `wb-osm-${osmTagKey}`,
        title: rawName,
        lat: centerLat,
        lng: centerLng,
        type,
      }).polygon;
    }

    const finalMajor =
      majorWaterway ||
      (type === 'river' && ((extracted?.lengthKm ?? 0) >= 95 || (extracted?.areaHa ?? 0) >= 160));
    const defaults = defaultDepthForType(type, extracted?.areaHa ?? bboxApproxHa, {
      isCanalOrMajorRiver: finalMajor,
      isStream,
    });
    const osmMeta = parseOsmWaterTags(el.tags);

    addCandidate({
      id: `wb-osm-${osmTagKey}`,
      name: rawName,
      display_label: rawName,
      type,
      center: interiorCenter,
      polygon,
      ...(polygonRings ? { polygon_rings: polygonRings } : {}),
      area_ha: Math.round(defaults.area * 10) / 10,
      source: 'osm',
      confidence: extracted ? 0.94 : 0.86,
      moderation_status: 'verified',
      connected_to: null,
      has_bathymetry: false,
      max_depth_m: osmMeta.max_depth_m ?? defaults.max,
      avg_depth_m: osmMeta.avg_depth_m ?? defaults.avg,
      depth_source: osmMeta.depth_source ?? 'estimated',
      ...(osmMeta.fishing_access ? { fishing_access: osmMeta.fishing_access } : {}),
      ...(osmMeta.fishing_access_note ? { fishing_access_note: osmMeta.fishing_access_note } : {}),
      ...(osmMeta.inhabiting_species ? { inhabiting_species: osmMeta.inhabiting_species } : {}),
      region: 'OpenStreetMap',
      external_id: `OSM-${osmTagKey}`,
      ndwi_stability: 'year_round',
      vegetation_index: 'moderate',
      water_clarity: 'moderate',
      target_zone: interiorCenter,
    });
  }

  // Photon water & waterway features enriched with Nominatim GeoJSON
  for (const batch of photonBatches) {
    for (const feat of batch) {
      const wb = buildWaterBodyFromPhotonFeature(feat, nomMap, anchor);
      if (wb) addCandidate(wb);
    }
  }

  const finalResults = Array.from(deduped.values())
    .map((entry) => {
      const wb = entry.wb;
      if (regionDef && (wb.region === 'OpenStreetMap' || !wb.region) && matchesWaterBodyRegion(wb, regionDef.id)) {
        return { ...entry, wb: { ...wb, region: regionDef.name } };
      }
      return entry;
    })
    .filter((entry) => {
      const matchesExplicit =
        cleanQuery.length >= 2 &&
        (entry.wb.display_label.toLowerCase().includes(cleanQuery.toLowerCase()) ||
          (strippedQuery.length >= 2 &&
            entry.wb.display_label.toLowerCase().includes(strippedQuery.toLowerCase())));
      if (matchesExplicit) return true;
      if (regionDef && !matchesWaterBodyRegion(entry.wb, regionDef.id)) return false;
      if (majorOnly && !isMajorWaterBody(entry.wb)) return false;
      return true;
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 30)
    .map((entry) => entry.wb);

  return finalResults;
}



