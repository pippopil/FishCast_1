import { Geolocation as CapacitorGeolocation } from '@capacitor/geolocation';
import { isCapacitorNative } from './apiClient';
import { haversineMeters, pointInWaterBody } from './fishLogic';
import type { LatLng, WaterBody } from './types';

const LAST_GPS_STORAGE_KEY = 'fishcast_last_gps_v1';
const DEFAULT_GPS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface GeolocationFix {
  coords: LatLng;
  accuracy_m: number | null;
  source: 'capacitor' | 'browser' | 'cached';
  timestamp?: number;
}

export interface GpsSampleInput {
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  timestamp?: number;
}

export interface GpsFilterResult {
  coords: LatLng;
  accuracy_m: number | null;
  rejected: boolean;
  smoothed: boolean;
  reason?: 'low_accuracy' | 'speed_spike' | 'static_jitter';
}

/**
 * Pure GPS stabilization filter:
 * - Rejects implausible teleport/jump spikes (> 30 m/s between consecutive readings)
 * - Rejects severely degraded readings (accuracy > maxAccuracyM) when a recent valid fix exists
 * - Suppresses static shore jitter (< 10 m displacement within accuracy error) via EMA smoothing
 */
export class GPSFilter {
  private lastCoords: LatLng | null = null;
  private lastAccuracyM: number | null = null;
  private lastTimestamp = 0;

  constructor(
    private readonly options: {
      maxSpeedMs?: number;
      maxAccuracyM?: number;
      jitterRadiusM?: number;
      smoothingAlpha?: number;
    } = {}
  ) {}

  reset(): void {
    this.lastCoords = null;
    this.lastAccuracyM = null;
    this.lastTimestamp = 0;
  }

  addPoint(sample: GpsSampleInput): GpsFilterResult {
    const now = typeof sample.timestamp === 'number' ? sample.timestamp : Date.now();
    const acc =
      typeof sample.accuracy_m === 'number' && Number.isFinite(sample.accuracy_m) && sample.accuracy_m >= 0
        ? Math.round(sample.accuracy_m)
        : null;
    const incoming: LatLng = {
      lat: Number(sample.lat.toFixed(5)),
      lng: Number(sample.lng.toFixed(5)),
    };

    const maxSpeedMs = this.options.maxSpeedMs ?? 30;
    const maxAccuracyM = this.options.maxAccuracyM ?? 80;
    const jitterRadiusM = this.options.jitterRadiusM ?? 10;
    const alpha = this.options.smoothingAlpha ?? 0.25;

    if (!this.lastCoords) {
      this.lastCoords = incoming;
      this.lastAccuracyM = acc;
      this.lastTimestamp = now;
      return { coords: incoming, accuracy_m: acc, rejected: false, smoothed: false };
    }

    const dtSec = Math.max(0.5, (now - this.lastTimestamp) / 1000);
    const distM = haversineMeters(this.lastCoords, incoming);

    // Reject severely degraded accuracy if we have a better fix within the last 2 minutes
    if (
      acc !== null &&
      acc > maxAccuracyM &&
      dtSec <= 120 &&
      (this.lastAccuracyM === null || this.lastAccuracyM <= maxAccuracyM)
    ) {
      return {
        coords: this.lastCoords,
        accuracy_m: this.lastAccuracyM,
        rejected: true,
        smoothed: false,
        reason: 'low_accuracy',
      };
    }

    // Reject impossible jump spikes (> 30 m/s ~ 108 km/h) on consecutive updates within 60s
    const speedMs = distM / dtSec;
    if (dtSec <= 60 && distM > 25 && speedMs > maxSpeedMs) {
      return {
        coords: this.lastCoords,
        accuracy_m: this.lastAccuracyM,
        rejected: true,
        smoothed: false,
        reason: 'speed_spike',
      };
    }

    // Suppress static jitter on shore (< 10 m drift) using exponential smoothing
    if (distM < jitterRadiusM && (acc === null || acc >= distM)) {
      const smoothed: LatLng = {
        lat: Number((this.lastCoords.lat + (incoming.lat - this.lastCoords.lat) * alpha).toFixed(5)),
        lng: Number((this.lastCoords.lng + (incoming.lng - this.lastCoords.lng) * alpha).toFixed(5)),
      };
      this.lastCoords = smoothed;
      this.lastAccuracyM = acc ?? this.lastAccuracyM;
      this.lastTimestamp = now;
      return {
        coords: smoothed,
        accuracy_m: this.lastAccuracyM,
        rejected: false,
        smoothed: true,
        reason: 'static_jitter',
      };
    }

    this.lastCoords = incoming;
    this.lastAccuracyM = acc;
    this.lastTimestamp = now;
    return { coords: incoming, accuracy_m: acc, rejected: false, smoothed: false };
  }
}

function nearestPointOnSegment(
  p: LatLng,
  a: [number, number],
  b: [number, number]
): { coords: LatLng; distance_m: number } {
  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a[0] - p.lng) * cosLat;
  const ay = a[1] - p.lat;
  const bx = (b[0] - p.lng) * cosLat;
  const by = b[1] - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 1e-14) {
    t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lenSq));
  }
  const projLng = a[0] + (b[0] - a[0]) * t;
  const projLat = a[1] + (b[1] - a[1]) * t;
  const coords: LatLng = {
    lat: Number(projLat.toFixed(5)),
    lng: Number(projLng.toFixed(5)),
  };
  return { coords, distance_m: haversineMeters(p, coords) };
}

/**
 * Snaps a GPS point near a water body shoreline (< maxSnapMeters, default 30 m)
 * cleanly to the nearest shoreline edge without requiring heavy GIS libraries.
 * If already inside a water polygon, returns unchanged with waterBodyId.
 */
export function snapPointToWaterShore(
  point: LatLng,
  waterBodies: Pick<WaterBody, 'id' | 'polygon' | 'polygon_rings'>[],
  maxSnapMeters = 30
): { coords: LatLng; snapped: boolean; waterBodyId: string | null; distance_m: number | null } {
  for (const wb of waterBodies) {
    if (pointInWaterBody(point, wb)) {
      return { coords: point, snapped: false, waterBodyId: wb.id, distance_m: 0 };
    }
  }

  let bestCoords: LatLng | null = null;
  let bestDist = Infinity;
  let bestWbId: string | null = null;

  for (const wb of waterBodies) {
    const rings = wb.polygon_rings && wb.polygon_rings.length > 0 ? wb.polygon_rings : [wb.polygon];
    for (const ring of rings) {
      if (!ring || ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const cand = nearestPointOnSegment(point, ring[i], ring[i + 1]);
        if (cand.distance_m < bestDist) {
          bestDist = cand.distance_m;
          bestCoords = cand.coords;
          bestWbId = wb.id;
        }
      }
    }
  }

  if (bestCoords && bestDist <= maxSnapMeters) {
    return {
      coords: bestCoords,
      snapped: true,
      waterBodyId: bestWbId,
      distance_m: Math.round(bestDist),
    };
  }

  return {
    coords: point,
    snapped: false,
    waterBodyId: null,
    distance_m: Number.isFinite(bestDist) ? Math.round(bestDist) : null,
  };
}

/**
 * Detects plain HTTP browser contexts (non-localhost, non-Capacitor) where
 * Web Geolocation API is blocked or degraded to rough IP accuracy.
 */
export function isInsecureHttpContext(): boolean {
  if (isCapacitorNative()) return false;
  if (typeof window === 'undefined' || !window.location) return false;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  if (proto !== 'http:') return false;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
}

export function getGpsHttpWarning(): string | null {
  if (!isInsecureHttpContext()) return null;
  return 'Сайт открыт по незащищённому HTTP — браузер может блокировать точный GPS. Откройте по HTTPS или в Android-приложении.';
}

function loadSavedGpsRecord(): { coords: LatLng; accuracy_m: number | null; ts: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_GPS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown; acc?: unknown; ts?: unknown };
    if (
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng) &&
      parsed.lat >= -90 &&
      parsed.lat <= 90 &&
      parsed.lng >= -180 &&
      parsed.lng <= 180
    ) {
      return {
        coords: { lat: parsed.lat, lng: parsed.lng },
        accuracy_m: typeof parsed.acc === 'number' && Number.isFinite(parsed.acc) ? Math.round(parsed.acc) : null,
        ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
      };
    }
  } catch {
    // Ignore storage read errors in restricted WebViews
  }
  return null;
}

export function loadSavedGpsOrigin(): LatLng | null {
  return loadSavedGpsRecord()?.coords ?? null;
}

export function saveGpsOrigin(coords: LatLng, accuracy_m?: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LAST_GPS_STORAGE_KEY,
      JSON.stringify({
        lat: Number(coords.lat.toFixed(5)),
        lng: Number(coords.lng.toFixed(5)),
        ...(typeof accuracy_m === 'number' && Number.isFinite(accuracy_m) ? { acc: Math.round(accuracy_m) } : {}),
        ts: Date.now(),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function isMobileDeviceContext(): boolean {
  if (isCapacitorNative()) return true;
  if (typeof window === 'undefined') return false;
  if (window.innerWidth <= 768) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export type LocationPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export type GeolocationErrorCode =
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'insecure_context'
  | 'unsupported';

export interface GeolocationAttemptResult {
  fix: GeolocationFix | null;
  errorCode?: GeolocationErrorCode;
  errorTitle?: string;
  errorDetail?: string;
  permissionState: LocationPermissionState;
}

export function describeGeolocationError(code: GeolocationErrorCode): { title: string; detail: string } {
  switch (code) {
    case 'permission_denied':
      return {
        title: 'Доступ к геолокации запрещён',
        detail:
          'Разрешите доступ к местоположению для «Клёвый прогноз» в настройках устройства или браузера, затем нажмите «Повторить».',
      };
    case 'position_unavailable':
      return {
        title: 'Не удалось определить координаты',
        detail:
          'Службы геолокации отключены или отсутствует сигнал спутников/сети. Включите GPS (высокая точность) на устройстве и выйдите на открытое место.',
      };
    case 'timeout':
      return {
        title: 'Превышено время ожидания GPS',
        detail:
          'Устройство не успело получить координаты от спутников. Попробуйте снова на открытом воздухе или включите определение по Wi‑Fi и мобильной сети.',
      };
    case 'insecure_context':
      return {
        title: 'Геолокация заблокирована на HTTP',
        detail:
          'Браузер ограничивает точный GPS на незащищённом соединении. Откройте приложение по HTTPS или используйте Android-приложение.',
      };
    case 'unsupported':
    default:
      return {
        title: 'Геолокация не поддерживается',
        detail: 'На этом устройстве или в текущем браузере отсутствует поддержка API геолокации.',
      };
  }
}

/**
 * Explicitly checks the current location permission status before starting
 * any GPS / triangulation flow (works in both Capacitor Android/iOS and Web).
 */
export async function checkLocationPermission(): Promise<LocationPermissionState> {
  if (isCapacitorNative()) {
    try {
      const perms = await CapacitorGeolocation.checkPermissions();
      if (perms.location === 'granted' || perms.coarseLocation === 'granted') {
        return 'granted';
      }
      if (perms.location === 'denied' && (!perms.coarseLocation || perms.coarseLocation === 'denied')) {
        return 'denied';
      }
      return 'prompt';
    } catch {
      return 'prompt';
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }

  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
        return status.state;
      }
    } catch {
      // Safari / older WebViews may not support permissions.query('geolocation')
    }
  }

  return 'prompt';
}

/**
 * Explicitly checks and, on native Capacitor devices, requests location permission
 * before initializing position triangulation.
 */
export async function ensureLocationPermission(): Promise<LocationPermissionState> {
  const current = await checkLocationPermission();
  if (current === 'granted' || current === 'unsupported') {
    return current;
  }

  if (isCapacitorNative()) {
    try {
      const req = await CapacitorGeolocation.requestPermissions();
      if (req.location === 'granted' || req.coarseLocation === 'granted') {
        return 'granted';
      }
      return 'denied';
    } catch {
      return current;
    }
  }

  return current;
}

function classifyNativeGeolocationError(err: unknown): GeolocationErrorCode {
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  if (msg.includes('denied') || msg.includes('permission') || msg.includes('not authorized')) {
    return 'permission_denied';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  return 'position_unavailable';
}

async function resolveNativeCapacitorLocation(
  highAccuracy: boolean,
  timeoutMs: number,
  forceFresh: boolean
): Promise<{ fix: GeolocationFix | null; errorCode?: GeolocationErrorCode }> {
  if (!isCapacitorNative()) return { fix: null, errorCode: 'unsupported' };

  const formatPos = (pos: { coords?: { latitude: number; longitude: number; accuracy?: number } } | null): GeolocationFix | null => {
    if (!pos?.coords) return null;
    if (!Number.isFinite(pos.coords.latitude) || !Number.isFinite(pos.coords.longitude)) return null;
    const coords: LatLng = {
      lat: Number(pos.coords.latitude.toFixed(5)),
      lng: Number(pos.coords.longitude.toFixed(5)),
    };
    const accuracy_m =
      typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
        ? Math.round(pos.coords.accuracy)
        : null;
    saveGpsOrigin(coords, accuracy_m);
    return {
      coords,
      accuracy_m,
      source: 'capacitor',
      timestamp: Date.now(),
    };
  };

  let lastError: GeolocationErrorCode = 'position_unavailable';

  // Step 1: High-accuracy FusedLocation / GPS fix
  try {
    const pos = await CapacitorGeolocation.getCurrentPosition({
      enableHighAccuracy: highAccuracy,
      timeout: Math.max(timeoutMs, 10000),
      maximumAge: forceFresh ? 0 : 30_000,
    });
    const fix = formatPos(pos);
    if (fix) return { fix };
  } catch (err) {
    lastError = classifyNativeGeolocationError(err);
    if (lastError === 'permission_denied') {
      return { fix: null, errorCode: 'permission_denied' };
    }
  }

  // Step 2: Fast network/Wi-Fi/cell FusedLocation (essential indoors or before cold GPS lock)
  try {
    const pos = await CapacitorGeolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 120_000,
    });
    const fix = formatPos(pos);
    if (fix) return { fix };
  } catch (err) {
    const errCode = classifyNativeGeolocationError(err);
    if (errCode === 'permission_denied') {
      return { fix: null, errorCode: 'permission_denied' };
    }
    lastError = errCode;
  }

  // Step 3: Single-shot watchPosition fallback for Android devices with empty last-known location cache
  try {
    const watchResult = await new Promise<{ fix: GeolocationFix | null; errorCode?: GeolocationErrorCode }>((resolve) => {
      let settled = false;
      let watchId: string | null = null;
      const done = (val: { fix: GeolocationFix | null; errorCode?: GeolocationErrorCode }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (watchId !== null) {
          void CapacitorGeolocation.clearWatch({ id: watchId }).catch(() => undefined);
        }
        resolve(val);
      };
      const timer = setTimeout(() => done({ fix: null, errorCode: 'timeout' }), 8000);
      void CapacitorGeolocation.watchPosition(
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
        (pos, err) => {
          if (err) {
            const code = classifyNativeGeolocationError(err);
            if (code === 'permission_denied') done({ fix: null, errorCode: code });
            return;
          }
          if (!pos) return;
          const fix = formatPos(pos);
          if (fix) done({ fix });
        }
      )
        .then((id) => {
          watchId = id;
          if (settled) {
            void CapacitorGeolocation.clearWatch({ id }).catch(() => undefined);
          }
        })
        .catch((err) => done({ fix: null, errorCode: classifyNativeGeolocationError(err) }));
    });
    if (watchResult.fix) return watchResult;
    return { fix: null, errorCode: watchResult.errorCode ?? lastError };
  } catch (err) {
    return { fix: null, errorCode: classifyNativeGeolocationError(err) };
  }
}

/**
 * Resolves the user's real GPS position with explicit pre-check of permissions
 * and descriptive error classification across Capacitor native and Web browsers.
 */
export async function detectUserLocationDetailed(options?: {
  highAccuracy?: boolean;
  timeoutMs?: number;
  forceFresh?: boolean;
  useCache?: boolean;
  cacheTtlMs?: number;
  requestPermission?: boolean;
}): Promise<GeolocationAttemptResult> {
  const highAccuracy = options?.highAccuracy ?? true;
  const timeoutMs = options?.timeoutMs ?? 12000;
  const forceFresh = options?.forceFresh ?? false;
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_GPS_CACHE_TTL_MS;
  const requestPermission = options?.requestPermission ?? true;

  if (isInsecureHttpContext()) {
    const desc = describeGeolocationError('insecure_context');
    return {
      fix: null,
      errorCode: 'insecure_context',
      errorTitle: desc.title,
      errorDetail: desc.detail,
      permissionState: 'denied',
    };
  }

  // Explicit permission check before initializing GPS triangulation
  const permState = requestPermission
    ? await ensureLocationPermission()
    : await checkLocationPermission();

  if (permState === 'unsupported') {
    const desc = describeGeolocationError('unsupported');
    return {
      fix: null,
      errorCode: 'unsupported',
      errorTitle: desc.title,
      errorDetail: desc.detail,
      permissionState: 'unsupported',
    };
  }

  if (permState === 'denied') {
    const desc = describeGeolocationError('permission_denied');
    return {
      fix: null,
      errorCode: 'permission_denied',
      errorTitle: desc.title,
      errorDetail: desc.detail,
      permissionState: 'denied',
    };
  }

  if (options?.useCache && !forceFresh) {
    const saved = loadSavedGpsRecord();
    if (saved && saved.ts > 0 && Date.now() - saved.ts <= cacheTtlMs) {
      return {
        fix: {
          coords: saved.coords,
          accuracy_m: saved.accuracy_m,
          source: 'cached',
          timestamp: saved.ts,
        },
        permissionState: permState,
      };
    }
  }

  // 1. Native Capacitor Geolocation plugin (Android FusedLocation / iOS CoreLocation)
  if (isCapacitorNative()) {
    const nativeAttempt = await resolveNativeCapacitorLocation(highAccuracy, timeoutMs, forceFresh);
    if (nativeAttempt.fix) {
      return { fix: nativeAttempt.fix, permissionState: 'granted' };
    }
    const errCode = nativeAttempt.errorCode ?? 'position_unavailable';
    if (errCode === 'permission_denied') {
      const desc = describeGeolocationError('permission_denied');
      return {
        fix: null,
        errorCode: 'permission_denied',
        errorTitle: desc.title,
        errorDetail: desc.detail,
        permissionState: 'denied',
      };
    }
    // Fall through to WebView Geolocation only if not explicitly denied
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const desc = describeGeolocationError(errCode);
      return {
        fix: null,
        errorCode: errCode,
        errorTitle: desc.title,
        errorDetail: desc.detail,
        permissionState: permState,
      };
    }
  }

  // 2. Standard WebView / Browser Geolocation API
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const requestBrowserPos = (
      enableHighAccuracy: boolean,
      timeout: number,
      maximumAge: number
    ): Promise<GeolocationFix> =>
      new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords: LatLng = {
              lat: Number(pos.coords.latitude.toFixed(5)),
              lng: Number(pos.coords.longitude.toFixed(5)),
            };
            const accuracy_m = typeof pos.coords.accuracy === 'number' ? Math.round(pos.coords.accuracy) : null;
            saveGpsOrigin(coords, accuracy_m);
            resolve({
              coords,
              accuracy_m,
              source: 'browser',
              timestamp: Date.now(),
            });
          },
          (err) => reject(err),
          { enableHighAccuracy, timeout, maximumAge }
        );
      });

    const mapBrowserErr = (err: unknown): GeolocationErrorCode => {
      const code = (err as { code?: number })?.code;
      if (code === 1) return 'permission_denied';
      if (code === 3) return 'timeout';
      return 'position_unavailable';
    };

    try {
      const fix = await requestBrowserPos(highAccuracy, timeoutMs, forceFresh ? 0 : 60_000);
      return { fix, permissionState: 'granted' };
    } catch (firstErr) {
      const firstCode = mapBrowserErr(firstErr);
      if (firstCode === 'permission_denied') {
        const desc = describeGeolocationError('permission_denied');
        return {
          fix: null,
          errorCode: 'permission_denied',
          errorTitle: desc.title,
          errorDetail: desc.detail,
          permissionState: 'denied',
        };
      }
      // Fallback to coarse/network fix when GPS satellites aren't locked indoors
      try {
        const fix = await requestBrowserPos(false, 8000, 180_000);
        return { fix, permissionState: 'granted' };
      } catch (secondErr) {
        const finalCode = mapBrowserErr(secondErr);
        const desc = describeGeolocationError(finalCode);
        return {
          fix: null,
          errorCode: finalCode,
          errorTitle: desc.title,
          errorDetail: desc.detail,
          permissionState: finalCode === 'permission_denied' ? 'denied' : permState,
        };
      }
    }
  }

  const desc = describeGeolocationError('unsupported');
  return {
    fix: null,
    errorCode: 'unsupported',
    errorTitle: desc.title,
    errorDetail: desc.detail,
    permissionState: 'unsupported',
  };
}

/**
 * Backwards-compatible helper returning only the GeolocationFix or null.
 */
export async function detectUserLocation(options?: {
  highAccuracy?: boolean;
  timeoutMs?: number;
  forceFresh?: boolean;
  useCache?: boolean;
  cacheTtlMs?: number;
}): Promise<GeolocationFix | null> {
  const attempt = await detectUserLocationDetailed(options);
  return attempt.fix;
}
