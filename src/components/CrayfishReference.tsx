import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Compass,
  MapPin,
  Scale,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import {
  CRAYFISH_BAITS,
  CRAYFISH_CALENDAR,
  CRAYFISH_HABITAT_SIGNS,
  CRAYFISH_METHODS,
  CRAYFISH_SPOTS,
  CRAYFISH_TIMING_AND_RULES,
  type CrayfishSpot,
} from '../data/crayfishData';

export interface CrayfishReferenceProps {
  onLocateCrayfishSpot?: (spot: CrayfishSpot) => void;
}

const WATER_BODY_HABITAT_TYPES = [
  {
    type: 'Реки (малые и средние)',
    bottom: 'Плотная глина, известняковые плиты, галька, корни ольхи и ивы',
    zones: 'Подмытые обрывистые берега, границы обратного течения, тихие заводи и каменные перекаты (1–3.5 м)',
    oxygen: 'Высокий (проточная вода — лучшая среда для широкопалого и длиннопалого рака)',
  },
  {
    type: 'Водохранилища',
    bottom: 'Глинистые бровки, ракушечник, затопленные коряжники, каменистые дамбы',
    zones: 'Береговые свалы 1.5–4.5 м, устья впадающих речек, каменные насыпи у плотин',
    oxygen: 'Хороший на открытых плёсах и у русловых бровок',
  },
  {
    type: 'Чистые озёра',
    bottom: 'Твёрдый песок, суглинок, камни, прибрежная растительность (рдест, элодея)',
    zones: 'Мелководные твёрдые бровки на границе травы, участки с подводными родниками (1–3 м)',
    oxygen: 'Требует отсутствия сильного заиления и цветения воды',
  },
  {
    type: 'Песчаные и известняковые карьеры',
    bottom: 'Известняк, крупный песок, щебень, затопленные уступы и кустарник',
    zones: 'Ступенчатые бровки и каменистые полки на глубине 1.5–4 м',
    oxygen: 'Очень высокая прозрачность и чистая родниковая вода',
  },
];

const LEGAL_CHECKLIST = [
  {
    title: 'Минимальный промысловый размер',
    detail:
      'Обычно 9–10 см (измеряется от линии глаз до конца средних хвостовых пластин). Мелких раков обязательно выпускайте обратно в водоём.',
  },
  {
    title: 'Запрет на вылов икряных самок и нерестовый период',
    detail:
      'Вылов самок, вынашивающих икру или личинок под брюшком, запрещён круглогодично. Весной и в период линьки (ориентировочно май–июнь) действуют региональные запреты.',
  },
  {
    title: 'Нормы вылова и разрешённые раколовки',
    detail:
      'Как правило, разрешено до 3–5 раколовок на одного рыболова (с соблюдением предельного диаметра/ширины, размера входа и ячеи) и суточная норма (обычно 20–50 экз. в зависимости от бассейна).',
  },
  {
    title: 'Запрещённые способы добычи',
    detail:
      'Запрещены электролов, химические приманки, багрение, ловля с аквалангом и другими автономными дыхательными аппаратами, а в ряде регионов — ловля вброд с подсветкой (фонарём) ночью.',
  },
];

export const CrayfishReference: React.FC<CrayfishReferenceProps> = ({ onLocateCrayfishSpot }) => {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const currentMonth = new Date().getMonth() + 1;
  const currentCrayfishMonth =
    CRAYFISH_CALENDAR.find((m) => m.month === currentMonth) ?? CRAYFISH_CALENDAR[8];

  const filteredSpots = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CRAYFISH_SPOTS.filter((spot) => {
      if (typeFilter !== 'all' && spot.waterType !== typeFilter) return false;
      if (!q) return true;
      return (
        spot.name.toLowerCase().includes(q) ||
        spot.region.toLowerCase().includes(q) ||
        spot.bestZones.toLowerCase().includes(q) ||
        spot.bottomType.toLowerCase().includes(q)
      );
    });
  }, [query, typeFilter]);

  return (
    <div className="mt-6 space-y-6" data-testid="crayfish-section">
      {/* 1. Season Calendar, Time of Day & Weather */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <Calendar className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              Когда лучше ловить раков (сезонный календарь)
            </h2>
            <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400">
              Сейчас ({currentCrayfishMonth.shortName}): {currentCrayfishMonth.phase}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
            {currentCrayfishMonth.note}
          </p>

          <div className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {CRAYFISH_CALENDAR.map((m) => {
              const isNow = m.month === currentMonth;
              const barColor =
                m.phase === 'Нерест / запрет'
                  ? 'bg-rose-500'
                  : m.activity >= 80
                    ? 'bg-teal-600'
                    : m.activity >= 45
                      ? 'bg-sky-600'
                      : 'bg-slate-300 dark:bg-slate-700';
              return (
                <div
                  key={m.month}
                  title={`${m.shortName}: ${m.phase} — ${m.note}`}
                  className={`flex flex-col items-center rounded-xl p-1.5 text-center ${
                    isNow
                      ? 'bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/50'
                      : 'bg-slate-50 dark:bg-slate-800/60'
                  }`}
                >
                  <div className="flex h-14 w-full items-end justify-center">
                    <div
                      className={`w-3.5 rounded-t-md ${barColor}`}
                      style={{ height: `${Math.max(12, Math.round((m.activity / 100) * 52))}px` }}
                    />
                  </div>
                  <span className="mt-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                    {m.shortName}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-teal-600" /> Лучший сезон (август–октябрь)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Нерест / запрет (май–июнь)
            </span>
          </div>
        </div>

        <div className="space-y-3 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
              <Clock className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              Время суток и погода
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {CRAYFISH_TIMING_AND_RULES.bestTimeOfDay}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Погода: </span>
              {CRAYFISH_TIMING_AND_RULES.bestWeather}
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Коротко о правилах
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90">
              {CRAYFISH_TIMING_AND_RULES.legalSummary}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Where to Find Crayfish: Water Body Types & Bottom Composition */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <Waves className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            Где искать раков: типы водоёмов и состав дна
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Речной рак — природный биоиндикатор чистой, насыщенной кислородом воды и плотного грунта, пригодного для рытья нор.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {WATER_BODY_HABITAT_TYPES.map((hab) => (
            <div
              key={hab.type}
              className="rounded-xl border border-slate-200/80 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
            >
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{hab.type}</h3>
              <dl className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <div>
                  <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Дно: </dt>
                  <dd className="inline">{hab.bottom}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Точки: </dt>
                  <dd className="inline">{hab.zones}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Кислород: </dt>
                  <dd className="inline">{hab.oxygen}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <Compass className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            Ключевые признаки обитания на местности
          </h3>
          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CRAYFISH_HABITAT_SIGNS.map((sign) => (
              <div
                key={sign.title}
                className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{sign.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {sign.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Curated Database of Crayfish Water Bodies */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              База водоёмов, где обитают раки ({filteredSpots.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Проверенные реки, водохранилища, озёра и чистые карьеры с привязкой к карте.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Поиск водоёма или области (Сейм, Ока...)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full sm:w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <select
              aria-label="Тип водоёма"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">Все типы</option>
              <option value="Река">Реки</option>
              <option value="Водохранилище">Водохранилища</option>
              <option value="Озеро">Озёра</option>
              <option value="Карьер">Карьеры</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredSpots.map((spot) => (
            <article
              key={spot.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {spot.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {spot.region} · {spot.waterType} · глубина {spot.depthRangeM}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-teal-700 dark:text-teal-400">
                    {spot.abundance}
                  </span>
                </div>

                <dl className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <div>
                    <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Дно: </dt>
                    <dd className="inline">{spot.bottomType}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Где искать: </dt>
                    <dd className="inline">{spot.bestZones}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold text-slate-800 dark:text-slate-100">Пик сезона: </dt>
                    <dd className="inline">{spot.peakSeason} · вода: {spot.waterQuality.toLowerCase()}</dd>
                  </div>
                  <div className="pt-1 text-slate-500 dark:text-slate-400">
                    {spot.tips}
                  </div>
                </dl>
              </div>

              {onLocateCrayfishSpot && (
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  <span className="font-mono text-[11px] text-slate-400">
                    {spot.coords.lat.toFixed(3)}, {spot.coords.lng.toFixed(3)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onLocateCrayfishSpot(spot)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    Показать на карте
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {/* 4. Catching Techniques (Traps, Manual Methods) & Baits */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            Способы ловли раков (ловушки, подъёмники и ручные методы)
          </h2>
          <div className="space-y-3">
            {CRAYFISH_METHODS.map((m) => (
              <article
                key={m.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{m.name}</h3>
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                    Эффективность: {m.effectiveness.toLowerCase()}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Оснастка: </span>
                  {m.gearSpec}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Подходит для: </span>
                  {m.bestFor}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {m.howToUse}
                </p>
                <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                  {m.legalNote}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-3 lg:col-span-5">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Лучшие приманки для раколовок
          </h2>
          <div className="space-y-2.5">
            {CRAYFISH_BAITS.map((b) => (
              <article
                key={b.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{b.name}</h3>
                  <span className="shrink-0 font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                    {b.rating}/5
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-medium text-sky-700 dark:text-sky-400">
                  {b.seasonFit}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {b.prepTip}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Legal Considerations */}
      <div
        data-testid="crayfish-legal-rules"
        className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-900/60 dark:bg-amber-950/30"
      >
        <h2 className="inline-flex items-center gap-2 text-base font-bold text-amber-950 dark:text-amber-100">
          <Scale className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          Правовые требования и ограничения вылова
        </h2>
        <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
          Соблюдение Правил рыболовства сохраняет популяцию раков и защищает от крупных штрафов. Всегда сверяйте актуальные сроки запрета для своего рыбохозяйственного бассейна.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LEGAL_CHECKLIST.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-amber-200/80 bg-white/80 p-3.5 dark:border-amber-900/50 dark:bg-slate-900/70"
            >
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
