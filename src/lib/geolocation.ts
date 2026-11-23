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
  // Local equirectangular projection around p for accurate short-distance projection
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

interface CapacitorGeolocationPlugin {
  requestPermissions?: () => Promise<{ location?: string; coarseLocation?: string }>;
  getCurrentPosition?: (options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }) => Promise<{ coords: { latitude: number; longitude: number; accuracy?: number } }>;
}

function getCapacitorGeolocationPlugin(): CapacitorGeolocationPlugin | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    Capacitor?: { Plugins?: { Geolocation?: CapacitorGeolocationPlugin } };
  };
  return win.Capacitor?.Plugins?.Geolocation ?? null;
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

/**
 * Resolves the user's real GPS position across Capacitor Android/iOS native WebViews
 * and mobile/desktop browsers. Supports optional 5-minute TTL caching to conserve battery,
 * strict high-accuracy GPS (`maximumAge: 0`, `timeout: 10000`) on explicit requests,
 * and automatic coarse fallback indoors.
 */
export async function detectUserLocation(options?: {
  highAccuracy?: boolean;
  timeoutMs?: number;
  forceFresh?: boolean;
  useCache?: boolean;
  cacheTtlMs?: number;
}): Promise<GeolocationFix | null> {
  const highAccuracy = options?.highAccuracy ?? true;
  const timeoutMs = options?.timeoutMs ?? 10000;
  const forceFresh = options?.forceFresh ?? false;
  const cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_GPS_CACHE_TTL_MS;

  if (options?.useCache && !forceFresh) {
    const saved = loadSavedGpsRecord();
    if (saved && saved.ts > 0 && Date.now() - saved.ts <= cacheTtlMs) {
      return {
        coords: saved.coords,
        accuracy_m: saved.accuracy_m,
        source: 'cached',
        timestamp: saved.ts,
      };
    }
  }

  // 1. Native Capacitor Geolocation plugin if present
  const capGeo = getCapacitorGeolocationPlugin();
  if (capGeo?.getCurrentPosition) {
    try {
      await capGeo.requestPermissions?.();
      const pos = await capGeo.getCurrentPosition({
        enableHighAccuracy: highAccuracy,
        timeout: timeoutMs,
        maximumAge: forceFresh ? 0 : 60_000,
      });
      if (pos?.coords) {
        const coords: LatLng = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        };
        const accuracy_m = typeof pos.coords.accuracy === 'number' ? Math.round(pos.coords.accuracy) : null;
        saveGpsOrigin(coords, accuracy_m);
        return {
          coords,
          accuracy_m,
          source: 'capacitor',
          timestamp: Date.now(),
        };
      }
    } catch {
      // Fall through to standard WebView navigator.geolocation
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

    try {
      return await requestBrowserPos(highAccuracy, timeoutMs, forceFresh ? 0 : 60_000);
    } catch {
      // Fallback to coarse/network fix when GPS satellites aren't locked indoors
      if (highAccuracy) {
        try {
          return await requestBrowserPos(false, 5000, 120_000);
        } catch {
          // Denied or unavailable
        }
      }
    }
  }

  return null;
}
