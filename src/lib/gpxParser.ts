import { haversineMeters } from './fishLogic';
import type { GpxRouteTrack, GpxTrackPoint, GpxWaypoint, MapBbox } from './types';

export const GPX_TRACK_PALETTE = [
  '#7C3AED', // violet
  '#EA580C', // orange
  '#0D9488', // teal
  '#DB2777', // magenta
  '#2563EB', // royal blue
  '#CA8A04', // amber gold
];

const MAX_POINTS_PER_SEGMENT = 1200;
const MAX_GPX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ParsedGpxResult {
  ok: true;
  track: GpxRouteTrack;
}

export interface ParsedGpxError {
  ok: false;
  error: string;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTagText(xml: string, tagName: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  const decoded = decodeXmlEntities(m[1]);
  return decoded.length > 0 ? decoded : null;
}

function parseAttrNumber(attrs: string, attrName: string): number | null {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = attrs.match(re);
  if (!m) return null;
  const n = Number(m[1].trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parsePointBlock(attrs: string, innerXml: string): GpxTrackPoint | null {
  const lat = parseAttrNumber(attrs, 'lat');
  const lng = parseAttrNumber(attrs, 'lon');
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const eleRaw = extractTagText(innerXml, 'ele');
  const eleNum = eleRaw !== null ? Number(eleRaw.replace(',', '.')) : null;
  const timeRaw = extractTagText(innerXml, 'time');

  return {
    lat,
    lng,
    ele_m: eleNum !== null && Number.isFinite(eleNum) ? Number(eleNum.toFixed(1)) : null,
    time: timeRaw,
  };
}

function extractPointsByTag(xml: string, tagName: 'trkpt' | 'rtept'): GpxTrackPoint[] {
  const points: GpxTrackPoint[] = [];
  const pairRe = new RegExp(
    `<(?:[a-zA-Z0-9_-]+:)?${tagName}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>)`,
    'gi'
  );
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(xml)) !== null) {
    const pt = parsePointBlock(match[1] ?? '', match[2] ?? '');
    if (pt) points.push(pt);
  }
  return points;
}

function extractWaypoints(xml: string): GpxWaypoint[] {
  const waypoints: GpxWaypoint[] = [];
  const wptRe = /<(?:[a-zA-Z0-9_-]+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?wpt>)/gi;
  let match: RegExpExecArray | null;
  let idx = 1;
  while ((match = wptRe.exec(xml)) !== null) {
    const pt = parsePointBlock(match[1] ?? '', match[2] ?? '');
    if (!pt) continue;
    const inner = match[2] ?? '';
    const name = extractTagText(inner, 'name') ?? `Точка ${idx}`;
    const desc = extractTagText(inner, 'desc') ?? extractTagText(inner, 'cmt');
    waypoints.push({
      name,
      lat: pt.lat,
      lng: pt.lng,
      ele_m: pt.ele_m ?? null,
      desc: desc ?? null,
    });
    idx++;
  }
  return waypoints;
}

function downsamplePoints(points: GpxTrackPoint[], maxPoints: number): GpxTrackPoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const out: GpxTrackPoint[] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    out.push(points[Math.round(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Validates basic file metadata before reading GPX text.
 */
export function validateGpxFileMeta(fileName: string, sizeBytes: number): string | null {
  if (sizeBytes <= 0) {
    return 'GPX-файл пустой.';
  }
  if (sizeBytes > MAX_GPX_FILE_BYTES) {
    return 'Файл слишком большой (максимум 10 МБ).';
  }
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gpx') && !lower.endsWith('.xml')) {
    return 'Поддерживаются только GPX-файлы (.gpx).';
  }
  return null;
}

/**
 * Parses a GPX XML string (tracks <trk>/<trkseg>/<trkpt>, routes <rte>/<rtept>, and waypoints <wpt>)
 * into a persisted GpxRouteTrack ready for IndexedDB storage and MapLibre overlay rendering.
 */
export function parseGpxRouteTrack(
  xmlContent: string,
  options: {
    fileName: string;
    customName?: string;
    colorIndex?: number;
  }
): ParsedGpxResult | ParsedGpxError {
  const trimmed = xmlContent.trim();
  if (!trimmed || !/<(?:[a-zA-Z0-9_-]+:)?gpx\b/i.test(trimmed)) {
    return {
      ok: false,
      error: 'Файл не содержит корректный заголовок GPX (<gpx>). Проверьте формат экспорта.',
    };
  }

  const rawSegments: GpxTrackPoint[][] = [];

  // 1. Parse all <trkseg> blocks
  const trksegRe = /<(?:[a-zA-Z0-9_-]+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?trkseg>/gi;
  let segMatch: RegExpExecArray | null;
  while ((segMatch = trksegRe.exec(trimmed)) !== null) {
    const pts = extractPointsByTag(segMatch[1], 'trkpt');
    if (pts.length > 0) {
      rawSegments.push(pts);
    }
  }

  // Fallback if <trkpt> exists directly without <trkseg>
  if (rawSegments.length === 0) {
    const looseTrkPts = extractPointsByTag(trimmed, 'trkpt');
    if (looseTrkPts.length > 0) {
      rawSegments.push(looseTrkPts);
    }
  }

  // 2. Parse <rte> route blocks if present
  const rteRe = /<(?:[a-zA-Z0-9_-]+:)?rte\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?rte>/gi;
  let rteMatch: RegExpExecArray | null;
  while ((rteMatch = rteRe.exec(trimmed)) !== null) {
    const pts = extractPointsByTag(rteMatch[1], 'rtept');
    if (pts.length > 0) {
      rawSegments.push(pts);
    }
  }

  // 3. Parse <wpt> waypoints
  const waypoints = extractWaypoints(trimmed);

  // If file only has >= 2 waypoints and no trk/rte, connect waypoints in order as a route
  if (rawSegments.length === 0 && waypoints.length >= 2) {
    rawSegments.push(
      waypoints.map((w) => ({
        lat: w.lat,
        lng: w.lng,
        ele_m: w.ele_m ?? null,
        time: null,
      }))
    );
  }

  const allPoints = rawSegments.flat();
  if (allPoints.length < 2) {
    return {
      ok: false,
      error: 'В GPX-файле найдено меньше 2 координатных точек маршрута.',
    };
  }

  // Calculate metrics on full-resolution track before downsampling for display
  let distanceM = 0;
  let elevationGainM = 0;
  let hasElevation = false;
  let minTs = Infinity;
  let maxTs = -Infinity;
  let recordedAt: string | null = null;

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  for (const seg of rawSegments) {
    for (let i = 0; i < seg.length; i++) {
      const pt = seg[i];
      if (pt.lat > north) north = pt.lat;
      if (pt.lat < south) south = pt.lat;
      if (pt.lng > east) east = pt.lng;
      if (pt.lng < west) west = pt.lng;

      if (pt.time) {
        const ts = Date.parse(pt.time);
        if (Number.isFinite(ts)) {
          if (ts < minTs) {
            minTs = ts;
            recordedAt = new Date(ts).toISOString();
          }
          if (ts > maxTs) maxTs = ts;
        }
      }

      if (i > 0) {
        const prev = seg[i - 1];
        distanceM += haversineMeters({ lat: prev.lat, lng: prev.lng }, { lat: pt.lat, lng: pt.lng });
        if (
          typeof prev.ele_m === 'number' &&
          typeof pt.ele_m === 'number' &&
          Number.isFinite(prev.ele_m) &&
          Number.isFinite(pt.ele_m)
        ) {
          hasElevation = true;
          const diff = pt.ele_m - prev.ele_m;
          if (diff > 0.5) {
            elevationGainM += diff;
          }
        }
      }
    }
  }

  for (const w of waypoints) {
    if (w.lat > north) north = w.lat;
    if (w.lat < south) south = w.lat;
    if (w.lng > east) east = w.lng;
    if (w.lng < west) west = w.lng;
  }

  // Extract metadata name (prefer customName -> <trk><name> -> <rte><name> -> <metadata><name> -> fileName)
  const trkBlock = trimmed.match(/<(?:[a-zA-Z0-9_-]+:)?trk\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?trk>/i)?.[1] ?? '';
  const rteBlock = trimmed.match(/<(?:[a-zA-Z0-9_-]+:)?rte\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?rte>/i)?.[1] ?? '';
  const xmlName =
    extractTagText(trkBlock, 'name') ??
    extractTagText(rteBlock, 'name') ??
    extractTagText(trimmed, 'name');
  const xmlDesc =
    extractTagText(trkBlock, 'desc') ??
    extractTagText(rteBlock, 'desc') ??
    extractTagText(trimmed, 'desc') ??
    undefined;

  const cleanFileStem = options.fileName.replace(/\.[^.]+$/, '').trim() || 'GPX-маршрут';
  const resolvedName = (options.customName?.trim() || xmlName || cleanFileStem).slice(0, 80);

  const downsampledSegments: [number, number][][] = rawSegments
    .filter((seg) => seg.length >= 2)
    .map((seg) =>
      downsamplePoints(seg, MAX_POINTS_PER_SEGMENT).map((pt) => [
        Number(pt.lng.toFixed(6)),
        Number(pt.lat.toFixed(6)),
      ])
    );

  const first = allPoints[0];
  const last = allPoints[allPoints.length - 1];
  const durationS =
    Number.isFinite(minTs) && Number.isFinite(maxTs) && maxTs > minTs
      ? Math.round((maxTs - minTs) / 1000)
      : null;

  const colorIdx = Math.abs(options.colorIndex ?? 0) % GPX_TRACK_PALETTE.length;
  const bbox: MapBbox = {
    north: Number(north.toFixed(6)),
    south: Number(south.toFixed(6)),
    east: Number(east.toFixed(6)),
    west: Number(west.toFixed(6)),
  };

  const track: GpxRouteTrack = {
    id: `gpx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: resolvedName,
    file_name: options.fileName,
    description: xmlDesc,
    color: GPX_TRACK_PALETTE[colorIdx],
    visible: true,
    segments: downsampledSegments,
    waypoints: waypoints.slice(0, 50),
    start_point: { lat: Number(first.lat.toFixed(6)), lng: Number(first.lng.toFixed(6)) },
    end_point: { lat: Number(last.lat.toFixed(6)), lng: Number(last.lng.toFixed(6)) },
    bbox,
    distance_m: Math.round(distanceM),
    duration_s: durationS,
    elevation_gain_m: hasElevation ? Math.round(elevationGainM) : null,
    point_count: allPoints.length,
    recorded_at: recordedAt,
    imported_at: new Date().toISOString(),
  };

  return { ok: true, track };
}

export function formatTrackDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} м`;
  return `${(distanceM / 1000).toFixed(2)} км`;
}

export function formatTrackDuration(durationS: number | null): string | null {
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0) return null;
  const totalMin = Math.round(durationS / 60);
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

export function estimateZoomForBbox(bbox: MapBbox): number {
  const span = Math.max(Math.abs(bbox.north - bbox.south), Math.abs(bbox.east - bbox.west));
  if (span <= 0.005) return 15.2;
  if (span <= 0.015) return 14.0;
  if (span <= 0.04) return 12.8;
  if (span <= 0.12) return 11.5;
  if (span <= 0.35) return 10.2;
  return 8.8;
}

export interface GpxTracksGeoJson {
  type: 'FeatureCollection';
  features: Array<
    | {
        type: 'Feature';
        properties: {
          feature_kind: 'track';
          track_id: string;
          name: string;
          color: string;
          distance_label: string;
          duration_label: string;
          points_count: number;
        };
        geometry: {
          type: 'LineString';
          coordinates: [number, number][];
        };
      }
    | {
        type: 'Feature';
        properties: {
          feature_kind: 'start' | 'end' | 'waypoint';
          track_id: string;
          track_name: string;
          label: string;
          color: string;
          desc: string;
        };
        geometry: {
          type: 'Point';
          coordinates: [number, number];
        };
      }
  >;
}

/**
 * Converts all visible saved GPX tracks into a GeoJSON FeatureCollection for MapLibre GL overlay layers.
 */
export function buildGpxTracksGeoJson(tracks: GpxRouteTrack[]): GpxTracksGeoJson {
  const features: GpxTracksGeoJson['features'] = [];

  for (const track of tracks) {
    if (!track.visible) continue;
    const distanceLabel = formatTrackDistance(track.distance_m);
    const durationLabel = formatTrackDuration(track.duration_s) ?? '—';

    for (const seg of track.segments) {
      if (seg.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: {
          feature_kind: 'track',
          track_id: track.id,
          name: track.name,
          color: track.color,
          distance_label: distanceLabel,
          duration_label: durationLabel,
          points_count: track.point_count,
        },
        geometry: {
          type: 'LineString',
          coordinates: seg,
        },
      });
    }

    features.push({
      type: 'Feature',
      properties: {
        feature_kind: 'start',
        track_id: track.id,
        track_name: track.name,
        label: 'Старт / дом',
        color: '#16A34A',
        desc: `${track.name} · ${distanceLabel}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [track.start_point.lng, track.start_point.lat],
      },
    });

    features.push({
      type: 'Feature',
      properties: {
        feature_kind: 'end',
        track_id: track.id,
        track_name: track.name,
        label: 'Финиш / лунка',
        color: '#EA580C',
        desc: `${track.name} · ${distanceLabel}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [track.end_point.lng, track.end_point.lat],
      },
    });

    for (const wpt of track.waypoints) {
      features.push({
        type: 'Feature',
        properties: {
          feature_kind: 'waypoint',
          track_id: track.id,
          track_name: track.name,
          label: wpt.name,
          color: track.color,
          desc: wpt.desc ?? '',
        },
        geometry: {
          type: 'Point',
          coordinates: [wpt.lng, wpt.lat],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
