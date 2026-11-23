import React from 'react';
import { Bell, BellRing, CheckCircle2, ShieldAlert, Star, Trash2, X } from 'lucide-react';
import type {
  BiteAlertLogEntry,
  BiteAlertScope,
  BiteAlertSettings,
  GoodBiteWaterBodyItem,
  WaterBody,
} from '../lib/types';
import type { PWANotificationPermission } from '../lib/notifications';

interface BiteAlertsModalProps {
  open: boolean;
  onClose: () => void;
  settings: BiteAlertSettings;
  onUpdateSettings: (next: BiteAlertSettings) => void;
  permission: PWANotificationPermission;
  onRequestPermission: () => Promise<void>;
  onCheckNow: () => Promise<void>;
  favoriteIds: string[];
  onToggleFavorite: (waterBodyId: string) => void;
  waterBodies: WaterBody[];
  goodBiteItems: GoodBiteWaterBodyItem[];
  alertHistory: BiteAlertLogEntry[];
  onClearHistory: () => void;
  onSelectWaterBody: (wb: WaterBody) => void;
}

const THRESHOLD_PRESETS = [66, 75, 80, 85];
const RADIUS_PRESETS = [15, 35, 100];

export const BiteAlertsModal: React.FC<BiteAlertsModalProps> = ({
  open,
  onClose,
  settings,
  onUpdateSettings,
  permission,
  onRequestPermission,
  onCheckNow,
  favoriteIds,
  onToggleFavorite,
  waterBodies,
  goodBiteItems,
  alertHistory,
  onClearHistory,
  onSelectWaterBody,
}) => {
  if (!open) return null;

  const favSet = new Set(favoriteIds);
  const matchingNow = goodBiteItems.filter((item) => {
    if (item.f_index < settings.threshold) return false;
    const isFav = favSet.has(item.water_body.id);
    const isNearby = item.distance_km <= settings.nearby_radius_km;
    if (settings.scope === 'favorites_only') return isFav;
    if (settings.scope === 'nearby_only') return isNearby;
    return isFav || isNearby;
  });

  const favoriteWaterBodies = waterBodies.filter((wb) => favSet.has(wb.id));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Уведомления о хорошем клёве (PWA)"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <BellRing className="h-5 w-5 shrink-0 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">
                Оповещения о клёве (PWA)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Сигналы при росте F-Индекса на избранных и ближайших водоёмах
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки уведомлений"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* PWA Notification Permission Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="flex items-center gap-2.5 text-xs">
              {permission === 'granted' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              ) : (
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              )}
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {permission === 'granted' && 'Push-уведомления браузера (PWA) разрешены'}
                  {permission === 'default' && 'Push-уведомления ещё не разрешены'}
                  {permission === 'denied' && 'Уведомления заблокированы в настройках браузера'}
                  {permission === 'unsupported' && 'Notification API недоступен — работают внутри приложения'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  При недоступности системных push-оповещений события фиксируются в журнале ниже
                </div>
              </div>
            </div>

            {permission === 'default' && (
              <button
                type="button"
                onClick={() => void onRequestPermission()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-800 whitespace-nowrap"
              >
                <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                Разрешить PWA
              </button>
            )}
          </div>

          {/* Arm Switch & Threshold */}
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Автоматически уведомлять о всплеске клёва
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Повтор не чаще раза в 6 часов (или при росте индекса на +5 и более)
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => onUpdateSettings({ ...settings, enabled: e.target.checked })}
                className="h-5 w-5 accent-sky-700 shrink-0"
              />
            </label>

            {/* Threshold Slider + Presets */}
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="bite-threshold-range" className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Порог срабатывания F-Индекса
                </label>
                <span className="font-mono text-sm font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                  F ≥ {settings.threshold}
                </span>
              </div>
              <input
                id="bite-threshold-range"
                type="range"
                min={50}
                max={95}
                step={1}
                value={settings.threshold}
                onChange={(e) => onUpdateSettings({ ...settings, threshold: Number(e.target.value) })}
                className="mt-2 w-full accent-teal-600"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {THRESHOLD_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, threshold: val })}
                    className={`min-h-[32px] rounded-lg px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-colors ${
                      settings.threshold === val
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    F ≥ {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Scope & Radius */}
            <div className="border-t border-slate-100 pt-4 space-y-3 dark:border-slate-800">
              <div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Какие водоёмы отслеживать
                </div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {(
                    [
                      { id: 'favorites_and_nearby', label: 'Избранные и рядом' },
                      { id: 'favorites_only', label: 'Только избранные' },
                      { id: 'nearby_only', label: 'Только рядом' },
                    ] as { id: BiteAlertScope; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, scope: opt.id })}
                      className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        settings.scope === opt.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {settings.scope !== 'favorites_only' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Радиус для ближайших водоёмов
                  </span>
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                    {RADIUS_PRESETS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onUpdateSettings({ ...settings, nearby_radius_km: r })}
                        className={`min-h-[30px] rounded-md px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-colors whitespace-nowrap ${
                          settings.nearby_radius_km === r
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {r} км
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Favorites Summary */}
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Избранные водоёмы ({favoriteWaterBodies.length})
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                Сейчас под порог подходит: {matchingNow.length}
              </span>
            </div>
            {favoriteWaterBodies.length > 0 ? (
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {favoriteWaterBodies.map((wb) => (
                  <div key={wb.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectWaterBody(wb);
                        onClose();
                      }}
                      className="truncate text-left font-medium text-slate-800 hover:text-sky-700 dark:text-slate-200 dark:hover:text-sky-400"
                    >
                      {wb.display_label}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(wb.id)}
                      aria-label={`Убрать ${wb.display_label} из избранного`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Star className="h-4 w-4 fill-current" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Нажмите на звёздочку рядом с водоёмом в карточке или каталоге, чтобы получать оповещения именно по нему.
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() => void onCheckNow()}
              className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800"
            >
              <BellRing className="h-4 w-4" aria-hidden="true" />
              Проверить прогноз и отправить уведомление
            </button>

            {alertHistory.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                aria-label="Очистить журнал уведомлений"
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Очистить
              </button>
            )}
          </div>

          {/* Dispatched Alert History */}
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Журнал оповещений ({alertHistory.length})
            </h3>
            {alertHistory.length > 0 ? (
              <div className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {alertHistory.map((entry) => {
                  const targetWb = waterBodies.find((w) => w.id === entry.water_body_id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        if (targetWb) {
                          onSelectWaterBody(targetWb);
                          onClose();
                        }
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {entry.water_body_name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {entry.species_name} · пик {entry.peak_hour}
                          {entry.is_favorite ? ' · Избранное' : ' · Рядом'}
                          {' · '}
                          {entry.delivered_via === 'pwa' ? 'PWA Push' : 'В приложении'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                          F-{entry.f_index}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                          {new Date(entry.created_at).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Срабатываний пока нет. Нажмите «Проверить прогноз», чтобы протестировать отправку уведомления.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
