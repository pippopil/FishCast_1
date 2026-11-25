import React, { useMemo, useState } from 'react';
import { Calendar, Car, Compass, Fish, Footprints, Globe, Loader2, MapPin, Plus, Search, Star, TrendingUp } from 'lucide-react';
import { getExpectedFishForWaterBody, waterBodyTypeRu } from '../lib/fishLogic';
import {
  MONTHS_RU_FULL,
  MONTHS_RU_PREP,
  MONTHS_RU_SHORT,
  rankFishForWaterBodyInMonth,
  type WaterBodyMonthlyFishEntry,
} from '../lib/seasonalFishing';
import { assessCrayfishPresence } from '../data/crayfishData';
import { REGIONS_CATALOG, getRegionById } from '../lib/regions';
import type {
  CatchReport,
  FishSpecies,
  GoodBiteWaterBodyItem,
  LatLng,
  NearbyWaterBody,
  WaterBody,
  WaterBodyType,
} from '../lib/types';

interface WaterBodiesDirectoryProps {
  nearbyItems: NearbyWaterBody[];
  goodBiteById: Record<string, GoodBiteWaterBodyItem>;
  goodBiteItems: GoodBiteWaterBodyItem[];
  speciesList?: FishSpecies[];
  reports?: CatchReport[];
  radiusKm: number;
  onChangeRadiusKm: (r: number) => void;
  includeUnnamed: boolean;
  onToggleIncludeUnnamed: (v: boolean) => void;
  onSelectWaterBody: (wb: WaterBody) => void;
  onAddWaterBody: (payload: {
    name: string | null;
    type: WaterBodyType;
    lat: number;
    lng: number;
    area_ha: number;
  }) => Promise<string | null>;
  onDiscoverOsmNearby?: (query?: string) => Promise<void> | void;
  discoveringOsm?: boolean;
  userOrigin: LatLng;
  favoriteIds?: string[];
  onToggleFavorite?: (waterBodyId: string) => void;
  selectedRegionId?: string;
  onChangeRegionId?: (regionId: string) => void;
  majorOnly?: boolean;
  onToggleMajorOnly?: (v: boolean) => void;
}

export const WaterBodiesDirectory: React.FC<WaterBodiesDirectoryProps> = ({
  nearbyItems,
  goodBiteById,
  goodBiteItems,
  speciesList = [],
  reports = [],
  radiusKm,
  onChangeRadiusKm,
  includeUnnamed,
  onToggleIncludeUnnamed,
  onSelectWaterBody,
  onAddWaterBody,
  onDiscoverOsmNearby,
  discoveringOsm = false,
  userOrigin,
  favoriteIds = [],
  onToggleFavorite,
  selectedRegionId = 'all',
  onChangeRegionId,
  majorOnly = false,
  onToggleMajorOnly,
}) => {
  const activeRegion = selectedRegionId !== 'all' ? getRegionById(selectedRegionId) : null;
  const favSet = new Set(favoriteIds);
  const [query, setQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<WaterBodyType>('pond');
  const [newLat, setNewLat] = useState(String((userOrigin.lat + 0.012).toFixed(4)));
  const [newLng, setNewLng] = useState(String((userOrigin.lng + 0.018).toFixed(4)));
  const [newArea, setNewArea] = useState('0.6');
  const [formError, setFormError] = useState<string | null>(null);
  const [onlyGoodBite, setOnlyGoodBite] = useState(false);
  const currentMonth = new Date().getMonth() + 1;
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [sortMode, setSortMode] = useState<'probability' | 'distance'>('probability');

  const selectedMonthFull = MONTHS_RU_FULL[selectedMonth - 1] ?? 'Январь';
  const selectedMonthPrep = MONTHS_RU_PREP[selectedMonth - 1] ?? 'январе';

  const monthlyFishByWbId = useMemo(() => {
    const map = new Map<string, WaterBodyMonthlyFishEntry[]>();
    if (speciesList.length === 0) return map;
    for (const item of nearbyItems) {
      map.set(
        item.water_body.id,
        rankFishForWaterBodyInMonth({
          waterBody: item.water_body,
          speciesList,
          reports,
          month: selectedMonth,
        })
      );
    }
    return map;
  }, [nearbyItems, speciesList, reports, selectedMonth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = nearbyItems.filter((item) => {
      if (onlyGoodBite) {
        const bite = goodBiteById[item.water_body.id];
        if (!bite || bite.f_index < 66) return false;
      }
      if (!q) return true;
      const monthlyFish = monthlyFishByWbId.get(item.water_body.id);
      const fishMatches =
        speciesList.length > 0 &&
        (monthlyFish
          ? monthlyFish.some((f) => f.species.name.toLowerCase().includes(q))
          : getExpectedFishForWaterBody({ waterBody: item.water_body, speciesList, reports }).some((f) =>
              f.species_name.toLowerCase().includes(q)
            ));
      const crayfishMatches =
        (q.includes('рак') || q.includes('crayfish')) &&
        assessCrayfishPresence(item.water_body).level !== 'low';
      return (
        item.water_body.display_label.toLowerCase().includes(q) ||
        waterBodyTypeRu(item.water_body.type).toLowerCase().includes(q) ||
        item.water_body.region.toLowerCase().includes(q) ||
        fishMatches ||
        crayfishMatches
      );
    });

    if (sortMode === 'probability' && speciesList.length > 0) {
      return [...matched].sort((a, b) => {
        const fishA = monthlyFishByWbId.get(a.water_body.id) ?? [];
        const fishB = monthlyFishByWbId.get(b.water_body.id) ?? [];
        const matchA = q ? fishA.find((f) => f.species.name.toLowerCase().includes(q)) : fishA[0];
        const matchB = q ? fishB.find((f) => f.species.name.toLowerCase().includes(q)) : fishB[0];
        const probA = matchA?.probability ?? fishA[0]?.probability ?? 0;
        const probB = matchB?.probability ?? fishB[0]?.probability ?? 0;
        if (probB !== probA) return probB - probA;
        return a.straight_distance_m - b.straight_distance_m;
      });
    }

    return [...matched].sort((a, b) => a.straight_distance_m - b.straight_distance_m);
  }, [nearbyItems, onlyGoodBite, goodBiteById, query, speciesList, reports, monthlyFishByWbId, sortMode]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const lat = Number(newLat);
    const lng = Number(newLng);
    const area_ha = Number(newArea);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setFormError('Укажите корректные координаты широты и долготы.');
      return;
    }
    const err = await onAddWaterBody({
      name: newName.trim() || null,
      type: newType,
      lat,
      lng,
      area_ha: Number.isNaN(area_ha) || area_ha <= 0 ? 0.5 : area_ha,
    });
    if (err) {
      setFormError(err);
      return;
    }
    setShowAddForm(false);
    setNewName('');
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6 md:pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Водоёмы рядом
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Крупные реки, водохранилища, старицы, карьеры и безымянные лесные пруды по данным Госводреестра, OSM и Sentinel-2.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onDiscoverOsmNearby && (
            <button
              type="button"
              data-testid="discover-osm-btn"
              disabled={discoveringOsm}
              onClick={() => void onDiscoverOsmNearby(query.trim() || undefined)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-sky-500 hover:text-sky-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:text-sky-400 whitespace-nowrap shrink-0"
            >
              {discoveringOsm ? (
                <Loader2 className="h-4 w-4 animate-spin text-sky-700 dark:text-sky-400" aria-hidden="true" />
              ) : (
                <Globe className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              )}
              {discoveringOsm
                ? 'Поиск в OSM...'
                : activeRegion
                  ? majorOnly
                    ? `Найти крупные в ${activeRegion.shortName} (OSM)`
                    : `Найти в ${activeRegion.shortName} (OSM)`
                  : 'Найти в OSM рядом'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить водоём
          </button>
        </div>
      </div>

      {/* Add Water Body Form (Crowdsourcing + Moderation) */}
      {showAddForm && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Новая точка водоёма (отправляется в очередь модерации)
          </h2>
          {formError && <p className="mt-2 text-xs font-medium text-rose-700">{formError}</p>}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label htmlFor="wb-add-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Название (необязательно)
              </label>
              <input
                id="wb-add-name"
                type="text"
                placeholder="Оставьте пустым для безымянного"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label htmlFor="wb-add-type" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Тип
              </label>
              <select
                id="wb-add-type"
                value={newType}
                onChange={(e) => setNewType(e.target.value as WaterBodyType)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="pond">Пруд</option>
                <option value="oxbow">Старица</option>
                <option value="quarry">Карьер</option>
                <option value="lake">Озеро</option>
                <option value="river">Река</option>
              </select>
            </div>
            <div>
              <label htmlFor="wb-add-lat" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Широта
              </label>
              <input
                id="wb-add-lat"
                type="text"
                value={newLat}
                onChange={(e) => setNewLat(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label htmlFor="wb-add-lng" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Долгота
              </label>
              <input
                id="wb-add-lng"
                type="text"
                value={newLng}
                onChange={(e) => setNewLng(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div>
              <label htmlFor="wb-add-area" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Площадь, га
              </label>
              <input
                id="wb-add-area"
                type="text"
                value={newArea}
                onChange={(e) => setNewArea(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-sky-700"
            >
              Отправить на модерацию
            </button>
          </div>
        </form>
      )}

      {/* Top 100 km Good Bite Summary Widget */}
      {goodBiteItems.length > 0 && (
        <section
          aria-label="Сводка хорошего клёва в радиусе 100 км"
          className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {activeRegion
                  ? `Где ожидается хороший клёв · ${activeRegion.name}${majorOnly ? ' (крупные)' : ''}`
                  : `Где ожидается хороший клёв в радиусе 100 км${majorOnly ? ' (крупные)' : ''}`}
              </h2>
            </div>
            <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
              {goodBiteItems.length} водоёмов с F ≥ 66
            </span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {goodBiteItems.slice(0, 4).map((item) => (
              <button
                key={item.water_body.id}
                type="button"
                onClick={() => onSelectWaterBody(item.water_body)}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-left transition-colors hover:border-teal-600 dark:border-slate-800 dark:bg-slate-800/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 text-xs font-bold text-slate-900 dark:text-slate-100">
                    {item.water_body.display_label}
                  </span>
                  <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 shrink-0 tabular-nums">
                    F-{item.f_index}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {item.best_species_name} · пик {item.peak_hour} ·{' '}
                  <span className="font-mono tabular-nums">{item.distance_km.toFixed(1)} км</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Search, Region & Scale Filters */}
      <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <label htmlFor="wb-search" className="sr-only">
              Поиск водоёма по названию
            </label>
            <input
              id="wb-search"
              type="search"
              placeholder="Поиск: водоём, река, озеро или рыба (судак, голавль, карп...)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {onChangeRegionId && (
            <div className="flex items-center gap-2 shrink-0">
              <MapPin className="h-4 w-4 text-sky-700 dark:text-sky-400 shrink-0" aria-hidden="true" />
              <label htmlFor="wb-region-select" className="sr-only">
                Регион (область)
              </label>
              <select
                id="wb-region-select"
                data-testid="directory-region-select"
                value={selectedRegionId}
                onChange={(e) => onChangeRegionId(e.target.value)}
                className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="all">Все регионы (по радиусу)</option>
                {REGIONS_CATALOG.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[5, 15, 35, 100].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onChangeRadiusKm(r)}
                className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold transition-colors whitespace-nowrap ${
                  radiusKm === r
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {r} км
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {onToggleMajorOnly && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-300 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="directory-major-only"
                  checked={majorOnly}
                  onChange={(e) => onToggleMajorOnly(e.target.checked)}
                  className="h-4 w-4 accent-sky-700"
                />
                Только крупные водоёмы
              </label>
            )}

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyGoodBite}
                onChange={(e) => setOnlyGoodBite(e.target.checked)}
                className="h-4 w-4 accent-teal-700"
              />
              Хороший клёв (F ≥ 66)
            </label>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeUnnamed}
                onChange={(e) => onToggleIncludeUnnamed(e.target.checked)}
                className="h-4 w-4 accent-sky-700"
              />
              Включая безымянные
            </label>
          </div>
        </div>

        {/* 12-Month Catch Probability Filter & Sort Mode */}
        {speciesList.length > 0 && (
          <div
            data-testid="directory-month-filter"
            className="border-t border-slate-100 pt-3 space-y-2.5 dark:border-slate-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Calendar className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                <span>
                  Клёв по месяцам: <span className="text-sky-700 dark:text-sky-400">{selectedMonthFull}</span>
                </span>
                {selectedMonth !== currentMonth && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(currentMonth)}
                    className="text-[11px] font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800 dark:text-sky-400"
                  >
                    Текущий месяц
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Сортировка водоёмов">
                <button
                  type="button"
                  data-testid="directory-sort-probability"
                  onClick={() => setSortMode('probability')}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    sortMode === 'probability'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  По вероятности (убыв.)
                </button>
                <button
                  type="button"
                  data-testid="directory-sort-distance"
                  onClick={() => setSortMode('distance')}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    sortMode === 'distance'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  По расстоянию
                </button>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-1 sm:grid-cols-12" role="group" aria-label="Выбор месяца рыбалки">
              {MONTHS_RU_SHORT.map((label, idx) => {
                const m = idx + 1;
                const active = selectedMonth === m;
                return (
                  <button
                    key={label}
                    type="button"
                    data-testid={`dir-month-btn-${m}`}
                    aria-pressed={active}
                    onClick={() => setSelectedMonth(m)}
                    className={`min-h-[32px] rounded-lg px-1.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-sky-700 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Results List */}
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map((item) => {
          const wb = item.water_body;
          const bite = goodBiteById[wb.id];
          const isFav = favSet.has(wb.id);
          return (
            <div
              key={wb.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-sky-500 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectWaterBody(wb)}
                    className="text-left flex-1 min-w-0"
                  >
                    <h2 className="text-base font-bold text-slate-900 hover:text-sky-700 dark:text-slate-100 dark:hover:text-sky-400">
                      {wb.display_label}
                    </h2>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-xs font-semibold text-sky-700 dark:text-sky-400 tabular-nums">
                      {(item.straight_distance_m / 1000).toFixed(1)} км
                    </span>
                    {onToggleFavorite && (
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(wb.id)}
                        aria-pressed={isFav}
                        aria-label={isFav ? `Убрать ${wb.display_label} из избранного` : `Добавить ${wb.display_label} в избранное`}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                          isFav
                            ? 'bg-amber-50 text-amber-500 dark:bg-amber-950/50'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Star className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Unboxed metadata per zero-pill discipline */}
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>{waterBodyTypeRu(wb.type)}</span>
                  {wb.region && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{wb.region}</span>
                    </>
                  )}
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono tabular-nums">{wb.area_ha} га</span>
                  <span aria-hidden="true"> · </span>
                  <span>достоверность {Math.round(wb.confidence * 100)}%</span>
                  {bite && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span
                        className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${
                          bite.f_index >= 66
                            ? 'text-teal-700 dark:text-teal-400'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        <TrendingUp className="h-3 w-3" aria-hidden="true" />
                        F-{bite.f_index} ({bite.best_species_name})
                      </span>
                    </>
                  )}
                  {wb.has_bathymetry && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-sky-700 dark:text-sky-400">есть батиметрия</span>
                    </>
                  )}
                  {wb.moderation_status === 'unverified' && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-amber-700 dark:text-amber-400">непроверено</span>
                    </>
                  )}
                </p>

                {speciesList.length > 0 && (() => {
                  const rankedFish = monthlyFishByWbId.get(wb.id) ?? [];
                  if (rankedFish.length === 0) return null;
                  const topEntries = rankedFish.slice(0, 6);
                  const extra = rankedFish.length > 6 ? ` +${rankedFish.length - 6}` : '';
                  const topProb = topEntries[0]?.probability ?? 0;
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                          <Fish className="h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                          Кто клюёт в {selectedMonthPrep} (по убыванию вероятности):
                        </span>
                        <span
                          className={`shrink-0 font-mono font-bold tabular-nums ${
                            topProb >= 68
                              ? 'text-teal-700 dark:text-teal-400'
                              : topProb >= 42
                                ? 'text-sky-700 dark:text-sky-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          до {topProb}%
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {topEntries.map((entry, idx) => (
                          <React.Fragment key={entry.species.id}>
                            {idx > 0 && <span className="text-slate-400" aria-hidden="true"> · </span>}
                            <span
                              className={
                                entry.tier === 'high'
                                  ? 'font-semibold text-slate-900 dark:text-slate-100'
                                  : ''
                              }
                            >
                              {entry.species.name}{' '}
                              <span
                                className={`font-mono text-[11px] tabular-nums ${
                                  entry.tier === 'high'
                                    ? 'font-bold text-teal-700 dark:text-teal-400'
                                    : entry.tier === 'medium'
                                      ? 'font-semibold text-sky-700 dark:text-sky-400'
                                      : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {entry.probability}%
                              </span>
                            </span>
                          </React.Fragment>
                        ))}
                        {extra && <span className="text-slate-400">{extra}</span>}
                      </p>
                    </div>
                  );
                })()}

                {(() => {
                  const cf = assessCrayfishPresence(wb);
                  return (
                    <p className="mt-1 flex items-center gap-1.5 text-xs">
                      <span
                        className={`font-semibold ${
                          cf.level === 'high'
                            ? 'text-teal-700 dark:text-teal-400'
                            : cf.level === 'medium'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {cf.shortLabel}
                      </span>
                      {cf.level !== 'low' && (
                        <span className="text-slate-500 dark:text-slate-400">
                          · сезон: {cf.bestSeason}
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>

              <button
                type="button"
                onClick={() => onSelectWaterBody(wb)}
                className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-left text-xs text-slate-600 hover:text-sky-700 dark:border-slate-800 dark:text-slate-300 dark:hover:text-sky-400"
              >
                {item.driving_available && item.driving_distance_m !== null && item.driving_duration_s !== null ? (
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Car className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    {(item.driving_distance_m / 1000).toFixed(1)} км (~{Math.round(item.driving_duration_s / 60)} мин)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                    Подъезд ограничен
                  </span>
                )}
                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <Footprints className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                  пешком {(item.walking_distance_m / 1000).toFixed(2)} км (~
                  {Math.max(1, Math.round(item.walking_duration_s / 60))} мин)
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <p>
            В радиусе {radiusKm} км по вашему фильтру водоёмы не найдены. Попробуйте увеличить радиус или включить безымянные акватории.
          </p>
          {onDiscoverOsmNearby && (
            <button
              type="button"
              disabled={discoveringOsm}
              onClick={() => void onDiscoverOsmNearby(query.trim() || undefined)}
              className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {discoveringOsm ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Globe className="h-4 w-4" aria-hidden="true" />
              )}
              {discoveringOsm ? 'Ищем в OpenStreetMap...' : 'Загрузить реки и озёра из OpenStreetMap'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
