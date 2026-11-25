import React from 'react';
import { BookOpen, CloudUpload, Compass, Map as MapIcon, NotebookPen, Radio, RefreshCw, WifiOff } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type AppTab = 'map' | 'waterbodies' | 'reference' | 'diary';

interface TopNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onOpenQuickMark: () => void;
  isOnline: boolean;
  wsConnected: boolean;
  pendingSyncCount: number;
  syncingQueue?: boolean;
  onSyncNow?: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'map', label: 'Карта', icon: MapIcon },
  { id: 'waterbodies', label: 'Водоёмы', icon: Compass },
  { id: 'reference', label: 'Справочник', icon: BookOpen },
  { id: 'diary', label: 'Дневник', icon: NotebookPen },
];

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenQuickMark,
  isOnline,
  wsConnected,
  pendingSyncCount,
  syncingQueue = false,
  onSyncNow,
  darkMode,
  onToggleDarkMode,
}) => {
  return (
    <>
      {/* Desktop & Mobile Top Header (3-zone contract on desktop, compact <=54px on mobile) */}
      <header className="sticky top-0 z-30 w-full max-w-full border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 pt-safe">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 px-3 sm:px-4 md:gap-8 md:px-6">
          {/* Zone 1: Brand Title */}
          <a
            href="#map"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('map');
            }}
            className="inline-flex min-w-0 items-center gap-2 text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap sm:text-base md:text-lg"
          >
            <img
              src="/app-icon-128.png"
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="h-7 w-7 rounded-lg shadow-xs shrink-0"
            />
            <span className="truncate">Клёвый прогноз</span>
          </a>

          {/* Zone 2: Navigation links (Desktop) */}
          <nav aria-label="Основная навигация" className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`relative py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-sky-700 dark:text-sky-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                  {item.id === 'diary' && pendingSyncCount > 0 && (
                    <span className="ml-1.5 font-mono text-xs text-amber-600 dark:text-amber-400">
                      ({pendingSyncCount})
                    </span>
                  )}
                  {active && (
                    <span className="absolute inset-x-0 -bottom-[13px] h-0.5 bg-sky-700 dark:bg-sky-400" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary CTA + sync queue status + compact utilities */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {pendingSyncCount > 0 && (
              <div
                data-testid="topnav-sync-status"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200 whitespace-nowrap shrink-0"
                title={`Записей в очереди синхронизации: ${pendingSyncCount}`}
              >
                <CloudUpload className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="font-mono tabular-nums">{pendingSyncCount}</span>
                <span className="hidden sm:inline">в очереди</span>
                {isOnline && onSyncNow && (
                  <button
                    type="button"
                    data-testid="topnav-sync-now-btn"
                    disabled={syncingQueue}
                    onClick={onSyncNow}
                    aria-label="Синхронизировать очередь сейчас"
                    className="ml-1 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60 transition-colors"
                  >
                    <RefreshCw
                      className={`h-3 w-3 shrink-0 ${syncingQueue ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="hidden md:inline">
                      {syncingQueue ? 'Отправка...' : 'Синхронизировать'}
                    </span>
                  </button>
                )}
              </div>
            )}
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden xs:inline">Офлайн</span>
              </span>
            )}
            <div className="hidden lg:flex items-center gap-2">
              <PWAInstallButton />
              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label={darkMode ? 'Включить дневную тему' : 'Включить ночную тему'}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {darkMode ? 'День' : 'Ночь'}
              </button>
            </div>
            <button
              type="button"
              onClick={onOpenQuickMark}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-sky-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 sm:px-3.5 md:min-h-[40px] md:px-4 md:text-sm"
            >
              <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Клюёт сейчас</span>
              {wsConnected && (
                <span className="sr-only">(канал реального времени активен)</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (Thumb zone, strictly contained within viewport + safe-area) */}
      <nav
        aria-label="Мобильная навигация"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 w-full max-w-full overflow-x-hidden box-border border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 pb-safe"
      >
        <div className="grid h-14 w-full grid-cols-4 items-center px-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex min-h-[44px] min-w-0 w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] sm:text-[11px] font-medium transition-colors ${
                  active
                    ? 'text-sky-700 dark:text-sky-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate leading-tight">
                  {item.label}
                  {item.id === 'diary' && pendingSyncCount > 0 ? ` (${pendingSyncCount})` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
