import type {
  BathymetryContour,
  BathymetryPoint,
  BiteAlertEvent,
  BiteAlertSettings,
  BiteForecastResponse,
  BiteForecastSlot,
  CatchReport,
  FishAbundance,
  FishSpecies,
  GoodBiteWaterBodyItem,
  HourlyWeatherPoint,
  LatLng,
  LunarPreference,
  LureRecommendationResult,
  ProspectiveZone,
  RouteMultiResult,
  SlotPressureTrend,
  VerifiedSpeciesEntry,
  WaterBody,
  WaterBodyAccessPoint,
  WaterBodyAnalysis,
  WaterBodyFishPresence,
  WeatherSnapshot,
} from './types';
import { isMajorWaterBody, matchesWaterBodyRegion } from './regions';

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function pointInRing(point: LatLng, ring: [number, number][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-16) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInWaterBody(
  point: LatLng,
  wb: Pick<WaterBody, 'polygon' | 'polygon_rings'>
): boolean {
  const rings = wb.polygon_rings && wb.polygon_rings.length > 0 ? wb.polygon_rings : [wb.polygon];
  if (rings.length === 0 || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

export function distToWaterBoundaryMeters(
  point: LatLng,
  rings: [number, number][][]
): number {
  const cosLat = Math.cos((point.lat * Math.PI) / 180) || 1;
  const kx = 111320 * cosLat;
  const ky = 110540;
  let minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = (ring[i][0] - point.lng) * kx;
      const ay = (ring[i][1] - point.lat) * ky;
      const bx = (ring[i + 1][0] - point.lng) * kx;
      const by = (ring[i + 1][1] - point.lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const dSq = px * px + py * py;
      if (dSq < minSq) minSq = dSq;
    }
  }
  return Math.sqrt(minSq);
}

export function findInteriorWaterPoint(
  rings: [number, number][][],
  prefer?: LatLng
): LatLng {
  const outer = rings[0];
  if (!outer || outer.length === 0) {
    return prefer ?? { lat: 55.975, lng: 36.825 };
  }
  if (prefer && pointInWaterBody(prefer, { polygon: outer, polygon_rings: rings })) {
    if (distToWaterBoundaryMeters(prefer, rings) >= 40) {
      return { lat: Number(prefer.lat.toFixed(5)), lng: Number(prefer.lng.toFixed(5)) };
    }
  }
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of outer) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const grid = 28;
  let best: { lat: number; lng: number; score: number } | null = null;
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const lng = minLng + (maxLng - minLng) * (i / grid);
      const lat = minLat + (maxLat - minLat) * (j / grid);
      const candidate = { lat, lng };
      if (!pointInWaterBody(candidate, { polygon: outer, polygon_rings: rings })) continue;
      const clearance = distToWaterBoundaryMeters(candidate, rings);
      const prefPenalty = prefer ? haversineMeters(candidate, prefer) * 0.04 : 0;
      const score = clearance - prefPenalty;
      if (!best || score > best.score) {
        best = { lat, lng, score };
      }
    }
  }
  if (best) {
    return { lat: Number(best.lat.toFixed(5)), lng: Number(best.lng.toFixed(5)) };
  }
  if (prefer) return prefer;
  return { lat: Number(outer[0][1].toFixed(5)), lng: Number(outer[0][0].toFixed(5)) };
}

export function windDegreesToLabel(deg: number): string {
  const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export function formatWaterBodyTitle(wb: Pick<WaterBody, 'name' | 'type' | 'moderation_status'>): string {
  if (wb.name && wb.name.trim().length > 0) {
    return wb.name.trim();
  }
  if (wb.type === 'pond') return 'Пруд (предположительно)';
  if (wb.type === 'oxbow') return 'Безымянная старица';
  if (wb.type === 'quarry') return 'Безымянный карьер';
  return 'Безымянный водоём';
}

export function probabilityLabelFromScore(score: number): BiteForecastSlot['probability_label'] {
  if (score >= 66) return 'высокая вероятность';
  if (score >= 40) return 'средняя вероятность';
  return 'низкая вероятность';
}

function formatHourMinute(hourFloat: number): string {
  const normalized = ((hourFloat % 24) + 24) % 24;
  const h = Math.floor(normalized);
  const m = Math.round((normalized - h) * 60);
  const hh = (m === 60 ? (h + 1) % 24 : h).toString().padStart(2, '0');
  const mm = (m === 60 ? 0 : m).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface SunTimes {
  sunriseHour: number;
  sunsetHour: number;
  sunriseStr: string;
  sunsetStr: string;
}

export function computeSunTimes(
  lat: number,
  lng: number,
  date: Date
): SunTimes {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.max(
    1,
    Math.min(366, Math.floor((date.getTime() - startOfYear) / 86400000) + 1)
  );
  const rad = Math.PI / 180;
  const B = ((2 * Math.PI) / 365) * (dayOfYear - 81);
  const eqTimeMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const declRad = 23.44 * rad * Math.sin(((2 * Math.PI) / 365) * (dayOfYear - 81));
  const latRad = Math.max(-65, Math.min(65, lat)) * rad;

  const cosH0 =
    (Math.cos(90.833 * rad) - Math.sin(latRad) * Math.sin(declRad)) /
    (Math.cos(latRad) * Math.cos(declRad) || 1e-6);
  const clampedCos = Math.max(-0.98, Math.min(0.98, cosH0));
  const halfDayHours = (Math.acos(clampedCos) / rad) / 15;

  // Approximate standard local timezone offset from longitude (e.g. Moscow/Istra ~37E -> UTC+3)
  const tzOffsetHours = Math.round(lng / 15);
  const solarNoonLocal = 12 + tzOffsetHours - lng / 15 - eqTimeMin / 60;
  const sunriseHour = Math.max(2, Math.min(11.5, solarNoonLocal - halfDayHours));
  const sunsetHour = Math.max(12.5, Math.min(23, solarNoonLocal + halfDayHours));

  return {
    sunriseHour: Number(sunriseHour.toFixed(2)),
    sunsetHour: Number(sunsetHour.toFixed(2)),
    sunriseStr: formatHourMinute(sunriseHour),
    sunsetStr: formatHourMinute(sunsetHour),
  };
}

export interface LunarCycleState {
  ageDays: number;
  phaseFraction: number; // 0..1 (0 = new moon, 0.5 = full moon)
  illuminationPct: number; // 0..100
  phaseType: 'new_moon' | 'waxing' | 'full_moon' | 'waning';
  phaseLabel: string;
  majorHours: [number, number]; // lunar overhead & underfoot transit hours (0..24)
  minorHours: [number, number]; // approximate moonrise & moonset hours (0..24)
  solunarWindow: 'major' | 'minor' | null;
}

export interface LunarTimeOfDayEvaluation {
  timeScore: number;
  lunarScore: number;
  activeHourMatch: 'peak' | 'active' | 'off_peak';
  solunarWindow: 'major' | 'minor' | null;
  reasons: string[];
}

function circularHourDist(a: number, b: number): number {
  const diff = Math.abs(a - b) % 24;
  return Math.min(diff, 24 - diff);
}

function lunarPhaseLabelFromFraction(phaseFraction: number, illuminationPct: number): string {
  if (illuminationPct <= 12) return 'Новолуние';
  if (illuminationPct >= 88) return 'Полнолуние';
  if (phaseFraction < 0.22) return 'Растущий серп';
  if (phaseFraction < 0.28) return 'Первая четверть';
  if (phaseFraction < 0.5) return 'Растущая луна';
  if (phaseFraction < 0.72) return 'Убывающая луна';
  if (phaseFraction < 0.78) return 'Последняя четверть';
  return 'Стареющий серп';
}

export function computeLunarCycleState(params: {
  date: Date;
  slotHour: number;
  weatherMoonIllumination?: number;
  weatherMoonPhase?: string;
  useWeatherOverride?: boolean;
}): LunarCycleState {
  const { date, slotHour, weatherMoonIllumination, weatherMoonPhase, useWeatherOverride = false } = params;
  const synodic = 29.53058867;
  const ref = Date.UTC(2024, 0, 11, 11, 57, 0);
  const slotTimestamp = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.max(0, Math.min(23, Math.floor(slotHour))),
    0,
    0
  );
  const days = (slotTimestamp - ref) / 86400000;
  const ageDays = ((days % synodic) + synodic) % synodic;
  const astroPhaseFraction = ageDays / synodic;
  const astroIllumination = Math.round(((1 - Math.cos(2 * Math.PI * astroPhaseFraction)) / 2) * 100);

  let illuminationPct = astroIllumination;
  let phaseFraction = astroPhaseFraction;
  let phaseLabel = lunarPhaseLabelFromFraction(phaseFraction, illuminationPct);

  if (useWeatherOverride && typeof weatherMoonIllumination === 'number' && Number.isFinite(weatherMoonIllumination)) {
    illuminationPct = Math.max(0, Math.min(100, Math.round(weatherMoonIllumination)));
    const lowerPhase = (weatherMoonPhase ?? '').toLowerCase();
    const isExplicitWaning = lowerPhase.includes('убыв') || lowerPhase.includes('старе') || lowerPhase.includes('последн');
    const isExplicitWaxing = lowerPhase.includes('раст') || lowerPhase.includes('перв');
    const cosVal = 1 - (illuminationPct / 100) * 2;
    const baseAngleFrac = Math.acos(Math.max(-1, Math.min(1, cosVal))) / (2 * Math.PI); // 0..0.5
    if (illuminationPct <= 12) {
      phaseFraction = 0.02;
      phaseLabel = 'Новолуние';
    } else if (illuminationPct >= 88) {
      phaseFraction = 0.5;
      phaseLabel = 'Полнолуние';
    } else if (isExplicitWaning) {
      phaseFraction = 1 - baseAngleFrac;
      phaseLabel = weatherMoonPhase?.trim() || lunarPhaseLabelFromFraction(phaseFraction, illuminationPct);
    } else if (isExplicitWaxing) {
      phaseFraction = baseAngleFrac;
      phaseLabel = weatherMoonPhase?.trim() || lunarPhaseLabelFromFraction(phaseFraction, illuminationPct);
    } else {
      phaseFraction = astroPhaseFraction >= 0.5 ? 1 - baseAngleFrac : baseAngleFrac;
      phaseLabel = weatherMoonPhase?.trim() || lunarPhaseLabelFromFraction(phaseFraction, illuminationPct);
    }
  }

  const phaseType: LunarCycleState['phaseType'] =
    illuminationPct <= 12
      ? 'new_moon'
      : illuminationPct >= 88
        ? 'full_moon'
        : phaseFraction < 0.5
          ? 'waxing'
          : 'waning';

  // Lunar overhead transit occurs ~12:00 at new moon and shifts ~0.81h/day (24h per synodic cycle)
  const overhead = (((phaseFraction * 24 + 12) % 24) + 24) % 24;
  const underfoot = (overhead + 12) % 24;
  const moonrise = (overhead + 18) % 24;
  const moonset = (overhead + 6) % 24;

  const dMajor = Math.min(circularHourDist(slotHour, overhead), circularHourDist(slotHour, underfoot));
  const dMinor = Math.min(circularHourDist(slotHour, moonrise), circularHourDist(slotHour, moonset));
  const solunarWindow: LunarCycleState['solunarWindow'] =
    dMajor <= 1.75 ? 'major' : dMinor <= 1.5 ? 'minor' : null;

  return {
    ageDays: Number(ageDays.toFixed(2)),
    phaseFraction: Number(phaseFraction.toFixed(4)),
    illuminationPct,
    phaseType,
    phaseLabel,
    majorHours: [Number(overhead.toFixed(2)), Number(underfoot.toFixed(2))],
    minorHours: [Number(moonrise.toFixed(2)), Number(moonset.toFixed(2))],
    solunarWindow,
  };
}

export function computeSolunarBoost(
  date: Date,
  hour: number,
  moonIllumination: number
): { boost: number; isMajor: boolean } {
  const lunar = computeLunarCycleState({
    date,
    slotHour: hour,
    weatherMoonIllumination: moonIllumination,
    useWeatherOverride: true,
  });
  let boost = 0;
  const isMajor = lunar.solunarWindow === 'major';
  if (isMajor) {
    boost += 3;
  } else if (lunar.solunarWindow === 'minor') {
    boost += 1.5;
  }

  // Spring tide effect near new moon or full moon
  if (lunar.illuminationPct <= 12 || lunar.illuminationPct >= 88) {
    boost += 2;
  } else if (lunar.illuminationPct >= 42 && lunar.illuminationPct <= 58) {
    boost -= 1;
  }

  return { boost: Math.max(-2, Math.min(5, Math.round(boost))), isMajor };
}

const DEFAULT_ACTIVE_HOURS_BY_SPECIES: Record<string, number[]> = {
  pike: [5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19],
  sudak: [3, 4, 5, 6, 18, 19, 20, 21, 22, 23, 0, 1],
  okun: [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18],
  lesh: [3, 4, 5, 6, 7, 8, 9, 18, 19, 20, 21, 22, 23],
  karp: [4, 5, 6, 7, 8, 9, 17, 18, 19, 20, 21, 22],
  karas: [4, 5, 6, 7, 8, 9, 17, 18, 19, 20],
  nalim: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5],
  plotva: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  zherekh: [4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20],
  golavl: [5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20],
  yaz: [4, 5, 6, 7, 8, 17, 18, 19, 20, 21],
  lin: [4, 5, 6, 7, 8, 9, 18, 19, 20],
  som: [20, 21, 22, 23, 0, 1, 2, 3, 4],
  krasnoperka: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  gustera: [5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19],
  rotan: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
};

export function resolveSpeciesActiveHours(species: FishSpecies): number[] {
  if (Array.isArray(species.active_hours) && species.active_hours.length > 0) {
    const cleaned = Array.from(
      new Set(
        species.active_hours
          .map((h) => Math.floor(Number(h)))
          .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23)
      )
    );
    if (cleaned.length > 0) return cleaned;
  }
  const byId = DEFAULT_ACTIVE_HOURS_BY_SPECIES[species.id];
  if (byId) return byId;

  const text = (species.time_of_day ?? '').toLowerCase();
  if (text.includes('ноч')) return [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  if (text.includes('весь день') || text.includes('солнечный день')) {
    return [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  }
  return [5, 6, 7, 8, 9, 16, 17, 18, 19, 20];
}

export function resolveSpeciesLunarPreference(species: FishSpecies): LunarPreference {
  if (species.lunar_preference) return species.lunar_preference;
  if (species.id === 'nalim' || species.id === 'som' || species.id === 'sudak' || species.id === 'lin') {
    return 'dark_moon';
  }
  if (species.id === 'lesh' || species.id === 'karp') {
    return 'bright_moon';
  }
  return 'balanced';
}

export function formatActiveHoursRanges(hours: number[]): string {
  if (!hours.length) return '05:00–09:00, 17:00–20:00';
  const set = new Set(hours.map((h) => ((Math.floor(h) % 24) + 24) % 24));
  const sorted = Array.from(set).sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const h of sorted) {
    const prev = ranges[ranges.length - 1];
    if (prev && h === prev[1] + 1) {
      prev[1] = h;
    } else {
      ranges.push([h, h]);
    }
  }
  // Merge overnight wrap (e.g. [0..4] and [20..23] -> 20:00–04:00)
  if (ranges.length >= 2 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === 23) {
    const first = ranges.shift()!;
    ranges[ranges.length - 1][1] = first[1];
  }
  const pad = (n: number) => String(n).padStart(2, '0') + ':00';
  return ranges.map(([start, end]) => `${pad(start)}–${pad(end)}`).join(', ');
}

export function evaluateLunarAndTimeOfDayActivity(params: {
  species: FishSpecies;
  slotHour: number;
  sun: SunTimes;
  lunar: LunarCycleState;
  waterBody?: WaterBody | null;
  cloudCoverPct: number;
  isIceRegime: boolean;
  isDaylight: boolean;
  oxygenDawnBoost: number;
  oxygenMiddayPenalty: number;
  springMiddayBoost: number;
}): LunarTimeOfDayEvaluation {
  const {
    species,
    slotHour,
    sun,
    lunar,
    waterBody = null,
    cloudCoverPct,
    isIceRegime,
    isDaylight,
    oxygenDawnBoost,
    oxygenMiddayPenalty,
    springMiddayBoost,
  } = params;

  const activeHours = resolveSpeciesActiveHours(species);
  const activeSet = new Set(activeHours);
  const lunarPref = resolveSpeciesLunarPreference(species);

  const slotHours = [slotHour % 24, (slotHour + 1) % 24, (slotHour + 2) % 24];
  const windowOverlap = slotHours.filter((h) => activeSet.has(h)).length;

  const nocturnalHourCount = activeHours.filter((h) => h >= 20 || h <= 5).length;
  const isNocturnal = nocturnalHourCount / Math.max(1, activeHours.length) >= 0.6;

  const nearSunrise =
    Math.abs(slotHour - sun.sunriseHour) <= 1.85 ||
    Math.abs(slotHour + 1 - sun.sunriseHour) <= 1.45;
  const nearSunset =
    Math.abs(slotHour - sun.sunsetHour) <= 1.85 ||
    Math.abs(slotHour + 1 - sun.sunsetHour) <= 1.45;

  const clarity = waterBody?.water_clarity ?? 'moderate';
  const avgDepth =
    waterBody?.avg_depth_m ??
    (waterBody?.max_depth_m ? waterBody.max_depth_m * 0.45 : 3.5);
  const isClearWater = clarity === 'clear';
  const isMurkyWater = clarity === 'murky';
  const isShallow = waterBody?.type === 'pond' || waterBody?.type === 'oxbow' || avgDepth < 2.5;
  const isDeepReservoir =
    waterBody?.type === 'reservoir' || waterBody?.type === 'quarry' || avgDepth >= 5.0;

  const reasons: string[] = [];
  let timeScore = 0;
  let activeHourMatch: LunarTimeOfDayEvaluation['activeHourMatch'] = 'off_peak';

  // 1. Species-specific active_hours & astronomical dawn/dusk evaluation
  if (isIceRegime && !isNocturnal) {
    if (slotHour >= 9 && slotHour <= 15 && windowOverlap >= 1) {
      timeScore = 10;
      activeHourMatch = 'peak';
      reasons.push('Зимний дневной выход подо льдом (+)');
    } else if (windowOverlap >= 2) {
      timeScore = 6;
      activeHourMatch = 'active';
      reasons.push('Активные часы вида подо льдом');
    } else if (isDaylight) {
      timeScore = 2;
      activeHourMatch = 'active';
    } else {
      timeScore = -10;
      activeHourMatch = 'off_peak';
    }
  } else {
    if (windowOverlap === 3 || (windowOverlap === 2 && (nearSunrise || nearSunset || (isNocturnal && !isDaylight)))) {
      activeHourMatch = 'peak';
      if (isNocturnal && !isDaylight) {
        timeScore = 14;
        reasons.push('Ночные активные часы вида (+)');
      } else if (nearSunrise) {
        timeScore = 14 + oxygenDawnBoost;
        reasons.push(`Рассветный пик (${sun.sunriseStr})`);
      } else if (nearSunset) {
        timeScore = 13;
        reasons.push(`Закатный пик (${sun.sunsetStr})`);
      } else {
        timeScore = 10;
        reasons.push('Пик суточной активности вида (+)');
      }
    } else if (windowOverlap >= 1) {
      activeHourMatch = 'active';
      if (nearSunrise) {
        timeScore = 9 + oxygenDawnBoost;
        reasons.push(`Утренний выход (${sun.sunriseStr})`);
      } else if (nearSunset) {
        timeScore = 9;
        reasons.push(`Вечерний выход (${sun.sunsetStr})`);
      } else if (windowOverlap === 2) {
        timeScore = isNocturnal && !isDaylight ? 11 : 6;
        if (isNocturnal && !isDaylight) reasons.push('Ночная активность вида');
      } else {
        timeScore = 3;
      }
    } else {
      activeHourMatch = 'off_peak';
      if (nearSunrise || nearSunset) {
        timeScore = isNocturnal ? 4 : 1;
        if (isNocturnal) reasons.push('Сумеречный выход');
      } else {
        timeScore = -10;
      }
    }

    // Water-body clarity & depth modulation of diurnal activity
    if (!isIceRegime && waterBody) {
      const isWaryPredator =
        species.id === 'pike' ||
        species.id === 'sudak' ||
        species.id === 'zherekh' ||
        species.id === 'golavl';
      if (
        isDaylight &&
        !nearSunrise &&
        !nearSunset &&
        cloudCoverPct < 50 &&
        isClearWater &&
        isShallow &&
        isWaryPredator
      ) {
        timeScore -= 4;
      } else if (
        (nearSunrise || nearSunset || (!isDaylight && activeHourMatch !== 'off_peak')) &&
        isClearWater &&
        isWaryPredator
      ) {
        timeScore += 2;
      } else if (
        isDaylight &&
        !nearSunrise &&
        !nearSunset &&
        (isDeepReservoir || isMurkyWater) &&
        windowOverlap >= 1
      ) {
        timeScore += 2;
      }
    }

    // Preserve spring shallow warming & summer midday oxygen stress interactions
    if (isDaylight && (slotHour === 12 || slotHour === 15)) {
      if (springMiddayBoost > 0) {
        timeScore += springMiddayBoost;
        reasons.push('Весенний прогрев мелководья (+)');
      }
      if (oxygenMiddayPenalty < 0) {
        timeScore += oxygenMiddayPenalty;
        reasons.push('Дневной перегрев воды (−)');
      }
    } else if (slotHour === 3 && oxygenDawnBoost > 0 && !isNocturnal) {
      timeScore += oxygenDawnBoost;
    }
  }

  // 2. Lunar cycle, moonlight penetration, and solunar transits
  let lunarScore = 0;

  if (lunar.solunarWindow === 'major') {
    lunarScore += activeHourMatch !== 'off_peak' || nearSunrise || nearSunset ? 4 : 2;
    reasons.push('Солунарный пик (транзит Луны) (+)');
  } else if (lunar.solunarWindow === 'minor') {
    lunarScore += activeHourMatch !== 'off_peak' ? 2 : 1;
  }

  // Underwater moonlight penetration depends on ice, water clarity, depth, and cloud cover
  const clarityTransmission = isClearWater ? 1.0 : isMurkyWater ? 0.42 : 0.72;
  const depthFactor = isShallow ? 1.1 : isDeepReservoir ? 0.85 : 1.0;
  const cloudFactor = 1 - Math.max(0, Math.min(100, cloudCoverPct)) / 100 * 0.72;
  const moonlightTransmission = isIceRegime
    ? 0.25
    : Math.max(0.15, Math.min(1.0, clarityTransmission * depthFactor * cloudFactor));

  if (lunar.phaseType === 'full_moon') {
    if (!isDaylight) {
      if (lunarPref === 'dark_moon') {
        const glarePenalty = -Math.round(9 * moonlightTransmission);
        lunarScore += glarePenalty;
        if (glarePenalty <= -4) {
          reasons.push('Яркое полнолуние в чистой воде (−)');
        }
      } else if (lunarPref === 'bright_moon') {
        const brightBonus = Math.max(1, Math.round(3 * moonlightTransmission));
        lunarScore += brightBonus;
        if (brightBonus >= 2 && activeHourMatch !== 'off_peak') {
          reasons.push('Лунная ночь благоприятна для вида (+)');
        }
      } else if (moonlightTransmission >= 0.7) {
        lunarScore -= 1;
      }
    } else if (nearSunrise || nearSunset) {
      // Gravitational syzygy push at twilight
      lunarScore += lunarPref === 'dark_moon' && isClearWater && cloudCoverPct < 35 ? 0 : 2;
    }
  } else if (lunar.phaseType === 'new_moon') {
    if (!isDaylight) {
      if (lunarPref === 'dark_moon') {
        const darkBonus = isIceRegime ? 2 : 5;
        lunarScore += darkBonus;
        reasons.push('Тёмная ночь новолуния (+)');
      } else if (activeHourMatch !== 'off_peak') {
        lunarScore += 2;
      }
    } else if (activeHourMatch !== 'off_peak') {
      lunarScore += 3;
      if (nearSunrise || nearSunset || lunar.solunarWindow === 'major') {
        reasons.push('Новолуние: сильный солунарный цикл (+)');
      }
    }
  } else if (lunar.phaseType === 'waxing') {
    if (activeHourMatch !== 'off_peak') {
      lunarScore += lunar.illuminationPct >= 20 && lunar.illuminationPct <= 70 ? 2 : 1;
    }
  } else {
    // waning
    if (lunar.illuminationPct >= 40 && lunar.illuminationPct <= 60) {
      lunarScore -= 1;
    } else if (lunar.illuminationPct <= 35 && !isDaylight && lunarPref === 'dark_moon') {
      lunarScore += isIceRegime ? 1 : 2;
    }
  }

  lunarScore = Math.max(-10, Math.min(9, Math.round(lunarScore)));

  return {
    timeScore: Math.round(timeScore),
    lunarScore,
    activeHourMatch,
    solunarWindow: lunar.solunarWindow,
    reasons,
  };
}

export function estimateWaterTempC(
  weather: WeatherSnapshot,
  waterBody?: Pick<WaterBody, 'type' | 'avg_depth_m' | 'max_depth_m' | 'connected_to'> | null
): { waterTempC: number; isIceRegime: boolean } {
  const tAir = weather.air_temp_c;
  const t7 = weather.avg_air_temp_7d_c;
  const t14 = weather.avg_air_temp_14d_c;

  const avgDepth = waterBody?.avg_depth_m ?? (waterBody?.max_depth_m ? waterBody.max_depth_m * 0.45 : 3.5);
  const isFlowing = waterBody?.type === 'river' || Boolean(waterBody?.connected_to);
  const isShallow = waterBody?.type === 'pond' || waterBody?.type === 'oxbow' || avgDepth < 2.5;
  const isDeep = waterBody?.type === 'reservoir' || waterBody?.type === 'quarry' || avgDepth >= 5.0;

  let baseWater: number;
  if (typeof t7 === 'number' && typeof t14 === 'number') {
    if (isDeep) {
      // High thermal inertia for deep reservoirs/quarries
      baseWater = t14 * 0.68 + t7 * 0.22 + tAir * 0.1 + 1.2;
    } else if (isShallow) {
      // Faster thermal response for shallow ponds/oxbows
      baseWater = t7 * 0.55 + t14 * 0.22 + tAir * 0.23 + 0.6;
    } else {
      baseWater = t14 * 0.45 + t7 * 0.35 + tAir * 0.2 + 0.9;
    }
    if (isFlowing) {
      if (baseWater > 18) baseWater -= 1.3;
      else if (baseWater < 3.5) baseWater += 0.8;
    }
  } else {
    baseWater = weather.water_temp_c;
    if (isDeep && tAir < baseWater - 3) baseWater += 0.7;
    if (isFlowing && baseWater > 18) baseWater -= 0.8;
  }

  const isIceRegime =
    typeof t7 === 'number'
      ? isFlowing
        ? t7 <= -5.5 && tAir <= -1
        : isShallow
          ? t7 <= -1.8 && tAir <= 0.5
          : t7 <= -3.0 && tAir <= 0.5
      : tAir <= -4.5 && weather.water_temp_c <= 2.0;

  if (isIceRegime) {
    // Under-ice water stays near 1.2..2.6 C regardless of harsh air frost
    const underIce = isDeep ? 2.4 : isShallow ? 1.4 : 1.8;
    return { waterTempC: Number(underIce.toFixed(1)), isIceRegime: true };
  }

  const clamped = Math.max(0.8, Math.min(28.5, baseWater));
  return { waterTempC: Number(clamped.toFixed(1)), isIceRegime: false };
}

export function analyzeBarometricWindow(
  hourly: HourlyWeatherPoint[] | undefined,
  targetTimeMs: number,
  fallbackWeather: WeatherSnapshot
): {
  pressureHpa: number;
  delta3h: number;
  delta6h: number;
  delta12h: number;
  stability48h: number;
  trend: WeatherSnapshot['pressure_trend'];
  detailedTrend: SlotPressureTrend;
  isReversal: boolean;
} {
  const classifyDetailedTrend = (
    d3: number,
    d6: number,
    d12: number
  ): SlotPressureTrend => {
    if (d6 <= -4.0 || d12 <= -7.0 || d3 <= -2.5) return 'sharp_drop';
    if (d6 >= 4.0 || d12 >= 7.0 || d3 >= 2.5) return 'sharp_rise';
    if (d6 <= -1.2 || d12 <= -2.5) return 'falling';
    if (d6 >= 1.2 || d12 >= 2.5) return 'rising';
    return 'steady';
  };

  if (!hourly || hourly.length < 3) {
    const delta6h =
      fallbackWeather.pressure_delta_6h ??
      (fallbackWeather.pressure_trend === 'rising'
        ? 1.8
        : fallbackWeather.pressure_trend === 'falling'
          ? -1.8
          : 0);
    const delta3h = Number((delta6h * 0.5).toFixed(1));
    const delta12h = Number((delta6h * 1.4).toFixed(1));
    const stability48h =
      fallbackWeather.pressure_stability_48h ??
      (fallbackWeather.pressure_trend === 'steady' ? 0.84 : 0.58);
    return {
      pressureHpa: fallbackWeather.pressure_hpa,
      delta3h,
      delta6h,
      delta12h,
      stability48h,
      trend: fallbackWeather.pressure_trend,
      detailedTrend: classifyDetailedTrend(delta3h, delta6h, delta12h),
      isReversal: false,
    };
  }

  const findClosest = (ms: number): HourlyWeatherPoint => {
    let best = hourly[0];
    let bestDiff = Math.abs(Date.parse(best.time) - ms);
    for (let i = 1; i < hourly.length; i++) {
      const diff = Math.abs(Date.parse(hourly[i].time) - ms);
      if (diff < bestDiff) {
        best = hourly[i];
        bestDiff = diff;
      }
    }
    return best;
  };

  const pNow = findClosest(targetTimeMs);
  const p3 = findClosest(targetTimeMs - 3 * 3600000);
  const p6 = findClosest(targetTimeMs - 6 * 3600000);
  const p12 = findClosest(targetTimeMs - 12 * 3600000);

  const delta3h = Number((pNow.pressure_hpa - p3.pressure_hpa).toFixed(1));
  const delta6h = Number((pNow.pressure_hpa - p6.pressure_hpa).toFixed(1));
  const delta12h = Number((pNow.pressure_hpa - p12.pressure_hpa).toFixed(1));
  const prior6hDelta = Number((p6.pressure_hpa - p12.pressure_hpa).toFixed(1));
  const isReversal =
    Math.abs(delta6h) >= 2.2 &&
    Math.abs(prior6hDelta) >= 2.2 &&
    Math.sign(delta6h) !== Math.sign(prior6hDelta);

  const window48 = hourly.filter((h) => {
    const t = Date.parse(h.time);
    return t <= targetTimeMs && t >= targetTimeMs - 48 * 3600000;
  });
  let stability48h = fallbackWeather.pressure_stability_48h ?? 0.7;
  if (window48.length >= 6) {
    let minP = Infinity;
    let maxP = -Infinity;
    for (const h of window48) {
      if (h.pressure_hpa < minP) minP = h.pressure_hpa;
      if (h.pressure_hpa > maxP) maxP = h.pressure_hpa;
    }
    const range = maxP - minP;
    stability48h = Number(Math.max(0, Math.min(1, 1 - range / 18)).toFixed(2));
  }

  const trend: WeatherSnapshot['pressure_trend'] =
    delta6h >= 1.2 ? 'rising' : delta6h <= -1.2 ? 'falling' : 'steady';

  return {
    pressureHpa: Math.round(pNow.pressure_hpa),
    delta3h,
    delta6h,
    delta12h,
    stability48h,
    trend,
    detailedTrend: classifyDetailedTrend(delta3h, delta6h, delta12h),
    isReversal,
  };
}

export function computeWaterBodyHabitatModifier(params: {
  waterBody: WaterBody;
  species: FishSpecies;
  weather: WeatherSnapshot;
  isIceRegime?: boolean;
}): { modifier: number; reasons: string[] } {
  const { waterBody: wb, species: sp, weather, isIceRegime = false } = params;
  let modifier = 0;
  const reasons: string[] = [];

  if (sp.water_types.includes(wb.type)) {
    modifier += 3;
    reasons.push(`подходящий тип (${waterBodyTypeRu(wb.type).toLowerCase()})`);
  } else {
    modifier -= 18;
  }

  if (wb.max_depth_m !== null) {
    if (
      wb.max_depth_m >= sp.depth_range_m[0] &&
      (wb.avg_depth_m ?? wb.max_depth_m * 0.5) <= sp.depth_range_m[1] + 2.5
    ) {
      modifier += 2;
      if (wb.has_bathymetry) {
        reasons.push('глубины и бровки');
      }
    } else if (wb.max_depth_m < 0.7 && sp.depth_range_m[0] >= 0.8) {
      modifier -= 18;
    }
  }

  if (wb.ndwi_stability === 'year_round') {
    modifier += 1;
  } else if (wb.ndwi_stability === 'seasonal_low') {
    modifier -= 9;
  } else {
    modifier -= 26;
  }

  if (wb.connected_to) {
    modifier += 2;
    reasons.push('проточный водоём');
  }

  if (wb.vegetation_index === 'algal_bloom') {
    modifier -= 12;
  }

  if (wb.has_bathymetry) {
    modifier += 2;
  }

  if (wb.confidence < 0.7 || wb.moderation_status === 'unverified') {
    modifier -= 8;
  }

  if (sp.id === 'nalim' || sp.id === 'sudak') {
    if ((wb.max_depth_m ?? 0) >= 6) {
      modifier += 2;
    } else if ((wb.max_depth_m ?? 0) < 4) {
      modifier -= 7;
    }
  }
  if (wb.water_clarity === 'clear' && (sp.id === 'okun' || sp.id === 'pike' || sp.id === 'golavl')) {
    modifier += 1;
  } else if (wb.water_clarity === 'murky' && sp.id === 'sudak') {
    modifier -= 4;
  }

  if (wb.area_ha >= 1000 && (sp.id === 'sudak' || sp.id === 'pike' || sp.id === 'lesh')) {
    modifier += 2;
  } else if (wb.area_ha < 2 && (sp.id === 'sudak' || sp.id === 'nalim')) {
    modifier -= 12;
  }

  if (!isIceRegime) {
    if (wb.area_ha > 800 && weather.wind_speed_ms > 7) {
      modifier -= 4;
    } else if (wb.area_ha <= 25 && weather.wind_speed_ms > 5) {
      modifier += 2;
      reasons.push('укрыт от ветра');
    }
  }

  // Cumulative 72h rain increases river turbidity & runoff
  const rain72 = weather.recent_rain_72h_mm ?? 0;
  if (rain72 >= 20 && (wb.type === 'river' || wb.connected_to)) {
    modifier -= rain72 >= 35 ? 8 : 5;
    reasons.push('паводковая мутность (−)');
  }

  // Ichthyofauna presence check when curated catalog exists for the water body
  if (wb.inhabiting_species && wb.inhabiting_species.length > 0) {
    const entry = wb.inhabiting_species.find((item) => item.species_id === sp.id);
    if (entry) {
      if (entry.abundance === 'common') modifier += 2;
    } else {
      modifier -= 14;
      reasons.push('редкий или нетипичный вид для водоёма (−)');
    }
  }

  return { modifier, reasons };
}

export function getExpectedFishForWaterBody(params: {
  waterBody: WaterBody;
  speciesList: FishSpecies[];
  reports?: CatchReport[];
}): WaterBodyFishPresence[] {
  const { waterBody: wb, speciesList, reports = [] } = params;
  const speciesMap = new Map(speciesList.map((s) => [s.id, s]));

  // Count confirmed catches on this specific water body
  const confirmedSpeciesIds = new Set<string>();
  for (const r of reports) {
    if (r.water_body_id === wb.id && r.outcome !== 'no_bite') {
      confirmedSpeciesIds.add(r.fish_species_id);
    }
  }

  const byId = new Map<string, WaterBodyFishPresence>();

  if (wb.inhabiting_species && wb.inhabiting_species.length > 0) {
    for (const item of wb.inhabiting_species) {
      const sp = speciesMap.get(item.species_id);
      if (!sp) continue;
      byId.set(sp.id, {
        species_id: sp.id,
        species_name: sp.name,
        category: sp.category,
        abundance: item.abundance,
        source: confirmedSpeciesIds.has(sp.id) ? 'confirmed_report' : 'catalog',
        note: item.note,
      });
    }
  } else {
    // Strict ecological habitat model for OSM or user-submitted water bodies without a curated catalog
    const fallbackDepthByType: Record<WaterBody['type'], number> = {
      pond: 1.8,
      oxbow: 2.0,
      river: 2.0,
      lake: 3.2,
      quarry: 6.0,
      reservoir: 7.0,
    };
    const maxD = wb.max_depth_m ?? fallbackDepthByType[wb.type];
    const areaHa = Math.max(0, wb.area_ha || 0);
    const isConnected = Boolean(wb.connected_to);

    for (const sp of speciesList) {
      if (!sp.water_types.includes(wb.type)) continue;

      if (wb.ndwi_stability === 'dries_summer' && sp.id !== 'karas' && sp.id !== 'rotan') {
        continue;
      }
      if (maxD < 0.9 && sp.id !== 'karas' && sp.id !== 'rotan') {
        continue;
      }

      // Species-specific hydrobiological habitat gates
      if (sp.id === 'sudak') {
        const okRes = wb.type === 'reservoir' && areaHa >= 120 && maxD >= 5.5;
        const okRiver = wb.type === 'river' && areaHa >= 120 && maxD >= 4.5;
        const okQuarry = wb.type === 'quarry' && areaHa >= 45 && maxD >= 10.0;
        const okLake = wb.type === 'lake' && areaHa >= 300 && maxD >= 6.0;
        if (!okRes && !okRiver && !okQuarry && !okLake) continue;
      } else if (sp.id === 'som') {
        const okRiver = wb.type === 'river' && areaHa >= 180 && maxD >= 6.0;
        const okRes = wb.type === 'reservoir' && areaHa >= 2500 && maxD >= 12.0;
        if (!okRiver && !okRes) continue;
      } else if (sp.id === 'zherekh') {
        const okRiver = wb.type === 'river' && areaHa >= 55 && maxD >= 3.0;
        const okRes = wb.type === 'reservoir' && areaHa >= 800 && maxD >= 6.0;
        if (!okRiver && !okRes) continue;
      } else if (sp.id === 'yaz') {
        const okRiver = wb.type === 'river' && areaHa >= 40 && maxD >= 2.6;
        const okOxbow = wb.type === 'oxbow' && isConnected && areaHa >= 15 && maxD >= 2.2;
        const okRes = wb.type === 'reservoir' && areaHa >= 1500 && maxD >= 6.0;
        if (!okRiver && !okOxbow && !okRes) continue;
      } else if (sp.id === 'nalim') {
        if (wb.water_clarity === 'murky') continue;
        const okRiver = wb.type === 'river' && areaHa >= 35 && maxD >= 2.8;
        const okRes = wb.type === 'reservoir' && areaHa >= 350 && maxD >= 8.0;
        const okLake = wb.type === 'lake' && areaHa >= 40 && maxD >= 9.0 && wb.water_clarity === 'clear';
        if (!okRiver && !okRes && !okLake) continue;
      } else if (sp.id === 'lesh' || sp.id === 'gustera') {
        const okRiver = wb.type === 'river' && areaHa >= 30 && maxD >= 2.4;
        const okLake = wb.type === 'lake' && areaHa >= 20 && maxD >= 3.5;
        const okRes = wb.type === 'reservoir' && areaHa >= 25 && maxD >= 3.5;
        const okQuarry = wb.type === 'quarry' && areaHa >= 35 && maxD >= 5.0;
        if (!okRiver && !okLake && !okRes && !okQuarry) continue;
      } else if (sp.id === 'golavl') {
        if (wb.type !== 'river' || areaHa < 6 || wb.water_clarity === 'murky') continue;
      } else if (sp.id === 'pike') {
        if (maxD < 1.4) continue;
        if (wb.type === 'pond' && areaHa < 2.5 && !isConnected) continue;
      } else if (sp.id === 'okun' || sp.id === 'plotva') {
        if (maxD < 1.2) continue;
        if (wb.type === 'pond' && areaHa < 1.2 && !isConnected) continue;
      } else if (sp.id === 'karp') {
        const okWarmPond = (wb.type === 'pond' || wb.type === 'quarry') && areaHa >= 8 && maxD >= 2.0;
        const okLargeLake = wb.type === 'lake' && areaHa >= 120 && maxD >= 2.5;
        if (!okWarmPond && !okLargeLake) continue;
      } else if (sp.id === 'lin' || sp.id === 'krasnoperka') {
        if (wb.vegetation_index === 'low') continue;
        if (wb.type === 'river' || wb.type === 'quarry') continue;
        if ((wb.type === 'pond' || wb.type === 'oxbow') && (maxD < 1.2 || areaHa < 1.5)) continue;
      } else if (sp.id === 'rotan') {
        const isSmallIsolated = (wb.type === 'pond' || wb.type === 'oxbow') && areaHa <= 12 && !isConnected;
        if (!isSmallIsolated) continue;
      } else if (sp.id === 'karas') {
        if (wb.type === 'river' && (areaHa >= 50 || wb.vegetation_index === 'low')) continue;
      }

      let abundance: WaterBodyFishPresence['abundance'] = 'regular';
      if (wb.type === 'pond' || wb.type === 'oxbow') {
        if (sp.id === 'karas' || (sp.id === 'rotan' && areaHa <= 4)) {
          abundance = 'common';
        } else if ((sp.id === 'okun' || sp.id === 'plotva') && areaHa >= 3 && maxD >= 1.8) {
          abundance = 'common';
        } else if (sp.id === 'karp' || sp.id === 'yaz') {
          abundance = 'rare';
        }
      } else if (wb.type === 'river') {
        if (['plotva', 'okun', 'golavl'].includes(sp.id)) {
          abundance = 'common';
        } else if (sp.id === 'pike' && areaHa >= 20) {
          abundance = 'common';
        } else if (sp.id === 'lesh' && areaHa >= 80 && maxD >= 3.5) {
          abundance = 'common';
        } else if (
          ['som', 'nalim', 'karas'].includes(sp.id) ||
          (sp.id === 'yaz' && areaHa < 100) ||
          (sp.id === 'zherekh' && areaHa < 150) ||
          (sp.id === 'sudak' && areaHa < 250)
        ) {
          abundance = 'rare';
        }
      } else if (wb.type === 'reservoir') {
        if (
          ['okun', 'plotva', 'pike'].includes(sp.id) ||
          (sp.id === 'lesh' && areaHa >= 200) ||
          (sp.id === 'sudak' && areaHa >= 400 && maxD >= 7.0)
        ) {
          abundance = 'common';
        } else if (
          ['som', 'nalim', 'zherekh', 'yaz', 'lin', 'krasnoperka', 'karp'].includes(sp.id) ||
          (sp.id === 'sudak' && (areaHa < 400 || maxD < 7.0))
        ) {
          abundance = 'rare';
        }
      } else if (wb.type === 'lake') {
        if (
          ['okun', 'plotva'].includes(sp.id) ||
          (sp.id === 'pike' && areaHa >= 15) ||
          (sp.id === 'karas' && wb.vegetation_index !== 'low')
        ) {
          abundance = 'common';
        } else if (['sudak', 'nalim', 'karp'].includes(sp.id)) {
          abundance = 'rare';
        }
      } else if (wb.type === 'quarry') {
        if (['okun', 'plotva', 'karas'].includes(sp.id)) {
          abundance = 'common';
        } else if (['sudak', 'karp', 'lesh'].includes(sp.id)) {
          abundance = 'rare';
        }
      }

      byId.set(sp.id, {
        species_id: sp.id,
        species_name: sp.name,
        category: sp.category,
        abundance,
        source: confirmedSpeciesIds.has(sp.id) ? 'confirmed_report' : 'ecological_model',
      });
    }
  }

  // Apply user-verified species confirmations & exclusions (overrides automatic errors)
  const verifiedList = wb.verified_species ?? [];
  for (const v of verifiedList) {
    const sp = speciesMap.get(v.species_id);
    if (!sp) continue;

    if (v.status === 'absent' && !confirmedSpeciesIds.has(v.species_id)) {
      byId.delete(v.species_id);
      continue;
    }

    if (v.status === 'confirmed') {
      const existing = byId.get(v.species_id);
      if (existing) {
        existing.source = confirmedSpeciesIds.has(v.species_id)
          ? 'confirmed_report'
          : 'verified_community';
        if (v.abundance) existing.abundance = v.abundance;
        if (v.note) existing.note = v.note;
        existing.confirm_count = v.confirm_count;
        existing.absent_count = v.absent_count;
      } else {
        byId.set(sp.id, {
          species_id: sp.id,
          species_name: sp.name,
          category: sp.category,
          abundance: v.abundance ?? 'regular',
          source: confirmedSpeciesIds.has(sp.id) ? 'confirmed_report' : 'verified_community',
          confirm_count: v.confirm_count,
          absent_count: v.absent_count,
          note: v.note || 'Подтверждено рыбаками',
        });
      }
    }
  }

  // Ensure any species confirmed by actual catch reports is always included
  for (const spId of confirmedSpeciesIds) {
    const existing = byId.get(spId);
    if (existing) {
      existing.source = 'confirmed_report';
    } else {
      const sp = speciesMap.get(spId);
      if (sp) {
        byId.set(sp.id, {
          species_id: sp.id,
          species_name: sp.name,
          category: sp.category,
          abundance: 'regular',
          source: 'confirmed_report',
          note: 'Подтверждено отчётами рыбаков',
        });
      }
    }
  }

  const abundanceRank: Record<WaterBodyFishPresence['abundance'], number> = {
    common: 0,
    regular: 1,
    rare: 2,
  };

  return [...byId.values()].sort((a, b) => {
    const aConf = a.source === 'confirmed_report' ? 0 : 1;
    const bConf = b.source === 'confirmed_report' ? 0 : 1;
    if (aConf !== bConf) return aConf - bConf;
    if (abundanceRank[a.abundance] !== abundanceRank[b.abundance]) {
      return abundanceRank[a.abundance] - abundanceRank[b.abundance];
    }
    return a.species_name.localeCompare(b.species_name, 'ru');
  });
}

export interface BiologicalPhaseResult {
  phase: 'pre_spawn' | 'spawning' | 'post_spawn' | 'autumn_feed' | 'normal';
  modifier: number;
  label: string | null;
  springMiddayBoost: number;
}

const SPRING_SPAWN_WINDOWS: Record<string, { spawn: [number, number]; months: number[] }> = {
  pike: { spawn: [4.5, 8.0], months: [3, 4, 5] },
  okun: { spawn: [7.5, 11.5], months: [4, 5] },
  zherekh: { spawn: [9.0, 13.0], months: [4, 5] },
  plotva: { spawn: [10.0, 14.0], months: [4, 5, 6] },
  sudak: { spawn: [12.0, 16.0], months: [4, 5, 6] },
  golavl: { spawn: [13.0, 17.0], months: [5, 6] },
  lesh: { spawn: [13.5, 18.0], months: [5, 6] },
  karas: { spawn: [16.0, 19.5], months: [5, 6, 7] },
  karp: { spawn: [18.0, 22.0], months: [5, 6, 7] },
  som: { spawn: [18.5, 22.5], months: [5, 6, 7] },
  lin: { spawn: [19.0, 23.0], months: [6, 7] },
};

export function computeBiologicalPhase(params: {
  species: FishSpecies;
  waterTempC: number;
  weather: WeatherSnapshot;
  date: Date;
  isIceRegime: boolean;
}): BiologicalPhaseResult {
  const { species, waterTempC, weather, date, isIceRegime } = params;
  const month = date.getMonth() + 1;
  const trend7vs14 =
    typeof weather.avg_air_temp_7d_c === 'number' && typeof weather.avg_air_temp_14d_c === 'number'
      ? Number((weather.avg_air_temp_7d_c - weather.avg_air_temp_14d_c).toFixed(1))
      : 0;

  // Spring shallow warming shifts peaceful fish feeding toward warm midday (12:00-15:00)
  const springMiddayBoost =
    !isIceRegime &&
    month >= 3 &&
    month <= 5 &&
    species.category === 'peaceful' &&
    waterTempC >= 5.0 &&
    waterTempC <= 15.5
      ? 5
      : 0;

  // Winter spawner: Burbot (Налим)
  if (species.id === 'nalim') {
    if ((month === 11 || month === 12) && waterTempC >= 2.5 && waterTempC <= 6.5) {
      return {
        phase: 'pre_spawn',
        modifier: 7,
        label: 'Преднерестовый выход налима (+)',
        springMiddayBoost: 0,
      };
    }
    if ((month === 1 || month === 2) && waterTempC <= 2.5) {
      const dayOfMonth = date.getDate();
      if (month === 2 && dayOfMonth >= 18) {
        return {
          phase: 'post_spawn',
          modifier: 6,
          label: 'Посленерестовый жор налима (+)',
          springMiddayBoost: 0,
        };
      }
      return {
        phase: 'spawning',
        modifier: -7,
        label: 'Нерест налима — спад активности (−)',
        springMiddayBoost: 0,
      };
    }
    if (month === 3 && waterTempC <= 4.5) {
      return {
        phase: 'post_spawn',
        modifier: 5,
        label: 'Посленерестовый жор налима (+)',
        springMiddayBoost: 0,
      };
    }
    return { phase: 'normal', modifier: 0, label: null, springMiddayBoost: 0 };
  }

  // Spring & early-summer spawners (by real water temp + warming phase, not calendar alone)
  const cfg = SPRING_SPAWN_WINDOWS[species.id];
  if (cfg && !isIceRegime && month >= 3 && month <= 7 && trend7vs14 >= -1.8) {
    const [sMin, sMax] = cfg.spawn;
    const preMin = Math.max(2.0, sMin - 3.5);
    const postMax = sMax + 3.8;
    const inExtendedWindow =
      cfg.months.includes(month) ||
      cfg.months.includes(month - 1) ||
      cfg.months.includes(month + 1);

    if (inExtendedWindow) {
      if (waterTempC >= sMin && waterTempC <= sMax) {
        return {
          phase: 'spawning',
          modifier: species.category === 'predator' ? -10 : -9,
          label: `Нерест (${sMin.toFixed(0)}–${sMax.toFixed(0)}°C) — спад клёва (−)`,
          springMiddayBoost,
        };
      }
      if (waterTempC >= preMin && waterTempC < sMin) {
        return {
          phase: 'pre_spawn',
          modifier: 6,
          label: 'Преднерестовый жор (+)',
          springMiddayBoost,
        };
      }
      if (waterTempC > sMax && waterTempC <= postMax && month >= cfg.months[0]) {
        return {
          phase: 'post_spawn',
          modifier: species.category === 'predator' ? 7 : 5,
          label: 'Посленерестовый жор (+)',
          springMiddayBoost,
        };
      }
    }
  }

  // Autumn cooling trigger for predators (Sep-Nov when water actively cools)
  if (
    !isIceRegime &&
    month >= 9 &&
    month <= 11 &&
    species.category === 'predator' &&
    waterTempC >= 5.5 &&
    waterTempC <= 13.5 &&
    trend7vs14 <= -1.0
  ) {
    return {
      phase: 'autumn_feed',
      modifier: 4,
      label: 'Осенний предзимний жор (+)',
      springMiddayBoost: 0,
    };
  }

  return { phase: 'normal', modifier: 0, label: null, springMiddayBoost };
}

export interface HydrologyModifierResult {
  modifier: number;
  label: string | null;
}

export function computeHydrologyModifier(params: {
  weather: WeatherSnapshot;
  waterBody?: Pick<WaterBody, 'type' | 'connected_to'> | null;
}): HydrologyModifierResult {
  const { weather, waterBody } = params;
  const q = weather.river_discharge_m3s;
  const ratio = weather.river_discharge_ratio;
  const trend = weather.river_discharge_trend;

  if (typeof ratio !== 'number' || typeof q !== 'number') {
    return { modifier: 0, label: null };
  }

  const isRiver = waterBody?.type === 'river';
  const isConnected = Boolean(waterBody?.connected_to) || waterBody?.type === 'reservoir' || waterBody?.type === 'oxbow';
  if (waterBody && !isRiver && !isConnected) {
    // Isolated ponds/quarries are largely decoupled from regional river discharge
    return { modifier: 0, label: null };
  }

  const weight = isRiver ? 1.0 : 0.6;
  const qStr = `${q.toFixed(1)} м³/с`;

  if (ratio >= 1.6 || (ratio >= 1.35 && trend === 'rising_fast')) {
    return {
      modifier: Math.round(-11 * weight),
      label: `Паводок: расход ×${ratio.toFixed(2)} (${qStr}) (−)`,
    };
  }
  if (trend === 'rising_fast' && ratio >= 1.15) {
    return {
      modifier: Math.round(-7 * weight),
      label: `Быстрый подъём воды (${qStr}) (−)`,
    };
  }
  if (trend === 'falling' && ratio >= 1.05 && ratio <= 1.5) {
    return {
      modifier: Math.round(4 * weight),
      label: `Спад после половодья (${qStr}) (+)`,
    };
  }
  if (trend === 'steady' && ratio >= 0.75 && ratio <= 1.25) {
    return {
      modifier: Math.round(3 * weight),
      label: `Стабильный речной сток (${qStr})`,
    };
  }
  if (ratio < 0.55) {
    return {
      modifier: Math.round(-4 * weight),
      label: `Сильная межень: расход ×${ratio.toFixed(2)} (−)`,
    };
  }

  return { modifier: 0, label: `Сток реки: ${qStr}` };
}

export interface OxygenAndIcePhaseResult {
  modifier: number;
  middayPenalty: number;
  dawnBoost: number;
  icePhase: 'first_ice' | 'midwinter' | 'last_ice' | null;
  oxygenRisk: 'normal' | 'moderate' | 'high';
  label: string | null;
}

export function computeOxygenAndIcePhase(params: {
  species: FishSpecies;
  waterTempC: number;
  weather: WeatherSnapshot;
  waterBody?: Pick<WaterBody, 'type' | 'avg_depth_m' | 'max_depth_m' | 'connected_to' | 'vegetation_index'> | null;
  date: Date;
  isIceRegime: boolean;
}): OxygenAndIcePhaseResult {
  const { species, waterTempC, weather, waterBody, date, isIceRegime } = params;
  const month = date.getMonth() + 1;
  const avgDepth = waterBody?.avg_depth_m ?? (waterBody?.max_depth_m ? waterBody.max_depth_m * 0.45 : 3.5);
  const isFlowing = waterBody?.type === 'river' || Boolean(waterBody?.connected_to);
  const isShallow = waterBody?.type === 'pond' || waterBody?.type === 'oxbow' || avgDepth < 3.0;
  const isAlgalBloom = waterBody?.vegetation_index === 'algal_bloom';

  if (isIceRegime) {
    const avg7 = weather.avg_air_temp_7d_c ?? weather.air_temp_c;
    const avg14 = weather.avg_air_temp_14d_c ?? weather.air_temp_c;

    // First ice: Nov-Dec or fresh freeze where 14d avg was still near/above freezing
    if (month === 11 || month === 12 || (avg14 > -3.0 && avg7 <= -1.8)) {
      return {
        modifier: 6,
        middayPenalty: 0,
        dawnBoost: 0,
        icePhase: 'first_ice',
        oxygenRisk: 'normal',
        label: 'Первый лёд — высокая активность (+)',
      };
    }

    // Last ice: Mar-Apr or late Feb spring thaw with warming trend
    if (month === 3 || month === 4 || (month === 2 && avg7 > avg14 + 2.2 && weather.air_temp_c >= -1.5)) {
      return {
        modifier: 7,
        middayPenalty: 0,
        dawnBoost: 0,
        icePhase: 'last_ice',
        oxygenRisk: 'normal',
        label: 'Последний лёд — приток талой воды (+)',
      };
    }

    // Midwinter (глухозимье): Jan-Feb
    if (!isFlowing && (isShallow || isAlgalBloom)) {
      return {
        modifier: -9,
        middayPenalty: 0,
        dawnBoost: 0,
        icePhase: 'midwinter',
        oxygenRisk: 'high',
        label: 'Глухозимье: дефицит O₂ в непроточном водоёме (−)',
      };
    }
    return {
      modifier: -3,
      middayPenalty: 0,
      dawnBoost: 0,
      icePhase: 'midwinter',
      oxygenRisk: 'moderate',
      label: 'Глухозимье — точечный клёв на глубине',
    };
  }

  // Open water summer heat / thermocline / dissolved oxygen stress
  if (waterTempC >= 22.5) {
    const coldSensitive = ['nalim', 'pike', 'sudak', 'golavl', 'okun'].includes(species.id);
    const lowWind = weather.wind_speed_ms < 2.5;
    const windAerated = weather.wind_speed_ms >= 3.8 && weather.wind_speed_ms <= 8.5;

    const highRisk =
      waterTempC >= 25.0 ||
      isAlgalBloom ||
      (waterTempC >= 23.5 && !isFlowing && (isShallow || lowWind));

    if (highRisk) {
      let mod = coldSensitive ? -9 : -5;
      if (windAerated) mod += 3;
      return {
        modifier: mod,
        middayPenalty: -9,
        dawnBoost: 5,
        icePhase: null,
        oxygenRisk: 'high',
        label: 'Летний термостресс и дефицит O₂ (лучше на рассвете)',
      };
    }

    if (lowWind && !isFlowing) {
      return {
        modifier: coldSensitive ? -5 : -2,
        middayPenalty: -6,
        dawnBoost: 4,
        icePhase: null,
        oxygenRisk: 'moderate',
        label: 'Тёплая вода и слабый ветер — пик на рассвете',
      };
    }
  }

  return {
    modifier: 0,
    middayPenalty: 0,
    dawnBoost: 0,
    icePhase: null,
    oxygenRisk: 'normal',
    label: null,
  };
}

export function computeWindwardShoreHint(
  windDirectionDeg: number,
  windSpeedMs: number,
  isIceRegime = false
): string {
  const fromLabel = windDegreesToLabel(windDirectionDeg);
  const toLabel = windDegreesToLabel((windDirectionDeg + 180) % 360);

  if (windSpeedMs < 2.0) {
    return 'Штиль — прибойный фактор слабый';
  }
  if (isIceRegime) {
    return `На льду комфортнее под защитой ${fromLabel} берега`;
  }
  if (windSpeedMs > 7.5) {
    return `Сильная волна у ${toLabel} берега — укрытие у ${fromLabel} берега`;
  }
  return `Прибойный берег: ${toLabel} (корм и O₂), укрытый: ${fromLabel}`;
}

export interface ForecastAccuracySummary {
  evaluatedCount: number;
  hitRatePct: number | null;
  brierScore: number | null;
  avgCatchF: number | null;
  avgNoBiteF: number | null;
  label: string;
}

export function evaluateForecastAccuracy(reports: CatchReport[]): ForecastAccuracySummary {
  const evaluated = reports.filter(
    (r) => typeof r.predicted_f_index === 'number' && Number.isFinite(r.predicted_f_index)
  );
  if (evaluated.length === 0) {
    return {
      evaluatedCount: 0,
      hitRatePct: null,
      brierScore: null,
      avgCatchF: null,
      avgNoBiteF: null,
      label: 'Добавьте отчёт — модель начнёт сверять точность прогноза',
    };
  }

  let hits = 0;
  let brierSum = 0;
  let catchSum = 0;
  let catchCount = 0;
  let noBiteSum = 0;
  let noBiteCount = 0;

  for (const r of evaluated) {
    const f = Math.max(0, Math.min(100, r.predicted_f_index as number));
    const p = f / 100;
    const isNoBite = r.outcome === 'no_bite';
    const y = isNoBite ? 0 : 1;

    brierSum += (p - y) * (p - y);
    if ((f >= 52 && y === 1) || (f < 52 && y === 0)) {
      hits += 1;
    }

    if (isNoBite) {
      noBiteSum += f;
      noBiteCount += 1;
    } else {
      catchSum += f;
      catchCount += 1;
    }
  }

  const hitRatePct = Math.round((hits / evaluated.length) * 100);
  const brierScore = Number((brierSum / evaluated.length).toFixed(3));
  const avgCatchF = catchCount > 0 ? Math.round(catchSum / catchCount) : null;
  const avgNoBiteF = noBiteCount > 0 ? Math.round(noBiteSum / noBiteCount) : null;

  const label = `Точность ${hitRatePct}% (${evaluated.length} отч. · Brier ${brierScore.toFixed(2)})`;
  return {
    evaluatedCount: evaluated.length,
    hitRatePct,
    brierScore,
    avgCatchF,
    avgNoBiteF,
    label,
  };
}

function classifyWindBand(windMs: number): 'calm' | 'moderate' | 'strong' {
  if (windMs < 2.0) return 'calm';
  if (windMs <= 6.0) return 'moderate';
  return 'strong';
}

function classifyTimeBand(hour: number): 'morning' | 'midday' | 'evening' | 'night' {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4 && h < 10) return 'morning';
  if (h >= 10 && h < 16) return 'midday';
  if (h >= 16 && h < 22) return 'evening';
  return 'night';
}

export function computeReportCalibration(params: {
  waterBody?: WaterBody | null;
  species: FishSpecies;
  weather: WeatherSnapshot;
  reports?: CatchReport[];
  baseDate: Date;
  slotHour?: number;
}): {
  delta: number;
  adaptiveDelta: number;
  reportsUsed: number;
  catchCount: number;
  noBiteCount: number;
  summaryReason: string | null;
  adaptiveNote: string | null;
} {
  const { waterBody, species, weather, reports, baseDate, slotHour } = params;
  if (!reports || reports.length === 0) {
    return {
      delta: 0,
      adaptiveDelta: 0,
      reportsUsed: 0,
      catchCount: 0,
      noBiteCount: 0,
      summaryReason: null,
      adaptiveNote: null,
    };
  }

  const nowMs = baseDate.getTime();
  const maxAgeMs = 21 * 86400000;
  const refPoint: LatLng = waterBody?.center ?? { lat: weather.lat, lng: weather.lng };

  let weightedEvidence = 0;
  let totalWeight = 0;
  let reportsUsed = 0;
  let catchCount = 0;
  let noBiteCount = 0;

  // Adaptive local factor accumulators (learned from reports with weather_snapshot)
  let presMatchScore = 0;
  let presMatchW = 0;
  let windMatchScore = 0;
  let windMatchW = 0;
  let timeMatchScore = 0;
  let timeMatchW = 0;
  let snapshotCount = 0;

  const curWindBand = classifyWindBand(weather.wind_speed_ms);
  const curTimeBand = typeof slotHour === 'number' ? classifyTimeBand(slotHour) : null;

  for (const rep of reports) {
    const ageMs = nowMs - Date.parse(rep.created_at);
    if (Number.isNaN(ageMs) || ageMs < -3600000 || ageMs > maxAgeMs) continue;

    // Spatial relevance: exact water body or nearby within 45 km
    const sameWb = Boolean(waterBody && rep.water_body_id === waterBody.id);
    const distKm = haversineMeters(refPoint, { lat: rep.lat, lng: rep.lng }) / 1000;
    let spatialW = 0;
    if (sameWb) {
      spatialW = 1.0;
    } else if (distKm <= 45) {
      spatialW = 0.45 * Math.exp(-distKm / 30);
    } else {
      continue;
    }

    // Species relevance
    const sameSpecies = rep.fish_species_id === species.id;
    const speciesW = sameSpecies ? 1.0 : 0.28;
    if (!sameSpecies && !sameWb) continue;

    // Exponential recency decay (half-life ~4.5 days)
    const ageDays = Math.max(0, ageMs / 86400000);
    const recencyW = Math.exp(-ageDays / 6.5);

    const isNoBite = rep.outcome === 'no_bite';
    const sign = isNoBite ? -1 : 1;

    // Weather similarity kernel if report saved a meteo vector
    let meteoW = 0.72;
    if (rep.weather_snapshot) {
      const ws = rep.weather_snapshot;
      const dP = (ws.pressure_hpa - weather.pressure_hpa) / 8;
      const dT = (ws.water_temp_c - weather.water_temp_c) / 4.5;
      const dW = (ws.wind_speed_ms - weather.wind_speed_ms) / 4.0;
      const trendBonus = ws.pressure_trend === weather.pressure_trend ? 1.0 : 0.78;
      meteoW = Math.max(0.35, Math.exp(-0.5 * (dP * dP + dT * dT + dW * dW)) * trendBonus);

      const baseLocalW = spatialW * speciesW * recencyW;
      snapshotCount += 1;
      if (ws.pressure_trend === weather.pressure_trend) {
        presMatchScore += sign * baseLocalW;
        presMatchW += baseLocalW;
      }
      if (classifyWindBand(ws.wind_speed_ms) === curWindBand) {
        windMatchScore += sign * baseLocalW;
        windMatchW += baseLocalW;
      }
      if (curTimeBand && typeof ws.hour_local === 'number' && classifyTimeBand(ws.hour_local) === curTimeBand) {
        timeMatchScore += sign * baseLocalW;
        timeMatchW += baseLocalW;
      }
    }

    const weight = spatialW * speciesW * recencyW * meteoW;
    if (weight < 0.05) continue;

    weightedEvidence += sign * weight;
    totalWeight += weight;
    reportsUsed += 1;
    if (isNoBite) noBiteCount += 1;
    else catchCount += 1;
  }

  if (reportsUsed === 0) {
    return {
      delta: 0,
      adaptiveDelta: 0,
      reportsUsed: 0,
      catchCount: 0,
      noBiteCount: 0,
      summaryReason: null,
      adaptiveNote: null,
    };
  }

  // Bayesian shrinkage toward 0 (prior pseudo-count = 2.0 prevents single-report overreaction)
  const shrunk = weightedEvidence / (totalWeight + 2.0);
  const baseDelta = Math.round(shrunk * 16);

  // Adaptive local factor lift requires at least 2 reports with weather snapshots
  let adaptiveDelta = 0;
  let adaptiveNote: string | null = null;
  if (snapshotCount >= 2) {
    const presLift = presMatchW >= 1.1 ? (presMatchScore / (presMatchW + 3.0)) * 4.5 : 0;
    const windLift = windMatchW >= 1.1 ? (windMatchScore / (windMatchW + 3.0)) * 3.5 : 0;
    const timeLift = timeMatchW >= 1.1 ? (timeMatchScore / (timeMatchW + 3.0)) * 3.0 : 0;
    adaptiveDelta = Math.max(-5, Math.min(5, Math.round(presLift + windLift + timeLift)));

    if (Math.abs(adaptiveDelta) >= 2) {
      const topSignal =
        Math.abs(presLift) >= Math.abs(windLift) && Math.abs(presLift) >= Math.abs(timeLift)
          ? weather.pressure_trend === 'steady'
            ? 'при ровном давлении'
            : weather.pressure_trend === 'rising'
              ? 'при росте давления'
              : 'при падении давления'
          : Math.abs(windLift) >= Math.abs(timeLift)
            ? curWindBand === 'moderate'
              ? 'при умеренном ветре'
              : curWindBand === 'calm'
                ? 'в штиль'
                : 'в сильный ветер'
            : 'в текущее время суток';

      adaptiveNote =
        adaptiveDelta > 0
          ? `Адаптация по водоёму: лучше ${topSignal} (+${adaptiveDelta})`
          : `Адаптация по водоёму: слабее ${topSignal} (${adaptiveDelta})`;
    }
  }

  const delta = Math.max(-12, Math.min(12, baseDelta + adaptiveDelta));

  let summaryReason: string | null = null;
  if (delta >= 2) {
    summaryReason = `Калибровка по отчётам: +${delta} (${catchCount} улов.)`;
  } else if (delta <= -2) {
    summaryReason = `Калибровка по отчётам: ${delta} (${noBiteCount} без клёва)`;
  }

  return {
    delta,
    adaptiveDelta,
    reportsUsed,
    catchCount,
    noBiteCount,
    summaryReason,
    adaptiveNote,
  };
}

const RU_WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;

export function formatForecastDayLabel(date: Date, dayOffset: number): string {
  if (dayOffset === 0) return 'Сегодня';
  if (dayOffset === 1) return 'Завтра';
  if (dayOffset === 2) return 'Послезавтра';
  const wd = RU_WEEKDAYS_SHORT[date.getUTCDay()];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${wd}, ${dd}.${mm}`;
}

export function computeFIndexForecast(params: {
  species: FishSpecies;
  weather: WeatherSnapshot;
  baseDate: Date;
  waterBody?: WaterBody | null;
  reports?: CatchReport[];
  days?: number;
}): BiteForecastSlot[] {
  const { species, weather, baseDate, waterBody = null, reports, days = 7 } = params;
  const forecastDays = Math.max(1, Math.min(7, Math.floor(days)));
  const slots: BiteForecastSlot[] = [];
  const [optMin, optMax] = species.optimal_water_temp_c;
  const optMid = (optMin + optMax) / 2;

  const { waterTempC, isIceRegime } = estimateWaterTempC(weather, waterBody);
  const habitat = waterBody
    ? computeWaterBodyHabitatModifier({ waterBody, species, weather, isIceRegime })
    : { modifier: 0, reasons: [] };
  const bioPhase = computeBiologicalPhase({
    species,
    waterTempC,
    weather,
    date: baseDate,
    isIceRegime,
  });
  const hydrology = computeHydrologyModifier({ weather, waterBody });
  const oxygenIce = computeOxygenAndIcePhase({
    species,
    waterTempC,
    weather,
    waterBody,
    date: baseDate,
    isIceRegime,
  });
  const baseCalibration = computeReportCalibration({
    waterBody,
    species,
    weather,
    reports,
    baseDate,
  });

  // Under ice, cold-water winter fish (okun, pike, sudak, plotva, lesh, nalim) adapt to ~1.5-2.5 C
  const winterTolerant = ['pike', 'okun', 'sudak', 'plotva', 'lesh', 'nalim'].includes(species.id);
  const tempDiff = isIceRegime && winterTolerant
    ? Math.max(0, Math.abs(waterTempC - 2.0) + 1.5)
    : Math.abs(waterTempC - optMid);
  const tempFactor = Math.max(0, 22 - tempDiff * 1.7);

  const intervals = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'];
  const hourly = weather.hourly;
  const lat = waterBody?.center.lat ?? weather.lat;
  const lng = waterBody?.center.lng ?? weather.lng;
  const tzOffsetHours = Math.round(lng / 15);

  const findHourlyForSlot = (slotLocalDateStr: string, hour: number): HourlyWeatherPoint | null => {
    if (!hourly || hourly.length === 0) return null;
    const prefix = `${slotLocalDateStr}T${hour.toString().padStart(2, '0')}:`;
    const exact = hourly.find((h) => h.time.startsWith(prefix));
    if (exact) return exact;
    const targetMs = Date.parse(`${slotLocalDateStr}T${hour.toString().padStart(2, '0')}:00:00Z`) - tzOffsetHours * 3600000;
    let best = hourly[0];
    let bestDiff = Math.abs(Date.parse(best.time) - targetMs);
    for (let i = 1; i < hourly.length; i++) {
      const diff = Math.abs(Date.parse(hourly[i].time) - targetMs);
      if (diff < bestDiff) {
        best = hourly[i];
        bestDiff = diff;
      }
    }
    return bestDiff <= 6 * 3600000 ? best : null;
  };

  const findHourlyAtMs = (targetMs: number): HourlyWeatherPoint | null => {
    if (!hourly || hourly.length === 0) return null;
    let best = hourly[0];
    let bestDiff = Math.abs(Date.parse(best.time) - targetMs);
    for (let i = 1; i < hourly.length; i++) {
      const diff = Math.abs(Date.parse(hourly[i].time) - targetMs);
      if (diff < bestDiff) {
        best = hourly[i];
        bestDiff = diff;
      }
    }
    return bestDiff <= 4 * 3600000 ? best : null;
  };

  const clarity = waterBody?.water_clarity ?? 'moderate';
  const baroSensitiveSpecies = species.category === 'peaceful' || species.id === 'sudak';

  for (let dayOffset = 0; dayOffset < forecastDays; dayOffset++) {
    const d = new Date(baseDate.getTime() + dayOffset * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayLabel = formatForecastDayLabel(d, dayOffset);
    const month = d.getMonth() + 1;
    const seasonScore = species.season_activity[month] ?? 55;
    const sun = computeSunTimes(lat, lng, d);

    for (let i = 0; i < intervals.length; i++) {
      const hour = i * 3;
      const slotWeather = findHourlyForSlot(dateStr, hour);
      const slotTimeMs = slotWeather
        ? Date.parse(slotWeather.time)
        : Date.parse(`${dateStr}T${hour.toString().padStart(2, '0')}:00:00Z`) - tzOffsetHours * 3600000;

      const baro = analyzeBarometricWindow(hourly, slotTimeMs, weather);
      const slotWind = slotWeather?.wind_speed_ms ?? weather.wind_speed_ms;
      const slotGusts = slotWeather?.wind_gusts_ms ?? weather.wind_gusts_ms;
      const slotWindDeg = slotWeather?.wind_direction_deg ?? weather.wind_direction_deg;
      const slotWindLabel = windDegreesToLabel(slotWindDeg);
      const slotCloud = slotWeather?.cloud_cover_pct ?? weather.cloud_cover_pct ?? 55;
      const slotRad = slotWeather?.shortwave_radiation_wm2 ?? weather.shortwave_radiation_wm2;
      const slotPrecip = slotWeather?.precipitation_mm ?? weather.precipitation_mm;
      const slotAirTemp = slotWeather?.temp_c ?? weather.air_temp_c;

      // 48h air temperature front delta for this slot
      const prev48Point = findHourlyAtMs(slotTimeMs - 48 * 3600000);
      const deltaT48 =
        prev48Point && slotWeather
          ? Number((slotAirTemp - prev48Point.temp_c).toFixed(1))
          : weather.air_temp_delta_48h_c;

      // 1. Barometric dynamics (3h/6h/12h trend velocity, sharp swings, reversals & 48h stability)
      let baroScore = 6;
      const factors: string[] = [];
      if (baro.detailedTrend === 'sharp_drop') {
        baroScore = baroSensitiveSpecies ? -15 : -12;
        const deltaStr =
          Math.abs(baro.delta6h) >= 4.0
            ? `${baro.delta6h} гПа/6ч`
            : Math.abs(baro.delta12h) >= 7.0
              ? `${baro.delta12h} гПа/12ч`
              : `${baro.delta3h} гПа/3ч`;
        factors.push(`Резкий скачок давления (${deltaStr}) (−)`);
      } else if (baro.detailedTrend === 'sharp_rise') {
        baroScore = baroSensitiveSpecies ? -13 : -11;
        const deltaStr =
          Math.abs(baro.delta6h) >= 4.0
            ? `+${baro.delta6h} гПа/6ч`
            : Math.abs(baro.delta12h) >= 7.0
              ? `+${baro.delta12h} гПа/12ч`
              : `+${baro.delta3h} гПа/3ч`;
        factors.push(`Резкий скачок давления (${deltaStr}) (−)`);
      } else if (baro.isReversal) {
        baroScore = baroSensitiveSpecies ? -9 : -6;
        factors.push('Перелом давления (резкая смена тренда) (−)');
      } else if (baro.delta6h <= -0.8 && baro.delta6h >= -2.8 && species.category === 'predator') {
        baroScore = 11;
        factors.push('Предфронтальное падение давления (+)');
      } else if (
        baro.stability48h >= 0.72 &&
        Math.abs(baro.delta6h) < 1.4 &&
        Math.abs(baro.delta12h) < 2.8
      ) {
        baroScore = 14;
        factors.push('Стабильное давление 48 ч');
      } else if (baro.delta6h >= 0.8 && baro.delta6h <= 3.2) {
        baroScore = 9;
        factors.push('Устойчивый рост давления');
      } else if (baro.delta6h < -2.8 || baro.delta12h <= -4.5) {
        baroScore = baroSensitiveSpecies ? -6 : -3;
        factors.push(`Быстрое падение давления (${baro.delta6h} гПа/6ч) (−)`);
      } else if (baro.detailedTrend === 'steady') {
        baroScore = 11;
        factors.push('Ровное давление');
      } else if (baro.detailedTrend === 'falling') {
        baroScore = species.category === 'peaceful' ? 1 : 4;
        factors.push('Снижение давления (−)');
      } else {
        baroScore = 6;
        factors.push('Рост давления');
      }

      // 2. Wind speed, gusts + wind direction
      let windScore = 0;
      const windThreshold = isIceRegime ? 11 : 9;
      if (slotWind > windThreshold) {
        windScore -= isIceRegime ? 6 : 13;
        factors.push(`Сильный ветер ${slotWind.toFixed(1)} м/с (−)`);
      } else if (slotWind >= 1.8 && slotWind <= 5.5) {
        windScore += 7;
        factors.push('Умеренный ветер');
      } else if (slotWind < 1.0 && species.category === 'predator' && !isIceRegime) {
        windScore -= 2; // Flat calm makes wary predators more cautious
      } else {
        windScore += 2;
      }

      if (typeof slotGusts === 'number') {
        if (!isIceRegime && slotGusts >= 17) {
          windScore -= 9;
          factors.push(`Шквалистые порывы до ${Math.round(slotGusts)} м/с (−)`);
        } else if (!isIceRegime && slotGusts >= 13) {
          windScore -= 6;
          factors.push(`Порывы ветра до ${Math.round(slotGusts)} м/с (−)`);
        } else if (isIceRegime && slotGusts >= 15) {
          windScore -= 4;
          factors.push(`Порывистый ветер на льду (−)`);
        }
      }

      if (['Ю', 'ЮЗ', 'З'].includes(slotWindLabel)) {
        windScore += 3;
      } else if (['С', 'СВ', 'В'].includes(slotWindLabel) && species.id !== 'nalim') {
        windScore -= 3;
        factors.push(`Холодный ветер (${slotWindLabel}) (−)`);
      }

      // 3. Cloud cover, real solar radiation × water clarity, and precipitation
      let skyScore = 0;
      if (slotPrecip >= 3.0) {
        skyScore -= 9;
        factors.push('Сильные осадки (−)');
      } else if (slotPrecip >= 0.2 && slotPrecip <= 1.5 && species.category === 'predator') {
        skyScore += 3;
      }

      const isDaylight = hour >= sun.sunriseHour - 0.5 && hour <= sun.sunsetHour + 0.5;
      if (isDaylight) {
        if (typeof slotRad === 'number') {
          const lightSensitive = ['sudak', 'nalim', 'som', 'pike'].includes(species.id);
          if (lightSensitive && !isIceRegime) {
            if (clarity === 'clear' && slotRad >= 450) {
              skyScore -= species.id === 'sudak' || species.id === 'nalim' ? 8 : 6;
              factors.push('Яркое солнце в чистой воде (−)');
            } else if (slotRad >= 620) {
              skyScore -= 4;
            } else if (slotRad >= 15 && slotRad <= 165) {
              skyScore += 4;
              factors.push('Мягкая освещённость (+)');
            }
          } else if (species.category === 'peaceful' && (month <= 5 || month >= 9) && slotRad >= 280) {
            skyScore += 3;
          }
        } else if (slotCloud >= 65 && species.category === 'predator') {
          skyScore += 4;
          factors.push('Пасмурно — комфортно хищнику');
        } else if (slotCloud <= 25 && species.category === 'predator' && Math.abs(hour - 12) <= 3 && !isIceRegime) {
          skyScore -= 4;
        } else if (slotCloud <= 35 && species.category === 'peaceful' && (month <= 5 || month >= 9)) {
          skyScore += 3;
        }
      }

      // 4. Weather fronts & 48h air temperature shock
      let frontScore = 0;
      if (typeof deltaT48 === 'number') {
        if (!isIceRegime && deltaT48 <= -7.0) {
          if (species.id === 'nalim') {
            frontScore += 3;
          } else if (species.category === 'peaceful') {
            frontScore -= deltaT48 <= -10.0 ? 11 : 8;
            factors.push(`Холодный фронт (${deltaT48}°/48ч) (−)`);
          } else {
            frontScore -= deltaT48 <= -10.0 ? 6 : 4;
            factors.push(`Резкое похолодание (${deltaT48}°/48ч) (−)`);
          }
        } else if (isIceRegime && deltaT48 >= 6.0 && winterTolerant) {
          frontScore += 5;
          factors.push(`Зимняя оттепель (+${deltaT48}°/48ч) (+)`);
        }
      }

      // 5 & 6. Species active_hours time-of-day behavior + lunar cycle & solunar transit analysis
      const lunar = computeLunarCycleState({
        date: d,
        slotHour: hour,
        weatherMoonIllumination: weather.moon_illumination,
        weatherMoonPhase: weather.moon_phase,
        useWeatherOverride: dayOffset === 0,
      });

      const lunarTimeEval = evaluateLunarAndTimeOfDayActivity({
        species,
        slotHour: hour,
        sun,
        lunar,
        waterBody,
        cloudCoverPct: slotCloud,
        isIceRegime,
        isDaylight,
        oxygenDawnBoost: oxygenIce.dawnBoost,
        oxygenMiddayPenalty: oxygenIce.middayPenalty,
        springMiddayBoost: bioPhase.springMiddayBoost,
      });

      for (const reason of lunarTimeEval.reasons) {
        factors.push(reason);
      }

      // Surface ecological/hydrological/calibration highlights
      if (bioPhase.label) factors.push(bioPhase.label);
      if (hydrology.modifier <= -4 || hydrology.modifier >= 3) {
        if (hydrology.label) factors.push(hydrology.label);
      }
      if (oxygenIce.label) factors.push(oxygenIce.label);
      if (baseCalibration.summaryReason) {
        factors.push(baseCalibration.summaryReason);
      }

      // Slight habitat & calibration shift applied smoothly (avoid overwhelming base curve)
      const habitatShift = waterBody ? Math.max(-18, Math.min(8, Math.round(habitat.modifier * 0.6))) : 0;

      const raw =
        seasonScore * 0.42 +
        tempFactor +
        baroScore +
        windScore +
        skyScore +
        frontScore +
        lunarTimeEval.timeScore +
        lunarTimeEval.lunarScore +
        bioPhase.modifier +
        hydrology.modifier +
        oxygenIce.modifier +
        habitatShift +
        baseCalibration.delta;

      const f_index = Math.max(8, Math.min(95, Math.round(raw)));

      slots.push({
        date: dateStr,
        day_label: dayLabel,
        hour_interval: intervals[i],
        f_index,
        probability_label: probabilityLabelFromScore(f_index),
        factors: factors.slice(0, 5),
        temp_c: Number(slotAirTemp.toFixed(1)),
        wind_speed_ms: Number(slotWind.toFixed(1)),
        wind_gusts_ms: typeof slotGusts === 'number' ? Number(slotGusts.toFixed(1)) : undefined,
        pressure_mmhg: Math.round(baro.pressureHpa * 0.75006),
        pressure_hpa: baro.pressureHpa,
        pressure_delta_6h: baro.delta6h,
        pressure_delta_12h: baro.delta12h,
        pressure_trend: baro.detailedTrend,
        cloud_cover_pct: Math.round(slotCloud),
        radiation_wm2: typeof slotRad === 'number' ? Math.round(slotRad) : undefined,
        moon_phase_label: lunar.phaseLabel,
        moon_illumination: lunar.illuminationPct,
        solunar_window: lunarTimeEval.solunarWindow,
        active_hour_match: lunarTimeEval.activeHourMatch,
      });
    }
  }
  return slots;
}

export function buildBiteForecastMetadata(params: {
  weather: WeatherSnapshot;
  species: FishSpecies;
  waterBody?: WaterBody | null;
  reports?: CatchReport[];
  baseDate: Date;
}): Pick<
  BiteForecastResponse,
  | 'confidence_level'
  | 'confidence_score'
  | 'confidence_label'
  | 'calibration_delta'
  | 'calibration_reports_used'
  | 'regime'
  | 'sunrise'
  | 'sunset'
  | 'estimated_water_temp_c'
  | 'bio_phase_label'
  | 'ice_phase'
  | 'oxygen_risk'
  | 'oxygen_label'
  | 'hydrology_label'
  | 'windward_shore_hint'
  | 'adaptive_factors_note'
  | 'lunar_summary'
> {
  const { weather, species, waterBody = null, reports, baseDate } = params;
  const lat = waterBody?.center.lat ?? weather.lat;
  const lng = waterBody?.center.lng ?? weather.lng;
  const sun = computeSunTimes(lat, lng, baseDate);
  const { waterTempC, isIceRegime } = estimateWaterTempC(weather, waterBody);
  const bioPhase = computeBiologicalPhase({
    species,
    waterTempC,
    weather,
    date: baseDate,
    isIceRegime,
  });
  const hydrology = computeHydrologyModifier({ weather, waterBody });
  const oxygenIce = computeOxygenAndIcePhase({
    species,
    waterTempC,
    weather,
    waterBody,
    date: baseDate,
    isIceRegime,
  });
  const calibration = computeReportCalibration({
    waterBody,
    species,
    weather,
    reports,
    baseDate,
    slotHour: baseDate.getHours(),
  });
  const shoreHint = computeWindwardShoreHint(
    weather.wind_direction_deg,
    weather.wind_speed_ms,
    isIceRegime
  );

  const lunarNow = computeLunarCycleState({
    date: baseDate,
    slotHour: baseDate.getHours(),
    weatherMoonIllumination: weather.moon_illumination,
    weatherMoonPhase: weather.moon_phase,
    useWeatherOverride: true,
  });
  const activeHoursRange = formatActiveHoursRanges(resolveSpeciesActiveHours(species));
  const lunarPref = resolveSpeciesLunarPreference(species);
  const majorStr = lunarNow.majorHours
    .map((h) => formatHourMinute(h))
    .sort()
    .join(' и ');
  let lunarBehaviorNote = `окна активности вида «${species.name}»: ${activeHoursRange}`;
  if (lunarNow.phaseType === 'full_moon' && lunarPref === 'dark_moon' && !isIceRegime) {
    lunarBehaviorNote = `яркий свет луны ослабляет ночной выход («${species.name}»), лучше ловить на границе сумерек (${activeHoursRange})`;
  } else if (lunarNow.phaseType === 'new_moon' && lunarPref === 'dark_moon') {
    lunarBehaviorNote = `тёмная ночь усиливает выход вида «${species.name}» (${activeHoursRange})`;
  } else if (lunarNow.phaseType === 'full_moon' && lunarPref === 'bright_moon') {
    lunarBehaviorNote = `лунная ночь благоприятна для вида «${species.name}» (${activeHoursRange})`;
  }
  const lunarSummary = `${lunarNow.phaseLabel} (${lunarNow.illuminationPct}%): ${lunarBehaviorNote}; солунарные транзиты ~${majorStr}.`;

  const hasHourly = Boolean(weather.hourly && weather.hourly.length >= 24);
  const has14dHistory = typeof weather.avg_air_temp_14d_c === 'number';
  const hasFlood = typeof weather.river_discharge_m3s === 'number';
  const isLive = weather.source !== 'offline-fallback';

  let score = isLive ? (hasHourly && has14dHistory ? 76 : 62) : 38;
  if (hasFlood && (waterBody?.type === 'river' || waterBody?.connected_to)) score += 3;
  if (waterBody && waterBody.moderation_status === 'verified') score += 6;
  if (waterBody?.has_bathymetry) score += 4;
  if (calibration.reportsUsed > 0) {
    score += Math.min(12, calibration.reportsUsed * 4);
  }
  score = Math.max(25, Math.min(97, score));

  const level: 'high' | 'medium' | 'low' = score >= 75 ? 'high' : score >= 52 ? 'medium' : 'low';
  const parts: string[] = [];
  if (isLive && hasHourly) parts.push('Open-Meteo 14 дн.');
  else if (isLive) parts.push('текущий Open-Meteo');
  else parts.push('офлайн-модель');

  if (hasFlood && (waterBody?.type === 'river' || waterBody?.connected_to)) {
    parts.push('сток рек');
  }
  if (calibration.reportsUsed > 0) {
    parts.push(`калибровка (${calibration.reportsUsed} отч.)`);
  }

  const prefix =
    level === 'high'
      ? 'Высокая точность'
      : level === 'medium'
        ? 'Средняя точность'
        : 'Ориентировочно';

  return {
    confidence_level: level,
    confidence_score: score,
    confidence_label: `${prefix}: ${parts.join(' + ')}`,
    calibration_delta: calibration.delta,
    calibration_reports_used: calibration.reportsUsed,
    regime: isIceRegime ? 'ice' : 'open_water',
    sunrise: sun.sunriseStr,
    sunset: sun.sunsetStr,
    estimated_water_temp_c: waterTempC,
    bio_phase_label: bioPhase.label,
    ice_phase: oxygenIce.icePhase,
    oxygen_risk: oxygenIce.oxygenRisk,
    oxygen_label: oxygenIce.label,
    hydrology_label: hydrology.label,
    windward_shore_hint: shoreHint,
    adaptive_factors_note: calibration.adaptiveNote,
    lunar_summary: lunarSummary,
  };
}

export function applySpeciesVerificationVote(params: {
  existing: VerifiedSpeciesEntry[] | undefined;
  speciesId: string;
  action: 'confirm' | 'absent';
  actorId: string;
  authorNickname?: string;
  abundance?: FishAbundance;
  note?: string;
  nowIso?: string;
}): VerifiedSpeciesEntry[] {
  const list = [...(params.existing ?? [])];
  const nowIso = params.nowIso ?? new Date().toISOString();
  const idx = list.findIndex((item) => item.species_id === params.speciesId);

  const current: VerifiedSpeciesEntry =
    idx >= 0
      ? {
          ...list[idx],
          confirmed_by: [...(list[idx].confirmed_by ?? [])],
          absent_by: [...(list[idx].absent_by ?? [])],
        }
      : {
          species_id: params.speciesId,
          status: params.action === 'confirm' ? 'confirmed' : 'absent',
          confirm_count: 0,
          absent_count: 0,
          confirmed_by: [],
          absent_by: [],
          updated_at: nowIso,
        };

  const confirmedBy = new Set(current.confirmed_by ?? []);
  const absentBy = new Set(current.absent_by ?? []);

  if (params.action === 'confirm') {
    absentBy.delete(params.actorId);
    confirmedBy.add(params.actorId);
    if (params.abundance) current.abundance = params.abundance;
  } else {
    confirmedBy.delete(params.actorId);
    absentBy.add(params.actorId);
  }

  const confirmCount = Math.max(confirmedBy.size, params.action === 'confirm' ? Math.max(1, confirmedBy.size) : confirmedBy.size);
  const absentCount = Math.max(absentBy.size, params.action === 'absent' ? Math.max(1, absentBy.size) : absentBy.size);

  current.confirmed_by = Array.from(confirmedBy).slice(-200);
  current.absent_by = Array.from(absentBy).slice(-200);
  current.confirm_count = confirmCount;
  current.absent_count = absentCount;
  current.status = absentCount > confirmCount ? 'absent' : 'confirmed';
  if (params.note && params.note.trim().length > 0) {
    current.note = params.note.trim().slice(0, 180);
  }
  if (params.authorNickname) {
    current.last_author = params.authorNickname;
  }
  current.updated_at = nowIso;

  if (idx >= 0) {
    list[idx] = current;
  } else {
    list.push(current);
  }
  return list;
}

export function getExcludedVerifiedSpecies(params: {
  waterBody: WaterBody;
  speciesList: FishSpecies[];
  reports?: CatchReport[];
}): Array<{ species_id: string; species_name: string; absent_count: number; note?: string }> {
  const { waterBody: wb, speciesList, reports = [] } = params;
  const confirmedByReport = new Set(
    reports
      .filter((r) => r.water_body_id === wb.id && r.outcome !== 'no_bite')
      .map((r) => r.fish_species_id)
  );
  const spMap = new Map(speciesList.map((s) => [s.id, s]));
  return (wb.verified_species ?? [])
    .filter((v) => v.status === 'absent' && !confirmedByReport.has(v.species_id))
    .map((v) => ({
      species_id: v.species_id,
      species_name: spMap.get(v.species_id)?.name ?? v.species_id,
      absent_count: v.absent_count,
      note: v.note,
    }));
}

export function evaluateGoodBiteWaterBodies(params: {
  origin: LatLng;
  waterBodies: WaterBody[];
  speciesList: FishSpecies[];
  weather: WeatherSnapshot;
  reports: CatchReport[];
  baseDate: Date;
  radiusKm?: number;
  fishId?: string;
  dayLabel?: 'Сегодня' | 'Завтра';
  minFIndex?: number;
  regionId?: string;
  majorOnly?: boolean;
}): GoodBiteWaterBodyItem[] {
  const {
    origin,
    waterBodies,
    speciesList,
    weather,
    reports,
    baseDate,
    radiusKm = 100,
    fishId = 'all',
    dayLabel = 'Сегодня',
    minFIndex = 66,
    regionId = 'all',
    majorOnly = false,
  } = params;

  if (speciesList.length === 0 || waterBodies.length === 0) return [];

  const targetSpeciesPool =
    fishId !== 'all'
      ? speciesList.filter((s) => s.id === fishId)
      : speciesList;
  if (targetSpeciesPool.length === 0) return [];

  // Precompute baseline meteorological peak per species for the chosen day
  const speciesPeakMap = new Map<string, { peak: BiteForecastSlot; species: FishSpecies }>();
  for (const sp of targetSpeciesPool) {
    const slots = computeFIndexForecast({ species: sp, weather, baseDate, days: 3 }).filter(
      (s) => s.day_label === dayLabel
    );
    const peak = slots.reduce(
      (best, cur) => (cur.f_index > best.f_index ? cur : best),
      slots[0]
    );
    if (peak) {
      speciesPeakMap.set(sp.id, { peak, species: sp });
    }
  }

  const recentThresholdMs = baseDate.getTime() - 14 * 86400000;
  const results: GoodBiteWaterBodyItem[] = [];

  for (const wb of waterBodies) {
    if (regionId && regionId !== 'all' && !matchesWaterBodyRegion(wb, regionId)) continue;
    if (majorOnly && !isMajorWaterBody(wb)) continue;

    const distKm = Number((haversineMeters(origin, wb.center) / 1000).toFixed(1));
    // When a specific region is chosen, allow viewing its water bodies even beyond the 100 km radius from origin
    if ((!regionId || regionId === 'all') && distKm > radiusKm) continue;

    const absentVerifiedSet = new Set(
      (wb.verified_species ?? []).filter((v) => v.status === 'absent').map((v) => v.species_id)
    );
    const { isIceRegime } = estimateWaterTempC(weather, wb);
    let bestCandidate: GoodBiteWaterBodyItem | null = null;

    for (const sp of targetSpeciesPool) {
      if (absentVerifiedSet.has(sp.id)) continue;
      const entry = speciesPeakMap.get(sp.id);
      if (!entry) continue;

      const { modifier: habMod, reasons } = computeWaterBodyHabitatModifier({
        waterBody: wb,
        species: sp,
        weather,
        isIceRegime,
      });
      let modifier = habMod;

      // Calibrate with recent catch AND no_bite reports
      const calibration = computeReportCalibration({
        waterBody: wb,
        species: sp,
        weather,
        reports,
        baseDate,
      });
      modifier += calibration.delta;
      if (calibration.summaryReason) {
        reasons.push(calibration.summaryReason);
      }

      const wbCatchReports = reports.filter(
        (r) =>
          r.water_body_id === wb.id &&
          r.visibility !== 'private' &&
          r.outcome !== 'no_bite' &&
          new Date(r.created_at).getTime() >= recentThresholdMs
      );
      const matchingSpeciesReports = wbCatchReports.filter((r) => r.fish_species_id === sp.id);

      if (weather.pressure_trend === 'steady') {
        reasons.push('стабильное давление');
      } else if (weather.pressure_trend === 'rising') {
        reasons.push('рост давления');
      }

      const finalScore = Math.max(8, Math.min(95, Math.round(entry.peak.f_index + modifier)));
      const candidate: GoodBiteWaterBodyItem = {
        water_body: wb,
        distance_km: distKm,
        f_index: finalScore,
        probability_label: probabilityLabelFromScore(finalScore),
        best_species_id: sp.id,
        best_species_name: sp.name,
        peak_hour: entry.peak.hour_interval,
        day_label: dayLabel,
        recent_reports_count: matchingSpeciesReports.length,
        reasons: reasons.slice(0, 3),
      };

      if (!bestCandidate || candidate.f_index > bestCandidate.f_index) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestCandidate.f_index >= minFIndex) {
      results.push(bestCandidate);
    }
  }

  return results.sort((a, b) => {
    if (b.f_index !== a.f_index) return b.f_index - a.f_index;
    return a.distance_km - b.distance_km;
  });
}

export function analyzeWaterBody(params: {
  waterBody: WaterBody;
  crowdReportCount: number;
  snapshotDate?: string;
}): WaterBodyAnalysis {
  const { waterBody, crowdReportCount, snapshotDate = '2026-10-18' } = params;
  const reasons: WaterBodyAnalysis['reasons'] = [];
  let score = 45;

  if (waterBody.connected_to) {
    score += 22;
    reasons.push({
      factor: 'Связь с водотоком',
      impact: '+',
      detail: `связан с ${waterBody.connected_name ?? 'ручьём / рекой'} (+)`,
    });
  } else {
    score -= 14;
    reasons.push({
      factor: 'Изолированность',
      impact: '-',
      detail: 'изолированный водоём без протоки (−)',
    });
  }

  if (waterBody.area_ha >= 0.5) {
    score += 14;
    reasons.push({
      factor: 'Площадь акватории',
      impact: '+',
      detail: `площадь ${waterBody.area_ha.toFixed(2).replace('.', ',')} га (+)`,
    });
  } else if (waterBody.area_ha < 0.1) {
    score -= 22;
    reasons.push({
      factor: 'Малая площадь',
      impact: '-',
      detail: `площадь ${waterBody.area_ha.toFixed(2).replace('.', ',')} га < 0,1 га (−)`,
    });
  } else {
    score -= 5;
    reasons.push({
      factor: 'Площадь акватории',
      impact: '-',
      detail: `площадь ${waterBody.area_ha.toFixed(2).replace('.', ',')} га (−)`,
    });
  }

  if (waterBody.ndwi_stability === 'year_round') {
    score += 12;
    reasons.push({
      factor: 'Стабильность воды (NDWI)',
      impact: '+',
      detail: 'вода круглый год (+)',
    });
  } else if (waterBody.ndwi_stability === 'seasonal_low') {
    score -= 6;
    reasons.push({
      factor: 'Сезонное обмеление',
      impact: '-',
      detail: 'снижение уровня в межень (−)',
    });
  } else {
    score -= 26;
    reasons.push({
      factor: 'Пересыхание',
      impact: '-',
      detail: 'пересыхает летом по Sentinel-2 (−)',
    });
  }

  if (waterBody.max_depth_m !== null) {
    if (waterBody.max_depth_m >= 1.5) {
      score += 10;
      reasons.push({
        factor: 'Глубина котловины',
        impact: '+',
        detail: `глубина до ${waterBody.max_depth_m.toFixed(1).replace('.', ',')} м (+)`,
      });
    } else if (waterBody.max_depth_m < 0.5) {
      score -= 18;
      reasons.push({
        factor: 'Мелководье',
        impact: '-',
        detail: `глубина < 0,5 м (−)`,
      });
    }
  }

  if (waterBody.vegetation_index === 'moderate') {
    score += 6;
    reasons.push({
      factor: 'Кормовая база (индекс растительности)',
      impact: '+',
      detail: 'умеренная продуктивность (+)',
    });
  } else if (waterBody.vegetation_index === 'algal_bloom') {
    score -= 12;
    reasons.push({
      factor: 'Цветение / заморный риск',
      impact: '-',
      detail: 'избыточный хлорофилл (−)',
    });
  }

  if (crowdReportCount > 0) {
    score += Math.min(12, crowdReportCount * 4);
    reasons.push({
      factor: 'Исторические отметки',
      impact: '+',
      detail: `отметок уловов: ${crowdReportCount} (+)`,
    });
  }

  const clamped = Math.max(5, Math.min(95, Math.round(score)));
  const fish_probability: WaterBodyAnalysis['fish_probability'] =
    clamped >= 65 ? 'high' : clamped >= 40 ? 'medium' : 'low';

  const recommendation =
    fish_probability === 'high'
      ? 'Рекомендуем проверить бровки у втока, прибрежную растительность и русловые перепады.'
      : fish_probability === 'medium'
        ? 'Рекомендуем проверить бровки у втока и более глубокие участки у плотины/выхода.'
        : 'Вероятность стабильной популяции низкая; возможен лишь неприхотливый карась или ротан. Проверьте уровень воды на месте.';

  return {
    id: `analysis-${waterBody.id}`,
    water_body_id: waterBody.id,
    analyzed_at: new Date().toISOString(),
    fish_probability,
    score: clamped,
    reasons,
    recommendation,
    disclaimer:
      'Оценка носит вероятностный характер, не гарантирует наличие рыбы и не заменяет разведку на месте.',
    satellite_snapshot_date: snapshotDate,
    model_version: 'rules-v1.0-ndwi-dem',
  };
}

export function detectProspectiveZones(points: BathymetryPoint[]): ProspectiveZone[] {
  if (points.length < 2) return [];
  const zones: ProspectiveZone[] = [];
  const usedIds = new Set<string>();

  // 1. Detect local maxima in depth (ямы / local depth minima in elevation)
  const sortedByDepth = [...points].sort((a, b) => b.depth_m - a.depth_m);
  for (const pt of sortedByDepth) {
    if (pt.depth_m < 3.0) break;
    const neighbors = points.filter(
      (other) => other.id !== pt.id && haversineMeters(pt, other) < 450
    );
    const isDeepestLocal =
      neighbors.length === 0 || neighbors.every((n) => pt.depth_m >= n.depth_m - 0.1);
    if (isDeepestLocal && !usedIds.has(pt.id)) {
      const tooCloseToExistingHole = zones.some(
        (z) => z.kind === 'hole' && haversineMeters(z, pt) < 350
      );
      if (!tooCloseToExistingHole) {
        usedIds.add(pt.id);
        zones.push({
          id: `hole-${pt.id}`,
          kind: 'hole',
          label: `Яма ${pt.depth_m.toFixed(1)} м`,
          lat: pt.lat,
          lng: pt.lng,
          depth_m: pt.depth_m,
        });
      }
    }
    if (zones.filter((z) => z.kind === 'hole').length >= 4) break;
  }

  // 2. Detect sharp depth drop-offs (бровки) between adjacent points
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      const dist = haversineMeters(a, b);
      if (dist < 15 || dist > 350) continue;
      const diff = Math.abs(a.depth_m - b.depth_m);
      const gradientPer10m = (diff / dist) * 10;
      if (diff >= 1.8 && gradientPer10m >= 0.08) {
        const mid: LatLng = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        const tooClose = zones.some(
          (z) => z.kind === 'dropoff' && haversineMeters(z, mid) < 300
        );
        if (!tooClose) {
          const minD = Math.min(a.depth_m, b.depth_m).toFixed(1);
          const maxD = Math.max(a.depth_m, b.depth_m).toFixed(1);
          zones.push({
            id: `dropoff-${a.id}-${b.id}`,
            kind: 'dropoff',
            label: `Бровка ${minD}→${maxD} м`,
            lat: mid.lat,
            lng: mid.lng,
            depth_m: Number(((a.depth_m + b.depth_m) / 2).toFixed(1)),
            gradient_m_per_10m: Number(gradientPer10m.toFixed(2)),
          });
        }
      }
    }
  }

  return zones.slice(0, 8);
}

export function recommendLures(params: {
  species: FishSpecies;
  waterBody: WaterBody | null;
  month: number;
  clarity?: WaterBody['water_clarity'];
  isIceRegime?: boolean;
}): LureRecommendationResult[] {
  const {
    species,
    waterBody,
    month,
    clarity = waterBody?.water_clarity ?? 'moderate',
    isIceRegime = false,
  } = params;
  const wbDepth = waterBody?.avg_depth_m ?? ((species.depth_range_m[0] + species.depth_range_m[1]) / 2);

  return species.lures
    .map((lure) => {
      let rawScore = lure.base_rank * 8;
      const reasons: string[] = [];

      if (isIceRegime) {
        if (lure.category === 'мормышка' || lure.category === 'балансир') {
          rawScore += 26;
          reasons.push('подходит для подлёдной ловли');
        } else if (lure.category === 'воблер' || lure.category === 'фидер') {
          rawScore -= 38;
        }
      }

      if (lure.best_seasons.includes(month)) {
        rawScore += 16;
        reasons.push('подходит для текущего сезона');
      } else {
        rawScore -= 8;
      }

      if (wbDepth >= lure.depth_min_m && wbDepth <= lure.depth_max_m) {
        rawScore += 14;
        reasons.push(`рабочий горизонт ${lure.depth_min_m}–${lure.depth_max_m} м`);
      } else {
        rawScore -= 10;
      }

      if (lure.best_clarity.includes(clarity)) {
        rawScore += 8;
        reasons.push(
          clarity === 'clear'
            ? 'для прозрачной воды'
            : clarity === 'murky'
              ? 'заметна в мутной воде'
              : 'универсальная прозрачность'
        );
      }

      if (waterBody && lure.water_types.includes(waterBody.type)) {
        rawScore += 10;
        reasons.push(`эффективна на типе «${waterBodyTypeRu(waterBody.type)}»`);
      }

      return {
        rawScore,
        result: {
          lure,
          score: Math.max(10, Math.min(99, Math.round(rawScore))),
          reasons: reasons.length > 0 ? reasons : [lure.rationale],
        },
      };
    })
    .sort((a, b) => b.rawScore - a.rawScore)
    .map((item) => item.result);
}

export function waterBodyTypeRu(t: WaterBody['type']): string {
  switch (t) {
    case 'reservoir':
      return 'Водохранилище';
    case 'river':
      return 'Река';
    case 'lake':
      return 'Озеро';
    case 'pond':
      return 'Пруд';
    case 'quarry':
      return 'Карьер';
    case 'oxbow':
      return 'Старица';
  }
}

export function selectBestAccessPoint(params: {
  accessPoints: WaterBodyAccessPoint[];
  targetPoint: LatLng;
  avoidUnpaved: boolean;
}): {
  selected: WaterBodyAccessPoint | null;
  nearestRoadDistanceM: number;
  drivingAvailable: boolean;
} {
  const { accessPoints, targetPoint, avoidUnpaved } = params;
  if (accessPoints.length === 0) {
    return { selected: null, nearestRoadDistanceM: 3200, drivingAvailable: false };
  }

  const drivable = accessPoints.filter((ap) => {
    if (!ap.driving_reachable) return false;
    if (avoidUnpaved && ap.unpaved) return false;
    return true;
  });

  if (drivable.length === 0) {
    // Pick nearest road_end/settlement even if unreachable by car for walking distance estimate
    const sortedAll = [...accessPoints].sort(
      (a, b) => haversineMeters(a, targetPoint) - haversineMeters(b, targetPoint)
    );
    const nearest = sortedAll[0];
    return {
      selected: nearest,
      nearestRoadDistanceM: Math.round(haversineMeters(nearest, targetPoint)),
      drivingAvailable: false,
    };
  }

  const sortedDrivable = [...drivable].sort(
    (a, b) => haversineMeters(a, targetPoint) - haversineMeters(b, targetPoint)
  );
  const best = sortedDrivable[0];
  return {
    selected: best,
    nearestRoadDistanceM: Math.round(haversineMeters(best, targetPoint)),
    drivingAvailable: true,
  };
}

export function buildSplitRouteMetrics(params: {
  origin: LatLng;
  waterBody: WaterBody;
  accessPoints: WaterBodyAccessPoint[];
  avoidUnpaved: boolean;
  quotaExceeded?: boolean;
}): RouteMultiResult {
  const { origin, waterBody, accessPoints, avoidUnpaved, quotaExceeded } = params;
  const targetPoint = waterBody.target_zone ?? waterBody.center;
  const { selected, nearestRoadDistanceM, drivingAvailable } = selectBestAccessPoint({
    accessPoints,
    targetPoint,
    avoidUnpaved,
  });

  const walkStart: LatLng = selected
    ? { lat: selected.lat, lng: selected.lng }
    : { lat: targetPoint.lat - 0.022, lng: targetPoint.lng - 0.02 };

  const walkMeters = Math.max(40, Math.round(haversineMeters(walkStart, targetPoint) * 1.18));
  const walkSeconds = Math.round(walkMeters / 1.15); // ~4.1 km/h trail speed

  const walkingSegment = {
    mode: 'walking' as const,
    distance_m: walkMeters,
    duration_s: walkSeconds,
    geometry: [
      [walkStart.lng, walkStart.lat] as [number, number],
      [
        (walkStart.lng + targetPoint.lng) / 2 + 0.0007,
        (walkStart.lat + targetPoint.lat) / 2 - 0.0005,
      ] as [number, number],
      [targetPoint.lng, targetPoint.lat] as [number, number],
    ],
  };

  const yandexMapsUrl = `https://yandex.ru/maps/?rtext=${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}~${walkStart.lat.toFixed(5)},${walkStart.lng.toFixed(5)}&rtt=auto`;

  if (!drivingAvailable || !selected) {
    const distKm = (nearestRoadDistanceM / 1000).toFixed(1).replace('.', ',');
    const walkMin = Math.max(1, Math.round(walkSeconds / 60));
    return {
      water_body_id: waterBody.id,
      access_point: selected,
      target_point: targetPoint,
      driving_available: false,
      driving_segment: null,
      walking_segment: walkingSegment,
      unavailable_reason: `Автомобильный маршрут недоступен. Ближайшая дорога — в ${distKm} км. Пеший подход — ${walkMin} мин.`,
      yandex_maps_url: yandexMapsUrl,
      avoid_unpaved: avoidUnpaved,
      source: 'yandex-fallback-osrm',
      quota_warning: quotaExceeded
        ? 'Дневной лимит API маршрутизации исчерпан — показан резервный расчёт.'
        : undefined,
    };
  }

  const straightDrive = haversineMeters(origin, walkStart);
  const driveFactor = avoidUnpaved ? 1.32 : 1.24;
  const driveMeters = Math.max(250, Math.round(straightDrive * driveFactor));
  const avgSpeedMs = avoidUnpaved ? 13.8 : 11.5; // paved highway is faster than dirt tracks
  const driveSeconds = Math.round(driveMeters / avgSpeedMs);

  // Midpoint deflection to simulate road curve and difference when avoidUnpaved is active
  const curveOffset = avoidUnpaved ? 0.009 : -0.005;
  const midLng = (origin.lng + walkStart.lng) / 2 + curveOffset;
  const midLat = (origin.lat + walkStart.lat) / 2 + (avoidUnpaved ? 0.006 : -0.004);

  return {
    water_body_id: waterBody.id,
    access_point: selected,
    target_point: targetPoint,
    driving_available: true,
    driving_segment: {
      mode: 'driving',
      distance_m: driveMeters,
      duration_s: driveSeconds,
      geometry: [
        [origin.lng, origin.lat],
        [midLng, midLat],
        [walkStart.lng, walkStart.lat],
      ],
    },
    walking_segment: walkingSegment,
    yandex_maps_url: yandexMapsUrl,
    avoid_unpaved: avoidUnpaved,
    source: 'yandex-fallback-osrm',
    quota_warning: quotaExceeded
      ? 'Дневной лимит API маршрутизации исчерпан — показан резервный расчёт.'
      : undefined,
  };
}

export function decodePolyline6(encoded: string, maxPoints = 320): [number, number][] {
  if (!encoded || typeof encoded !== 'string') return [];
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b = 0;
    do {
      if (index >= encoded.length) return coords;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) return coords;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    coords.push([Number((lng / 1e6).toFixed(6)), Number((lat / 1e6).toFixed(6))]);
  }

  if (coords.length <= maxPoints || maxPoints < 3) return coords;
  const step = (coords.length - 1) / (maxPoints - 1);
  const sampled: [number, number][] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    sampled.push(coords[Math.round(i * step)]);
  }
  sampled.push(coords[coords.length - 1]);
  return sampled;
}

export function validateCoordinates(lat: unknown, lng: unknown): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return 'Требуются корректные координаты геолокации.';
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return 'Координаты выходят за допустимый диапазон.';
  }
  return null;
}

export function validateCatchReportInput(input: {
  lat?: number | null;
  lng?: number | null;
  fish_species_id?: string;
  source?: 'quick_mark' | 'diary';
  photo_size_bytes?: number;
  photo_mime?: string;
}): string | null {
  const coordErr = validateCoordinates(input.lat, input.lng);
  if (coordErr) return coordErr;
  if (!input.fish_species_id || input.fish_species_id.trim().length === 0) {
    return 'Выберите вид рыбы.';
  }
  if (input.photo_size_bytes !== undefined && input.photo_size_bytes > 5 * 1024 * 1024) {
    return 'Размер фото превышает лимит 5 МБ.';
  }
  if (
    input.photo_mime !== undefined &&
    !['image/jpeg', 'image/png', 'image/webp'].includes(input.photo_mime)
  ) {
    return 'Допустимые форматы фото: JPEG, PNG, WebP.';
  }
  return null;
}

export function validateDepthPointInput(input: {
  lat?: number | null;
  lng?: number | null;
  depth_m?: number | null;
}): string | null {
  const coordErr = validateCoordinates(input.lat, input.lng);
  if (coordErr) return coordErr;
  if (typeof input.depth_m !== 'number' || Number.isNaN(input.depth_m)) {
    return 'Укажите глубину в метрах.';
  }
  if (input.depth_m < 0.1 || input.depth_m > 200) {
    return 'Глубина должна быть от 0.1 до 200 м.';
  }
  return null;
}

export function evaluateFIndexAlerts(params: {
  items: GoodBiteWaterBodyItem[];
  favoriteIds: string[];
  settings: BiteAlertSettings;
  now?: Date;
  force?: boolean;
}): BiteAlertEvent[] {
  const { items, favoriteIds, settings, now = new Date(), force = false } = params;
  if (!settings.enabled && !force) return [];

  const favSet = new Set(favoriteIds);
  const cooldownMs = 6 * 60 * 60 * 1000;
  const events: BiteAlertEvent[] = [];

  for (const item of items) {
    if (item.f_index < settings.threshold) continue;
    const isFav = favSet.has(item.water_body.id);
    const isNearby = item.distance_km <= settings.nearby_radius_km;

    if (settings.scope === 'favorites_only' && !isFav) continue;
    if (settings.scope === 'nearby_only' && !isNearby) continue;
    if (settings.scope === 'favorites_and_nearby' && !isFav && !isNearby) continue;

    if (!force) {
      const prev = settings.last_notified[item.water_body.id];
      if (prev) {
        const elapsed = now.getTime() - new Date(prev.notified_at).getTime();
        const jumpedSignificantly = item.f_index >= prev.f_index + 5;
        if (elapsed < cooldownMs && !jumpedSignificantly) {
          continue;
        }
      }
    }

    const label = isFav ? 'Избранный водоём' : `Рядом (${item.distance_km.toFixed(1)} км)`;
    events.push({
      water_body_id: item.water_body.id,
      water_body_name: item.water_body.display_label,
      is_favorite: isFav,
      distance_km: item.distance_km,
      f_index: item.f_index,
      best_species_id: item.best_species_id,
      best_species_name: item.best_species_name,
      peak_hour: item.peak_hour,
      title: `Клёв F-${item.f_index}: ${item.water_body.display_label}`,
      body: `${label} · ${item.best_species_name}, пик в ${item.peak_hour} (порог F ≥ ${settings.threshold})`,
    });
  }

  events.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    if (b.f_index !== a.f_index) return b.f_index - a.f_index;
    return a.distance_km - b.distance_km;
  });

  return events;
}

export type BathymetryProfileLineMode = 'transect' | 'west_east' | 'south_north';

export interface BathymetryProfilePoint {
  id: string;
  distance_m: number;
  distance_label: string;
  depth_m: number;
  bottom_elevation_m: number;
  source: BathymetryPoint['source'];
  source_label: string;
  lat: number;
  lng: number;
}

const DEPTH_SOURCE_LABELS: Record<BathymetryPoint['source'], string> = {
  seascape: 'Seascape',
  sonar: 'Эхолот / сонар',
  manual: 'Ручной промер',
};

export function buildBathymetryProfile(
  depthPoints: BathymetryPoint[],
  lineMode: BathymetryProfileLineMode = 'transect'
): BathymetryProfilePoint[] {
  if (depthPoints.length === 0) return [];

  const refLat = depthPoints[0].lat;
  const refLng = depthPoints[0].lng;
  const cosLat = Math.cos((refLat * Math.PI) / 180) || 1;
  const toXY = (pt: Pick<BathymetryPoint, 'lat' | 'lng'>) => ({
    x: (pt.lng - refLng) * 111320 * cosLat,
    y: (pt.lat - refLat) * 110540,
  });

  const coords = depthPoints.map((pt) => ({ pt, ...toXY(pt) }));

  let ux = 1;
  let uy = 0;
  if (lineMode === 'south_north') {
    ux = 0;
    uy = 1;
  } else if (lineMode === 'transect' && coords.length >= 2) {
    let bestDistSq = -1;
    let ax = coords[0].x;
    let ay = coords[0].y;
    let bx = coords[0].x;
    let by = coords[0].y;
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        const dx = coords[j].x - coords[i].x;
        const dy = coords[j].y - coords[i].y;
        const dSq = dx * dx + dy * dy;
        if (dSq > bestDistSq) {
          bestDistSq = dSq;
          ax = coords[i].x;
          ay = coords[i].y;
          bx = coords[j].x;
          by = coords[j].y;
        }
      }
    }
    const len = Math.sqrt(bestDistSq);
    if (len >= 1) {
      ux = (bx - ax) / len;
      uy = (by - ay) / len;
      // Keep canonical left-to-right (or south-to-north when vertical) orientation
      if (ux < -0.001 || (Math.abs(ux) <= 0.001 && uy < 0)) {
        ux = -ux;
        uy = -uy;
      }
    }
  }

  const projected = coords.map((c) => ({
    pt: c.pt,
    proj: c.x * ux + c.y * uy,
  }));
  const minProj = Math.min(...projected.map((p) => p.proj));

  return projected
    .map((p) => {
      const distance_m = Math.max(0, Math.round(p.proj - minProj));
      const depth_m = Number(p.pt.depth_m.toFixed(2));
      return {
        id: p.pt.id,
        distance_m,
        distance_label: `${distance_m} м`,
        depth_m,
        bottom_elevation_m: Number((-depth_m).toFixed(2)),
        source: p.pt.source,
        source_label: DEPTH_SOURCE_LABELS[p.pt.source] ?? p.pt.source,
        lat: p.pt.lat,
        lng: p.pt.lng,
      };
    })
    .sort((a, b) => a.distance_m - b.distance_m);
}

export interface SonarImportPoint {
  lat: number;
  lng: number;
  depth_m: number;
}

export interface SonarParseResult {
  points: SonarImportPoint[];
  format: 'csv' | 'gpx';
  skippedCount: number;
  downsampled: boolean;
  error?: string;
}

const MAX_SONAR_IMPORT_POINTS = 400;

function parseLocalizedNumber(raw: string): number {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  if (!cleaned) return Number.NaN;
  const normalized = cleaned.includes(',') && !cleaned.includes('.') ? cleaned.replace(',', '.') : cleaned;
  return Number(normalized);
}

function downsampleSonarPoints(points: SonarImportPoint[], maxCount: number): {
  points: SonarImportPoint[];
  downsampled: boolean;
} {
  if (points.length <= maxCount) return { points, downsampled: false };
  const step = (points.length - 1) / (maxCount - 1);
  const sampled: SonarImportPoint[] = [];
  for (let i = 0; i < maxCount - 1; i++) {
    sampled.push(points[Math.round(i * step)]);
  }
  sampled.push(points[points.length - 1]);
  return { points: sampled, downsampled: true };
}

/**
 * Safely parses sonar depth logs from Deeper, Garmin ActiveCaptain/Quickdraw, Lowrance/Humminbird CSV
 * or GPX (<trkpt>/<wpt>/<rtept> with <depth>/<gpxtpx:depth>/<waterdepth>/negative <ele>).
 * Pure string/regex parser (avoids XML DOM/XXE risks) with strict coordinate & depth validation.
 */
export function parseSonarDepthFile(content: string, filename = ''): SonarParseResult {
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  const lowerName = filename.toLowerCase();
  const isGpx =
    lowerName.endsWith('.gpx') ||
    /^<\?xml/i.test(trimmed) ||
    /<gpx[\s>]/i.test(trimmed) ||
    /<(trkpt|wpt|rtept)\b/i.test(trimmed);

  if (!trimmed) {
    return { points: [], format: isGpx ? 'gpx' : 'csv', skippedCount: 0, downsampled: false, error: 'Файл пустой.' };
  }

  const rawPoints: SonarImportPoint[] = [];
  let skippedCount = 0;

  if (isGpx) {
    const pointTagRe = /<(trkpt|wpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match: RegExpExecArray | null;
    while ((match = pointTagRe.exec(trimmed)) !== null) {
      const attrs = match[2];
      const body = match[3];
      const latMatch = /\blat\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const lonMatch = /\blon\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if (!latMatch || !lonMatch) {
        skippedCount += 1;
        continue;
      }
      const lat = parseLocalizedNumber(latMatch[1]);
      const lng = parseLocalizedNumber(lonMatch[1]);

      const depthTag =
        /<(?:[a-z0-9_-]+:)?(?:depth|waterdepth|dpt)\b[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?(?:depth|waterdepth|dpt)>/i.exec(
          body
        );
      let depthMeters = Number.NaN;
      if (depthTag) {
        depthMeters = Math.abs(parseLocalizedNumber(depthTag[1]));
      } else {
        const eleTag = /<ele\b[^>]*>([^<]+)<\/ele>/i.exec(body);
        if (eleTag) {
          const eleVal = parseLocalizedNumber(eleTag[1]);
          if (Number.isFinite(eleVal) && eleVal < 0) {
            depthMeters = Math.abs(eleVal);
          }
        }
      }

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        !Number.isFinite(depthMeters) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180 ||
        depthMeters < 0.1 ||
        depthMeters > 120
      ) {
        skippedCount += 1;
        continue;
      }

      rawPoints.push({
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        depth_m: Number(depthMeters.toFixed(2)),
      });
    }

    if (rawPoints.length === 0) {
      return {
        points: [],
        format: 'gpx',
        skippedCount,
        downsampled: false,
        error: 'В GPX не найдено точек с тегом глубины (<depth> / <gpxtpx:depth> или отрицательным <ele>).',
      };
    }

    const { points, downsampled } = downsampleSonarPoints(rawPoints, MAX_SONAR_IMPORT_POINTS);
    return { points, format: 'gpx', skippedCount, downsampled };
  }

  // CSV / TXT sonar log parser (Deeper, Garmin, Lowrance, Humminbird, generic)
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    return { points: [], format: 'csv', skippedCount: 0, downsampled: false, error: 'Файл не содержит строк данных.' };
  }

  const sampleLine = lines[0];
  const semiCount = (sampleLine.match(/;/g) || []).length;
  const tabCount = (sampleLine.match(/\t/g) || []).length;
  const commaCount = (sampleLine.match(/,/g) || []).length;
  const delimiter = tabCount >= 2 ? '\t' : semiCount >= 2 && semiCount >= commaCount ? ';' : ',';

  const firstCells = sampleLine
    .split(delimiter)
    .map((c) => c.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const hasHeader = firstCells.some((c) => /[a-zа-яё]/i.test(c));
  let latIdx = 0;
  let lngIdx = 1;
  let depthIdx = 2;
  let depthInFeet = false;

  if (hasHeader) {
    const foundLat = firstCells.findIndex((c) => /^(lat|latitude|широта|y)$/i.test(c) || c.includes('lat') || c.includes('широт'));
    const foundLng = firstCells.findIndex(
      (c) => /^(lon|lng|long|longitude|долгота|x)$/i.test(c) || c.includes('lon') || c.includes('lng') || c.includes('долгот')
    );
    const foundDepth = firstCells.findIndex(
      (c) =>
        /^(depth|depth_m|depth_ft|dpt|глубина|depth\(m\)|depth\(ft\)|z)$/i.test(c) ||
        c.includes('depth') ||
        c.includes('глубин')
    );
    if (foundLat >= 0) latIdx = foundLat;
    if (foundLng >= 0) lngIdx = foundLng;
    if (foundDepth >= 0) {
      depthIdx = foundDepth;
      const headerCell = firstCells[foundDepth];
      if (/\bft\b|feet|фут|_ft|\(ft\)/i.test(headerCell)) {
        depthInFeet = true;
      }
    }
  }

  const startIdx = hasHeader ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split(delimiter);
    if (cells.length <= Math.max(latIdx, lngIdx, depthIdx)) {
      skippedCount += 1;
      continue;
    }
    const lat = parseLocalizedNumber(cells[latIdx]);
    const lng = parseLocalizedNumber(cells[lngIdx]);
    const rawDepth = parseLocalizedNumber(cells[depthIdx]);
    const depthMeters = depthInFeet ? Math.abs(rawDepth) * 0.3048 : Math.abs(rawDepth);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(depthMeters) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      depthMeters < 0.1 ||
      depthMeters > 120
    ) {
      skippedCount += 1;
      continue;
    }

    rawPoints.push({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      depth_m: Number(depthMeters.toFixed(2)),
    });
  }

  if (rawPoints.length === 0) {
    return {
      points: [],
      format: 'csv',
      skippedCount,
      downsampled: false,
      error: 'Не удалось распознать координаты и глубины. Ожидаются колонки Latitude, Longitude, Depth (в метрах или футах).',
    };
  }

  const { points, downsampled } = downsampleSonarPoints(rawPoints, MAX_SONAR_IMPORT_POINTS);
  return { points, format: 'csv', skippedCount, downsampled };
}

export function buildSampleSonarCsv(waterBody: Pick<WaterBody, 'center' | 'max_depth_m'>): string {
  const baseLat = waterBody.center.lat;
  const baseLng = waterBody.center.lng;
  const peak = Math.max(4.5, Math.min(18, waterBody.max_depth_m ?? 8.5));
  const offsets: Array<[number, number, number]> = [
    [-0.0022, -0.0024, 0.25],
    [-0.0014, -0.0018, 0.45],
    [-0.0006, -0.0011, 0.72],
    [0.0, -0.0004, 0.94],
    [0.0007, 0.0003, 1.0],
    [0.0015, 0.001, 0.78],
    [0.0022, 0.0018, 0.35],
    [-0.0018, 0.0014, 0.32],
    [-0.0009, 0.0009, 0.64],
    [0.0002, 0.0012, 0.82],
    [0.0012, -0.0014, 0.56],
    [0.0019, -0.002, 0.28],
    [-0.0004, -0.0021, 0.4],
    [0.0005, 0.0022, 0.38],
  ];
  const header = 'Latitude,Longitude,Depth_m';
  const rows = offsets.map(([dLat, dLng, frac]) => {
    const lat = (baseLat + dLat).toFixed(6);
    const lng = (baseLng + dLng).toFixed(6);
    const depth = Math.max(0.8, Number((peak * frac).toFixed(1)));
    return `${lat},${lng},${depth}`;
  });
  return [header, ...rows].join('\n');
}

export function getWaterBodyImageBounds(
  wb: Pick<WaterBody, 'polygon' | 'center'>
): [[number, number], [number, number], [number, number], [number, number]] {
  let west = wb.center.lng - 0.014;
  let east = wb.center.lng + 0.014;
  let south = wb.center.lat - 0.009;
  let north = wb.center.lat + 0.009;

  if (wb.polygon && wb.polygon.length >= 3) {
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of wb.polygon) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (Number.isFinite(minLng) && Number.isFinite(maxLng) && Number.isFinite(minLat) && Number.isFinite(maxLat)) {
      const padLng = Math.max(0.0015, (maxLng - minLng) * 0.12);
      const padLat = Math.max(0.001, (maxLat - minLat) * 0.12);
      west = minLng - padLng;
      east = maxLng + padLng;
      south = minLat - padLat;
      north = maxLat + padLat;
    }
  }

  return [
    [Number(west.toFixed(6)), Number(north.toFixed(6))], // top-left
    [Number(east.toFixed(6)), Number(north.toFixed(6))], // top-right
    [Number(east.toFixed(6)), Number(south.toFixed(6))], // bottom-right
    [Number(west.toFixed(6)), Number(south.toFixed(6))], // bottom-left
  ];
}

/**
 * Generates smooth interpolated bathymetry contours (isobaths) from sparse or dense depth readings
 * using Inverse Distance Weighting (IDW) + Marching Squares contour extraction and polyline stitching.
 */
export function generateBathymetryContours(
  points: BathymetryPoint[],
  waterBody?: Pick<WaterBody, 'polygon' | 'polygon_rings'> | null
): BathymetryContour[] {
  if (!points || points.length < 3) return [];

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.depth_m)) continue;
    if (p.depth_m < minDepth) minDepth = p.depth_m;
    if (p.depth_m > maxDepth) maxDepth = p.depth_m;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  if (!Number.isFinite(minDepth) || maxDepth - minDepth < 0.4) return [];

  const latSpan = Math.max(0.0025, maxLat - minLat);
  const lngSpan = Math.max(0.0035, maxLng - minLng);
  minLat -= latSpan * 0.28;
  maxLat += latSpan * 0.28;
  minLng -= lngSpan * 0.28;
  maxLng += lngSpan * 0.28;

  const hasPolygon = Boolean(waterBody && waterBody.polygon && waterBody.polygon.length >= 3);
  const cols = 22;
  const rows = 22;
  const dLng = (maxLng - minLng) / (cols - 1);
  const dLat = (maxLat - minLat) / (rows - 1);

  // Build IDW depth grid with soft shoreline anchoring outside the water polygon (if available)
  const grid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0.15));
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180) || 1;
  const boundaryRadiusSq = Math.pow(Math.max(latSpan, lngSpan * cosLat) * 0.72, 2);

  for (let r = 0; r < rows; r++) {
    const lat = minLat + r * dLat;
    for (let c = 0; c < cols; c++) {
      const lng = minLng + c * dLng;
      if (hasPolygon && waterBody && !pointInWaterBody({ lat, lng }, waterBody)) {
        grid[r][c] = 0.15;
        continue;
      }

      // Fade smoothly toward 0.2m at the outer perimeter when no polygon is present so isobaths close cleanly
      const edgeDist = Math.min(r, rows - 1 - r, c, cols - 1 - c);
      if (!hasPolygon && edgeDist === 0) {
        grid[r][c] = 0.2;
        continue;
      }

      let wSum = 0;
      let vSum = 0;
      let exact: number | null = null;
      let nearestDistSq = Infinity;

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const dy = lat - pt.lat;
        const dx = (lng - pt.lng) * cosLat;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1e-12) {
          exact = pt.depth_m;
          break;
        }
        if (distSq < nearestDistSq) nearestDistSq = distSq;
        const w = 1 / distSq;
        wSum += w;
        vSum += w * pt.depth_m;
      }

      if (exact !== null) {
        grid[r][c] = exact;
      } else {
        // Blend weakly toward shallow baseline if far from any reading
        const rawVal = wSum > 0 ? vSum / wSum : 0.2;
        const farFactor = Math.min(1, nearestDistSq / Math.max(1e-8, boundaryRadiusSq));
        grid[r][c] = rawVal * (1 - 0.55 * farFactor) + 0.2 * (0.55 * farFactor);
      }
    }
  }

  // Choose 3..5 clean contour levels between minDepth and maxDepth
  const span = maxDepth - Math.min(minDepth, 0.5);
  const step = span <= 3 ? 0.5 : span <= 6 ? 1 : span <= 12 ? 2 : span <= 24 ? 3 : 5;
  const levels: number[] = [];
  const startLevel = Math.max(step, Math.ceil((Math.min(minDepth, 1.0) + step * 0.25) / step) * step);
  for (let lv = startLevel; lv <= maxDepth - step * 0.15; lv += step) {
    levels.push(Number(lv.toFixed(1)));
    if (levels.length >= 6) break;
  }
  if (levels.length === 0) {
    levels.push(Number(((minDepth + maxDepth) / 2).toFixed(1)));
  }

  const interp = (v1: number, v2: number, level: number): number => {
    const denom = v2 - v1;
    if (Math.abs(denom) < 1e-9) return 0.5;
    return Math.max(0, Math.min(1, (level - v1) / denom));
  };

  type Seg = [[number, number], [number, number]];
  const contours: BathymetryContour[] = [];

  for (const level of levels) {
    const segments: Seg[] = [];

    for (let r = 0; r < rows - 1; r++) {
      const lat0 = minLat + r * dLat;
      const lat1 = lat0 + dLat;
      for (let c = 0; c < cols - 1; c++) {
        const lng0 = minLng + c * dLng;
        const lng1 = lng0 + dLng;

        const bl = grid[r][c];
        const br = grid[r][c + 1];
        const tr = grid[r + 1][c + 1];
        const tl = grid[r + 1][c];

        const mask =
          (bl >= level ? 1 : 0) |
          (br >= level ? 2 : 0) |
          (tr >= level ? 4 : 0) |
          (tl >= level ? 8 : 0);

        if (mask === 0 || mask === 15) continue;

        const bottom: [number, number] = [lng0 + interp(bl, br, level) * dLng, lat0];
        const right: [number, number] = [lng1, lat0 + interp(br, tr, level) * dLat];
        const top: [number, number] = [lng0 + interp(tl, tr, level) * dLng, lat1];
        const left: [number, number] = [lng0, lat0 + interp(bl, tl, level) * dLat];

        switch (mask) {
          case 1:
          case 14:
            segments.push([left, bottom]);
            break;
          case 2:
          case 13:
            segments.push([bottom, right]);
            break;
          case 3:
          case 12:
            segments.push([left, right]);
            break;
          case 4:
          case 11:
            segments.push([top, right]);
            break;
          case 5: {
            const center = (bl + br + tr + tl) / 4;
            if (center >= level) {
              segments.push([left, top], [bottom, right]);
            } else {
              segments.push([left, bottom], [top, right]);
            }
            break;
          }
          case 6:
          case 9:
            segments.push([bottom, top]);
            break;
          case 7:
          case 8:
            segments.push([left, top]);
            break;
          case 10: {
            const center = (bl + br + tr + tl) / 4;
            if (center >= level) {
              segments.push([left, bottom], [top, right]);
            } else {
              segments.push([left, top], [bottom, right]);
            }
            break;
          }
        }
      }
    }

    if (segments.length === 0) continue;

    // Stitch segments into connected polylines
    const keyOf = (pt: [number, number]) => `${Math.round(pt[0] * 1e5)},${Math.round(pt[1] * 1e5)}`;
    const used = new Array<boolean>(segments.length).fill(false);

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const line: [number, number][] = [segments[i][0], segments[i][1]];

      let extended = true;
      while (extended) {
        extended = false;
        const headKey = keyOf(line[0]);
        const tailKey = keyOf(line[line.length - 1]);
        for (let j = 0; j < segments.length; j++) {
          if (used[j]) continue;
          const [a, b] = segments[j];
          const aKey = keyOf(a);
          const bKey = keyOf(b);
          if (aKey === tailKey) {
            line.push(b);
            used[j] = true;
            extended = true;
          } else if (bKey === tailKey) {
            line.push(a);
            used[j] = true;
            extended = true;
          } else if (bKey === headKey) {
            line.unshift(a);
            used[j] = true;
            extended = true;
          } else if (aKey === headKey) {
            line.unshift(b);
            used[j] = true;
            extended = true;
          }
        }
      }

      if (line.length >= 3) {
        contours.push({
          depth_m: level,
          coordinates: line.map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]),
        });
      }
    }
  }

  return contours;
}

