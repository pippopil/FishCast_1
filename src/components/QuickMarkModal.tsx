import React, { useState } from 'react';
import { LocateFixed, Radio, X } from 'lucide-react';
import { detectUserLocation, getGpsHttpWarning, snapPointToWaterShore } from '../lib/geolocation';
import type { FishSpecies, LatLng, ReportOutcome, ReportVisibility, WaterBody } from '../lib/types';

interface QuickMarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  speciesList: FishSpecies[];
  waterBodies: WaterBody[];
  selectedWaterBody: WaterBody | null;
  currentCoords: LatLng | null;
  onSubmit: (payload: {
    lat: number | null;
    lng: number | null;
    fish_species_id: string;
    water_body_id: string | null;
    outcome: ReportOutcome;
    depth_m?: number | null;
    gps_accuracy_m?: number | null;
    bait: string;
    notes: string;
    visibility: ReportVisibility;
    photo_url: string | null;
    photo_size_bytes?: number;
    photo_mime?: string;
  }) => Promise<string | null>;
}

export const QuickMarkModal: React.FC<QuickMarkModalProps> = ({
  isOpen,
  onClose,
  speciesList,
  waterBodies,
  selectedWaterBody,
  currentCoords,
  onSubmit,
}) => {
  const [outcome, setOutcome] = useState<ReportOutcome>('catch');
  const [speciesId, setSpeciesId] = useState(speciesList[0]?.id ?? 'pike');
  const [waterBodyId, setWaterBodyId] = useState(selectedWaterBody?.id ?? '');
  const [latInput, setLatInput] = useState(
    selectedWaterBody?.center.lat.toFixed(5) ?? currentCoords?.lat.toFixed(5) ?? ''
  );
  const [lngInput, setLngInput] = useState(
    selectedWaterBody?.center.lng.toFixed(5) ?? currentCoords?.lng.toFixed(5) ?? ''
  );
  const [depthInput, setDepthInput] = useState('');
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsStatusNote, setGpsStatusNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [bait, setBait] = useState('');
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<ReportVisibility>('public');
  const [photoData, setPhotoData] = useState<{ url: string; size: number; mime: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const httpWarning = getGpsHttpWarning();

  const handleUseGps = async () => {
    setError(null);
    setGpsStatusNote(null);
    setLocating(true);
    try {
      const fix = await detectUserLocation({ highAccuracy: true, timeoutMs: 10000, forceFresh: true });
      if (fix) {
        const snapped = snapPointToWaterShore(fix.coords, waterBodies, 30);
        setLatInput(snapped.coords.lat.toFixed(5));
        setLngInput(snapped.coords.lng.toFixed(5));
        setGpsAccuracyM(fix.accuracy_m);
        if (snapped.waterBodyId && !waterBodyId) {
          setWaterBodyId(snapped.waterBodyId);
        }
        const parts: string[] = [];
        if (fix.accuracy_m !== null) parts.push(`Точность GPS: ±${fix.accuracy_m} м`);
        if (snapped.snapped) parts.push('привязано к береговой линии');
        setGpsStatusNote(parts.length > 0 ? parts.join(' · ') : 'Координаты определены по GPS');
      } else if (currentCoords) {
        setLatInput(currentCoords.lat.toFixed(5));
        setLngInput(currentCoords.lng.toFixed(5));
        setGpsAccuracyM(null);
        setGpsStatusNote('GPS недоступен — подставлены координаты выбранной точки.');
      } else {
        setError('Не удалось получить координаты GPS. Разрешите доступ или укажите их вручную.');
      }
    } finally {
      setLocating(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Размер фото превышает лимит 5 МБ.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Допустимые форматы: JPEG, PNG, WebP.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      setPhotoData({ url: String(reader.result), size: file.size, mime: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedLat = latInput.trim() === '' ? null : Number(latInput);
    const parsedLng = lngInput.trim() === '' ? null : Number(lngInput);
    const parsedDepthRaw = depthInput.trim() === '' ? null : Number(depthInput.replace(',', '.'));
    const parsedDepth =
      parsedDepthRaw !== null && Number.isFinite(parsedDepthRaw) && parsedDepthRaw >= 0.1 && parsedDepthRaw <= 150
        ? Number(parsedDepthRaw.toFixed(1))
        : null;

    setSubmitting(true);
    const errMsg = await onSubmit({
      lat: parsedLat !== null && !Number.isNaN(parsedLat) ? parsedLat : null,
      lng: parsedLng !== null && !Number.isNaN(parsedLng) ? parsedLng : null,
      fish_species_id: speciesId,
      water_body_id: waterBodyId || null,
      outcome,
      depth_m: parsedDepth,
      gps_accuracy_m: gpsAccuracyM,
      bait,
      notes,
      visibility,
      photo_url: outcome === 'no_bite' ? null : photoData?.url ?? null,
      photo_size_bytes: outcome === 'no_bite' ? undefined : photoData?.size,
      photo_mime: outcome === 'no_bite' ? undefined : photoData?.mime,
    });
    setSubmitting(false);

    if (errMsg) {
      setError(errMsg);
      return;
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-mark-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="quick-mark-title" className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {outcome === 'no_bite' ? 'Отметка «Клёва не было»' : 'Метка «Клюёт здесь сейчас»'}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {outcome === 'no_bite'
                ? 'Помогает модели точнее калибровать вероятность клёва по реальным условиям.'
                : 'Отметка появится у других рыбаков на карте и откалибрует прогноз.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Закрыть окно отметки"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          {/* Outcome segmented toggle */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="Результат рыбалки">
            <button
              type="button"
              onClick={() => setOutcome('catch')}
              className={`min-h-[38px] rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                outcome === 'catch'
                  ? 'bg-white text-teal-700 shadow-sm dark:bg-slate-700 dark:text-teal-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Есть клёв / улов
            </button>
            <button
              type="button"
              onClick={() => setOutcome('no_bite')}
              className={`min-h-[38px] rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                outcome === 'no_bite'
                  ? 'bg-white text-amber-700 shadow-sm dark:bg-slate-700 dark:text-amber-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Был — клёва нет
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="qm-species" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Вид рыбы
              </label>
              <select
                id="qm-species"
                value={speciesId}
                onChange={(e) => setSpeciesId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {speciesList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="qm-wb" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Водоём (опционально)
              </label>
              <select
                id="qm-wb"
                value={waterBodyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setWaterBodyId(id);
                  const found = waterBodies.find((w) => w.id === id);
                  if (found) {
                    setLatInput(found.center.lat.toFixed(5));
                    setLngInput(found.center.lng.toFixed(5));
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">По координатам</option>
                {waterBodies.map((wb) => (
                  <option key={wb.id} value={wb.id}>
                    {wb.display_label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Координаты геолокации (обязательно)
              </span>
              <button
                type="button"
                disabled={locating}
                onClick={() => void handleUseGps()}
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline disabled:opacity-60 dark:text-sky-400"
              >
                <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
                {locating ? 'Поиск спутников...' : 'Определить по GPS'}
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="qm-lat" className="sr-only">
                  Широта
                </label>
                <input
                  id="qm-lat"
                  type="text"
                  inputMode="decimal"
                  placeholder="Широта (56.0120)"
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="qm-lng" className="sr-only">
                  Долгота
                </label>
                <input
                  id="qm-lng"
                  type="text"
                  inputMode="decimal"
                  placeholder="Долгота (36.8220)"
                  value={lngInput}
                  onChange={(e) => setLngInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            {gpsStatusNote && (
              <p className="mt-1 text-[11px] font-medium text-teal-700 dark:text-teal-400">
                {gpsStatusNote}
              </p>
            )}
            {httpWarning && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                {httpWarning}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="qm-bait" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Приманка / наживка
              </label>
              <input
                id="qm-bait"
                type="text"
                placeholder="Виброхвост 10 см"
                value={bait}
                onChange={(e) => setBait(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="qm-depth" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Глубина, м (опц.)
              </label>
              <input
                id="qm-depth"
                type="text"
                inputMode="decimal"
                placeholder="Напр. 3.5"
                value={depthInput}
                onChange={(e) => setDepthInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <div>
              <label htmlFor="qm-vis" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Приватность
              </label>
              <select
                id="qm-vis"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as ReportVisibility)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="public">Видна всем</option>
                <option value="friends">Только друзьям</option>
                <option value="private">Только мне</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="qm-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Короткий комментарий
            </label>
            <input
              id="qm-notes"
              type="text"
              placeholder="Глубина, поклёвки, условия у берега"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="qm-photo" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Фото улова (до 5 МБ, опционально)
            </label>
            <input
              id="qm-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-800 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                outcome === 'no_bite'
                  ? 'bg-slate-800 hover:bg-slate-900 dark:bg-amber-700 dark:hover:bg-amber-800'
                  : 'bg-sky-700 hover:bg-sky-800'
              }`}
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
              {submitting
                ? 'Отправка...'
                : outcome === 'no_bite'
                  ? 'Отметить «клёва нет»'
                  : 'Отправить отметку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
