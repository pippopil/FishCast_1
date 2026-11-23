import React from 'react';
import { BookOpen, Compass, Map as MapIcon, NotebookPen, Radio, WifiOff } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

export type AppTab = 'map' | 'waterbodies' | 'reference' | 'diary';

interface TopNavProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  onOpenQuickMark: () => void;
  isOnline: boolean;
  wsConnected: boolean;
  pendingSyncCount: number;
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
  darkMode,
  onToggleDarkMode,
}) => {
  return (
    <>
      {/* Desktop & Mobile Top Header (3-zone contract on desktop, compact <=54px on mobile) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-4 md:gap-8 md:px-6">
          {/* Zone 1: Brand Title */}
          <a
            href="#map"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('map');
            }}
            className="inline-flex items-center gap-2 text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 md:text-lg"
          >
            <img
              src="/app-icon-128.png"
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="h-7 w-7 rounded-lg shadow-xs shrink-0"
            />
            <span>Клёвый прогноз</span>
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

          {/* Zone 3: Primary CTA + compact utilities */}
          <div className="flex items-center gap-2.5 shrink-0">
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                Офлайн
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
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-800 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 md:px-4 md:text-sm"
            >
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Клюёт сейчас</span>
              {wsConnected && (
                <span className="sr-only">(канал реального времени активен)</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (Thumb zone, <15% viewport height combined) */}
      <nav
        aria-label="Мобильная навигация"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 pb-safe"
      >
        <div className="grid h-15 grid-cols-4 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-sky-700 dark:text-sky-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>
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
