import React, { useMemo, useState } from 'react';
import { Camera, Download, LogOut, NotebookPen, RefreshCw, Trash2, UserCheck, WifiOff } from 'lucide-react';
import { evaluateForecastAccuracy } from '../lib/fishLogic';
import { resolveReportPhotoUrl } from '../utils/samplePhotos';
import type {
  CatchReport,
  FishSpecies,
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
  const [photoData, setPhotoData] = useState<{ url: string; size: number; mime: string } | null>(null);
  const [visionMsg, setVisionMsg] = useState<string | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Фото больше 5 МБ отклонено.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Поддерживаются только JPEG, PNG, WebP.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFormError(null);
      setVisionMsg(null);
      setPhotoData({ url: String(reader.result), size: file.size, mime: file.type });
    };
    reader.readAsDataURL(file);
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

      {/* Main 2-column layout: Left = New Entry + List; Right = Profile & Auth */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-5">
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

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  <span>{photoData ? 'Фото выбрано' : 'Прикрепить фото'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoUpload}
                    className="sr-only"
                  />
                </label>

                {photoData && (
                  <button
                    type="button"
                    disabled={visionBusy}
                    onClick={() => void handleRecognizePhoto()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                  >
                    {visionBusy ? 'Распознаём...' : 'Определить вид по фото'}
                  </button>
                )}
              </div>

              <button
                type="submit"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800"
              >
                {isOnline ? 'Сохранить запись' : 'Сохранить в офлайн-очередь'}
              </button>
            </div>

            {visionMsg && <p className="text-xs text-slate-600 dark:text-slate-300">{visionMsg}</p>}
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
                    <img
                      src={photoSrc}
                      alt={`Улов: ${rep.fish_species_name}`}
                      referrerPolicy="no-referrer"
                      className="h-28 w-full shrink-0 rounded-xl object-cover sm:w-36"
                    />
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
        </div>
      </div>
    </div>
  );
};
