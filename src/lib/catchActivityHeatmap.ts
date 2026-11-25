import type { CatchReport } from './types';

export interface CatchActivityHeatmapFeature {
  type: 'Feature';
  properties: {
    activity_weight: number;
    catches_count: number;
    avg_weight_kg: number;
    freshest_hours_ago: number;
    top_species: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface CatchActivityHeatmapGeoJson {
  type: 'FeatureCollection';
  features: CatchActivityHeatmapFeature[];
}

/**
 * Computes recency multiplier in [0.2 .. 1.0] favoring catches from the last 24–72 hours.
 */
function recencyDecayFactor(createdAtIso: string, nowMs: number): { factor: number; hoursAgo: number } {
  const ts = Date.parse(createdAtIso);
  if (!Number.isFinite(ts)) {
    return { factor: 0.45, hoursAgo: 72 };
  }
  const hoursAgo = Math.max(0, (nowMs - ts) / (1000 * 60 * 60));
  if (hoursAgo <= 24) return { factor: 1.0, hoursAgo };
  if (hoursAgo <= 72) return { factor: 0.84, hoursAgo };
  if (hoursAgo <= 168) return { factor: 0.65, hoursAgo };
  if (hoursAgo <= 720) return { factor: 0.4, hoursAgo };
  return { factor: 0.22, hoursAgo };
}

/**
 * Aggregates recent public/friends catch reports into spatial activity cells (~150 m grid)
 * weighted by recency, catch weight, and author verification for MapLibre heatmap rendering.
 */
export function buildCatchActivityHeatmapGeoJson(
  reports: CatchReport[],
  nowMs = Date.now()
): CatchActivityHeatmapGeoJson {
  // ~0.0015 deg latitude ~ 165 m grid cell for aggregating overlapping spots
  const cellDeg = 0.0015;
  const cells = new Map<
    string,
    {
      sumLat: number;
      sumLng: number;
      count: number;
      sumActivity: number;
      weights: number[];
      minHoursAgo: number;
      speciesCounts: Map<string, number>;
    }
  >();

  for (const rep of reports) {
    if (rep.visibility === 'private') continue;
    if (rep.outcome === 'no_bite') continue;
    if (!Number.isFinite(rep.lat) || !Number.isFinite(rep.lng)) continue;

    const { factor: recencyFactor, hoursAgo } = recencyDecayFactor(rep.created_at, nowMs);
    const weightBonus =
      typeof rep.weight_kg === 'number' && Number.isFinite(rep.weight_kg) && rep.weight_kg > 0
        ? 1 + Math.min(0.45, rep.weight_kg / 6)
        : 1;
    const verifiedBonus = rep.author_verified ? 1.1 : 1.0;
    const pointActivity = recencyFactor * weightBonus * verifiedBonus;

    const latCell = Math.round(rep.lat / cellDeg);
    const lngCell = Math.round(rep.lng / cellDeg);
    const key = `${latCell}:${lngCell}`;

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        sumLat: 0,
        sumLng: 0,
        count: 0,
        sumActivity: 0,
        weights: [],
        minHoursAgo: hoursAgo,
        speciesCounts: new Map<string, number>(),
      };
      cells.set(key, cell);
    }

    cell.sumLat += rep.lat;
    cell.sumLng += rep.lng;
    cell.count += 1;
    cell.sumActivity += pointActivity;
    if (typeof rep.weight_kg === 'number' && Number.isFinite(rep.weight_kg) && rep.weight_kg > 0) {
      cell.weights.push(rep.weight_kg);
    }
    if (hoursAgo < cell.minHoursAgo) {
      cell.minHoursAgo = hoursAgo;
    }
    if (rep.fish_species_name) {
      cell.speciesCounts.set(rep.fish_species_name, (cell.speciesCounts.get(rep.fish_species_name) ?? 0) + 1);
    }
  }

  const features: CatchActivityHeatmapFeature[] = [];
  for (const cell of cells.values()) {
    const avgLat = cell.sumLat / cell.count;
    const avgLng = cell.sumLng / cell.count;
    const avgWeightKg =
      cell.weights.length > 0
        ? Number((cell.weights.reduce((s, w) => s + w, 0) / cell.weights.length).toFixed(2))
        : 0;
    const topSpecies =
      [...cell.speciesCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Рыба';
    // Clamp heatmap weight smoothly into [0.2 .. 3.0] so multi-catch hotspots glow vividly
    const normalizedWeight = Number(Math.min(3.0, Math.max(0.2, cell.sumActivity)).toFixed(3));

    features.push({
      type: 'Feature',
      properties: {
        activity_weight: normalizedWeight,
        catches_count: cell.count,
        avg_weight_kg: avgWeightKg,
        freshest_hours_ago: Math.round(cell.minHoursAgo),
        top_species: topSpecies,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(avgLng.toFixed(5)), Number(avgLat.toFixed(5))],
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
