import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Database,
  Fish,
  MapPin,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { CRAYFISH_SPOTS, type CrayfishSpot } from '../data/crayfishData';
import { CrayfishReference } from './CrayfishReference';
import { recommendLures, waterBodyTypeRu } from '../lib/fishLogic';
import {
  MONTHS_RU_FULL,
  MONTHS_RU_PREP,
  MONTHS_RU_SHORT,
  rankSpeciesForMonth,
  rankWaterBodiesForSpeciesInMonth,
} from '../lib/seasonalFishing';
import type { CatchReport, FishSpecies, KnotGuide, WaterBody } from '../lib/types';
import type { KnotsCacheMeta } from '../utils/offlineDb';

interface SpeciesReferenceProps {
  speciesList: FishSpecies[];
  knotsList: KnotGuide[];
  waterBodies: WaterBody[];
  reports?: CatchReport[];
  selectedWaterBody: WaterBody | null;
  knotsCacheMeta?: KnotsCacheMeta | null;
  isOnline?: boolean;
  onRefreshKnotsCache?: () => Promise<void>;
  onLocateCrayfishSpot?: (spot: CrayfishSpot) => void;
  onSelectWaterBody?: (wb: WaterBody) => void;
  initialSection?: 'species' | 'crayfish' | 'knots';
}

const KnotDiagramSvg: React.FC<{ type: KnotGuide['svg_type'] }> = ({ type }) => {
  return (
    <svg viewBox="0 0 180 76" className="h-16 w-full rounded-xl bg-slate-50 p-2 dark:bg-slate-800" aria-hidden="true">
      {type === 'palomar' && (
        <g stroke="#0369A1" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <circle cx="32" cy="38" r="11" stroke="#334155" />
          <path d="M40 32 C68 18, 96 18, 124 34 C142 44, 152 24, 168 38" />
          <path d="M40 44 C68 58, 96 58, 124 42 C142 32, 152 52, 168 38" stroke="#0D9488" />
        </g>
      )}
      {type === 'clinch' && (
        <g stroke="#0369A1" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <circle cx="28" cy="38" r="10" stroke="#334155" />
          <path d="M38 38 H164" />
          <path d="M56 26 Q66 50 76 26 Q86 50 96 26 Q106 50 116 26" stroke="#0D9488" />
        </g>
      )}
      {type === 'albright' && (
        <g stroke="#0369A1" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M16 32 H102 C118 32, 118 44, 102 44 H16" stroke="#334155" />
          <path d="M52 24 L60 52 M66 24 L74 52 M80 24 L88 52 M94 24 L102 52" stroke="#0D9488" />
          <path d="M108 38 H166" stroke="#0D9488" />
        </g>
      )}
      {type === 'loop' && (
        <g stroke="#0369A1" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <circle cx="32" cy="38" r="14" stroke="#0D9488" />
          <circle cx="62" cy="38" r="7" stroke="#334155" />
          <path d="M69 38 H166" />
        </g>
      )}
      {type === 'feeder' && (
        <g stroke="#0369A1" strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M16 38 H164" />
          <path d="M54 38 L78 62 L102 38" stroke="#D97706" />
          <rect x="70" y="56" width="16" height="12" rx="3" stroke="#334155" />
        </g>
      )}
    </svg>
  );
};

export const SpeciesReference: React.FC<SpeciesReferenceProps> = ({
  speciesList,
  knotsList,
  waterBodies,
  reports = [],
  selectedWaterBody,
  knotsCacheMeta = null,
  isOnline = true,
  onRefreshKnotsCache,
  onLocateCrayfishSpot,
  onSelectWaterBody,
  initialSection,
}) => {
  const [section, setSection] = useState<'species' | 'crayfish' | 'knots'>(initialSection ?? 'species');
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  const currentMonth = new Date().getMonth() + 1;
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [activeSpeciesId, setActiveSpeciesId] = useState(speciesList[0]?.id ?? 'pike');
  const [contextWbId, setContextWbId] = useState(selectedWaterBody?.id ?? waterBodies[0]?.id ?? '');
  const [knotQuery, setKnotQuery] = useState('');
  const [refreshingKnots, setRefreshingKnots] = useState(false);

  const monthlyRankings = useMemo(
    () =>
      rankSpeciesForMonth({
        speciesList,
        waterBodies,
        reports,
        month: selectedMonth,
      }),
    [speciesList, waterBodies, reports, selectedMonth]
  );

  const activeRanking =
    monthlyRankings.find((r) => r.species.id === activeSpeciesId) ?? monthlyRankings[0] ?? null;
  const activeSpecies = activeRanking?.species ?? speciesList[0];

  const rankedWaterBodiesForSpecies = useMemo(() => {
    if (!activeSpecies) return [];
    return rankWaterBodiesForSpeciesInMonth({
      species: activeSpecies,
      waterBodies,
      speciesList,
      reports,
      month: selectedMonth,
    });
  }, [activeSpecies, waterBodies, speciesList, reports, selectedMonth]);

  const contextWb = waterBodies.find((w) => w.id === contextWbId) ?? null;

  const recs = useMemo(() => {
    if (!activeSpecies) return [];
    return recommendLures({ species: activeSpecies, waterBody: contextWb, month: selectedMonth });
  }, [activeSpecies, contextWb, selectedMonth]);

  const filteredKnots = knotsList.filter((k) => {
    const q = knotQuery.trim().toLowerCase();
    if (!q) return true;
    return k.name.toLowerCase().includes(q) || k.purpose.toLowerCase().includes(q);
  });

  const selectedMonthName = MONTHS_RU_FULL[selectedMonth - 1];
  const selectedMonthPrep = MONTHS_RU_PREP[selectedMonth - 1];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6 md:pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Справочник рыбака
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Где и какая рыба клюёт по месяцам, подбор приманок, ловля раков и узлы — всё доступно офлайн.
          </p>
        </div>

        <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800 sm:flex sm:w-auto sm:items-center">
          <button
            type="button"
            onClick={() => setSection('species')}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:px-3.5 ${
              section === 'species'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Fish className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Рыба ({speciesList.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('crayfish')}
            data-testid="tab-crayfish-guide"
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:px-3.5 ${
              section === 'crayfish'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Waves className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Раки ({CRAYFISH_SPOTS.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('knots')}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:px-3.5 ${
              section === 'knots'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Узлы ({knotsList.length})</span>
          </button>
        </div>
      </div>

      {section === 'species' && activeSpecies && activeRanking && (
        <div className="mt-6 space-y-5">
          {/* 12-Month Probability Filter Strip */}
          <section
            data-testid="species-month-filter"
            aria-label="Фильтрация рыбалки по месяцам"
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Календарь клёва по месяцам: {selectedMonthName}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                <span>Сортировка: от более вероятного к менее</span>
                {selectedMonth !== currentMonth && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(currentMonth)}
                    className="font-semibold text-sky-700 hover:underline dark:text-sky-400 whitespace-nowrap"
                  >
                    Текущий ({MONTHS_RU_SHORT[currentMonth - 1]})
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-12" role="group" aria-label="Выберите месяц">
              {MONTHS_RU_SHORT.map((mLabel, idx) => {
                const mNum = idx + 1;
                const isSelected = mNum === selectedMonth;
                const isNow = mNum === currentMonth;
                return (
                  <button
                    key={mLabel}
                    type="button"
                    data-testid={`month-btn-${mNum}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedMonth(mNum)}
                    className={`min-h-[38px] rounded-xl border px-2 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      isSelected
                        ? 'border-sky-700 bg-sky-700 text-white shadow-xs'
                        : isNow
                          ? 'border-sky-300 bg-sky-50/70 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {mLabel}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Species Selector ranked strictly from most probable to least probable in selectedMonth */}
            <div className="lg:col-span-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between px-2 pb-2 text-xs font-bold text-slate-500">
                  <span>Виды рыб в {selectedMonthPrep}</span>
                  <span className="font-mono text-[11px] font-medium">вероятность</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                  {monthlyRankings.map((item, idx) => {
                    const active = item.species.id === activeSpecies.id;
                    const probColor = active
                      ? 'text-white'
                      : item.tier === 'high'
                        ? 'text-teal-700 dark:text-teal-400'
                        : item.tier === 'medium'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400';
                    const barColor = active
                      ? 'bg-sky-300'
                      : item.tier === 'high'
                        ? 'bg-teal-600'
                        : item.tier === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-slate-300 dark:bg-slate-600';
                    return (
                      <button
                        key={item.species.id}
                        type="button"
                        data-testid={`ranked-species-${item.species.id}`}
                        onClick={() => setActiveSpeciesId(item.species.id)}
                        className={`flex min-h-[48px] flex-col justify-center rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? 'bg-sky-700 font-semibold text-white'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="truncate">
                            <span className={`mr-1.5 font-mono text-xs tabular-nums ${active ? 'text-sky-200' : 'text-slate-400'}`}>
                              {idx + 1}.
                            </span>
                            {item.species.name}
                          </span>
                          <span className={`shrink-0 font-mono text-xs font-bold tabular-nums ${probColor}`}>
                            {item.probability}%
                          </span>
                        </div>
                        <div className="mt-1 flex w-full items-center gap-2">
                          <div className={`h-1 flex-1 overflow-hidden rounded-full ${active ? 'bg-sky-900/50' : 'bg-slate-200 dark:bg-slate-700'}`}>
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${item.probability}%` }} />
                          </div>
                          <span className={`shrink-0 text-[10px] tabular-nums ${active ? 'text-sky-100' : 'text-slate-400'}`}>
                            {item.tierLabel} · {item.matchingWaterBodiesCount} вод.
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Species Detail + Ranked Monthly Water Bodies + Intersection Lure Recommender */}
            <div className="lg:col-span-8 space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{activeSpecies.name}</h2>
                    <p className="text-xs italic text-slate-500">{activeSpecies.latin_name}</p>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      В {selectedMonthPrep}:{' '}
                    </span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        activeRanking.tier === 'high'
                          ? 'text-teal-700 dark:text-teal-400'
                          : activeRanking.tier === 'medium'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {activeRanking.probability}% ({activeRanking.tierLabel})
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>{activeSpecies.water_types.map(waterBodyTypeRu).join(', ')}</span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                    <div className="text-slate-500">Глубины</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                      {activeSpecies.depth_range_m[0]}–{activeSpecies.depth_range_m[1]} м
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                    <div className="text-slate-500">Опт. температура воды</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                      +{activeSpecies.optimal_water_temp_c[0]}…+{activeSpecies.optimal_water_temp_c[1]} °C
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                    <div className="text-slate-500">Время суток</div>
                    <div className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                      {activeSpecies.time_of_day}
                    </div>
                  </div>
                </div>

                {/* Clickable 12-Month Seasonal Calendar */}
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Сезонная активность по месяцам
                    </span>
                    <span className="text-[11px] text-slate-500">Нажмите на месяц для фильтрации</span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-12 gap-1 items-end h-24">
                    {MONTHS_RU_SHORT.map((mName, idx) => {
                      const mNum = idx + 1;
                      const val = activeSpecies.season_activity[mNum] ?? 0;
                      const isSelected = mNum === selectedMonth;
                      return (
                        <button
                          key={mName}
                          type="button"
                          onClick={() => setSelectedMonth(mNum)}
                          className="group flex flex-col items-center gap-1 h-full justify-end focus:outline-none"
                          title={`${MONTHS_RU_FULL[idx]}: активность ${val}%`}
                        >
                          <span className="font-mono text-[9px] text-slate-400 tabular-nums">
                            {isSelected ? `${val}%` : ''}
                          </span>
                          <div
                            className={`w-full rounded-t transition-colors ${
                              isSelected
                                ? 'bg-sky-700'
                                : val >= 70
                                  ? 'bg-teal-600/80 group-hover:bg-teal-600'
                                  : 'bg-slate-300 group-hover:bg-slate-400 dark:bg-slate-700 dark:group-hover:bg-slate-600'
                            }`}
                            style={{ height: `${Math.max(5, Math.round(val * 0.56))}px` }}
                          />
                          <span
                            className={`text-[10px] ${
                              isSelected ? 'font-bold text-sky-700 dark:text-sky-400' : 'text-slate-500'
                            }`}
                          >
                            {mName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  {activeSpecies.release_note}
                </p>
              </div>

              {/* Ranked Water Bodies where this species bites in selectedMonth (most probable -> least probable) */}
              <div
                data-testid="species-monthly-waterbodies"
                className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Где ловится {activeSpecies.name} в {selectedMonthPrep}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Водоёмы упорядочены по вероятности поимки — от наиболее перспективных к менее вероятным.
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {rankedWaterBodiesForSpecies.length} водоёмов
                  </span>
                </div>

                {rankedWaterBodiesForSpecies.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700">
                    В текущей загруженной базе нет подходящих водоёмов для вида «{activeSpecies.name}». Расширьте поиск водоёмов на карте.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {rankedWaterBodiesForSpecies.slice(0, 8).map((match, idx) => (
                      <li key={match.waterBody.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-slate-400 tabular-nums">{idx + 1}.</span>
                            <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                              {match.waterBody.display_label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {waterBodyTypeRu(match.waterBody.type)}
                            {match.waterBody.region ? ` · ${match.waterBody.region}` : ''}
                            <span> · {match.reason}</span>
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          <div className="text-right">
                            <div
                              className={`font-mono text-sm font-bold tabular-nums ${
                                match.tier === 'high'
                                  ? 'text-teal-700 dark:text-teal-400'
                                  : match.tier === 'medium'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {match.probability}%
                            </div>
                            <div className="text-[10px] text-slate-400">{match.tierLabel}</div>
                          </div>
                          {onSelectWaterBody && (
                            <button
                              type="button"
                              onClick={() => onSelectWaterBody(match.waterBody)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-slate-700 dark:text-sky-400 dark:hover:bg-slate-800 whitespace-nowrap"
                            >
                              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                              На карте
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Lure Recommender intersected with Water Body & selectedMonth */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Подбор приманок для водоёма ({selectedMonthName})
                  </h3>
                  <select
                    aria-label="Выберите водоём для расчёта приманок"
                    value={contextWbId}
                    onChange={(e) => setContextWbId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {waterBodies.map((wb) => (
                      <option key={wb.id} value={wb.id}>
                        {wb.display_label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 space-y-3">
                  {recs.map((rec, index) => (
                    <div
                      key={rec.lure.id}
                      className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-medium text-slate-500">
                            {index + 1}. {rec.lure.category} · {rec.lure.depth_min_m}–{rec.lure.depth_max_m} м
                          </span>
                          <h4 className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                            {rec.lure.lure_type}
                          </h4>
                        </div>
                        <span className="font-mono text-sm font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                          {rec.score}%
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                        Проводка: {rec.lure.retrieve}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Обоснование: {rec.lure.rationale} ({rec.reasons.join(', ')})
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === 'knots' && (
        <div className="mt-6 space-y-4">
          {/* IndexedDB Offline Cache Status Bar */}
          <div
            data-testid="knots-offline-cache-bar"
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
              <Database className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden="true" />
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Справочник узлов кэширован в IndexedDB
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-teal-700 dark:text-teal-400 tabular-nums">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {knotsCacheMeta?.count ?? knotsList.length} узлов доступно офлайн
              </span>
              {knotsCacheMeta?.cached_at && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  · обновлено{' '}
                  {new Date(knotsCacheMeta.cached_at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>

            {onRefreshKnotsCache && (
              <button
                type="button"
                disabled={!isOnline || refreshingKnots}
                onClick={async () => {
                  setRefreshingKnots(true);
                  try {
                    await onRefreshKnotsCache();
                  } finally {
                    setRefreshingKnots(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingKnots ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isOnline ? (refreshingKnots ? 'Обновляем...' : 'Обновить кэш') : 'Офлайн-режим'}
              </button>
            )}
          </div>

          <div>
            <label htmlFor="knot-search" className="sr-only">
              Поиск узла или оснастки
            </label>
            <input
              id="knot-search"
              type="search"
              placeholder="Поиск узла: Паломар, Клинч, Олбрайт, Юни, Патерностер..."
              value={knotQuery}
              onChange={(e) => setKnotQuery(e.target.value)}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredKnots.map((k) => (
              <article
                key={k.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <KnotDiagramSvg type={k.svg_type} />
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{k.name}</h3>
                    <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                      ~{k.strength_pct}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {k.difficulty} · {k.line_types}
                  </p>
                  <p className="mt-2 text-xs font-medium text-slate-700 dark:text-slate-300">{k.purpose}</p>
                  <ol className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                    {k.steps.map((step, idx) => (
                      <li key={idx}>
                        {idx + 1}. {step}
                      </li>
                    ))}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {section === 'crayfish' && (
        <CrayfishReference onLocateCrayfishSpot={onLocateCrayfishSpot} />
      )}
    </div>
  );
};
