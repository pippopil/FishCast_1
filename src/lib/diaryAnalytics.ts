import type { CatchReport } from './types';

export interface HourlyCatchDatum {
  hour: number;
  hourLabel: string;
  avgWeightKg: number;
  maxWeightKg: number;
  avgWaterTempC: number | null;
  catchesCount: number;
}

export interface TempCatchDatum {
  tempC: number;
  tempLabel: string;
  avgWeightKg: number;
  maxWeightKg: number;
  catchesCount: number;
  bestHourLabel: string;
}

export interface CatchScatterPoint {
  id: string;
  hour: number;
  hourLabel: string;
  waterTempC: number;
  weightKg: number;
  speciesName: string;
  waterBodyName: string;
  bait: string;
}

export interface DiaryCatchAnalytics {
  byHourSeries: HourlyCatchDatum[];
  byTempSeries: TempCatchDatum[];
  scatterPoints: CatchScatterPoint[];
  bestHourLabel: string | null;
  bestHourAvgKg: number | null;
  overallAvgWeightKg: number | null;
  optimalWaterTempLabel: string | null;
  peakWindowSummary: string | null;
  totalAnalyzed: number;
  withWaterTempCount: number;
}

function formatHourLabel(hour: number): string {
  const clamped = ((Math.round(hour) % 24) + 24) % 24;
  return `${String(clamped).padStart(2, '0')}:00`;
}

function extractReportHour(report: CatchReport): number {
  const snapHour = report.weather_snapshot?.hour_local;
  if (typeof snapHour === 'number' && Number.isFinite(snapHour) && snapHour >= 0 && snapHour <= 23) {
    return Math.floor(snapHour);
  }
  const dt = new Date(report.created_at);
  return Number.isNaN(dt.getTime()) ? 12 : dt.getHours();
}

function extractReportWaterTemp(report: CatchReport): number | null {
  const snapTemp = report.weather_snapshot?.water_temp_c;
  if (typeof snapTemp === 'number' && Number.isFinite(snapTemp)) {
    return Number(snapTemp.toFixed(1));
  }
  // Fallback: estimate water temp from air temp in weather_summary if legacy report has no weather_snapshot
  const summary = report.weather_summary || '';
  const match = summary.match(/([+-]?\d+(?:[.,]\d+)?)\s*°\s*C/i);
  if (match) {
    const air = Number(match[1].replace(',', '.'));
    if (Number.isFinite(air)) {
      return Number(Math.max(1.0, air * 0.78 + 1.4).toFixed(1));
    }
  }
  return null;
}

/**
 * Aggregates catch reports into time-of-day, water-temperature, and 2D scatter series
 * so anglers can inspect peak feeding hours and productive water temperatures.
 */
export function buildDiaryCatchAnalytics(
  reports: CatchReport[],
  speciesFilterId = 'all'
): DiaryCatchAnalytics {
  const validCatches = reports.filter((r) => {
    if (r.outcome === 'no_bite') return false;
    if (typeof r.weight_kg !== 'number' || !Number.isFinite(r.weight_kg) || r.weight_kg <= 0) return false;
    if (speciesFilterId !== 'all' && r.fish_species_id !== speciesFilterId) return false;
    return true;
  });

  if (validCatches.length === 0) {
    return {
      byHourSeries: [],
      byTempSeries: [],
      scatterPoints: [],
      bestHourLabel: null,
      bestHourAvgKg: null,
      overallAvgWeightKg: null,
      optimalWaterTempLabel: null,
      peakWindowSummary: null,
      totalAnalyzed: 0,
      withWaterTempCount: 0,
    };
  }

  const byHour = new Map<number, { weights: number[]; temps: number[] }>();
  const byTemp = new Map<number, { weights: number[]; hours: number[] }>();
  const scatterPoints: CatchScatterPoint[] = [];
  let withWaterTempCount = 0;
  let totalWeightSum = 0;

  for (const rep of validCatches) {
    const hour = extractReportHour(rep);
    const weight = rep.weight_kg as number;
    const waterTemp = extractReportWaterTemp(rep);
    totalWeightSum += weight;

    const hBucket = byHour.get(hour) ?? { weights: [], temps: [] };
    hBucket.weights.push(weight);
    if (waterTemp !== null) {
      hBucket.temps.push(waterTemp);
      withWaterTempCount++;

      scatterPoints.push({
        id: rep.id,
        hour,
        hourLabel: formatHourLabel(hour),
        waterTempC: waterTemp,
        weightKg: Number(weight.toFixed(2)),
        speciesName: rep.fish_species_name,
        waterBodyName: rep.water_body_name,
        bait: rep.bait || 'Приманка не указана',
      });

      const tempKey = Math.round(waterTemp);
      const tBucket = byTemp.get(tempKey) ?? { weights: [], hours: [] };
      tBucket.weights.push(weight);
      tBucket.hours.push(hour);
      byTemp.set(tempKey, tBucket);
    }
    byHour.set(hour, hBucket);
  }

  const byHourSeries: HourlyCatchDatum[] = [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, bucket]) => {
      const avgWeightKg = Number(
        (bucket.weights.reduce((s, w) => s + w, 0) / bucket.weights.length).toFixed(2)
      );
      const maxWeightKg = Number(Math.max(...bucket.weights).toFixed(2));
      const avgWaterTempC =
        bucket.temps.length > 0
          ? Number((bucket.temps.reduce((s, t) => s + t, 0) / bucket.temps.length).toFixed(1))
          : null;
      return {
        hour,
        hourLabel: formatHourLabel(hour),
        avgWeightKg,
        maxWeightKg,
        avgWaterTempC,
        catchesCount: bucket.weights.length,
      };
    });

  const byTempSeries: TempCatchDatum[] = [...byTemp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tempC, bucket]) => {
      const avgWeightKg = Number(
        (bucket.weights.reduce((s, w) => s + w, 0) / bucket.weights.length).toFixed(2)
      );
      const maxWeightKg = Number(Math.max(...bucket.weights).toFixed(2));
      // Most frequent hour in this temperature band
      const hourCounts = new Map<number, number>();
      for (const h of bucket.hours) {
        hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
      }
      const topHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 7;
      return {
        tempC,
        tempLabel: `${tempC > 0 ? '+' : ''}${tempC}°C`,
        avgWeightKg,
        maxWeightKg,
        catchesCount: bucket.weights.length,
        bestHourLabel: formatHourLabel(topHour),
      };
    });

  // Best hour by average catch weight (tie-breaker: more catches)
  const bestHour = [...byHourSeries].sort(
    (a, b) => b.avgWeightKg - a.avgWeightKg || b.catchesCount - a.catchesCount
  )[0];

  const overallAvgWeightKg = Number((totalWeightSum / validCatches.length).toFixed(2));

  // Optimal water temperature band from top-half heaviest catches with water temp
  let optimalWaterTempLabel: string | null = null;
  if (byTempSeries.length > 0) {
    const sortedByWeight = [...byTempSeries].sort((a, b) => b.avgWeightKg - a.avgWeightKg);
    const topBand = sortedByWeight.slice(0, Math.min(2, sortedByWeight.length));
    const minT = Math.min(...topBand.map((x) => x.tempC));
    const maxT = Math.max(...topBand.map((x) => x.tempC));
    optimalWaterTempLabel =
      minT === maxT ? `${minT > 0 ? '+' : ''}${minT}°C` : `${minT > 0 ? '+' : ''}${minT}…${maxT > 0 ? '+' : ''}${maxT}°C`;
  }

  let peakWindowSummary: string | null = null;
  if (bestHour) {
    const nextHourLabel = formatHourLabel((bestHour.hour + 1) % 24);
    peakWindowSummary = optimalWaterTempLabel
      ? `${bestHour.hourLabel}–${nextHourLabel} при воде ${optimalWaterTempLabel}`
      : `${bestHour.hourLabel}–${nextHourLabel}`;
  }

  return {
    byHourSeries,
    byTempSeries,
    scatterPoints,
    bestHourLabel: bestHour?.hourLabel ?? null,
    bestHourAvgKg: bestHour?.avgWeightKg ?? null,
    overallAvgWeightKg,
    optimalWaterTempLabel,
    peakWindowSummary,
    totalAnalyzed: validCatches.length,
    withWaterTempCount,
  };
}
