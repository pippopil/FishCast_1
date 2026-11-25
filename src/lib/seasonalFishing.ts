import { getExpectedFishForWaterBody } from './fishLogic';
import type { CatchReport, FishAbundance, FishSpecies, WaterBody, WaterBodyFishPresence } from './types';

export const MONTHS_RU_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'] as const;

export const MONTHS_RU_FULL = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

export const MONTHS_RU_PREP = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
] as const;

export type ProbabilityTier = 'high' | 'medium' | 'low';

export interface MonthlyWaterBodyMatch {
  waterBody: WaterBody;
  probability: number; // 0..99
  tier: ProbabilityTier;
  tierLabel: 'высокая' | 'средняя' | 'низкая';
  abundance: FishAbundance;
  source: WaterBodyFishPresence['source'];
  reason: string;
}

export interface MonthlySpeciesRanking {
  species: FishSpecies;
  month: number;
  seasonalActivity: number; // raw 0..100 from species.season_activity
  probability: number; // 0..99 combined seasonal + local water body availability
  tier: ProbabilityTier;
  tierLabel: 'высокая' | 'средняя' | 'низкая';
  topWaterBodies: MonthlyWaterBodyMatch[];
  matchingWaterBodiesCount: number;
}

export interface WaterBodyMonthlyFishEntry {
  species: FishSpecies;
  probability: number; // 0..99
  tier: ProbabilityTier;
  tierLabel: 'высокая' | 'средняя' | 'низкая';
  abundance: FishAbundance;
  source: WaterBodyFishPresence['source'];
}

export function normalizeMonth(month: number): number {
  const m = Math.round(month);
  if (m < 1) return 1;
  if (m > 12) return 12;
  return m;
}

export function probabilityTierFromScore(prob: number): {
  tier: ProbabilityTier;
  tierLabel: 'высокая' | 'средняя' | 'низкая';
} {
  if (prob >= 68) return { tier: 'high', tierLabel: 'высокая' };
  if (prob >= 42) return { tier: 'medium', tierLabel: 'средняя' };
  return { tier: 'low', tierLabel: 'низкая' };
}

function abundanceMultiplier(abundance: FishAbundance): number {
  if (abundance === 'common') return 1.06;
  if (abundance === 'regular') return 0.94;
  return 0.78;
}

function sourceBonus(source: WaterBodyFishPresence['source']): number {
  if (source === 'confirmed_report') return 7;
  if (source === 'verified_community') return 5;
  if (source === 'catalog') return 2;
  return -2;
}

function sourceLabelRu(source: WaterBodyFishPresence['source']): string {
  if (source === 'confirmed_report') return 'подтверждено уловами';
  if (source === 'verified_community') return 'подтверждено рыбаками';
  if (source === 'catalog') return 'ихтиологическая база';
  return 'экологическая оценка';
}

function abundanceLabelRu(abundance: FishAbundance): string {
  if (abundance === 'common') return 'обитает массово';
  if (abundance === 'regular') return 'встречается регулярно';
  return 'редкий вид';
}

function computeSpeciesWaterBodyMonthScore(params: {
  species: FishSpecies;
  waterBody: WaterBody;
  presence: WaterBodyFishPresence;
  month: number;
}): { probability: number; reason: string } {
  const { species, waterBody, presence, month } = params;
  const m = normalizeMonth(month);
  const seasonBase = species.season_activity[m] ?? 40;

  let score = seasonBase * abundanceMultiplier(presence.abundance) + sourceBonus(presence.source);

  // Habitat & depth synergy
  const wbTypeMatch = species.water_types.includes(waterBody.type);
  if (wbTypeMatch) {
    score += 3;
  } else {
    score -= 8;
  }

  const maxDepth = waterBody.max_depth_m ?? waterBody.avg_depth_m;
  const isWinterMonth = m === 12 || m === 1 || m === 2 || m === 3;
  if (typeof maxDepth === 'number' && Number.isFinite(maxDepth)) {
    const [minSpDepth, maxSpDepth] = species.depth_range_m;
    if (maxDepth >= minSpDepth) {
      if (maxDepth <= maxSpDepth * 2.2) {
        score += 3;
      }
    } else {
      score -= 10;
    }
    // In deep winter, shallow ponds risk winterkill / very low activity
    if (isWinterMonth && maxDepth < 2.2 && (waterBody.type === 'pond' || waterBody.type === 'oxbow')) {
      score -= 12;
    }
  }

  const probability = Math.max(5, Math.min(98, Math.round(score)));
  const reasonParts = [sourceLabelRu(presence.source), abundanceLabelRu(presence.abundance)];
  if (typeof maxDepth === 'number' && maxDepth >= species.depth_range_m[0]) {
    reasonParts.push(`глубины до ${maxDepth.toFixed(1)} м`);
  }
  return {
    probability,
    reason: reasonParts.join(' · '),
  };
}

/**
 * Ranks all fish expected in a single water body for a given month,
 * ordered strictly from most probable to least probable.
 */
export function rankFishForWaterBodyInMonth(params: {
  waterBody: WaterBody;
  speciesList: FishSpecies[];
  reports: CatchReport[];
  month: number;
}): WaterBodyMonthlyFishEntry[] {
  const { waterBody, speciesList, reports, month } = params;
  const m = normalizeMonth(month);
  const speciesById = new Map(speciesList.map((s) => [s.id, s]));
  const expected = getExpectedFishForWaterBody({ waterBody, speciesList, reports });

  const entries: WaterBodyMonthlyFishEntry[] = [];
  for (const pres of expected) {
    const sp = speciesById.get(pres.species_id);
    if (!sp) continue;
    const { probability } = computeSpeciesWaterBodyMonthScore({
      species: sp,
      waterBody,
      presence: pres,
      month: m,
    });
    const { tier, tierLabel } = probabilityTierFromScore(probability);
    entries.push({
      species: sp,
      probability,
      tier,
      tierLabel,
      abundance: pres.abundance,
      source: pres.source,
    });
  }

  return entries.sort(
    (a, b) =>
      b.probability - a.probability ||
      (b.species.season_activity[m] ?? 0) - (a.species.season_activity[m] ?? 0) ||
      a.species.name.localeCompare(b.species.name, 'ru')
  );
}

/**
 * Ranks water bodies where a target species is most likely to bite in a specific month,
 * sorted strictly from most probable to least probable.
 */
export function rankWaterBodiesForSpeciesInMonth(params: {
  species: FishSpecies;
  waterBodies: WaterBody[];
  speciesList: FishSpecies[];
  reports: CatchReport[];
  month: number;
}): MonthlyWaterBodyMatch[] {
  const { species, waterBodies, speciesList, reports, month } = params;
  const m = normalizeMonth(month);
  const matches: MonthlyWaterBodyMatch[] = [];

  for (const wb of waterBodies) {
    const expected = getExpectedFishForWaterBody({ waterBody: wb, speciesList, reports });
    const pres = expected.find((e) => e.species_id === species.id);
    if (!pres) continue;

    const { probability, reason } = computeSpeciesWaterBodyMonthScore({
      species,
      waterBody: wb,
      presence: pres,
      month: m,
    });
    const { tier, tierLabel } = probabilityTierFromScore(probability);
    matches.push({
      waterBody: wb,
      probability,
      tier,
      tierLabel,
      abundance: pres.abundance,
      source: pres.source,
      reason,
    });
  }

  return matches.sort(
    (a, b) =>
      b.probability - a.probability ||
      b.waterBody.area_ha - a.waterBody.area_ha ||
      a.waterBody.display_label.localeCompare(b.waterBody.display_label, 'ru')
  );
}

/**
 * Ranks all species for a chosen month from highest catch probability to lowest,
 * including the best matching water bodies for each species.
 */
export function rankSpeciesForMonth(params: {
  speciesList: FishSpecies[];
  waterBodies: WaterBody[];
  reports: CatchReport[];
  month: number;
}): MonthlySpeciesRanking[] {
  const { speciesList, waterBodies, reports, month } = params;
  const m = normalizeMonth(month);

  // Pre-compute expected fish map per water body once for O(W + S) efficiency
  const wbExpectedMap = new Map<string, Map<string, WaterBodyFishPresence>>();
  for (const wb of waterBodies) {
    const expected = getExpectedFishForWaterBody({ waterBody: wb, speciesList, reports });
    wbExpectedMap.set(wb.id, new Map(expected.map((e) => [e.species_id, e])));
  }

  const rankings: MonthlySpeciesRanking[] = speciesList.map((species) => {
    const seasonalActivity = Math.max(0, Math.min(100, Math.round(species.season_activity[m] ?? 0)));
    const wbMatches: MonthlyWaterBodyMatch[] = [];

    for (const wb of waterBodies) {
      const pres = wbExpectedMap.get(wb.id)?.get(species.id);
      if (!pres) continue;
      const { probability, reason } = computeSpeciesWaterBodyMonthScore({
        species,
        waterBody: wb,
        presence: pres,
        month: m,
      });
      const { tier, tierLabel } = probabilityTierFromScore(probability);
      wbMatches.push({
        waterBody: wb,
        probability,
        tier,
        tierLabel,
        abundance: pres.abundance,
        source: pres.source,
        reason,
      });
    }

    wbMatches.sort(
      (a, b) =>
        b.probability - a.probability ||
        b.waterBody.area_ha - a.waterBody.area_ha ||
        a.waterBody.display_label.localeCompare(b.waterBody.display_label, 'ru')
    );

    // Combined species probability for this month blends seasonal activity with top local water body score
    const bestWbProb = wbMatches[0]?.probability ?? Math.max(5, seasonalActivity - 8);
    const probability =
      wbMatches.length > 0
        ? Math.max(5, Math.min(98, Math.round(seasonalActivity * 0.65 + bestWbProb * 0.35)))
        : Math.max(5, Math.min(95, seasonalActivity));
    const { tier, tierLabel } = probabilityTierFromScore(probability);

    return {
      species,
      month: m,
      seasonalActivity,
      probability,
      tier,
      tierLabel,
      topWaterBodies: wbMatches.slice(0, 6),
      matchingWaterBodiesCount: wbMatches.length,
    };
  });

  return rankings.sort(
    (a, b) =>
      b.probability - a.probability ||
      b.seasonalActivity - a.seasonalActivity ||
      b.matchingWaterBodiesCount - a.matchingWaterBodiesCount ||
      a.species.name.localeCompare(b.species.name, 'ru')
  );
}
