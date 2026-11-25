import React, { useMemo } from 'react';
import { Bell, ChevronDown, ChevronRight, Fish, LocateFixed, Star, TrendingUp, X } from 'lucide-react';
import { buildMoonPhaseFishingAdvice, waterBodyTypeRu } from '../lib/fishLogic';
import { REGIONS_CATALOG, getRegionById } from '../lib/regions';
import type { FishSpecies, GoodBiteWaterBodyItem, WaterBody, WeatherSnapshot } from '../lib/types';

function MiniMoonPhaseDisc({
  illumination,
  isWaning,
  phaseLabel,
}: {
  illumination: number;
  isWaning: boolean;
  phaseLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, illumination));
  const frac = clamped / 100;
  const r = 10;
  const cx = 12;
  const cy = 12;

  let litPath: string | null = null;
  if (clamped < 98 && clamped > 2) {
    const rx = Math.max(0.2, Math.abs(1 - 2 * frac) * r);
    const topY = cy - r;
    const botY = cy + r;
    if (!isWaning) {
      const termSweep = frac >= 0.5 ? 1 : 0;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 1 ${cx} ${botY} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    } else {
      const termSweep = frac >= 0.5 ? 0 : 1;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 0 ${cx} ${botY} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    }
  }

  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      role="img"
      aria-label={`Фаза Луны: ${phaseLabel}, освещённость ${clamped}%`}
      className="mt-0.5 shrink-0"
    >
      <circle cx={cx} cy={cy} r={r} className="fill-slate-800 dark:fill-slate-950" />
      {clamped >= 98 ? (
        <circle cx={cx} cy={cy} r={r} className="fill-amber-200" />
      ) : litPath ? (
        <path d={litPath} className="fill-amber-200" />
      ) : null}
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="1.1" className="stroke-slate-300 dark:stroke-slate-600" />
    </svg>
  );
}

interface GoodBiteWidgetProps {
  items: GoodBiteWaterBodyItem[];
  totalInRadius: number;
  speciesList: FishSpecies[];
  selectedSpeciesId: string;
  onSelectSpeciesId: (id: string) => void;
  selectedDay: 'Сегодня' | 'Завтра';
  onSelectDay: (day: 'Сегодня' | 'Завтра') => void;
  selectedWaterBodyId: string | null;
  onSelectWaterBody: (wb: WaterBody, speciesId: string) => void;
  onOpenDirectory100Km: () => void;
  usingRealGps: boolean;
  onLocateUser: () => void;
  expandedDesktop: boolean;
  onToggleDesktop: () => void;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  onCloseMobile: () => void;
  favoriteIds?: string[];
  onOpenAlerts?: () => void;
  alertsEnabled?: boolean;
  selectedRegionId?: string;
  onChangeRegionId?: (regionId: string) => void;
  majorOnly?: boolean;
  onToggleMajorOnly?: (v: boolean) => void;
  weather?: WeatherSnapshot | null;
}

const WidgetCardContent: React.FC<{
  items: GoodBiteWaterBodyItem[];
  totalInRadius: number;
  speciesList: FishSpecies[];
  selectedSpeciesId: string;
  onSelectSpeciesId: (id: string) => void;
  selectedDay: 'Сегодня' | 'Завтра';
  onSelectDay: (day: 'Сегодня' | 'Завтра') => void;
  selectedWaterBodyId: string | null;
  onSelectWaterBody: (wb: WaterBody, speciesId: string) => void;
  onOpenDirectory100Km: () => void;
  usingRealGps: boolean;
  onLocateUser: () => void;
  onClose: () => void;
  closeLabel: string;
  favoriteIds: string[];
  onOpenAlerts?: () => void;
  alertsEnabled: boolean;
  selectedRegionId: string;
  onChangeRegionId?: (regionId: string) => void;
  majorOnly: boolean;
  onToggleMajorOnly?: (v: boolean) => void;
  weather?: WeatherSnapshot | null;
}> = ({
  items,
  totalInRadius,
  speciesList,
  selectedSpeciesId,
  onSelectSpeciesId,
  selectedDay,
  onSelectDay,
  selectedWaterBodyId,
  onSelectWaterBody,
  onOpenDirectory100Km,
  usingRealGps,
  onLocateUser,
  onClose,
  closeLabel,
  favoriteIds,
  onOpenAlerts,
  alertsEnabled,
  selectedRegionId,
  onChangeRegionId,
  majorOnly,
  onToggleMajorOnly,
  weather = null,
}) => {
  const favSet = new Set(favoriteIds);
  const activeRegion = selectedRegionId !== 'all' ? getRegionById(selectedRegionId) : null;
  const selectedSpeciesObj = useMemo(
    () => (selectedSpeciesId !== 'all' ? speciesList.find((s) => s.id === selectedSpeciesId) ?? null : null),
    [speciesList, selectedSpeciesId]
  );
  const moonAdvice = useMemo(
    () => buildMoonPhaseFishingAdvice(weather, selectedSpeciesObj),
    [weather, selectedSpeciesObj]
  );

  return (
    <section
      aria-label="Хороший клёв в радиусе 100 км"
      data-testid="good-bite-widget"
      className="flex flex-col rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <h2 className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
              {activeRegion
                ? `Хороший клёв · ${activeRegion.shortName}`
                : 'Хороший клёв · радиус 100 км'}
            </h2>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {items.length} из {totalInRadius} {majorOnly ? 'крупных водоёмов' : 'водоёмов'} (F ≥ 66)
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onOpenAlerts && (
            <button
              type="button"
              onClick={onOpenAlerts}
              title="Настройка PWA-уведомлений о росте F-Индекса"
              aria-label="Уведомления о хорошем клёве"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                alertsEnabled
                  ? 'text-sky-700 bg-sky-50 dark:bg-sky-950/60 dark:text-sky-400'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onLocateUser}
            title={usingRealGps ? 'Обновить мою геопозицию' : 'Определить мою геопозицию (GPS)'}
            aria-label="Определить моё местоположение для радиуса 100 км"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              usingRealGps
                ? 'text-teal-700 bg-teal-50 dark:bg-teal-950/60 dark:text-teal-400'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ChevronDown className="hidden md:block h-4 w-4" aria-hidden="true" />
            <X className="md:hidden h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Controls: Species, Day, Region & Major-only */}
      <div className="space-y-1.5 border-b border-slate-100 px-3.5 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <label htmlFor="good-bite-species" className="sr-only">
              Фильтр по виду рыбы
            </label>
            <select
              id="good-bite-species"
              value={selectedSpeciesId}
              onChange={(e) => onSelectSpeciesId(e.target.value)}
              className="w-full min-h-[32px] rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="all">Все виды (лучший клёв)</option>
              {speciesList.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 shrink-0">
            {(['Сегодня', 'Завтра'] as const).map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`min-h-[28px] rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  selectedDay === day
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {(onChangeRegionId || onToggleMajorOnly) && (
          <div className="flex items-center gap-1.5">
            {onChangeRegionId && (
              <select
                aria-label="Регион анализа клёва"
                data-testid="good-bite-region-select"
                value={selectedRegionId}
                onChange={(e) => onChangeRegionId(e.target.value)}
                className="min-h-[30px] flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="all">Все регионы (100 км)</option>
                {REGIONS_CATALOG.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.name}
                  </option>
                ))}
              </select>
            )}
            {onToggleMajorOnly && (
              <button
                type="button"
                data-testid="good-bite-major-only-btn"
                aria-pressed={majorOnly}
                onClick={() => onToggleMajorOnly(!majorOnly)}
                className={`min-h-[30px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  majorOnly
                    ? 'border-sky-600 bg-sky-700 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
                title="Показать только крупные водохранилища, озёра и магистральные реки/каналы"
              >
                Крупные
              </button>
            )}
          </div>
        )}
      </div>

      {/* Moon Phase & Illumination Fishing Tip (from weather_snapshot) */}
      {moonAdvice && (
        <div
          data-testid="good-bite-moon-advice"
          className="flex items-start gap-2.5 border-b border-slate-100 bg-slate-50/85 px-3.5 py-2 dark:border-slate-800 dark:bg-slate-800/50"
        >
          <MiniMoonPhaseDisc
            illumination={moonAdvice.illuminationPct}
            isWaning={moonAdvice.isWaning}
            phaseLabel={moonAdvice.phaseLabel}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {moonAdvice.phaseLabel}
                <span className="font-mono font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                  {' '}· {moonAdvice.illuminationPct}%
                </span>
              </span>
              <span
                className={`text-[10px] font-semibold ${
                  moonAdvice.tone === 'favorable'
                    ? 'text-teal-700 dark:text-teal-400'
                    : moonAdvice.tone === 'caution'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {moonAdvice.impactLabel}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] leading-snug text-slate-600 dark:text-slate-300">
              {moonAdvice.behaviorSummary}
            </p>
            <p className="mt-0.5 text-[10.5px] font-medium leading-snug text-slate-800 dark:text-slate-200">
              Совет: {moonAdvice.tacticalTip}
            </p>
          </div>
        </div>
      )}

      {/* Water Bodies List */}
      <div className="max-h-[196px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {items.length > 0 ? (
          items.map((item) => {
            const isSelected = item.water_body.id === selectedWaterBodyId;
            const isFav = favSet.has(item.water_body.id);
            return (
              <button
                key={item.water_body.id}
                type="button"
                onClick={() => onSelectWaterBody(item.water_body, item.best_species_id)}
                className={`flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-sky-50/70 dark:hover:bg-slate-800/70 ${
                  isSelected ? 'bg-sky-50/90 dark:bg-sky-950/35' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isFav && (
                      <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" aria-label="Избранный водоём" />
                    )}
                    <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.water_body.display_label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-teal-700 dark:text-teal-400">
                      {item.best_species_name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">пик {item.peak_hour}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{item.distance_km.toFixed(1)} км</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                    {waterBodyTypeRu(item.water_body.type)}
                    {item.reasons.length > 0 ? ` · ${item.reasons.join(' · ')}` : ''}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                      F-{item.f_index}
                    </div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {item.f_index >= 80 ? 'отличный' : 'хороший'}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                </div>
              </button>
            );
          })
        ) : (
          <div className="px-4 py-5 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Для выбранного вида в радиусе 100 км высокий клёв сейчас маловероятен (сезонный или погодный фактор). Выберите другой вид или «Все виды».
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3.5 py-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span>{usingRealGps ? 'По вашей геопозиции (GPS)' : 'Вероятностный расчёт F-Индекса'}</span>
        <button
          type="button"
          onClick={onOpenDirectory100Km}
          className="font-semibold text-sky-700 hover:underline dark:text-sky-400 whitespace-nowrap shrink-0"
        >
          Список 100 км →
        </button>
      </div>
    </section>
  );
};

export const GoodBiteWidget: React.FC<GoodBiteWidgetProps> = ({
  items,
  totalInRadius,
  speciesList,
  selectedSpeciesId,
  onSelectSpeciesId,
  selectedDay,
  onSelectDay,
  selectedWaterBodyId,
  onSelectWaterBody,
  onOpenDirectory100Km,
  usingRealGps,
  onLocateUser,
  expandedDesktop,
  onToggleDesktop,
  mobileOpen,
  onOpenMobile,
  onCloseMobile,
  favoriteIds = [],
  onOpenAlerts,
  alertsEnabled = false,
  selectedRegionId = 'all',
  onChangeRegionId,
  majorOnly = false,
  onToggleMajorOnly,
  weather = null,
}) => {
  return (
    <>
      {/* Tablet & Desktop (>= md / 768px): bottom-right floating widget or collapsed trigger */}
      <div className="hidden md:block absolute bottom-3 right-3 z-10">
        {expandedDesktop ? (
          <div className="w-[324px] xl:w-[368px]">
            <WidgetCardContent
              items={items}
              totalInRadius={totalInRadius}
              speciesList={speciesList}
              selectedSpeciesId={selectedSpeciesId}
              onSelectSpeciesId={onSelectSpeciesId}
              selectedDay={selectedDay}
              onSelectDay={onSelectDay}
              selectedWaterBodyId={selectedWaterBodyId}
              onSelectWaterBody={onSelectWaterBody}
              onOpenDirectory100Km={onOpenDirectory100Km}
              usingRealGps={usingRealGps}
              onLocateUser={onLocateUser}
              onClose={onToggleDesktop}
              closeLabel="Свернуть виджет хорошего клёва"
              favoriteIds={favoriteIds}
              onOpenAlerts={onOpenAlerts}
              alertsEnabled={alertsEnabled}
              selectedRegionId={selectedRegionId}
              onChangeRegionId={onChangeRegionId}
              majorOnly={majorOnly}
              onToggleMajorOnly={onToggleMajorOnly}
              weather={weather}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleDesktop}
            data-testid="good-bite-trigger-desktop"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-teal-600/30 bg-white/95 px-3.5 py-2 text-xs font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white dark:border-teal-500/40 dark:bg-slate-900/95 dark:text-slate-100 whitespace-nowrap"
          >
            <Fish className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <span>Хороший клёв · 100 км</span>
            <span className="font-mono font-bold text-teal-700 dark:text-teal-400 tabular-nums">
              ({items.length})
            </span>
          </button>
        )}
      </div>

      {/* Mobile (< md): compact trigger chip in top bar */}
      <div className="md:hidden absolute left-[182px] top-3 z-10">
        <button
          type="button"
          onClick={onOpenMobile}
          data-testid="good-bite-trigger-mobile"
          className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-teal-600/35 bg-white/95 px-2.5 py-2 text-xs font-semibold text-slate-900 shadow-sm backdrop-blur hover:bg-white dark:border-teal-500/40 dark:bg-slate-900/95 dark:text-slate-100 whitespace-nowrap"
        >
          <TrendingUp className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400 shrink-0" aria-hidden="true" />
          <span>Клёв 100 км</span>
          <span className="font-mono font-bold text-teal-700 dark:text-teal-400 tabular-nums">
            ({items.length})
          </span>
        </button>
      </div>

      {/* Mobile (< md) Overlay Sheet */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/45 p-3 pb-20 backdrop-blur-xs">
          <div className="w-full">
            <WidgetCardContent
              items={items}
              totalInRadius={totalInRadius}
              speciesList={speciesList}
              selectedSpeciesId={selectedSpeciesId}
              onSelectSpeciesId={onSelectSpeciesId}
              selectedDay={selectedDay}
              onSelectDay={onSelectDay}
              selectedWaterBodyId={selectedWaterBodyId}
              onSelectWaterBody={(wb, spId) => {
                onSelectWaterBody(wb, spId);
                onCloseMobile();
              }}
              onOpenDirectory100Km={() => {
                onCloseMobile();
                onOpenDirectory100Km();
              }}
              usingRealGps={usingRealGps}
              onLocateUser={onLocateUser}
              onClose={onCloseMobile}
              closeLabel="Закрыть виджет клёва"
              favoriteIds={favoriteIds}
              onOpenAlerts={
                onOpenAlerts
                  ? () => {
                      onCloseMobile();
                      onOpenAlerts();
                    }
                  : undefined
              }
              alertsEnabled={alertsEnabled}
              selectedRegionId={selectedRegionId}
              onChangeRegionId={onChangeRegionId}
              majorOnly={majorOnly}
              onToggleMajorOnly={onToggleMajorOnly}
              weather={weather}
            />
          </div>
        </div>
      )}
    </>
  );
};
