import { haversineMeters } from '../lib/fishLogic.ts';
import type { LatLng, WaterBody, WaterBodyType } from '../lib/types.ts';

export const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const PLACES_SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.viewport,places.googleMapsUri';

const WATER_PLACE_TYPES = new Set([
  'lake',
  'river',
  'pond',
  'reservoir',
  'fishing_pond',
  'fishing_charter',
  'dam',
  'canal',
  'marina',
  'natural_feature',
  'water',
]);

const NON_WATER_BUSINESS_TYPES = new Set([
  'restaurant',
  'cafe',
  'bar',
  'lodging',
  'hotel',
  'motel',
  'store',
  'supermarket',
  'shopping_mall',
  'gas_station',
  'pharmacy',
  'hospital',
  'school',
  'bank',
  'atm',
  'real_estate_agency',
  'car_repair',
  'car_wash',
  'beauty_salon',
  'hair_care',
  'gym',
  'night_club',
  'bakery',
  'clothing_store',
  'convenience_store',
  'hardware_store',
  'route',
  'street_address',
  'bus_station',
  'transit_station',
  'subway_station',
]);

const WATER_NAME_REGEX =
  /(?:^|[\s«"'(,-])(озер\p{L}*|оз\.|пруд\p{L}*|рек\p{L}*|речк\p{L}*|р\.|водохранилищ\p{L}*|вдхр\.?|плотин\p{L}*|платин\p{L}*|запруд\p{L}*|карьер\p{L}*|стариц\p{L}*|залив\p{L}*|лиман\p{L}*|канал\p{L}*|руч[еейь]\p{L}*|рыбхоз\p{L}*|водо[её]м\p{L}*|платн\p{L}*\s+рыбалк\p{L}*|lake|river|pond|reservoir|dam|quarry|canal|fishing\s+pond)/iu;

const NON_WATER_NAME_PREFIX_REGEX =
  /^(?:ул\.|улица|пер\.|переулок|пр-т|проспект|шоссе|кафе|ресторан|бар|магазин|отель|гостиница|аптека|жк|снт|гск|автомойка|шиномонтаж|остановка)\b/iu;

export interface GooglePlaceRaw {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  viewport?: {
    low?: { latitude?: number; longitude?: number };
    high?: { latitude?: number; longitude?: number };
  };
  googleMapsUri?: string;
}

export interface GooglePlacesWaterSearchItem {
  id: string;
  place_id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  water_body_id: string | null;
  is_water_body: boolean;
  water_type?: WaterBodyType;
  google_maps_uri?: string;
  provider: 'google_places';
}

export interface GooglePlacesSearchResult<T> {
  items: T[];
  quotaExceeded: boolean;
  configured: boolean;
}

export function getGoogleMapsServerApiKey(): string | null {
  const raw =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.MAPS_API_KEY ||
    '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 10 || trimmed === 'YOUR_API_KEY') {
    return null;
  }
  return trimmed;
}

export function isGoogleQuotaError(status: number, bodyText?: string): boolean {
  if (status === 429) return true;
  if (!bodyText) return false;
  const upper = bodyText.toUpperCase();
  return (
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('OVER_QUERY_LIMIT') ||
    upper.includes('QUOTA_EXCEEDED') ||
    upper.includes('RATE_LIMIT_EXCEEDED')
  );
}

export function inferWaterBodyTypeFromGooglePlace(place: GooglePlaceRaw): WaterBodyType {
  const name = (place.displayName?.text ?? '').toLowerCase();
  const types = new Set((place.types ?? []).map((t) => t.toLowerCase()));
  const primary = (place.primaryType ?? '').toLowerCase();

  if (
    primary === 'reservoir' ||
    primary === 'dam' ||
    types.has('reservoir') ||
    types.has('dam') ||
    /водохранилищ|вдхр|плотин|платин|запруд|reservoir|dam/i.test(name)
  ) {
    return 'reservoir';
  }
  if (/стариц|oxbow/i.test(name)) return 'oxbow';
  if (/карьер|quarry/i.test(name)) return 'quarry';
  if (
    primary === 'pond' ||
    primary === 'fishing_pond' ||
    types.has('pond') ||
    types.has('fishing_pond') ||
    /пруд|рыбхоз|платн\p{L}*\s+рыбалк|pond/iu.test(name)
  ) {
    return 'pond';
  }
  if (
    primary === 'river' ||
    primary === 'canal' ||
    types.has('river') ||
    types.has('canal') ||
    /(?:^|[\s«"'(,-])(рек\p{L}*|речк\p{L}*|р\.|канал\p{L}*|руч[еейь]\p{L}*|river|canal)/iu.test(name)
  ) {
    return 'river';
  }
  if (primary === 'lake' || types.has('lake') || /озер|оз\.|lake/i.test(name)) {
    return 'lake';
  }
  return 'lake';
}

export function isGooglePlaceWaterBody(place: GooglePlaceRaw): boolean {
  const name = (place.displayName?.text ?? '').trim();
  if (!name) return false;
  if (NON_WATER_NAME_PREFIX_REGEX.test(name)) return false;

  const types = (place.types ?? []).map((t) => t.toLowerCase());
  const primary = (place.primaryType ?? '').toLowerCase();

  if (primary === 'fishing_pond' || types.includes('fishing_pond')) return true;
  if (
    primary === 'lake' ||
    primary === 'river' ||
    primary === 'pond' ||
    primary === 'reservoir' ||
    primary === 'dam'
  ) {
    return true;
  }

  const hasBusinessBlockType =
    NON_WATER_BUSINESS_TYPES.has(primary) ||
    types.some((t) => NON_WATER_BUSINESS_TYPES.has(t));
  if (hasBusinessBlockType) return false;

  const hasWaterType = WATER_PLACE_TYPES.has(primary) || types.some((t) => WATER_PLACE_TYPES.has(t));
  const hasWaterName = WATER_NAME_REGEX.test(name);

  if (hasWaterType && (primary !== 'natural_feature' || hasWaterName)) {
    return true;
  }
  if (hasWaterName) {
    return true;
  }
  return false;
}

function estimateAreaHaFromViewport(
  viewport: GooglePlaceRaw['viewport'],
  type: WaterBodyType
): number {
  if (
    viewport?.low?.latitude != null &&
    viewport?.low?.longitude != null &&
    viewport?.high?.latitude != null &&
    viewport?.high?.longitude != null
  ) {
    const midLat = (viewport.low.latitude + viewport.high.latitude) / 2;
    const dLatKm = Math.abs(viewport.high.latitude - viewport.low.latitude) * 111;
    const dLngKm =
      Math.abs(viewport.high.longitude - viewport.low.longitude) *
      111 *
      Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
    const rectHa = dLatKm * dLngKm * 100;
    const fillFactor = type === 'river' ? 0.14 : type === 'reservoir' ? 0.42 : 0.48;
    const estimated = Math.round(rectHa * fillFactor * 10) / 10;
    if (Number.isFinite(estimated) && estimated >= 0.4 && estimated <= 35000) {
      return estimated;
    }
  }
  switch (type) {
    case 'reservoir':
      return 120;
    case 'river':
      return 28;
    case 'lake':
      return 16;
    case 'quarry':
      return 10;
    case 'oxbow':
      return 3.5;
    case 'pond':
    default:
      return 3.0;
  }
}

function estimateDepthsForWaterBody(type: WaterBodyType, areaHa: number): { max: number; avg: number } {
  switch (type) {
    case 'reservoir':
      return areaHa >= 200 ? { max: 11.5, avg: 4.4 } : { max: 6.5, avg: 2.8 };
    case 'river':
      return areaHa >= 60 ? { max: 5.5, avg: 2.5 } : { max: 2.6, avg: 1.3 };
    case 'quarry':
      return { max: 7.5, avg: 3.4 };
    case 'lake':
      return areaHa >= 40 ? { max: 5.8, avg: 2.5 } : { max: 3.2, avg: 1.5 };
    case 'oxbow':
      return { max: 2.4, avg: 1.2 };
    case 'pond':
    default:
      return areaHa >= 8 ? { max: 3.4, avg: 1.6 } : { max: 2.2, avg: 1.1 };
  }
}

export function buildWaterBodyFromGooglePlace(place: GooglePlaceRaw): WaterBody | null {
  const title = place.displayName?.text?.trim();
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!title || typeof lat !== 'number' || typeof lng !== 'number') return null;

  const type = inferWaterBodyTypeFromGooglePlace(place);
  const areaHa = estimateAreaHaFromViewport(place.viewport, type);
  const depths = estimateDepthsForWaterBody(type, areaHa);
  const placeId = place.id?.trim() || `${lat.toFixed(4)}-${lng.toFixed(4)}`;
  const safeSlug = placeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);

  // Small approximate ring only for hit-testing; FishMap renders 'approximate' strictly as a water pin, never shading land
  const rLng = 0.001;
  const rLat = 0.00065;
  const polygon: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    polygon.push([
      Number((lng + Math.cos(a) * rLng).toFixed(5)),
      Number((lat + Math.sin(a) * rLat).toFixed(5)),
    ]);
  }
  polygon.push(polygon[0]);

  const regionParts = (place.formattedAddress ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const regionLabel = regionParts.slice(-3, -1).join(' · ') || regionParts[0] || 'Google Карты';
  const isPaidFishing =
    (place.types ?? []).includes('fishing_pond') ||
    /платн\p{L}*\s+рыбалк|рыбхоз|крх/iu.test(title);

  const center: LatLng = {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
  };

  return {
    id: `wb-gmaps-${safeSlug}`,
    name: title,
    display_label: title,
    type,
    center,
    polygon,
    geometry_quality: 'approximate',
    area_ha: areaHa,
    source: 'google_places',
    confidence: 0.88,
    moderation_status: 'verified',
    connected_to: null,
    has_bathymetry: false,
    max_depth_m: depths.max,
    avg_depth_m: depths.avg,
    depth_source: 'estimated',
    ...(isPaidFishing
      ? {
          fishing_access: 'paid' as const,
          fishing_access_note: 'Платный водоём / рыболовное хозяйство (уточняйте правила на месте)',
        }
      : {}),
    region: regionLabel,
    external_id: `GMAPS-${placeId}`,
    google_place_id: placeId,
    ...(place.googleMapsUri ? { google_maps_uri: place.googleMapsUri } : {}),
    ndwi_stability: 'year_round',
    vegetation_index: 'moderate',
    water_clarity: 'moderate',
    target_zone: center,
  };
}

interface PlacesCallResponse {
  places: GooglePlaceRaw[];
  quotaExceeded: boolean;
}

// Ephemeral in-memory cache (15 min TTL, strictly ToS-compliant — never written to disk permanently)
const placesTextCache = new Map<string, { expiresAt: number; data: PlacesCallResponse }>();

async function callPlacesSearchText(params: {
  apiKey: string;
  textQuery: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  maxResultCount?: number;
  timeoutMs?: number;
}): Promise<PlacesCallResponse> {
  const {
    apiKey,
    textQuery,
    lat,
    lng,
    radiusM = 25000,
    maxResultCount = 10,
    timeoutMs = 4500,
  } = params;

  const cacheKey = `${textQuery.toLowerCase().trim()}:${lat?.toFixed(2) ?? 'x'}:${lng?.toFixed(2) ?? 'x'}:${Math.round(radiusM / 1000)}`;
  const cached = placesTextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const body: Record<string, unknown> = {
    textQuery: textQuery.trim(),
    languageCode: 'ru',
    maxResultCount: Math.max(1, Math.min(20, maxResultCount)),
  };

  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    const clampedRadius = Math.max(500, Math.min(50000, Math.round(radiusM)));
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: clampedRadius,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACES_FIELD_MASK,
        'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        places: [],
        quotaExceeded: isGoogleQuotaError(res.status, errText),
      };
    }

    const json = (await res.json()) as { places?: GooglePlaceRaw[] };
    const result: PlacesCallResponse = {
      places: Array.isArray(json.places) ? json.places : [],
      quotaExceeded: false,
    };
    placesTextCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60 * 1000, data: result });
    return result;
  } catch {
    return { places: [], quotaExceeded: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchWaterBodiesViaGooglePlaces(params: {
  query: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<GooglePlacesSearchResult<GooglePlacesWaterSearchItem>> {
  const apiKey = getGoogleMapsServerApiKey();
  if (!apiKey) {
    return { items: [], quotaExceeded: false, configured: false };
  }

  const clean = params.query.trim();
  if (clean.length < 2) {
    return { items: [], quotaExceeded: false, configured: true };
  }

  const res = await callPlacesSearchText({
    apiKey,
    textQuery: clean,
    lat: params.lat,
    lng: params.lng,
    radiusM: Math.min(50000, Math.max(5000, (params.radiusKm ?? 40) * 1000)),
    maxResultCount: 10,
  });

  if (res.quotaExceeded) {
    return { items: [], quotaExceeded: true, configured: true };
  }

  const items: GooglePlacesWaterSearchItem[] = [];
  const seen = new Set<string>();

  for (const place of res.places) {
    const title = place.displayName?.text?.trim();
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (!title || typeof lat !== 'number' || typeof lng !== 'number') continue;

    const placeId = place.id?.trim() || `${lat.toFixed(4)}-${lng.toFixed(4)}`;
    if (seen.has(placeId)) continue;
    seen.add(placeId);

    const isWater = isGooglePlaceWaterBody(place);
    const waterType = isWater ? inferWaterBodyTypeFromGooglePlace(place) : undefined;
    const shortAddr = (place.formattedAddress ?? '')
      .split(',')
      .slice(0, 2)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' · ');

    items.push({
      id: `gmaps-${placeId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 28)}`,
      place_id: placeId,
      title,
      subtitle: isWater
        ? `${shortAddr || 'Google Карты'} · открыть водоём`
        : `${shortAddr || 'Google Карты'} · найти водоёмы рядом`,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      water_body_id: null,
      is_water_body: isWater,
      water_type: waterType,
      ...(place.googleMapsUri ? { google_maps_uri: place.googleMapsUri } : {}),
      provider: 'google_places',
    });
  }

  items.sort((a, b) => Number(b.is_water_body) - Number(a.is_water_body));
  return { items, quotaExceeded: false, configured: true };
}

export async function discoverNearbyWaterBodiesViaGooglePlaces(params: {
  lat: number;
  lng: number;
  radiusKm?: number;
  queryText?: string;
}): Promise<GooglePlacesSearchResult<WaterBody>> {
  const apiKey = getGoogleMapsServerApiKey();
  if (!apiKey) {
    return { items: [], quotaExceeded: false, configured: false };
  }

  const radiusKm = Math.max(5, Math.min(50, Math.round(params.radiusKm ?? 22)));
  const radiusM = radiusKm * 1000;
  const cleanQuery = (params.queryText ?? '').trim();

  const queries =
    cleanQuery.length >= 2
      ? [cleanQuery]
      : ['озеро пруд водохранилище', 'река плотина карьер рыбалка'];

  const responses = await Promise.all(
    queries.map((q) =>
      callPlacesSearchText({
        apiKey,
        textQuery: q,
        lat: params.lat,
        lng: params.lng,
        radiusM,
        maxResultCount: 14,
      })
    )
  );

  const quotaExceeded = responses.some((r) => r.quotaExceeded);
  if (quotaExceeded && responses.every((r) => r.places.length === 0)) {
    return { items: [], quotaExceeded: true, configured: true };
  }

  const anchor: LatLng = { lat: params.lat, lng: params.lng };
  const maxDistM = Math.max(radiusM * 1.45, 25000);
  const seenIds = new Set<string>();
  const results: WaterBody[] = [];

  for (const resp of responses) {
    for (const place of resp.places) {
      if (!isGooglePlaceWaterBody(place)) continue;
      const wb = buildWaterBodyFromGooglePlace(place);
      if (!wb) continue;
      if (seenIds.has(wb.id)) continue;
      const dist = haversineMeters(anchor, wb.center);
      // Keep explicit query matches even if slightly further; cap area discovery to nearby radius
      if (!cleanQuery && dist > maxDistM) continue;
      // Deduplicate same-name places within 1.5 km
      const duplicateNearby = results.some(
        (existing) =>
          existing.display_label.toLowerCase() === wb.display_label.toLowerCase() &&
          haversineMeters(existing.center, wb.center) < 1500
      );
      if (duplicateNearby) continue;

      seenIds.add(wb.id);
      results.push(wb);
    }
  }

  results.sort((a, b) => haversineMeters(anchor, a.center) - haversineMeters(anchor, b.center));
  return {
    items: results.slice(0, 20),
    quotaExceeded,
    configured: true,
  };
}
