import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Database, Fish, RefreshCw } from 'lucide-react';
import { recommendLures, waterBodyTypeRu } from '../lib/fishLogic';
import type { FishSpecies, KnotGuide, WaterBody } from '../lib/types';
import type { KnotsCacheMeta } from '../utils/offlineDb';

interface SpeciesReferenceProps {
  speciesList: FishSpecies[];
  knotsList: KnotGuide[];
  waterBodies: WaterBody[];
  selectedWaterBody: WaterBody | null;
  knotsCacheMeta?: KnotsCacheMeta | null;
  isOnline?: boolean;
  onRefreshKnotsCache?: () => Promise<void>;
}

const MONTHS_RU = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

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
  selectedWaterBody,
  knotsCacheMeta = null,
  isOnline = true,
  onRefreshKnotsCache,
}) => {
  const [section, setSection] = useState<'species' | 'knots'>('species');
  const [activeSpeciesId, setActiveSpeciesId] = useState(speciesList[0]?.id ?? 'pike');
  const [contextWbId, setContextWbId] = useState(selectedWaterBody?.id ?? waterBodies[0]?.id ?? '');
  const [knotQuery, setKnotQuery] = useState('');
  const [refreshingKnots, setRefreshingKnots] = useState(false);

  const activeSpecies = speciesList.find((s) => s.id === activeSpeciesId) ?? speciesList[0];
  const contextWb = waterBodies.find((w) => w.id === contextWbId) ?? null;
  const currentMonth = new Date().getMonth() + 1;

  const recs = useMemo(() => {
    if (!activeSpecies) return [];
    return recommendLures({ species: activeSpecies, waterBody: contextWb, month: currentMonth });
  }, [activeSpecies, contextWb, currentMonth]);

  const filteredKnots = knotsList.filter((k) => {
    const q = knotQuery.trim().toLowerCase();
    if (!q) return true;
    return k.name.toLowerCase().includes(q) || k.purpose.toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6 md:pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Справочник рыбака
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            16 видов рыб региона, подбор приманок под глубины водоёма и библиотека узлов — доступно офлайн.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800 self-start">
          <button
            type="button"
            onClick={() => setSection('species')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              section === 'species'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Fish className="h-4 w-4" aria-hidden="true" />
            Рыба и приманки ({speciesList.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('knots')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              section === 'knots'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Узлы и оснастки ({knotsList.length})
          </button>
        </div>
      </div>

      {section === 'species' && activeSpecies && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Species Selector */}
          <div className="lg:col-span-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="px-2 pb-2 text-xs font-bold text-slate-500">Виды рыб ({speciesList.length})</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
                {speciesList.map((s) => {
                  const active = s.id === activeSpecies.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setActiveSpeciesId(s.id)}
                      className={`flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? 'bg-sky-700 font-semibold text-white'
                          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{s.name}</span>
                      <span className={`font-mono text-[11px] ${active ? 'text-sky-100' : 'text-slate-400'}`}>
                        {s.depth_range_m[0]}–{s.depth_range_m[1]}м
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Species Detail + Intersection Lure Recommender */}
          <div className="lg:col-span-8 space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{activeSpecies.name}</h2>
                  <p className="text-xs italic text-slate-500">{activeSpecies.latin_name}</p>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Водоёмы: {activeSpecies.water_types.map(waterBodyTypeRu).join(', ')}
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

              {/* 12-Month Seasonal Calendar */}
              <div className="mt-5">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Сезонная активность по месяцам
                </div>
                <div className="mt-2.5 grid grid-cols-12 gap-1 items-end h-20">
                  {MONTHS_RU.map((mName, idx) => {
                    const mNum = idx + 1;
                    const val = activeSpecies.season_activity[mNum] ?? 0;
                    const isCurrent = mNum === currentMonth;
                    return (
                      <div key={mName} className="flex flex-col items-center gap-1 h-full justify-end">
                        <div
                          className={`w-full rounded-t ${
                            isCurrent ? 'bg-sky-700' : val >= 70 ? 'bg-teal-600/80' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                          style={{ height: `${Math.max(4, Math.round(val * 0.56))}px` }}
                          title={`${mName}: ${val}%`}
                        />
                        <span
                          className={`text-[10px] ${
                            isCurrent ? 'font-bold text-sky-700 dark:text-sky-400' : 'text-slate-500'
                          }`}
                        >
                          {mName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                {activeSpecies.release_note}
              </p>
            </div>

            {/* Lure Recommender intersected with Water Body */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Подбор приманок для водоёма
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
    </div>
  );
};
