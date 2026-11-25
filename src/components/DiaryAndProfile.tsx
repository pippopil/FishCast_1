import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Camera,
  CheckCircle2,
  Clock,
  Database,
  Download,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  Map as MapIcon,
  Maximize2,
  NotebookPen,
  RefreshCw,
  Settings,
  Thermometer,
  Trash2,
  UserCheck,
  WifiOff,
  X,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import {
  buildDiaryCatchAnalytics,
  type CatchScatterPoint,
  type HourlyCatchDatum,
  type TempCatchDatum,
} from '../lib/diaryAnalytics';
import { evaluateForecastAccuracy } from '../lib/fishLogic';
import {
  PRESET_MAP_REGIONS,
  buildOfflineBboxForRegion,
  estimateRegionTileCount,
} from '../lib/offlineMapRegions';
import { REGIONS_CATALOG } from '../lib/regions';
import {
  formatPhotoSize,
  processAndValidateDiaryPhoto,
} from '../utils/imageValidation';
import { offlineDb, type OfflineStorageStats } from '../utils/offlineDb';
import { resolveReportPhotoUrl } from '../utils/samplePhotos';
import type {
  CatchReport,
  FishSpecies,
  MapBbox,
  OfflineMapRegion,
  ReportOutcome,
  ReportVisibility,
  SyncQueueItem,
  UserProfile,
  WaterBody,
  WeatherSnapshot,
} from '../lib/types';

interface DiaryAndProfileProps {
  reports: CatchReport[];
  speciesList: FishSpecies[];
  waterBodies: WaterBody[];
  weather: WeatherSnapshot | null;
  user: UserProfile | null;
  isOnline: boolean;
  manualOffline: boolean;
  onToggleManualOffline: (offline: boolean) => void;
  syncQueue: SyncQueueItem[];
  onFlushSyncQueue: () => void;
  offlineRegions: OfflineMapRegion[];
  selectedRegionId: string;
  onDownloadOfflineRegion: (params: {
    id: string;
    name: string;
    bbox: MapBbox;
    minZoom: number;
    maxZoom: number;
    signal: AbortSignal;
    onProgress: (done: number, total: number) => void;
  }) => Promise<void>;
  onDeleteOfflineRegion: (region: OfflineMapRegion) => Promise<void>;
  onFocusOfflineRegion?: (region: OfflineMapRegion) => void;
  onCreateDiaryEntry: (payload: {
    fish_species_id: string;
    water_body_id: string | null;
    lat: number;
    lng: number;
    outcome: ReportOutcome;
    weight_kg: number | null;
    length_cm: number | null;
    bait: string;
    retrieve: string;
    notes: string;
    visibility: ReportVisibility;
    photo_url: string | null;
    photo_size_bytes?: number;
    photo_mime?: string;
  }) => Promise<string | null>;
  onDeleteReport: (id: string) => Promise<void>;
  onAuthLogin: (email: string, password: string) => Promise<string | null>;
  onAuthRegister: (email: string, password: string, nickname: string) => Promise<string | null>;
  onAuthLogout: () => Promise<void>;
  onUpdatePrivacy: (privacy: ReportVisibility) => Promise<void>;
}

export const DiaryAndProfile: React.FC<DiaryAndProfileProps> = ({
  reports,
  speciesList,
  waterBodies,
  weather,
  user,
  isOnline,
  manualOffline,
  onToggleManualOffline,
  syncQueue,
  onFlushSyncQueue,
  offlineRegions,
  selectedRegionId,
  onDownloadOfflineRegion,
  onDeleteOfflineRegion,
  onFocusOfflineRegion,
  onCreateDiaryEntry,
  onDeleteReport,
  onAuthLogin,
  onAuthRegister,
  onAuthLogout,
  onUpdatePrivacy,
}) => {
  const [outcome, setOutcome] = useState<ReportOutcome>('catch');
  const [speciesId, setSpeciesId] = useState(speciesList[0]?.id ?? 'pike');
  const [wbId, setWbId] = useState(waterBodies[0]?.id ?? '');
  const [weight, setWeight] = useState('1.8');
  const [lengthCm, setLengthCm] = useState('54');
  const [bait, setBait] = useState('Виброхвост 10 см');
  const [retrieve, setRetrieve] = useState('Ступенчатая проводка');
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<ReportVisibility>(user?.privacy_default ?? 'public');
  const [photoData, setPhotoData] = useState<{
    url: string;
    size: number;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    width: number;
    height: number;
    compressed: boolean;
  } | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ src: string; title: string; subtitle: string } | null>(null);
  const [visionMsg, setVisionMsg] = useState<string | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Offline map regions settings state
  const offlineCatalogOptions = useMemo(() => {
    const presets = PRESET_MAP_REGIONS.map((p) => ({
      id: p.id,
      group: 'preset' as const,
      name: p.name,
      description: p.description,
      bbox: p.bbox,
    }));
    const oblasts = REGIONS_CATALOG.map((r) => ({
      id: `oblast-${r.id}`,
      group: 'oblast' as const,
      name: r.name,
      description: `Центральная акватория: ${r.featuredQueries?.slice(0, 2).join(', ') || r.shortName}`,
      bbox: buildOfflineBboxForRegion(r.center, r.bbox),
    }));
    return [...presets, ...oblasts];
  }, []);

  const defaultOfflineChoice = useMemo(() => {
    if (selectedRegionId === 'kursk_oblast') return 'region-kursk-seym-lgov';
    const matchingOblast = offlineCatalogOptions.find((o) => o.id === `oblast-${selectedRegionId}`);
    return matchingOblast?.id ?? PRESET_MAP_REGIONS[0].id;
  }, [selectedRegionId, offlineCatalogOptions]);

  const [selectedOfflineOptId, setSelectedOfflineOptId] = useState<string>(defaultOfflineChoice);
  const [offlineDetailLevel, setOfflineDetailLevel] = useState<'overview' | 'detailed'>('detailed');
  const [offlineDownloading, setOfflineDownloading] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<{ done: number; total: number } | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [confirmClearOffline, setConfirmClearOffline] = useState(false);
  const offlineAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSelectedOfflineOptId(defaultOfflineChoice);
  }, [defaultOfflineChoice]);

  const selectedOfflineOption = useMemo(
    () => offlineCatalogOptions.find((o) => o.id === selectedOfflineOptId) ?? offlineCatalogOptions[0],
    [offlineCatalogOptions, selectedOfflineOptId]
  );

  const existingSelectedOfflineRegion = useMemo(
    () => offlineRegions.find((r) => r.id === selectedOfflineOption.id) ?? null,
    [offlineRegions, selectedOfflineOption.id]
  );

  const offlineZoomRange = offlineDetailLevel === 'detailed' ? { min: 10, max: 13 } : { min: 9, max: 12 };
  const estimatedOfflineTiles = useMemo(
    () => estimateRegionTileCount(selectedOfflineOption.bbox, offlineZoomRange.min, offlineZoomRange.max, 220),
    [selectedOfflineOption, offlineZoomRange.min, offlineZoomRange.max]
  );

  const totalOfflineBytes = useMemo(
    () => offlineRegions.reduce((sum, r) => sum + (r.size_bytes || 0), 0),
    [offlineRegions]
  );

  // System IndexedDB cache status state
  const [storageStats, setStorageStats] = useState<OfflineStorageStats | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);

  const refreshStorageStats = useCallback(async () => {
    setStorageLoading(true);
    try {
      const stats = await offlineDb.getStorageStats();
      setStorageStats(stats);
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const startRegionDownload = async (target: {
    id: string;
    name: string;
    bbox: MapBbox;
    minZoom: number;
    maxZoom: number;
  }) => {
    if (!isOnline) {
      setOfflineError('Для загрузки фрагментов карты OSM требуется подключение к интернету.');
      return;
    }
    setOfflineError(null);
    setConfirmClearOffline(false);
    setOfflineDownloading(true);
    const est = estimateRegionTileCount(target.bbox, target.minZoom, target.maxZoom, 220);
    setOfflineProgress({ done: 0, total: est });
    const controller = new AbortController();
    offlineAbortRef.current = controller;
    try {
      await onDownloadOfflineRegion({
        id: target.id,
        name: target.name,
        bbox: target.bbox,
        minZoom: target.minZoom,
        maxZoom: target.maxZoom,
        signal: controller.signal,
        onProgress: (done, total) => setOfflineProgress({ done, total }),
      });
      await refreshStorageStats();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setOfflineError('Не удалось полностью загрузить фрагменты OSM. Проверьте соединение и повторите.');
      }
    } finally {
      setOfflineDownloading(false);
      setOfflineProgress(null);
      offlineAbortRef.current = null;
    }
  };

  const handleStartOfflineDownload = async () => {
    await startRegionDownload({
      id: selectedOfflineOption.id,
      name: selectedOfflineOption.name,
      bbox: selectedOfflineOption.bbox,
      minZoom: offlineZoomRange.min,
      maxZoom: offlineZoomRange.max,
    });
  };

  const handleDeleteRegionWithRefresh = async (reg: OfflineMapRegion) => {
    await onDeleteOfflineRegion(reg);
    await refreshStorageStats();
  };

  const handleClearAllOfflineRegions = async () => {
    for (const reg of offlineRegions) {
      await onDeleteOfflineRegion(reg);
    }
    setConfirmClearOffline(false);
    await refreshStorageStats();
  };

  const handleCancelOfflineDownload = () => {
    offlineAbortRef.current?.abort();
  };

  // Auth states
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('angler@fishcast.ru');
  const [password, setPassword] = useState('fishcast2026');
  const [nickname, setNickname] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const diaryReports = reports;
  const weights = diaryReports
    .filter((r) => r.outcome !== 'no_bite')
    .map((r) => r.weight_kg)
    .filter((w): w is number => typeof w === 'number');
  const avgWeight = weights.length > 0 ? (weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2) : '—';

  const baitCounts = new Map<string, number>();
  for (const r of diaryReports) {
    if (r.bait && r.outcome !== 'no_bite') baitCounts.set(r.bait, (baitCounts.get(r.bait) ?? 0) + 1);
  }
  const topBait = [...baitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Виброхвост 12 см';
  const forecastAccuracy = useMemo(() => evaluateForecastAccuracy(diaryReports), [diaryReports]);

  // Recharts catch analytics state (weight vs time of day & water temp from weather_snapshot)
  const [chartMode, setChartMode] = useState<'hour' | 'temp' | 'matrix'>('hour');
  const [chartSpeciesFilter, setChartSpeciesFilter] = useState<string>('all');
  const catchAnalytics = useMemo(
    () => buildDiaryCatchAnalytics(diaryReports, chartSpeciesFilter),
    [diaryReports, chartSpeciesFilter]
  );

  useEffect(() => {
    void refreshStorageStats();
  }, [refreshStorageStats, waterBodies.length, offlineRegions.length, reports.length, speciesList.length]);

  const formatReferenceTimestamp = (iso: string | null | undefined): string => {
    if (!iso) return 'Ожидает первичного кэширования';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Ожидает первичного кэширования';
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so the user can take another shot or re-pick the same file
    e.target.value = '';
    if (!file) return;

    setFormError(null);
    setVisionMsg(null);
    setPhotoProcessing(true);
    try {
      const result = await processAndValidateDiaryPhoto(file);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setPhotoData({
        url: result.dataUrl,
        size: result.sizeBytes,
        mime: result.mime,
        width: result.width,
        height: result.height,
        compressed: result.compressed,
      });
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handleRecognizePhoto = async () => {
    if (!photoData) return;
    setVisionBusy(true);
    setVisionMsg(null);
    try {
      const base64 = photoData.url.split(',')[1] ?? '';
      const res = await fetch('/api/v1/vision/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data: base64, mimeType: photoData.mime }),
      });
      const json = (await res.json()) as {
        recognized?: boolean;
        species_id?: string | null;
        species_name?: string | null;
        confidence?: number;
        release_advice?: string;
      };
      if (json.recognized && json.species_id) {
        setSpeciesId(json.species_id);
        setVisionMsg(
          `Определено: ${json.species_name} (уверенность ${Math.round((json.confidence ?? 0) * 100)}%). ${json.release_advice ?? ''}`
        );
      } else {
        setVisionMsg(json.release_advice ?? 'Низкая уверенность — выберите вид рыбы вручную.');
      }
    } catch {
      setVisionMsg('Сервис распознавания временно недоступен — выберите вид вручную.');
    } finally {
      setVisionBusy(false);
    }
  };

  const handleDiarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const wb = waterBodies.find((w) => w.id === wbId) ?? waterBodies[0];
    const parsedW = weight.trim() === '' ? null : Number(weight.replace(',', '.'));
    const parsedL = lengthCm.trim() === '' ? null : Number(lengthCm.replace(',', '.'));
    const err = await onCreateDiaryEntry({
      fish_species_id: speciesId,
      water_body_id: wb?.id ?? null,
      lat: wb?.center.lat ?? 55.975,
      lng: wb?.center.lng ?? 36.825,
      outcome,
      weight_kg: outcome === 'no_bite' ? null : parsedW !== null && !Number.isNaN(parsedW) ? parsedW : null,
      length_cm: outcome === 'no_bite' ? null : parsedL !== null && !Number.isNaN(parsedL) ? parsedL : null,
      bait,
      retrieve,
      notes,
      visibility,
      photo_url: outcome === 'no_bite' ? null : photoData?.url ?? null,
      photo_size_bytes: outcome === 'no_bite' ? undefined : photoData?.size,
      photo_mime: outcome === 'no_bite' ? undefined : photoData?.mime,
    });
    if (err) {
      setFormError(err);
      return;
    }
    setNotes('');
    setPhotoData(null);
    setVisionMsg(null);
  };

  const exportCsv = () => {
    const header = ['Дата', 'Водоём', 'Вид', 'Вес_кг', 'Длина_см', 'Приманка', 'Погода', 'Заметка'];
    const rows = diaryReports.map((r) => [
      r.created_at,
      `"${r.water_body_name.replace(/"/g, '""')}"`,
      `"${r.fish_species_name}"`,
      r.weight_kg ?? '',
      r.length_cm ?? '',
      `"${(r.bait || '').replace(/"/g, '""')}"`,
      `"${(r.weather_summary || '').replace(/"/g, '""')}"`,
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fishcast-diary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(diaryReports, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fishcast-diary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const err =
      authMode === 'login'
        ? await onAuthLogin(email, password)
        : await onAuthRegister(email, password, nickname);
    if (err) setAuthError(err);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6 md:pb-10 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Дневник уловов и профиль
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Записи создаются даже без сети, попадают в очередь синхронизации IndexedDB и экспортируются в CSV / JSON.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleManualOffline(!manualOffline)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              manualOffline
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            {manualOffline ? 'Офлайн-тест активен' : 'Симуляция офлайна'}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Экспорт CSV
          </button>
          <button
            type="button"
            onClick={exportJson}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            JSON
          </button>
        </div>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Записей и отметок</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {diaryReports.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Средний вес улова</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {avgWeight} кг
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Лучшая приманка</div>
          <div className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">{topBait}</div>
        </div>
        <div
          data-testid="forecast-accuracy-card"
          className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="text-xs text-slate-500">Точность прогноза F</div>
          <div className="mt-1 font-mono text-2xl font-bold text-teal-700 dark:text-teal-400 tabular-nums">
            {forecastAccuracy.hitRatePct !== null ? `${forecastAccuracy.hitRatePct}%` : '—'}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500 tabular-nums">
            {forecastAccuracy.evaluatedCount > 0
              ? `Brier ${forecastAccuracy.brierScore?.toFixed(2)} · ${forecastAccuracy.evaluatedCount} отч.`
              : 'сверяется по новым отчётам'}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 md:col-span-1 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500">Очередь синхронизации</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {syncQueue.length}
            </span>
            {syncQueue.length > 0 && isOnline && (
              <button
                type="button"
                onClick={onFlushSyncQueue}
                className="inline-flex items-center gap-1 rounded-lg bg-sky-700 px-2.5 py-1 text-xs font-semibold text-white"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Синхронизировать
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main 2-column layout: Left = Analytics + New Entry + List; Right = Profile, Offline Regions & System */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-5">
          {/* Recharts Bite Analytics: Catch Weight vs Time of Day & Water Temperature */}
          <section
            data-testid="diary-catch-analytics"
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                  <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Аналитика клёва: вес улова, часы и t° воды
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Зависимость веса улова от времени суток и температуры воды из погодных снимков отчётов.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Фильтр вида рыбы на графике"
                  value={chartSpeciesFilter}
                  onChange={(e) => setChartSpeciesFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="all">Все виды</option>
                  {speciesList.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>

                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Режим графика клёва">
                  <button
                    type="button"
                    onClick={() => setChartMode('hour')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      chartMode === 'hour'
                        ? 'bg-white text-sky-800 shadow-xs dark:bg-slate-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    По часам
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('temp')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      chartMode === 'temp'
                        ? 'bg-white text-sky-800 shadow-xs dark:bg-slate-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    По t° воды
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('matrix')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      chartMode === 'matrix'
                        ? 'bg-white text-sky-800 shadow-xs dark:bg-slate-700 dark:text-sky-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Часы × t°
                  </button>
                </div>
              </div>
            </div>

            {catchAnalytics.totalAnalyzed === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500 dark:border-slate-700">
                Нет уловов с указанным весом для выбранного фильтра. Добавьте запись в дневник, чтобы построить график клёва.
              </div>
            ) : (
              <>
                <div className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {chartMode === 'hour' ? (
                      <ComposedChart data={catchAnalytics.byHourSeries} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} />
                        <XAxis
                          dataKey="hourLabel"
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="weight"
                          unit=" кг"
                          tick={{ fontSize: 11, fill: '#0284c7' }}
                          tickLine={false}
                          width={54}
                        />
                        <YAxis
                          yAxisId="temp"
                          orientation="right"
                          unit="°C"
                          tick={{ fontSize: 11, fill: '#d97706' }}
                          tickLine={false}
                          width={46}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const row = payload[0]?.payload as HourlyCatchDatum | undefined;
                            if (!row) return null;
                            return (
                              <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-900 shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
                                <div className="font-mono font-bold">
                                  {row.hourLabel} · {row.catchesCount} улов.
                                </div>
                                <div className="mt-1 space-y-0.5 tabular-nums">
                                  <div className="text-sky-700 dark:text-sky-300">
                                    Ср. вес: <span className="font-mono font-semibold">{row.avgWeightKg.toFixed(2)} кг</span>
                                  </div>
                                  <div className="text-teal-700 dark:text-teal-300">
                                    Макс. трофей: <span className="font-mono font-semibold">{row.maxWeightKg.toFixed(2)} кг</span>
                                  </div>
                                  <div className="text-amber-700 dark:text-amber-300">
                                    Вода:{' '}
                                    <span className="font-mono font-semibold">
                                      {row.avgWaterTempC !== null ? `${row.avgWaterTempC > 0 ? '+' : ''}${row.avgWaterTempC.toFixed(1)} °C` : 'нет данных'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {catchAnalytics.overallAvgWeightKg !== null && (
                          <ReferenceLine
                            yAxisId="weight"
                            y={catchAnalytics.overallAvgWeightKg}
                            stroke="#64748b"
                            strokeDasharray="4 4"
                            label={{
                              value: `ср. ${catchAnalytics.overallAvgWeightKg} кг`,
                              position: 'insideTopRight',
                              fill: '#64748b',
                              fontSize: 10,
                            }}
                          />
                        )}
                        <Bar
                          yAxisId="weight"
                          dataKey="avgWeightKg"
                          name="Ср. вес улова (кг)"
                          fill="#0284c7"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={36}
                        />
                        <Line
                          yAxisId="temp"
                          type="monotone"
                          dataKey="avgWaterTempC"
                          name="Темп. воды (°C)"
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#f59e0b' }}
                          connectNulls
                        />
                      </ComposedChart>
                    ) : chartMode === 'temp' ? (
                      <ComposedChart data={catchAnalytics.byTempSeries} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} />
                        <XAxis
                          dataKey="tempLabel"
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                        />
                        <YAxis
                          unit=" кг"
                          tick={{ fontSize: 11, fill: '#0284c7' }}
                          tickLine={false}
                          width={54}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const row = payload[0]?.payload as TempCatchDatum | undefined;
                            if (!row) return null;
                            return (
                              <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-900 shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
                                <div className="font-mono font-bold">
                                  Вода {row.tempLabel} · {row.catchesCount} улов.
                                </div>
                                <div className="mt-1 space-y-0.5 tabular-nums">
                                  <div className="text-teal-700 dark:text-teal-300">
                                    Ср. вес: <span className="font-mono font-semibold">{row.avgWeightKg.toFixed(2)} кг</span>
                                  </div>
                                  <div className="text-sky-700 dark:text-sky-300">
                                    Трофей: <span className="font-mono font-semibold">{row.maxWeightKg.toFixed(2)} кг</span>
                                  </div>
                                  <div className="text-slate-500 dark:text-slate-400">
                                    Чаще всего клевало в <span className="font-mono font-semibold">{row.bestHourLabel}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar
                          dataKey="avgWeightKg"
                          name="Ср. вес улова (кг)"
                          fill="#0d9488"
                          radius={[6, 6, 0, 0]}
                          maxBarSize={36}
                        />
                        <Line
                          type="monotone"
                          dataKey="maxWeightKg"
                          name="Трофей (кг)"
                          stroke="#0284c7"
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: '#0284c7' }}
                        />
                      </ComposedChart>
                    ) : (
                      <ScatterChart margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} />
                        <XAxis
                          type="number"
                          dataKey="hour"
                          name="Время суток"
                          domain={[0, 23]}
                          tickFormatter={(h: number) => `${String(Math.round(h)).padStart(2, '0')}:00`}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          tickLine={false}
                        />
                        <YAxis
                          type="number"
                          dataKey="waterTempC"
                          name="Темп. воды"
                          unit="°C"
                          tick={{ fontSize: 11, fill: '#d97706' }}
                          tickLine={false}
                          width={48}
                        />
                        <ZAxis type="number" dataKey="weightKg" range={[60, 360]} name="Вес улова" unit=" кг" />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const pt = payload[0]?.payload as CatchScatterPoint | undefined;
                            if (!pt) return null;
                            return (
                              <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-900 shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
                                <div className="font-bold">
                                  {pt.speciesName} · <span className="font-mono">{pt.weightKg.toFixed(2)} кг</span>
                                </div>
                                <div className="mt-1 space-y-0.5 text-[11px] tabular-nums">
                                  <div>
                                    Время: <span className="font-mono font-semibold">{pt.hourLabel}</span> · Вода:{' '}
                                    <span className="font-mono font-semibold">{pt.waterTempC > 0 ? '+' : ''}{pt.waterTempC}°C</span>
                                  </div>
                                  <div className="text-slate-500 dark:text-slate-400">{pt.waterBodyName}</div>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Scatter
                          name="Уловы (размер точки = вес, кг)"
                          data={catchAnalytics.scatterPoints}
                          fill="#0284c7"
                          fillOpacity={0.78}
                        />
                      </ScatterChart>
                    )}
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                    <Clock className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500">Лучший час клёва</div>
                      <div className="truncate font-mono text-xs font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {catchAnalytics.bestHourLabel ?? '—'}
                        {catchAnalytics.bestHourAvgKg !== null ? ` · ср. ${catchAnalytics.bestHourAvgKg} кг` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                    <Thermometer className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500">Продуктивная t° воды</div>
                      <div className="truncate font-mono text-xs font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {catchAnalytics.optimalWaterTempLabel ?? 'нет снимка погоды'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                    <BarChart3 className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500">Оптимальное окно</div>
                      <div className="truncate font-mono text-xs font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {catchAnalytics.peakWindowSummary ?? `${catchAnalytics.totalAnalyzed} отч.`}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* Create Diary Entry Form */}
          <form
            onSubmit={(e) => void handleDiarySubmit(e)}
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                <NotebookPen className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                Новая запись в дневник
              </h2>
              {weather && (
                <span className="text-xs text-slate-500 font-mono">
                  Погода: {weather.pressure_mmhg} мм · {weather.air_temp_c}°C
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="Итог рыбалки">
              <button
                type="button"
                onClick={() => setOutcome('catch')}
                className={`min-h-[36px] rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
                  outcome === 'catch'
                    ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Улов / поклёвки
              </button>
              <button
                type="button"
                onClick={() => setOutcome('no_bite')}
                className={`min-h-[36px] rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
                  outcome === 'no_bite'
                    ? 'bg-white text-amber-700 shadow-sm dark:bg-slate-700 dark:text-amber-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                Был на водоёме — клёва нет
              </button>
            </div>

            {formError && (
              <div role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-800">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="diary-species" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {outcome === 'no_bite' ? 'Целевой вид рыбы' : 'Вид рыбы'}
                </label>
                <select
                  id="diary-species"
                  value={speciesId}
                  onChange={(e) => setSpeciesId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  {speciesList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="diary-wb" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Водоём
                </label>
                <select
                  id="diary-wb"
                  value={wbId}
                  onChange={(e) => setWbId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  {waterBodies.map((wb) => (
                    <option key={wb.id} value={wb.id}>
                      {wb.display_label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {outcome === 'catch' && (
                <>
                  <div>
                    <label htmlFor="diary-weight" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Вес, кг
                    </label>
                    <input
                      id="diary-weight"
                      type="text"
                      inputMode="decimal"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label htmlFor="diary-len" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Длина, см
                    </label>
                    <input
                      id="diary-len"
                      type="text"
                      inputMode="decimal"
                      value={lengthCm}
                      onChange={(e) => setLengthCm(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                </>
              )}
              <div className={outcome === 'no_bite' ? 'col-span-2 sm:col-span-4' : 'col-span-2'}>
                <label htmlFor="diary-bait" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {outcome === 'no_bite' ? 'Что пробовали (приманки / снасть)' : 'Приманка / наживка'}
                </label>
                <input
                  id="diary-bait"
                  type="text"
                  value={bait}
                  onChange={(e) => setBait(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="diary-retrieve" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Проводка / глубина
                </label>
                <input
                  id="diary-retrieve"
                  type="text"
                  value={retrieve}
                  onChange={(e) => setRetrieve(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label htmlFor="diary-vis" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Приватность
                </label>
                <select
                  id="diary-vis"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ReportVisibility)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="public">Видна всем</option>
                  <option value="friends">Друзьям</option>
                  <option value="private">Только в личный дневник</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="diary-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Заметка
              </label>
              <textarea
                id="diary-notes"
                rows={2}
                placeholder="Условия, точка заброса, поклёвки..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    <span>{photoProcessing ? 'Проверка...' : 'Снять на камеру'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={photoProcessing}
                      onChange={(e) => void handlePhotoUpload(e)}
                      className="sr-only"
                    />
                  </label>

                  <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    <span>Из галереи</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={photoProcessing}
                      onChange={(e) => void handlePhotoUpload(e)}
                      className="sr-only"
                    />
                  </label>

                  {photoData && (
                    <button
                      type="button"
                      disabled={visionBusy}
                      onClick={() => void handleRecognizePhoto()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200"
                    >
                      {visionBusy ? 'Распознаём...' : 'Определить вид по фото'}
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={photoProcessing}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                >
                  {isOnline ? 'Сохранить запись' : 'Сохранить в офлайн-очередь'}
                </button>
              </div>

              {photoData && outcome !== 'no_bite' && (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/70">
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxPhoto({
                        src: photoData.url,
                        title: 'Предпросмотр фото улова',
                        subtitle: `${photoData.width}×${photoData.height} · ${formatPhotoSize(photoData.size)}`,
                      })
                    }
                    className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                    title="Увеличить фото"
                  >
                    <img
                      src={photoData.url}
                      alt="Предпросмотр прикреплённого фото"
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
                      <CheckCircle2 className="h-3.5 w-3.5 text-teal-600 shrink-0" aria-hidden="true" />
                      <span>Фото проверено и готово к сохранению</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {photoData.width}×{photoData.height} пикс. · {formatPhotoSize(photoData.size)}
                      {photoData.compressed ? ' · оптимизировано для офлайн' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Удалить прикреплённое фото"
                    onClick={() => {
                      setPhotoData(null);
                      setVisionMsg(null);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-rose-600 dark:hover:bg-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {visionMsg && <p className="text-xs text-slate-600 dark:text-slate-300">{visionMsg}</p>}
            </div>
          </form>

          {/* Diary Entries Feed */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Лента уловов и отметок ({diaryReports.length})
            </h2>

            {diaryReports.map((rep) => {
              const photoSrc = resolveReportPhotoUrl(rep.photo_url);
              return (
                <article
                  key={rep.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row dark:border-slate-800 dark:bg-slate-900"
                >
                  {photoSrc && (
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxPhoto({
                          src: photoSrc,
                          title: `${rep.fish_species_name}${rep.weight_kg !== null ? ` · ${rep.weight_kg} кг` : ''}`,
                          subtitle: `${rep.water_body_name} · ${rep.author_nickname}`,
                        })
                      }
                      className="group relative h-32 w-full shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 sm:h-28 sm:w-36 dark:border-slate-700 dark:bg-slate-800"
                      aria-label={`Открыть фото улова: ${rep.fish_species_name}`}
                    >
                      <img
                        src={photoSrc}
                        alt={`Улов: ${rep.fish_species_name}`}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                      <span className="absolute right-1.5 bottom-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-900/70 text-white backdrop-blur-xs">
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {rep.fish_species_name}
                            {rep.outcome !== 'no_bite' && rep.weight_kg !== null ? ` · ${rep.weight_kg} кг` : ''}
                            {rep.outcome !== 'no_bite' && rep.length_cm !== null ? ` · ${rep.length_cm} см` : ''}
                          </h3>
                          {rep.outcome === 'no_bite' && (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Без поклёвок (калибровка)
                            </span>
                          )}
                          {typeof rep.predicted_f_index === 'number' && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 tabular-nums dark:bg-slate-800 dark:text-slate-300">
                              Прогноз F-{rep.predicted_f_index}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {rep.water_body_name} · {rep.author_nickname} ·{' '}
                          {new Date(rep.created_at).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Удалить запись ${rep.fish_species_name}`}
                        onClick={() => void onDeleteReport(rep.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {rep.bait || 'Приманка не указана'}
                      {rep.retrieve ? ` · ${rep.retrieve}` : ''}
                    </p>
                    {rep.notes && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{rep.notes}</p>}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* Right Column: Profile & Auth */}
        <div className="lg:col-span-4 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            {user ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-white">
                      <UserCheck className="h-4 w-4 text-teal-600" aria-hidden="true" />
                      {user.nickname}
                    </div>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onAuthLogout()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Выйти
                  </button>
                </div>

                <div>
                  <label htmlFor="profile-privacy" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Приватность меток по умолчанию
                  </label>
                  <select
                    id="profile-privacy"
                    value={user.privacy_default}
                    onChange={(e) => void onUpdatePrivacy(e.target.value as ReportVisibility)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="public">Всем пользователям</option>
                    <option value="friends">Только друзьям</option>
                    <option value="private">Скрыть точку по умолчанию</option>
                  </select>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void handleAuthSubmit(e)} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {authMode === 'login' ? 'Вход в аккаунт' : 'Регистрация'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                    className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {authMode === 'login' ? 'Создать профиль' : 'Уже есть аккаунт'}
                  </button>
                </div>

                {authError && <p className="text-xs font-medium text-rose-700">{authError}</p>}

                {authMode === 'register' && (
                  <div>
                    <label htmlFor="auth-nick" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                      Никнейм рыбака
                    </label>
                    <input
                      id="auth-nick"
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="auth-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Email
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label htmlFor="auth-pass" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                    Пароль
                  </label>
                  <input
                    id="auth-pass"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  className="min-h-[44px] w-full rounded-xl bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-sky-700"
                >
                  {authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                </button>
                <p className="text-[11px] text-slate-500">
                  Демо-доступ предзаполнен: angler@fishcast.ru / fishcast2026
                </p>
              </form>
            )}
          </div>

          {/* Settings Heading */}
          <div className="flex items-center justify-between pt-1">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">
              <Settings className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Настройки приложения
            </h2>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {storageStats?.mapTilesCount ?? 0} плиток в IndexedDB
            </span>
          </div>

          {/* Settings Section: Offline OSM Map Regions */}
          <section
            data-testid="offline-regions-settings"
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                  <HardDrive className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Офлайн-области
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Скачивайте фрагменты карты OSM и водоёмы выбранного региона в локальную базу IndexedDB для работы без интернета.
                </p>
              </div>
              <div className="shrink-0 text-right font-mono text-[11px] font-semibold text-slate-600 tabular-nums dark:text-slate-300">
                <div>{offlineRegions.length} обл.</div>
                <div className="text-[10px] text-slate-500">
                  {totalOfflineBytes > 0 ? formatPhotoSize(totalOfflineBytes) : formatPhotoSize(storageStats?.mapTilesBytes ?? 0)}
                </div>
              </div>
            </div>

            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/80 dark:bg-slate-800/40">
              <div>
                <label htmlFor="offline-region-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Выберите регион для кэширования OSM
                </label>
                <select
                  id="offline-region-select"
                  value={selectedOfflineOptId}
                  disabled={offlineDownloading}
                  onChange={(e) => setSelectedOfflineOptId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <optgroup label="Популярные рыболовные зоны">
                    {offlineCatalogOptions
                      .filter((o) => o.group === 'preset')
                      .map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Регионы России (центр области)">
                    {offlineCatalogOptions
                      .filter((o) => o.group === 'oblast')
                      .map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedOfflineOption.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900">
                <button
                  type="button"
                  disabled={offlineDownloading}
                  onClick={() => setOfflineDetailLevel('overview')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    offlineDetailLevel === 'overview'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Обзор (z9–12)
                </button>
                <button
                  type="button"
                  disabled={offlineDownloading}
                  onClick={() => setOfflineDetailLevel('detailed')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    offlineDetailLevel === 'detailed'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Подробно (z10–13)
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-600 tabular-nums dark:text-slate-300">
                <span>Оценка: {estimatedOfflineTiles} плиток OSM</span>
                <span className="font-mono">≈ {((estimatedOfflineTiles * 18) / 1024).toFixed(1)} МБ</span>
              </div>

              {existingSelectedOfflineRegion && !offlineDownloading && (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Уже в кэше: {existingSelectedOfflineRegion.cached_tiles} плиток ({formatPhotoSize(existingSelectedOfflineRegion.size_bytes)})
                  </span>
                </div>
              )}

              {offlineError && (
                <div role="alert" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                  {offlineError}
                </div>
              )}

              {offlineDownloading && offlineProgress ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-sky-800 tabular-nums dark:text-sky-300">
                    <span>
                      Загрузка плиток OSM: {offlineProgress.done} / {offlineProgress.total}
                    </span>
                    <span className="font-mono">
                      {Math.round((offlineProgress.done / Math.max(1, offlineProgress.total)) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div
                      className="h-full bg-sky-600 transition-all duration-150"
                      style={{
                        width: `${Math.min(100, Math.round((offlineProgress.done / Math.max(1, offlineProgress.total)) * 100))}%`,
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelOfflineDownload}
                    className="w-full rounded-lg border border-slate-300 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200"
                  >
                    Отменить загрузку
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!isOnline}
                  onClick={() => void handleStartOfflineDownload()}
                  className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {!isOnline
                    ? 'Нет подключения к сети'
                    : existingSelectedOfflineRegion
                      ? 'Обновить фрагменты OSM'
                      : 'Скачать карту для офлайна'}
                </button>
              )}
            </div>

            {/* Downloaded regions management list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Скачанные регионы ({offlineRegions.length})
                </span>
                {offlineRegions.length > 0 && !offlineDownloading && (
                  confirmClearOffline ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleClearAllOfflineRegions()}
                        className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700"
                      >
                        Подтвердить
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearOffline(false)}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearOffline(true)}
                      className="text-[11px] font-medium text-slate-500 hover:text-rose-600 dark:text-slate-400"
                    >
                      Очистить все
                    </button>
                  )
                )}
              </div>
              {offlineRegions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-slate-500 dark:border-slate-700">
                  Пока нет загруженных офлайн-областей. Выберите регион выше и нажмите «Скачать».
                </p>
              ) : (
                <ul className="space-y-2">
                  {offlineRegions.map((reg) => (
                    <li
                      key={reg.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                            {reg.name}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                            {reg.cached_tiles}/{reg.tile_count} плиток · {formatPhotoSize(reg.size_bytes)} · z{reg.min_zoom}–{reg.max_zoom}
                          </div>
                          <div className="text-[10px] text-slate-400 tabular-nums">
                            Водоёмов в кэше: {reg.water_body_ids.length} ·{' '}
                            {new Date(reg.downloaded_at).toLocaleDateString('ru-RU')}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isOnline && !offlineDownloading && (
                            <button
                              type="button"
                              onClick={() =>
                                void startRegionDownload({
                                  id: reg.id,
                                  name: reg.name,
                                  bbox: reg.bbox,
                                  minZoom: reg.min_zoom,
                                  maxZoom: reg.max_zoom,
                                })
                              }
                              aria-label={`Обновить кэш области ${reg.name}`}
                              title="Обновить плитки OSM"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onFocusOfflineRegion && (
                            <button
                              type="button"
                              onClick={() => onFocusOfflineRegion(reg)}
                              aria-label={`Показать область ${reg.name} на карте`}
                              title="Показать на карте"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sky-700 hover:bg-sky-50 dark:border-slate-700 dark:text-sky-400 dark:hover:bg-slate-700"
                            >
                              <MapIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDeleteRegionWithRefresh(reg)}
                            aria-label={`Удалить офлайн-область ${reg.name}`}
                            title="Удалить кэш области"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Settings Section: System & Offline IndexedDB Cache Status */}
          <section
            data-testid="system-cache-settings"
            className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                  <Database className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
                  Система
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Статус локального кэширования IndexedDB — что доступно без интернета.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshStorageStats()}
                disabled={storageLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-3 w-3 ${storageLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Обновить
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-teal-50 px-3 py-2 text-xs dark:bg-teal-950/50">
              <span className="inline-flex items-center gap-1.5 font-semibold text-teal-800 dark:text-teal-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {(storageStats?.waterBodiesCount ?? 0) > 0 && (storageStats?.speciesCount ?? 0) > 0
                  ? 'Офлайн-база готова к работе'
                  : 'Идёт локальное кэширование'}
              </span>
              <span className="font-mono text-[11px] text-teal-700 dark:text-teal-300">
                IndexedDB
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/80 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Занято в IndexedDB</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white tabular-nums">
                  {storageStats ? formatPhotoSize(storageStats.indexedDbUsedBytes) : '—'}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Плитки OSM: {storageStats ? formatPhotoSize(storageStats.mapTilesBytes) : '0 КБ'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700/80 dark:bg-slate-800/40">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Сохранено водоёмов</div>
                <div className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white tabular-nums">
                  {storageStats ? storageStats.waterBodiesCount : waterBodies.length}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Плиток: {storageStats?.mapTilesCount ?? 0} · Отчётов: {storageStats?.reportsCount ?? reports.length}
                </div>
              </div>
            </div>

            {storageStats?.storageQuotaBytes && storageStats.storageQuotaBytes > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Квота хранилища устройства</span>
                  <span className="font-mono">
                    {formatPhotoSize(storageStats.storageEstimateUsedBytes ?? storageStats.indexedDbUsedBytes)} /{' '}
                    {formatPhotoSize(storageStats.storageQuotaBytes)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full bg-teal-600"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          2,
                          Math.round(
                            ((storageStats.storageEstimateUsedBytes ?? storageStats.indexedDbUsedBytes) /
                              storageStats.storageQuotaBytes) *
                              100
                          )
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <dl className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500 dark:text-slate-400">Справочники офлайн</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-200">
                  {storageStats?.speciesCount || speciesList.length} рыб · {storageStats?.knotsCount ?? 0} узлов · раки
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Обновление справочников</dt>
                <dd className="text-right font-mono text-[11px] font-medium text-slate-800 dark:text-slate-200">
                  {formatReferenceTimestamp(storageStats?.referencesUpdatedAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2 gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Обновление базы водоёмов</dt>
                <dd className="text-right font-mono text-[11px] font-medium text-slate-800 dark:text-slate-200">
                  {formatReferenceTimestamp(storageStats?.waterBodiesUpdatedAt)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {/* Photo Lightbox Modal */}
      {lightboxPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxPhoto.title}
          onClick={() => setLightboxPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{lightboxPhoto.title}</div>
                <div className="truncate text-xs text-slate-400">{lightboxPhoto.subtitle}</div>
              </div>
              <button
                type="button"
                aria-label="Закрыть просмотр фото"
                onClick={() => setLightboxPhoto(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex max-h-[75vh] items-center justify-center bg-black p-2">
              <img
                src={lightboxPhoto.src}
                alt={lightboxPhoto.title}
                referrerPolicy="no-referrer"
                className="max-h-[72vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
