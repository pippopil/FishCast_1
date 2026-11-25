import type { WaterBody } from './types';

export type LngLatTuple = [number, number];

/**
 * Signed planar area of a closed ring (shoelace formula).
 * Positive => counter-clockwise (RFC 7946 outer ring).
 * Negative => clockwise (RFC 7946 hole / island cutout).
 */
export function signedRingArea(ring: LngLatTuple[]): number {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

export function ensureClosedRing(ring: LngLatTuple[]): LngLatTuple[] {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const cleaned: LngLatTuple[] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev[0] !== lng || prev[1] !== lat) {
      cleaned.push([lng, lat]);
    }
  }
  if (cleaned.length < 3) return [];
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned.length >= 4 ? cleaned : [];
}

/**
 * Enforces RFC 7946 winding order:
 * - Outer water rings: counter-clockwise (signedArea > 0)
 * - Inner island holes: clockwise (signedArea < 0)
 */
export function normalizeRingWinding(ring: LngLatTuple[], wantCCW: boolean): LngLatTuple[] {
  const closed = ensureClosedRing(ring);
  if (closed.length < 4) return [];
  const area = signedRingArea(closed);
  if (Math.abs(area) < 1e-13) return [];
  const isCCW = area > 0;
  if (isCCW === wantCCW) return closed;
  return [...closed].reverse();
}

export function pointInRing(pt: LngLatTuple, ring: LngLatTuple[]): boolean {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Ramer-Douglas-Peucker polyline simplification that preserves real bends, bays,
 * and river meanders instead of stride-sampling across dry land.
 */
export function simplifyPolylineRDP(points: LngLatTuple[], toleranceDeg = 0.00006): LngLatTuple[] {
  if (!Array.isArray(points) || points.length <= 2) return points ?? [];

  const sqTol = toleranceDeg * toleranceDeg;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end - start <= 1) continue;

    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let maxDistSq = -1;
    let maxIdx = -1;

    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i];
      let distSq: number;
      if (lenSq < 1e-18) {
        const vx = px - ax;
        const vy = py - ay;
        distSq = vx * vx + vy * vy;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = ax + t * dx;
        const projY = ay + t * dy;
        const vx = px - projX;
        const vy = py - projY;
        distSq = vx * vx + vy * vy;
      }
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIdx = i;
      }
    }

    if (maxDistSq > sqTol && maxIdx > start && maxIdx < end) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const out: LngLatTuple[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      out.push([Number(points[i][0].toFixed(5)), Number(points[i][1].toFixed(5))]);
    }
  }
  return out;
}

export function simplifyClosedRingRDP(
  ring: LngLatTuple[],
  toleranceDeg = 0.00005,
  maxVertices = 420
): LngLatTuple[] {
  const closed = ensureClosedRing(ring);
  if (closed.length < 4) return [];
  if (closed.length <= maxVertices && toleranceDeg <= 0) return closed;

  // Split closed ring into two halves between farthest vertices to avoid collapsing closed loops
  const open = closed.slice(0, -1);
  let splitIdx = Math.floor(open.length / 2);
  let maxDistSq = -1;
  const [x0, y0] = open[0];
  for (let i = 1; i < open.length; i++) {
    const dx = open[i][0] - x0;
    const dy = open[i][1] - y0;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxDistSq) {
      maxDistSq = d2;
      splitIdx = i;
    }
  }

  let tol = toleranceDeg;
  let simplified: LngLatTuple[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const halfA = simplifyPolylineRDP(open.slice(0, splitIdx + 1), tol);
    const halfB = simplifyPolylineRDP([...open.slice(splitIdx), open[0]], tol);
    simplified = ensureClosedRing([...halfA.slice(0, -1), ...halfB]);
    if (simplified.length <= maxVertices) break;
    tol *= 1.8;
  }

  return simplified.length >= 4 ? simplified : closed;
}

/**
 * Detects synthetic fallback polygons (4-corner rectangles, 8-vertex regular octagons/ellipses,
 * or coarse straight-edged placeholder bars) so the map NEVER shades dry land blue when
 * real OSM shoreline contours are unavailable.
 */
export function isSyntheticPlaceholderPolygon(ring: LngLatTuple[]): boolean {
  if (!Array.isArray(ring) || ring.length < 4) return true;
  const uniqueCount =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;

  // 3..5 unique vertices => triangle/box/pentagon placeholder (never a real natural shoreline)
  if (uniqueCount <= 5) return true;

  // Regular synthetic octagon/circle placeholder (6..10 vertices distributed evenly around an ellipse)
  if (uniqueCount <= 10) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < uniqueCount; i++) {
      const [x, y] = ring[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = Math.max(1e-6, (maxX - minX) / 2);
    const ry = Math.max(1e-6, (maxY - minY) / 2);

    // Check normalized elliptical radius uniformity — synthetic octagons have r ≈ 1.00 for all vertices
    let sumR = 0;
    const radii: number[] = [];
    for (let i = 0; i < uniqueCount; i++) {
      const nx = (ring[i][0] - cx) / rx;
      const ny = (ring[i][1] - cy) / ry;
      const r = Math.hypot(nx, ny);
      radii.push(r);
      sumR += r;
    }
    const meanR = sumR / radii.length;
    const maxDev = Math.max(...radii.map((r) => Math.abs(r - meanR)));
    if (maxDev < 0.09) return true;
  }

  return false;
}

/**
 * Stitches OSM relation ways (role: 'outer' | 'inner') end-to-end into closed polygon rings.
 * Prevents broken multipolygon relations from collapsing into bounding boxes over dry land.
 */
export function stitchOsmRelationWays(
  ways: LngLatTuple[][]
): LngLatTuple[][] {
  const remaining = ways
    .map((w) =>
      w
        .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))] as LngLatTuple)
    )
    .filter((w) => w.length >= 2);

  const rings: LngLatTuple[][] = [];
  const EPS = 0.00018; // ~15-20m endpoint snapping tolerance for OSM ways

  const ptsNear = (a: LngLatTuple, b: LngLatTuple): boolean =>
    Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

  while (remaining.length > 0) {
    let chain = remaining.shift()!;
    let extended = true;

    while (extended) {
      extended = false;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      if (chain.length >= 4 && ptsNear(head, tail)) break;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const cHead = cand[0];
        const cTail = cand[cand.length - 1];

        if (ptsNear(tail, cHead)) {
          chain = [...chain, ...cand.slice(1)];
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (ptsNear(tail, cTail)) {
          chain = [...chain, ...[...cand].reverse().slice(1)];
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (ptsNear(head, cTail)) {
          chain = [...cand.slice(0, -1), ...chain];
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (ptsNear(head, cHead)) {
          chain = [...[...cand].reverse().slice(0, -1), ...chain];
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }

    if (chain.length >= 4 && ptsNear(chain[0], chain[chain.length - 1])) {
      const closed = ensureClosedRing(chain);
      if (closed.length >= 4) rings.push(closed);
    }
  }

  return rings;
}

/**
 * Groups stitched outer water rings and inner island holes into valid RFC 7946 MultiPolygon parts:
 * each part is [outerCCW, ...innerHolesCW], ensuring islands stay dry land and only water fills.
 */
export function groupOuterAndInnerRings(
  outerRings: LngLatTuple[][],
  innerRings: LngLatTuple[][]
): LngLatTuple[][][] {
  const normalizedOuters = outerRings
    .map((r) => normalizeRingWinding(simplifyClosedRingRDP(r, 0.00005, 420), true))
    .filter((r) => r.length >= 4)
    .sort((a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a)));

  if (normalizedOuters.length === 0) return [];

  const parts: LngLatTuple[][][] = normalizedOuters.map((outer) => [outer]);

  const normalizedInners = innerRings
    .map((r) => normalizeRingWinding(simplifyClosedRingRDP(r, 0.00005, 220), false))
    .filter((r) => r.length >= 4);

  for (const hole of normalizedInners) {
    const samplePt = hole[0];
    // Assign hole to the smallest outer ring that contains it
    let targetIdx = -1;
    let smallestArea = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const outer = parts[i][0];
      const outerArea = Math.abs(signedRingArea(outer));
      if (outerArea < smallestArea && pointInRing(samplePt, outer)) {
        smallestArea = outerArea;
        targetIdx = i;
      }
    }
    if (targetIdx >= 0) {
      parts[targetIdx].push(hole);
    }
  }

  return parts;
}

export interface WaterMapLayersGeoJson {
  waterPolygons: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: {
        id: string;
        title: string;
        type: WaterBody['type'];
        confidence: number;
        unverified: number;
        selected: number;
        has_bathymetry: number;
      };
      geometry:
        | { type: 'Polygon'; coordinates: LngLatTuple[][] }
        | { type: 'MultiPolygon'; coordinates: LngLatTuple[][][] };
    }>;
  };
  waterRivers: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: {
        id: string;
        title: string;
        type: WaterBody['type'];
        selected: number;
        area_ha: number;
      };
      geometry:
        | { type: 'LineString'; coordinates: LngLatTuple[] }
        | { type: 'MultiLineString'; coordinates: LngLatTuple[][] };
    }>;
  };
  waterMarkers: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: {
        id: string;
        title: string;
        type: WaterBody['type'];
        selected: number;
        approximate: number;
      };
      geometry: { type: 'Point'; coordinates: LngLatTuple };
    }>;
  };
}

/**
 * Splits water bodies into precision MapLibre GeoJSON layers so ONLY real water
 * contours or riverbeds are highlighted — never shading dry land with synthetic boxes/octagons.
 */
export function buildWaterBodiesMapLayersGeoJson(
  waterBodies: WaterBody[],
  selectedWaterBodyId: string | null
): WaterMapLayersGeoJson {
  const polyFeatures: WaterMapLayersGeoJson['waterPolygons']['features'] = [];
  const riverFeatures: WaterMapLayersGeoJson['waterRivers']['features'] = [];
  const markerFeatures: WaterMapLayersGeoJson['waterMarkers']['features'] = [];

  for (const wb of waterBodies) {
    const isSelected = selectedWaterBodyId === wb.id ? 1 : 0;

    // 1) Exact river centerline layer (for rivers where OSM provides waterway=river LineString without riverbank area)
    if (
      Array.isArray(wb.river_lines) &&
      wb.river_lines.length > 0 &&
      wb.geometry_quality === 'centerline'
    ) {
      const validLines = wb.river_lines.filter((l) => Array.isArray(l) && l.length >= 2);
      if (validLines.length > 0) {
        riverFeatures.push({
          type: 'Feature',
          id: wb.id,
          properties: {
            id: wb.id,
            title: wb.display_label,
            type: wb.type,
            selected: isSelected,
            area_ha: wb.area_ha,
          },
          geometry:
            validLines.length === 1
              ? { type: 'LineString', coordinates: validLines[0] }
              : { type: 'MultiLineString', coordinates: validLines },
        });
        markerFeatures.push({
          type: 'Feature',
          id: `${wb.id}-pt`,
          properties: {
            id: wb.id,
            title: wb.display_label,
            type: wb.type,
            selected: isSelected,
            approximate: 0,
          },
          geometry: { type: 'Point', coordinates: [wb.center.lng, wb.center.lat] },
        });
        continue;
      }
    }

    // 2) Exact GeoJSON MultiPolygon water bodies (multiple basins + island cutouts)
    if (
      wb.geometry_quality !== 'approximate' &&
      Array.isArray(wb.polygon_parts) &&
      wb.polygon_parts.length > 0
    ) {
      const cleanParts: LngLatTuple[][][] = [];
      for (const part of wb.polygon_parts) {
        if (!Array.isArray(part) || part.length === 0) continue;
        const outer = normalizeRingWinding(part[0], true);
        if (outer.length < 4 || isSyntheticPlaceholderPolygon(outer)) continue;
        const holes = part
          .slice(1)
          .map((h) => normalizeRingWinding(h, false))
          .filter((h) => h.length >= 4);
        cleanParts.push([outer, ...holes]);
      }

      if (cleanParts.length > 0) {
        polyFeatures.push({
          type: 'Feature',
          id: wb.id,
          properties: {
            id: wb.id,
            title: wb.display_label,
            type: wb.type,
            confidence: wb.confidence,
            unverified: wb.moderation_status === 'unverified' ? 1 : 0,
            selected: isSelected,
            has_bathymetry: wb.has_bathymetry ? 1 : 0,
          },
          geometry:
            cleanParts.length === 1
              ? { type: 'Polygon', coordinates: cleanParts[0] }
              : { type: 'MultiPolygon', coordinates: cleanParts },
        });
        continue;
      }
    }

    // 3) Single-basin Polygon with optional island holes — ONLY if NOT synthetic/approximate
    const rawRings =
      wb.polygon_rings && wb.polygon_rings.length > 0 ? wb.polygon_rings : [wb.polygon];
    const outerRaw = rawRings[0] ?? [];
    const isApprox =
      wb.geometry_quality === 'approximate' || isSyntheticPlaceholderPolygon(outerRaw);

    if (!isApprox) {
      const outer = normalizeRingWinding(outerRaw, true);
      if (outer.length >= 4) {
        const holes = rawRings
          .slice(1)
          .map((h) => normalizeRingWinding(h, false))
          .filter((h) => h.length >= 4);
        polyFeatures.push({
          type: 'Feature',
          id: wb.id,
          properties: {
            id: wb.id,
            title: wb.display_label,
            type: wb.type,
            confidence: wb.confidence,
            unverified: wb.moderation_status === 'unverified' ? 1 : 0,
            selected: isSelected,
            has_bathymetry: wb.has_bathymetry ? 1 : 0,
          },
          geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
        });
        continue;
      }
    }

    // 4) Approximate / unresolved contour: render ONLY a clean water pin on the water coordinate — NEVER shade land!
    markerFeatures.push({
      type: 'Feature',
      id: wb.id,
      properties: {
        id: wb.id,
        title: wb.display_label,
        type: wb.type,
        selected: isSelected,
        approximate: 1,
      },
      geometry: { type: 'Point', coordinates: [wb.center.lng, wb.center.lat] },
    });
  }

  return {
    waterPolygons: { type: 'FeatureCollection', features: polyFeatures },
    waterRivers: { type: 'FeatureCollection', features: riverFeatures },
    waterMarkers: { type: 'FeatureCollection', features: markerFeatures },
  };
}
