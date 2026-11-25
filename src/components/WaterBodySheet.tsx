import React, { useMemo, useState } from 'react';
import {
  Anchor,
  Bell,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  Download,
  ExternalLink,
  Fish,
  Footprints,
  Image as ImageIcon,
  Layers,
  Navigation2,
  PlusCircle,
  Radar,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Star,
  Thermometer,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildBathymetryProfile,
  buildOptimalDepartureSummary,
  buildSampleSonarCsv,
  getExcludedVerifiedSpecies,
  getExpectedFishForWaterBody,
  parseSonarDepthFile,
  waterBodyTypeRu,
  type BathymetryProfileLineMode,
  type BathymetryProfilePoint,
  type SonarImportPoint,
} from '../lib/fishLogic';
import { assessCrayfishPresence } from '../data/crayfishData';
import type {
  BathymetryPoint,
  BiteForecastResponse,
  BiteForecastSlot,
  CatchReport,
  FishAbundance,
  FishSpecies,
  LatLng,
  LureRecommendationResult,
  ProspectiveZone,
  RouteMultiResult,
  WaterBody,
  WaterBodyAnalysis,
  WeatherSnapshot,
} from '../lib/types';

interface WaterBodySheetProps {
  waterBody: WaterBody;
  weather: WeatherSnapshot | null;
  forecast: BiteForecastResponse | null;
  forecastLoading: boolean;
  speciesList: FishSpecies[];
  reports?: CatchReport[];
  selectedFishId: string;
  onSelectFishId: (id: string) => void;
  recommendations: LureRecommendationResult[];
  depthPoints: BathymetryPoint[];
  prospectiveZones: ProspectiveZone[];
  analysis: WaterBodyAnalysis | null;
  reconRunning: boolean;
  onRunRecon: () => void;
  onAddDepthPoint: (payload: { lat: number; lng: number; depth_m: number; source: 'manual' | 'sonar' }) => Promise<string | null>;
  onImportDepthPoints?: (points: SonarImportPoint[]) => Promise<{ importedCount: number; error?: string }>;
  historicOverlay?: { waterBodyId: string; fileName: string } | null;
  historicOpacity?: number;
  onChangeHistoricOpacity?: (val: number) => void;
  onUploadHistoricMap?: (file: File) => Promise<string | null>;
  onClearHistoricMap?: () => void;
  openSeaMapEnabled?: boolean;
  onToggleOpenSeaMap?: (enabled: boolean) => void;
  pickDepthMode: boolean;
  onTogglePickDepthMode: () => void;
  pickedCoords: LatLng | null;
  routeResult: RouteMultiResult | null;
  routeLoading: boolean;
  avoidUnpaved: boolean;
  onToggleAvoidUnpaved: (val: boolean) => void;
  onBuildRoute: (simulateQuota?: boolean) => void;
  onCloseMobile?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onOpenAlerts?: () => void;
  isOnline?: boolean;
  onVerifySpecies?: (payload: {
    waterBodyId: string;
    speciesId: string;
    action: 'confirm' | 'absent';
    abundance?: FishAbundance;
    note?: string;
  }) => Promise<string | null>;
  onOpenCrayfishGuide?: () => void;
}

type DetailSubTab = 'forecast' | 'depth' | 'route';
type ChartSlotPoint = BiteForecastSlot & { slotKey: string; chartLabel: string };

const SOURCE_LABELS: Record<WaterBody['source'], string> = {
  registry: 'Госводреестр',
  osm: 'OpenStreetMap',
  google_places: 'Google Карты',
  satellite: 'Sentinel-2 NDWI',
  user: 'Краудсорсинг',
};

const ABUNDANCE_LABELS: Record<'common' | 'regular' | 'rare', string> = {
  common: 'основная',
  regular: 'обычная',
  rare: 'редко',
};

const PRESSURE_TREND_LABELS: Record<
  NonNullable<BiteForecastSlot['pressure_trend']>,
  string
> = {
  sharp_drop: 'Резкое падение',
  falling: 'Снижение',
  steady: 'Стабильно',
  rising: 'Рост',
  sharp_rise: 'Резкий скачок вверх',
};

interface ForecastDaySummary {
  key: string;
  date: string;
  day_label: string;
  short_label: string;
  peak_f_index: number;
  peak_hour: string;
  min_pressure_mmhg: number | null;
  max_pressure_mmhg: number | null;
  has_sharp_pressure: boolean;
}

const FISHING_ACCESS_LABELS: Record<
  Exclude<NonNullable<WaterBody['fishing_access']>, 'unknown'>,
  { label: string; className: string }
> = {
  allowed: {
    label: 'лов разрешён (OSM)',
    className: 'font-semibold text-teal-700 dark:text-teal-400',
  },
  paid: {
    label: 'путёвка / платный (OSM)',
    className: 'font-semibold text-amber-700 dark:text-amber-400',
  },
  forbidden: {
    label: 'лов запрещён / частный (OSM)',
    className: 'font-semibold text-rose-700 dark:text-rose-400',
  },
};

function MoonPhaseDisc({
  illumination,
  moonPhase,
  size = 34,
}: {
  illumination: number;
  moonPhase: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, illumination));
  const frac = clamped / 100;
  const r = 13;
  const cx = 16;
  const cy = 16;
  const isWaning = /убывающ|последн|стареющ/i.test(moonPhase);

  // Build mathematically accurate waxing/waning illuminated path
  let litPath: string | null = null;
  if (clamped >= 98) {
    litPath = null; // Full circle rendered directly
  } else if (clamped > 2) {
    const rx = Math.max(0.2, Math.abs(1 - 2 * frac) * r);
    const topY = cy - r;
    const botY = cy + r;
    if (!isWaning) {
      // Waxing: right outer limb illuminated
      const termSweep = frac >= 0.5 ? 1 : 0;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 1 ${cx} ${botY} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    } else {
      // Waning: left outer limb illuminated
      const termSweep = frac >= 0.5 ? 0 : 1;
      litPath = `M ${cx} ${topY} A ${r} ${r} 0 0 0 ${cx} ${botY} A ${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${cx} ${topY} Z`;
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={`Фаза Луны: ${moonPhase}, освещённость ${clamped}%`}
      className="shrink-0 drop-shadow-xs"
    >
      {/* Unlit lunar body */}
      <circle cx={cx} cy={cy} r={r} className="fill-slate-800 dark:fill-slate-950" />
      {/* Illuminated lunar surface */}
      {clamped >= 98 ? (
        <circle cx={cx} cy={cy} r={r} className="fill-amber-200 dark:fill-amber-200" />
      ) : litPath ? (
        <path d={litPath} className="fill-amber-200 dark:fill-amber-200" />
      ) : null}
      {/* Subtle maria craters */}
      <circle cx={12.5} cy={12} r={2.1} className="fill-slate-900/12" />
      <circle cx={19.5} cy={15.5} r={2.6} className="fill-slate-900/10" />
      <circle cx={15} cy={20.5} r={1.6} className="fill-slate-900/10" />
      {/* Outer rim */}
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth="1.2" className="stroke-slate-300 dark:stroke-slate-600" />
    </svg>
  );
}

function describeMoonImpact(
  illumination: number,
  species: FishSpecies | undefined,
  waterClarity: WaterBody['water_clarity']
): { impactLabel: string; description: string; toneClass: string } {
  const pref = species?.lunar_preference ?? 'balanced';
  const speciesName = species?.name ? `для «${species.name}»` : 'для рыбы';

  if (illumination >= 75) {
    if (pref === 'dark_moon') {
      return {
        impactLabel: 'Осторожный дневной клёв',
        description:
          waterClarity === 'clear'
            ? `Яркая Луна (${illumination}%) в прозрачной воде делает хищника осторожнее днём — смещайте ловлю на зори, бровки и глубокие ямы.`
            : `Высокая ночная освещённость (${illumination}%) позволяет рыбе кормиться ночью; ${speciesName} лучшие выходы вероятны на рассвете и закате.`,
        toneClass: 'text-amber-700 dark:text-amber-300',
      };
    }
    if (pref === 'bright_moon') {
      return {
        impactLabel: 'Благоприятно для выходов',
        description: `Высокая освещённость (${illumination}%) стимулирует ночные и предрассветные выходы ${speciesName} на кормовые поливы.`,
        toneClass: 'text-teal-700 dark:text-teal-300',
      };
    }
    return {
      impactLabel: 'Усиление на зорях',
      description: `Яркая Луна (${illumination}%) концентрирует активность ${speciesName} на утренней и вечерней зорях, снижая активность в полдень.`,
      toneClass: 'text-sky-700 dark:text-sky-300',
    };
  }

  if (illumination <= 25) {
    if (pref === 'dark_moon') {
      return {
        impactLabel: 'Благоприятно днём',
        description: `Тёмные ночи (${illumination}%) ограничивают ночную охоту — ${speciesName} активнее и смелее кормится в светлое время суток.`,
        toneClass: 'text-teal-700 dark:text-teal-300',
      };
    }
    if (pref === 'bright_moon') {
      return {
        impactLabel: 'Смещение на день',
        description: `Слабая ночная освещённость (${illumination}%) переносит основной пик кормёжки ${speciesName} на светлые часы и предзакат.`,
        toneClass: 'text-sky-700 dark:text-sky-300',
      };
    }
    return {
      impactLabel: 'Ровный дневной фон',
      description: `Низкая освещённость (${illumination}%) обеспечивает ровную дневную активность ${speciesName} без перекоса в ночную кормёжку.`,
      toneClass: 'text-teal-700 dark:text-teal-300',
    };
  }

  return {
    impactLabel: 'Нейтральный лунный фон',
    description: `Умеренная освещённость (${illumination}%) не подавляет активность ${speciesName} — ключевыми остаются давление, ветер и зори.`,
    toneClass: 'text-slate-600 dark:text-slate-300',
  };
}

export const WaterBodySheet: React.FC<WaterBodySheetProps> = ({
  waterBody,
  weather,
  forecast,
  forecastLoading,
  speciesList,
  reports = [],
  selectedFishId,
  onSelectFishId,
  recommendations,
  depthPoints,
  prospectiveZones,
  analysis,
  reconRunning,
  onRunRecon,
  onAddDepthPoint,
  onImportDepthPoints,
  historicOverlay = null,
  historicOpacity = 0.55,
  onChangeHistoricOpacity,
  onUploadHistoricMap,
  onClearHistoricMap,
  openSeaMapEnabled = false,
  onToggleOpenSeaMap,
  pickDepthMode,
  onTogglePickDepthMode,
  pickedCoords,
  routeResult,
  routeLoading,
  avoidUnpaved,
  onToggleAvoidUnpaved,
  onBuildRoute,
  onCloseMobile,
  isFavorite = false,
  onToggleFavorite,
  onOpenAlerts,
  isOnline = true,
  onVerifySpecies,
  onOpenCrayfishGuide,
}) => {
  const [subTab, setSubTab] = useState<DetailSubTab>('forecast');
  const [selectedDay, setSelectedDay] = useState<string>('24h');
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [profileLineMode, setProfileLineMode] = useState<BathymetryProfileLineMode>('transect');
  const [depthVal, setDepthVal] = useState('4.5');
  const [depthSource, setDepthSource] = useState<'manual' | 'sonar'>('manual');
  const [depthError, setDepthError] = useState<string | null>(null);
  const [depthSavedMsg, setDepthSavedMsg] = useState<string | null>(null);
  const [sonarImporting, setSonarImporting] = useState(false);
  const [sonarImportMsg, setSonarImportMsg] = useState<string | null>(null);
  const [sonarImportErr, setSonarImportErr] = useState<string | null>(null);
  const [historicErr, setHistoricErr] = useState<string | null>(null);

  // Community species verification form state
  const [verifyFormOpen, setVerifyFormOpen] = useState(false);
  const [verifySpeciesId, setVerifySpeciesId] = useState<string>(selectedFishId);
  const [verifyAction, setVerifyAction] = useState<'confirm' | 'absent'>('confirm');
  const [verifyAbundance, setVerifyAbundance] = useState<FishAbundance>('regular');
  const [verifyNote, setVerifyNote] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const expectedFish = useMemo(
    () => getExpectedFishForWaterBody({ waterBody, speciesList, reports }),
    [waterBody, speciesList, reports]
  );

  const excludedFish = useMemo(
    () => getExcludedVerifiedSpecies({ waterBody, speciesList, reports }),
    [waterBody, speciesList, reports]
  );

  const crayfishPresence = useMemo(() => assessCrayfishPresence(waterBody), [waterBody]);

  const selectedExpectedFish = useMemo(
    () => expectedFish.find((f) => f.species_id === selectedFishId) ?? null,
    [expectedFish, selectedFishId]
  );

  const selectedSpeciesObj = useMemo(
    () => speciesList.find((s) => s.id === selectedFishId) ?? speciesList[0],
    [speciesList, selectedFishId]
  );

  const runSpeciesVerification = async (payload: {
    speciesId: string;
    action: 'confirm' | 'absent';
    abundance?: FishAbundance;
    note?: string;
  }) => {
    if (!onVerifySpecies) return;
    setVerifySubmitting(true);
    setVerifyFeedback(null);
    try {
      const err = await onVerifySpecies({
        waterBodyId: waterBody.id,
        ...payload,
      });
      if (err) {
        setVerifyFeedback({ type: 'err', text: err });
      } else {
        const spName = speciesList.find((s) => s.id === payload.speciesId)?.name ?? 'Вид';
        setVerifyFeedback({
          type: 'ok',
          text:
            payload.action === 'confirm'
              ? `«${spName}» подтверждён в базе знаний водоёма.`
              : `«${spName}» отмечен как отсутствующий в этом водоёме.`,
        });
        setVerifyNote('');
      }
    } finally {
      setVerifySubmitting(false);
    }
  };

  const profileData = useMemo(
    () => buildBathymetryProfile(depthPoints, profileLineMode),
    [depthPoints, profileLineMode]
  );

  const profileSummary = useMemo(() => {
    if (profileData.length === 0) return null;
    const maxD = Math.max(...profileData.map((p) => p.depth_m));
    const avgD = profileData.reduce((sum, p) => sum + p.depth_m, 0) / profileData.length;
    const spanM = profileData[profileData.length - 1].distance_m;
    const domainBottom = -Math.ceil(Math.max(2, maxD * 1.15));
    return { maxD, avgD, spanM, domainBottom };
  }, [profileData]);

  const forecastDaySummaries = useMemo<ForecastDaySummary[]>(() => {
    const allSlots = forecast?.slots ?? [];
    if (allSlots.length === 0) return [];
    const byDate = new Map<string, BiteForecastSlot[]>();
    for (const s of allSlots) {
      const list = byDate.get(s.date) ?? [];
      list.push(s);
      byDate.set(s.date, list);
    }
    const out: ForecastDaySummary[] = [];
    for (const [date, list] of Array.from(byDate.entries()).slice(0, 7)) {
      const peak = list.reduce((best, cur) => (cur.f_index > best.f_index ? cur : best), list[0]);
      const pressures = list
        .map((s) => s.pressure_mmhg)
        .filter((p): p is number => typeof p === 'number' && Number.isFinite(p));
      const minP = pressures.length > 0 ? Math.min(...pressures) : null;
      const maxP = pressures.length > 0 ? Math.max(...pressures) : null;
      const hasSharp =
        list.some(
          (s) => s.pressure_trend === 'sharp_drop' || s.pressure_trend === 'sharp_rise'
        ) || (minP !== null && maxP !== null && maxP - minP >= 6);
      const label = list[0]?.day_label ?? date.slice(5);
      const shortLabel =
        label === 'Послезавтра'
          ? 'Послез.'
          : label;
      out.push({
        key: date,
        date,
        day_label: label,
        short_label: shortLabel,
        peak_f_index: peak.f_index,
        peak_hour: peak.hour_interval,
        min_pressure_mmhg: minP,
        max_pressure_mmhg: maxP,
        has_sharp_pressure: hasSharp,
      });
    }
    return out;
  }, [forecast?.slots]);

  const bestWeekDay = useMemo<ForecastDaySummary | null>(() => {
    if (forecastDaySummaries.length < 2) return null;
    return forecastDaySummaries.reduce(
      (best, cur) => (cur.peak_f_index > best.peak_f_index ? cur : best),
      forecastDaySummaries[0]
    );
  }, [forecastDaySummaries]);

  const effectiveSelectedDay = useMemo(() => {
    if (selectedDay === '24h') return '24h';
    if (forecastDaySummaries.some((d) => d.key === selectedDay)) return selectedDay;
    return '24h';
  }, [selectedDay, forecastDaySummaries]);

  const chartSlots = useMemo<ChartSlotPoint[]>(() => {
    const allSlots = forecast?.slots ?? [];
    if (allSlots.length === 0) return [];

    let rawSlice: BiteForecastSlot[];
    if (effectiveSelectedDay === '24h') {
      const currentBlock = Math.floor(new Date().getHours() / 3) * 3;
      const targetHour = `${currentBlock.toString().padStart(2, '0')}:00`;
      const startIdx = allSlots.findIndex(
        (s) => s.day_label === 'Сегодня' && s.hour_interval === targetHour
      );
      if (startIdx >= 0 && startIdx + 8 <= allSlots.length) {
        rawSlice = allSlots.slice(startIdx, startIdx + 8);
      } else {
        rawSlice = allSlots.slice(0, 8);
      }
    } else {
      rawSlice = allSlots.filter((s) => s.date === effectiveSelectedDay).slice(0, 8);
    }

    const firstDate = rawSlice[0]?.date;
    return rawSlice.map((s) => ({
      ...s,
      slotKey: `${s.date}_${s.hour_interval}`,
      chartLabel:
        effectiveSelectedDay === '24h' && s.date !== firstDate && s.hour_interval === '00:00'
          ? '00:00*'
          : s.hour_interval,
    }));
  }, [forecast?.slots, effectiveSelectedDay]);

  const pressureChartMeta = useMemo(() => {
    const vals = chartSlots
      .map((s) => s.pressure_mmhg)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (vals.length === 0) return null;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const span = maxVal - minVal;
    const pad = Math.max(3, Math.ceil(span * 0.25));
    const domainMin = Math.floor(minVal - pad);
    const domainMax = Math.ceil(maxVal + pad);
    const hasSharp =
      chartSlots.some(
        (s) => s.pressure_trend === 'sharp_drop' || s.pressure_trend === 'sharp_rise'
      ) || span >= 6;
    const netDeltaMm = vals[vals.length - 1] - vals[0];
    return {
      minVal,
      maxVal,
      span,
      domainMin,
      domainMax,
      hasSharp,
      netDeltaMm,
      showNormalLine: domainMin <= 760 && domainMax >= 760,
    };
  }, [chartSlots]);

  const peakSlot: ChartSlotPoint = chartSlots.reduce(
    (best, cur) => (cur.f_index > best.f_index ? cur : best),
    chartSlots[0] ?? {
      date: '',
      day_label: 'Сегодня',
      hour_interval: '06:00',
      f_index: 0,
      probability_label: 'средняя вероятность' as const,
      factors: [],
      slotKey: '_06:00',
      chartLabel: '06:00',
    }
  );
  const activeSlot =
    chartSlots.find((s) => s.slotKey === selectedSlotKey) ?? peakSlot;

  const optimalDeparture = useMemo(
    () => buildOptimalDepartureSummary(chartSlots),
    [chartSlots]
  );

  const handleDepthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepthError(null);
    setDepthSavedMsg(null);
    const ptLat = pickedCoords?.lat ?? waterBody.center.lat;
    const ptLng = pickedCoords?.lng ?? waterBody.center.lng;
    const parsedDepth = Number(depthVal.replace(',', '.'));
    const err = await onAddDepthPoint({
      lat: ptLat,
      lng: ptLng,
      depth_m: parsedDepth,
      source: depthSource,
    });
    if (err) {
      setDepthError(err);
    } else {
      setDepthSavedMsg('Точка глубины сохранена и добавлена на карту.');
    }
  };

  return (
    <section
      aria-label={`Карточка водоёма ${waterBody.display_label}`}
      className="flex h-full flex-col bg-white dark:bg-slate-900"
    >
      {/* Header */}
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
              {waterBody.display_label}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{waterBodyTypeRu(waterBody.type)}</span>
              <span aria-hidden="true"> · </span>
              <span>{SOURCE_LABELS[waterBody.source]}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">
                Достоверность {Math.round(waterBody.confidence * 100)}%
              </span>
              {waterBody.moderation_status === 'unverified' && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">непроверено</span>
                </>
              )}
              {waterBody.fishing_access &&
                waterBody.fishing_access !== 'unknown' && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span
                      title={waterBody.fishing_access_note}
                      className={FISHING_ACCESS_LABELS[waterBody.fishing_access].className}
                    >
                      {FISHING_ACCESS_LABELS[waterBody.fishing_access].label}
                    </span>
                  </>
                )}
              <span aria-hidden="true"> · </span>
              <span
                title={crayfishPresence.summary}
                className={
                  crayfishPresence.level === 'high'
                    ? 'font-semibold text-teal-700 dark:text-teal-400'
                    : crayfishPresence.level === 'medium'
                      ? 'font-semibold text-amber-700 dark:text-amber-400'
                      : 'text-slate-500 dark:text-slate-400'
                }
              >
                {crayfishPresence.compactBadge}
              </span>
              {waterBody.google_maps_uri && (
                <>
                  <span aria-hidden="true"> · </span>
                  <a
                    href={waterBody.google_maps_uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-semibold text-sky-700 hover:underline dark:text-sky-400"
                  >
                    <span>Google Карты</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? 'Убрать водоём из избранного' : 'Добавить водоём в избранное'}
                title={isFavorite ? 'В избранном (уведомления F-Индекса)' : 'Добавить в избранное'}
                data-testid="toggle-favorite-wb"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  isFavorite
                    ? 'bg-amber-50 text-amber-500 dark:bg-amber-950/50'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800'
                }`}
              >
                <Star className={`h-5 w-5 ${isFavorite ? 'fill-current' : ''}`} aria-hidden="true" />
              </button>
            )}

            {onOpenAlerts && (
              <button
                type="button"
                onClick={onOpenAlerts}
                aria-label="Настроить оповещения о клёве"
                title="Оповещения F-Индекса (PWA)"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-sky-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-sky-400"
              >
                <Bell className="h-4.5 w-4.5" aria-hidden="true" />
              </button>
            )}

            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Свернуть карточку водоёма"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Sub-tab segmented control */}
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'forecast'}
            onClick={() => setSubTab('forecast')}
            className={`min-h-[38px] rounded-lg px-1.5 py-1.5 text-[11px] xl:text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'forecast'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Прогноз и клёв
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'depth'}
            onClick={() => setSubTab('depth')}
            className={`min-h-[38px] rounded-lg px-1.5 py-1.5 text-[11px] xl:text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'depth'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Глубины и разведка
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'route'}
            onClick={() => {
              setSubTab('route');
              if (!routeResult) onBuildRoute(false);
            }}
            className={`min-h-[38px] rounded-lg px-1.5 py-1.5 text-[11px] xl:text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === 'route'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            Как добраться
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {subTab === 'forecast' && (
          <>
            {/* Weather Strip */}
            {weather && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <span>Среда и погода (Open-Meteo)</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {weather.moon_phase} ({weather.moon_illumination}%)
                  </span>
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-white p-2.5 dark:bg-slate-900">
                    <div className="text-slate-500 whitespace-nowrap">Давление</div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                      {weather.pressure_mmhg} мм
                    </div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {typeof weather.pressure_delta_6h === 'number'
                        ? `Δ6ч ${weather.pressure_delta_6h > 0 ? '+' : ''}${weather.pressure_delta_6h} гПа`
                        : weather.pressure_trend === 'steady'
                          ? 'стабильно'
                          : weather.pressure_trend === 'rising'
                            ? 'растёт'
                            : 'падает'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white p-2.5 dark:bg-slate-900">
                    <div className="flex items-center gap-1 text-slate-500 whitespace-nowrap">
                      <Thermometer className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Т° вода/возд</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                      {forecast?.estimated_water_temp_c ?? weather.water_temp_c}° / {weather.air_temp_c}°
                    </div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap">
                      {typeof weather.cloud_cover_pct === 'number'
                        ? `Облачн. ${weather.cloud_cover_pct}%`
                        : `Осадки ${weather.precipitation_mm} мм`}
                    </div>
                  </div>
                  <div className="rounded-xl bg-white p-2.5 dark:bg-slate-900">
                    <div className="flex items-center gap-1 text-slate-500 whitespace-nowrap">
                      <Wind className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>Ветер</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                      {weather.wind_speed_ms} м/с
                    </div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {weather.wind_direction_label}
                      {typeof weather.wind_gusts_ms === 'number' && weather.wind_gusts_ms >= weather.wind_speed_ms + 3
                        ? ` · пор. ${Math.round(weather.wind_gusts_ms)}`
                        : weather.precipitation_mm > 0
                          ? ` · ${weather.precipitation_mm} мм`
                          : ''}
                    </div>
                  </div>
                </div>
                {(forecast?.sunrise || forecast?.regime || typeof weather.air_temp_delta_48h_c === 'number') && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                    {forecast?.sunrise && forecast?.sunset && (
                      <span className="font-mono tabular-nums">
                        Восход {forecast.sunrise} · Закат {forecast.sunset}
                      </span>
                    )}
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {forecast?.regime === 'ice'
                        ? forecast.ice_phase === 'first_ice'
                          ? 'Первый лёд'
                          : forecast.ice_phase === 'last_ice'
                            ? 'Последний лёд'
                            : 'Глухозимье (лёд)'
                        : 'Открытая вода'}
                      {typeof weather.air_temp_delta_48h_c === 'number' && Math.abs(weather.air_temp_delta_48h_c) >= 4
                        ? ` · ΔT48ч ${weather.air_temp_delta_48h_c > 0 ? '+' : ''}${weather.air_temp_delta_48h_c}°`
                        : ''}
                    </span>
                  </div>
                )}

                {/* Visual Moon Phase & Illumination Impact Block */}
                {(() => {
                  const selectedSpeciesObj = speciesList.find((s) => s.id === selectedFishId);
                  const moonImpact = describeMoonImpact(
                    weather.moon_illumination,
                    selectedSpeciesObj,
                    waterBody.water_clarity
                  );
                  return (
                    <div
                      data-testid="moon-phase-indicator"
                      className="mt-2.5 flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-2.5 dark:border-slate-700/80 dark:bg-slate-900"
                    >
                      <MoonPhaseDisc
                        illumination={weather.moon_illumination}
                        moonPhase={weather.moon_phase}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {weather.moon_phase} · освещённость{' '}
                            <span className="font-mono tabular-nums">{weather.moon_illumination}%</span>
                          </span>
                          <span className={`font-semibold ${moonImpact.toneClass}`}>
                            {moonImpact.impactLabel}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                          {moonImpact.description}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Ecological, Hydrological, Lunar & Windward Shore Insights */}
                {(forecast?.bio_phase_label ||
                  forecast?.hydrology_label ||
                  forecast?.oxygen_label ||
                  forecast?.lunar_summary ||
                  forecast?.windward_shore_hint ||
                  forecast?.adaptive_factors_note) && (
                  <div
                    data-testid="forecast-eco-insights"
                    className="mt-2.5 space-y-1 border-t border-slate-200/80 pt-2 text-[11px] leading-snug text-slate-600 dark:border-slate-700/80 dark:text-slate-300"
                  >
                    {forecast.lunar_summary && (
                      <div data-testid="forecast-lunar-summary">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Луна и суточный ход: </span>
                        <span>{forecast.lunar_summary}</span>
                      </div>
                    )}
                    {forecast.bio_phase_label && (
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Биофаза: </span>
                        <span>{forecast.bio_phase_label}</span>
                      </div>
                    )}
                    {forecast.hydrology_label && (
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Гидрология: </span>
                        <span>{forecast.hydrology_label}</span>
                      </div>
                    )}
                    {forecast.oxygen_label && (
                      <div
                        className={
                          forecast.oxygen_risk === 'high'
                            ? 'font-medium text-amber-800 dark:text-amber-300'
                            : undefined
                        }
                      >
                        <span className="font-semibold">Кислород / сезон: </span>
                        <span>{forecast.oxygen_label}</span>
                      </div>
                    )}
                    {forecast.windward_shore_hint && (
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100">Берег: </span>
                        <span>{forecast.windward_shore_hint}</span>
                      </div>
                    )}
                    {forecast.adaptive_factors_note && (
                      <div className="text-sky-800 dark:text-sky-300">
                        <span>{forecast.adaptive_factors_note}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Expected Fish Species in this Water Body + Community Verification */}
            <div
              data-testid="water-body-inhabiting-species"
              className="rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Fish className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Какая рыба водится в водоёме
                </h3>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {expectedFish.length} вид.
                  </span>
                  {onVerifySpecies && (
                    <button
                      type="button"
                      data-testid="toggle-species-verify-form"
                      onClick={() => {
                        setVerifySpeciesId(selectedFishId);
                        setVerifyFeedback(null);
                        setVerifyFormOpen((v) => !v);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-400"
                    >
                      <PlusCircle className="h-3 w-3" aria-hidden="true" />
                      <span>Уточнить</span>
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Нажмите на вид для прогноза. Значок щита — подтверждено рыбаками.
              </p>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {expectedFish.map((item) => {
                  const isSelected = item.species_id === selectedFishId;
                  const isVerified = item.source === 'confirmed_report' || item.source === 'verified_community';
                  const confirmCount = item.confirm_count ?? 0;
                  return (
                    <button
                      key={item.species_id}
                      type="button"
                      onClick={() => onSelectFishId(item.species_id)}
                      title={
                        item.note
                          ? `${item.species_name} (${ABUNDANCE_LABELS[item.abundance]}): ${item.note}`
                          : `${item.species_name} (${ABUNDANCE_LABELS[item.abundance]})`
                      }
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : isVerified
                            ? 'border-teal-200 bg-teal-50/70 text-slate-900 hover:border-teal-500 dark:border-teal-800 dark:bg-teal-950/35 dark:text-slate-100'
                            : item.abundance === 'common'
                              ? 'border-slate-200 bg-slate-50 text-slate-800 hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                              : 'border-slate-200/80 bg-white text-slate-600 hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {item.source === 'confirmed_report' ? (
                        <CheckCircle2
                          className={`h-3 w-3 shrink-0 ${isSelected ? 'text-sky-100' : 'text-teal-600 dark:text-teal-400'}`}
                          aria-hidden="true"
                        />
                      ) : item.source === 'verified_community' ? (
                        <ShieldCheck
                          className={`h-3 w-3 shrink-0 ${isSelected ? 'text-sky-100' : 'text-teal-600 dark:text-teal-400'}`}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span>{item.species_name}</span>
                      <span
                        className={`text-[10px] ${
                          isSelected ? 'text-sky-100' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        · {ABUNDANCE_LABELS[item.abundance]}
                        {confirmCount > 0 ? ` ✓${confirmCount}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedExpectedFish ? (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-[11px] dark:bg-slate-800/60">
                  <div className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      {selectedExpectedFish.species_name}:
                    </span>{' '}
                    {selectedExpectedFish.note || 'Ожидаемый вид по параметрам водоёма'}
                    {selectedExpectedFish.source === 'confirmed_report'
                      ? ' · подтверждено уловами'
                      : selectedExpectedFish.source === 'verified_community'
                        ? ` · верифицировано (${selectedExpectedFish.confirm_count ?? 1})`
                        : ''}
                  </div>
                  {onVerifySpecies && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={verifySubmitting}
                        data-testid="quick-confirm-species-btn"
                        onClick={() =>
                          void runSpeciesVerification({
                            speciesId: selectedExpectedFish.species_id,
                            action: 'confirm',
                            abundance: selectedExpectedFish.abundance,
                          })
                        }
                        title="Подтвердить, что этот вид действительно водится здесь"
                        className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-2 py-1 text-[10px] font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-300"
                      >
                        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                        <span>Водится</span>
                      </button>
                      <button
                        type="button"
                        disabled={verifySubmitting}
                        data-testid="quick-absent-species-btn"
                        onClick={() =>
                          void runSpeciesVerification({
                            speciesId: selectedExpectedFish.species_id,
                            action: 'absent',
                          })
                        }
                        title="Отметить как ошибку базы — этого вида здесь нет"
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                      >
                        <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                        <span>Нет здесь</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : selectedSpeciesObj ? (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <span>
                    «{selectedSpeciesObj.name}» нетипичен для этого водоёма — выберите вид выше или подтвердите наличие.
                  </span>
                  {onVerifySpecies && (
                    <button
                      type="button"
                      disabled={verifySubmitting}
                      onClick={() =>
                        void runSpeciesVerification({
                          speciesId: selectedSpeciesObj.id,
                          action: 'confirm',
                          abundance: 'regular',
                        })
                      }
                      className="rounded-md bg-amber-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      Подтвердить «{selectedSpeciesObj.name}»
                    </button>
                  )}
                </div>
              ) : null}

              {verifyFeedback && (
                <p
                  data-testid="species-verify-feedback"
                  className={`mt-2 text-[11px] font-medium ${
                    verifyFeedback.type === 'ok'
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {verifyFeedback.text}
                </p>
              )}

              {/* Community Species Correction Form */}
              {verifyFormOpen && onVerifySpecies && (
                <form
                  data-testid="species-verify-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSpeciesVerification({
                      speciesId: verifySpeciesId,
                      action: verifyAction,
                      abundance: verifyAction === 'confirm' ? verifyAbundance : undefined,
                      note: verifyNote.trim() || undefined,
                    });
                  }}
                  className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100">
                    Предложить правку по ихтиофауне водоёма
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      aria-label="Вид рыбы для верификации"
                      value={verifySpeciesId}
                      onChange={(e) => setVerifySpeciesId(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {speciesList.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Статус вида в водоёме"
                      value={verifyAction}
                      onChange={(e) => setVerifyAction(e.target.value as 'confirm' | 'absent')}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="confirm">Водится (подтвердить / добавить)</option>
                      <option value="absent">Нет в водоёме (убрать ошибку)</option>
                    </select>
                  </div>

                  {verifyAction === 'confirm' && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-500">Встречаемость:</span>
                      {(['common', 'regular', 'rare'] as const).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setVerifyAbundance(lvl)}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                            verifyAbundance === lvl
                              ? 'bg-sky-700 text-white'
                              : 'bg-white text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                          }`}
                        >
                          {ABUNDANCE_LABELS[lvl]}
                        </button>
                      ))}
                    </div>
                  )}

                  <input
                    type="text"
                    maxLength={160}
                    placeholder="Комментарий (напр.: ловится у русловой бровки 6–8 м)"
                    value={verifyNote}
                    onChange={(e) => setVerifyNote(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setVerifyFormOpen(false)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    >
                      Закрыть
                    </button>
                    <button
                      type="submit"
                      disabled={verifySubmitting}
                      className="rounded-lg bg-sky-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
                    >
                      {verifySubmitting ? 'Сохранение...' : 'Сохранить правку'}
                    </button>
                  </div>
                </form>
              )}

              {/* Excluded Species Footer (with one-click restore) */}
              {excludedFish.length > 0 && (
                <div className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Исключено рыбаками:</span>
                    {excludedFish.map((ex) => (
                      <span
                        key={ex.species_id}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        <span className="line-through">{ex.species_name}</span>
                        {onVerifySpecies && (
                          <button
                            type="button"
                            disabled={verifySubmitting}
                            onClick={() =>
                              void runSpeciesVerification({
                                speciesId: ex.species_id,
                                action: 'confirm',
                                abundance: 'rare',
                              })
                            }
                            title={`Восстановить «${ex.species_name}» в списке`}
                            className="text-sky-700 hover:underline dark:text-sky-400"
                          >
                            <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Crayfish Presence Assessment */}
              <div
                data-testid="water-body-crayfish-presence"
                className={`mt-3 rounded-xl border p-3 text-xs ${
                  crayfishPresence.level === 'high'
                    ? 'border-teal-200 bg-teal-50/70 dark:border-teal-900/60 dark:bg-teal-950/30'
                    : crayfishPresence.level === 'medium'
                      ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    <span>Наличие раков: </span>
                    <span
                      className={
                        crayfishPresence.level === 'high'
                          ? 'text-teal-700 dark:text-teal-400'
                          : crayfishPresence.level === 'medium'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-400'
                      }
                    >
                      {crayfishPresence.confirmedSpot
                        ? 'обитают (подтверждено базой)'
                        : crayfishPresence.level === 'high'
                          ? 'высокая вероятность'
                          : crayfishPresence.level === 'medium'
                            ? 'возможны локально'
                            : 'маловероятны'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                    {crayfishPresence.score}/100
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {crayfishPresence.summary}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    Сезон: <strong className="text-slate-700 dark:text-slate-200">{crayfishPresence.bestSeason}</strong>
                    {' · '}
                    Глубины: <strong className="text-slate-700 dark:text-slate-200">{crayfishPresence.depthHint}</strong>
                  </span>
                  {onOpenCrayfishGuide && (
                    <button
                      type="button"
                      onClick={onOpenCrayfishGuide}
                      className="font-semibold text-sky-700 hover:underline dark:text-sky-400"
                    >
                      Как и когда ловить раков →
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* F-Index Bite Forecast (7 Days + Barometric Pressure) */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="wb-fish-select" className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Прогноз клёва на 7 дней (F-Индекс)
                </label>
                <select
                  id="wb-fish-select"
                  value={selectedFishId}
                  onChange={(e) => onSelectFishId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {speciesList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 7-day planning switcher */}
              <div
                data-testid="forecast-7day-switcher"
                className="mt-2.5 flex items-stretch gap-1.5 overflow-x-auto pb-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDay('24h');
                    setSelectedSlotKey(null);
                  }}
                  className={`flex shrink-0 flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 text-center transition-colors whitespace-nowrap ${
                    effectiveSelectedDay === '24h'
                      ? 'border-sky-700 bg-sky-700 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <span className="text-[11px] font-semibold">24ч</span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      effectiveSelectedDay === '24h' ? 'text-sky-100' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    сейчас
                  </span>
                </button>
                {forecastDaySummaries.map((day) => {
                  const isActive = effectiveSelectedDay === day.key;
                  const isBest = bestWeekDay?.key === day.key;
                  const fColor = isActive
                    ? 'text-white'
                    : day.peak_f_index >= 66
                      ? 'text-teal-700 dark:text-teal-400'
                      : day.peak_f_index >= 40
                        ? 'text-sky-700 dark:text-sky-400'
                        : 'text-slate-500';
                  return (
                    <button
                      key={day.key}
                      type="button"
                      data-testid={`forecast-day-btn-${day.date}`}
                      onClick={() => {
                        setSelectedDay(day.key);
                        setSelectedSlotKey(null);
                      }}
                      className={`relative flex shrink-0 flex-col items-center rounded-xl border px-2.5 py-1.5 text-center transition-colors whitespace-nowrap ${
                        isActive
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : isBest
                            ? 'border-teal-300 bg-teal-50/70 text-slate-800 hover:bg-teal-50 dark:border-teal-800 dark:bg-teal-950/30 dark:text-slate-100'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                      title={`${day.day_label}: пик F-${day.peak_f_index} в ${day.peak_hour}${
                        day.has_sharp_pressure ? ' · резкий перепад давления' : ''
                      }`}
                    >
                      <span className="text-[11px] font-semibold leading-tight">{day.short_label}</span>
                      <span className={`mt-0.5 font-mono text-[10px] font-bold tabular-nums ${fColor}`}>
                        F-{day.peak_f_index}
                        {day.has_sharp_pressure ? ' · ΔP' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>

              {bestWeekDay && (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-teal-50/80 px-2.5 py-1.5 text-[11px] text-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
                  <span className="truncate">
                    Перспективный день недели:{' '}
                    <strong className="font-semibold">
                      {bestWeekDay.day_label} (F-{bestWeekDay.peak_f_index} в {bestWeekDay.peak_hour})
                    </strong>
                  </span>
                  {effectiveSelectedDay !== bestWeekDay.key && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDay(bestWeekDay.key);
                        setSelectedSlotKey(null);
                      }}
                      className="shrink-0 font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-900 dark:text-teal-300"
                    >
                      Открыть
                    </button>
                  )}
                </div>
              )}

              {/* Summary headline (probabilistic phrasing per FR-5.5) */}
              <div className="mt-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Прогноз: {peakSlot.probability_label}
                  </span>
                  <span className="font-mono text-sm font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                    пик F-{peakSlot.f_index} в {peakSlot.hour_interval}
                  </span>
                </div>

                {/* Model confidence & Bayesian calibration bar */}
                {forecast?.confidence_label && (
                  <div
                    data-testid="forecast-confidence-bar"
                    className="mt-2 flex flex-wrap items-center justify-between gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800/70"
                  >
                    <span
                      className={`font-semibold ${
                        forecast.confidence_level === 'high'
                          ? 'text-teal-700 dark:text-teal-400'
                          : forecast.confidence_level === 'medium'
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {forecast.confidence_label}
                    </span>
                    {typeof forecast.calibration_delta === 'number' && forecast.calibration_delta !== 0 && (
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                        поправка {forecast.calibration_delta > 0 ? `+${forecast.calibration_delta}` : forecast.calibration_delta}
                      </span>
                    )}
                  </div>
                )}

                {forecastLoading ? (
                  <div className="mt-4 text-xs text-slate-500">Обновляем прогноз...</div>
                ) : chartSlots.length > 0 ? (
                  <>
                    {/* Optimal departure window banner for next 24h / selected day */}
                    {optimalDeparture && (
                      <div
                        data-testid="findex-optimal-window"
                        className={`mt-2.5 flex items-start justify-between gap-2.5 rounded-xl border px-3 py-2 text-[11px] ${
                          optimalDeparture.quality === 'optimal'
                            ? 'border-teal-200/90 bg-teal-50/75 text-teal-950 dark:border-teal-800/70 dark:bg-teal-950/35 dark:text-teal-100'
                            : optimalDeparture.quality === 'moderate'
                              ? 'border-sky-200/90 bg-sky-50/70 text-sky-950 dark:border-sky-800/70 dark:bg-sky-950/35 dark:text-sky-100'
                              : 'border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <Clock
                              className={`h-3.5 w-3.5 shrink-0 ${
                                optimalDeparture.quality === 'optimal'
                                  ? 'text-teal-700 dark:text-teal-400'
                                  : optimalDeparture.quality === 'moderate'
                                    ? 'text-sky-700 dark:text-sky-400'
                                    : 'text-slate-500'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="tabular-nums">{optimalDeparture.headline}</span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-600 dark:text-slate-300 tabular-nums">
                            {optimalDeparture.subtext}
                          </div>
                        </div>
                        {activeSlot.slotKey !== optimalDeparture.peakSlotKey && (
                          <button
                            type="button"
                            onClick={() => setSelectedSlotKey(optimalDeparture.peakSlotKey)}
                            className="shrink-0 self-center rounded-md px-2 py-1 text-[10px] font-semibold text-teal-700 underline underline-offset-2 hover:text-teal-900 dark:text-teal-300 whitespace-nowrap"
                          >
                            К пику
                          </button>
                        )}
                      </div>
                    )}

                    {/* Chart caption */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {effectiveSelectedDay === '24h'
                          ? 'Динамика F-Индекса (ближайшие 24 ч)'
                          : `Динамика F-Индекса (${chartSlots[0]?.day_label ?? ''})`}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                        Оптимум ≥ 66 · шаг 3 ч
                      </span>
                    </div>

                    {/* Recharts 24h F-Index Dynamics Area Chart */}
                    <div className="mt-1.5 h-[196px] w-full" data-testid="findex-24h-chart">
                      <ResponsiveContainer width="100%" height={192}>
                        <AreaChart
                          data={chartSlots}
                          margin={{ top: 12, right: 12, left: -20, bottom: 2 }}
                          onClick={(state) => {
                            const idx = typeof state?.activeTooltipIndex === 'number' ? state.activeTooltipIndex : -1;
                            if (idx >= 0 && chartSlots[idx]) {
                              setSelectedSlotKey(chartSlots[idx].slotKey);
                            }
                          }}
                        >
                          <defs>
                            <linearGradient id="fIndexAreaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0D9488" stopOpacity={0.34} />
                              <stop offset="55%" stopColor="#0284C7" stopOpacity={0.14} />
                              <stop offset="98%" stopColor="#0284C7" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" strokeOpacity={0.45} />
                          <XAxis
                            dataKey="chartLabel"
                            tick={{ fontSize: 10, fill: '#64748B' }}
                            axisLine={{ stroke: '#CBD5E1' }}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            ticks={[0, 40, 66, 100]}
                            tick={{ fontSize: 10, fill: '#64748B' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          {/* Shaded optimal F >= 66 zone */}
                          <ReferenceArea
                            y1={66}
                            y2={100}
                            fill="#0D9488"
                            fillOpacity={0.07}
                            ifOverflow="extendDomain"
                          />
                          {/* Highlighted best contiguous departure window on X-axis */}
                          {optimalDeparture &&
                            optimalDeparture.endIndex > optimalDeparture.startIndex &&
                            chartSlots[optimalDeparture.startIndex] &&
                            chartSlots[optimalDeparture.endIndex] && (
                              <ReferenceArea
                                x1={chartSlots[optimalDeparture.startIndex].chartLabel}
                                x2={chartSlots[optimalDeparture.endIndex].chartLabel}
                                fill={optimalDeparture.quality === 'optimal' ? '#0D9488' : '#0284C7'}
                                fillOpacity={0.12}
                                ifOverflow="extendDomain"
                              />
                            )}
                          <ReferenceLine
                            y={66}
                            stroke="#0D9488"
                            strokeDasharray="4 3"
                            strokeOpacity={0.85}
                            label={{
                              value: 'F-66',
                              position: 'insideTopRight',
                              fill: '#0D9488',
                              fontSize: 9,
                              fontWeight: 700,
                            }}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const pt = payload[0].payload as ChartSlotPoint;
                              return (
                                <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-md dark:border-slate-700 dark:bg-slate-900/95">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                      {pt.day_label}, {pt.hour_interval}
                                    </span>
                                    <span
                                      className={`font-mono font-bold tabular-nums ${
                                        pt.f_index >= 66
                                          ? 'text-teal-700 dark:text-teal-400'
                                          : pt.f_index >= 40
                                            ? 'text-sky-700 dark:text-sky-400'
                                            : 'text-slate-500'
                                      }`}
                                    >
                                      F-{pt.f_index}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-slate-600 dark:text-slate-300">
                                    {pt.probability_label}
                                  </div>
                                  {typeof pt.temp_c === 'number' && (
                                    <div className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                                      {pt.temp_c}°C · {pt.wind_speed_ms} м/с · {pt.pressure_mmhg} мм · об.{' '}
                                      {pt.cloud_cover_pct ?? 0}%
                                    </div>
                                  )}
                                  {pt.factors.length > 0 && (
                                    <div className="mt-1 max-w-[220px] text-[10px] text-slate-500 dark:text-slate-400">
                                      {pt.factors.slice(0, 2).join(' · ')}
                                    </div>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="f_index"
                            stroke="#0284C7"
                            strokeWidth={2.5}
                            fill="url(#fIndexAreaGrad)"
                            isAnimationActive={false}
                            dot={(dotProps: {
                              cx?: number;
                              cy?: number;
                              payload?: ChartSlotPoint;
                            }) => {
                              const { cx, cy, payload } = dotProps;
                              if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) {
                                return <g key="empty-f" />;
                              }
                              const isSelectedDot = activeSlot.slotKey === payload.slotKey;
                              const isHigh = payload.f_index >= 66;
                              const fill = isSelectedDot
                                ? '#0F172A'
                                : isHigh
                                  ? '#0D9488'
                                  : payload.f_index >= 40
                                    ? '#0284C7'
                                    : '#94A3B8';
                              return (
                                <circle
                                  key={payload.slotKey}
                                  cx={cx}
                                  cy={cy}
                                  r={isSelectedDot ? 5 : isHigh ? 4 : 3.2}
                                  fill={fill}
                                  stroke="#FFFFFF"
                                  strokeWidth={1.6}
                                />
                              );
                            }}
                            activeDot={{ r: 6, fill: '#0F172A', stroke: '#FFFFFF', strokeWidth: 2 }}
                          />
                          <ReferenceDot
                            x={peakSlot.chartLabel}
                            y={peakSlot.f_index}
                            r={6}
                            fill="#0D9488"
                            stroke="#FFFFFF"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Minimal typographic legend */}
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>Нажмите на точку графика или час ниже для разбора погоды</span>
                      <span className="font-mono tabular-nums">
                        Пик: <strong className="text-teal-700 dark:text-teal-400">F-{peakSlot.f_index}</strong> ({peakSlot.hour_interval})
                      </span>
                    </div>

                    {/* Synchronized Atmospheric Pressure Chart (mmHg + sharp swing indicators) */}
                    {pressureChartMeta && (
                      <div
                        className="mt-3 border-t border-slate-100 pt-2.5 dark:border-slate-800"
                        data-testid="pressure-forecast-chart"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Атмосферное давление (мм рт. ст.)
                          </span>
                          <span
                            className={`font-mono text-[10px] font-semibold tabular-nums ${
                              pressureChartMeta.hasSharp
                                ? 'text-rose-700 dark:text-rose-400'
                                : Math.abs(pressureChartMeta.netDeltaMm) <= 2 && pressureChartMeta.span <= 3
                                  ? 'text-teal-700 dark:text-teal-400'
                                  : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {pressureChartMeta.minVal === pressureChartMeta.maxVal
                              ? `${pressureChartMeta.minVal} мм`
                              : `${pressureChartMeta.minVal}–${pressureChartMeta.maxVal} мм`}
                            {pressureChartMeta.hasSharp
                              ? ' · резкий перепад'
                              : Math.abs(pressureChartMeta.netDeltaMm) <= 2 && pressureChartMeta.span <= 3
                                ? ' · стабильно'
                                : pressureChartMeta.netDeltaMm > 0
                                  ? ` · +${pressureChartMeta.netDeltaMm} мм`
                                  : ` · ${pressureChartMeta.netDeltaMm} мм`}
                          </span>
                        </div>
                        <div className="mt-1.5 h-[126px] w-full">
                          <ResponsiveContainer width="100%" height={122}>
                            <AreaChart
                              data={chartSlots}
                              margin={{ top: 10, right: 12, left: -16, bottom: 2 }}
                              onClick={(state) => {
                                const idx =
                                  typeof state?.activeTooltipIndex === 'number'
                                    ? state.activeTooltipIndex
                                    : -1;
                                if (idx >= 0 && chartSlots[idx]) {
                                  setSelectedSlotKey(chartSlots[idx].slotKey);
                                }
                              }}
                            >
                              <defs>
                                <linearGradient id="pressureAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.28} />
                                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0.03} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" strokeOpacity={0.4} />
                              <XAxis
                                dataKey="chartLabel"
                                tick={{ fontSize: 10, fill: '#64748B' }}
                                axisLine={{ stroke: '#CBD5E1' }}
                                tickLine={false}
                              />
                              <YAxis
                                domain={[pressureChartMeta.domainMin, pressureChartMeta.domainMax]}
                                tick={{ fontSize: 10, fill: '#64748B' }}
                                axisLine={false}
                                tickLine={false}
                                width={42}
                              />
                              {pressureChartMeta.showNormalLine && (
                                <ReferenceLine
                                  y={760}
                                  stroke="#94A3B8"
                                  strokeDasharray="3 3"
                                  strokeOpacity={0.7}
                                />
                              )}
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload || payload.length === 0) return null;
                                  const pt = payload[0].payload as ChartSlotPoint;
                                  const trendText = pt.pressure_trend
                                    ? PRESSURE_TREND_LABELS[pt.pressure_trend]
                                    : 'Ровно';
                                  const isSharp =
                                    pt.pressure_trend === 'sharp_drop' ||
                                    pt.pressure_trend === 'sharp_rise';
                                  return (
                                    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-md dark:border-slate-700 dark:bg-slate-900/95">
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                          {pt.day_label}, {pt.hour_interval}
                                        </span>
                                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
                                          {pt.pressure_mmhg} мм
                                        </span>
                                      </div>
                                      <div
                                        className={`mt-0.5 font-medium ${
                                          isSharp
                                            ? 'text-rose-700 dark:text-rose-400'
                                            : 'text-slate-600 dark:text-slate-300'
                                        }`}
                                      >
                                        {trendText}
                                        {typeof pt.pressure_delta_6h === 'number'
                                          ? ` (Δ6ч ${pt.pressure_delta_6h > 0 ? '+' : ''}${pt.pressure_delta_6h} гПа)`
                                          : ''}
                                      </div>
                                      <div className="mt-0.5 font-mono text-[10px] text-slate-500 tabular-nums">
                                        {typeof pt.pressure_hpa === 'number' ? `${pt.pressure_hpa} гПа · ` : ''}
                                        F-{pt.f_index}
                                      </div>
                                    </div>
                                  );
                                }}
                              />
                              <Area
                                type="monotone"
                                dataKey="pressure_mmhg"
                                stroke="#4F46E5"
                                strokeWidth={2}
                                fill="url(#pressureAreaGrad)"
                                isAnimationActive={false}
                                dot={(dotProps: {
                                  cx?: number;
                                  cy?: number;
                                  payload?: ChartSlotPoint;
                                }) => {
                                  const { cx, cy, payload } = dotProps;
                                  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) {
                                    return <g key="empty" />;
                                  }
                                  const isDrop = payload.pressure_trend === 'sharp_drop';
                                  const isRise = payload.pressure_trend === 'sharp_rise';
                                  const isSelectedDot = activeSlot.slotKey === payload.slotKey;
                                  const fill = isDrop
                                    ? '#DC2626'
                                    : isRise
                                      ? '#D97706'
                                      : isSelectedDot
                                        ? '#0F172A'
                                        : '#4F46E5';
                                  return (
                                    <circle
                                      key={payload.slotKey}
                                      cx={cx}
                                      cy={cy}
                                      r={isDrop || isRise || isSelectedDot ? 4.5 : 3}
                                      fill={fill}
                                      stroke="#FFFFFF"
                                      strokeWidth={1.5}
                                    />
                                  );
                                }}
                                activeDot={{ r: 5, fill: '#0F172A', stroke: '#FFFFFF', strokeWidth: 2 }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* Compact clickable 3-hour slot strip for quick touch inspection */}
                    <div className="mt-1.5 grid grid-cols-8 gap-1">
                      {chartSlots.map((slot) => {
                        const isSelected = activeSlot.slotKey === slot.slotKey;
                        const isPeak = peakSlot.slotKey === slot.slotKey;
                        const isSharpSlot =
                          slot.pressure_trend === 'sharp_drop' || slot.pressure_trend === 'sharp_rise';
                        return (
                          <button
                            key={slot.slotKey}
                            type="button"
                            onClick={() => setSelectedSlotKey(slot.slotKey)}
                            className={`rounded-md py-1 text-center font-mono text-[10px] tabular-nums transition-colors ${
                              isSelected
                                ? 'bg-sky-700 font-bold text-white'
                                : isPeak
                                  ? 'bg-teal-50 font-bold text-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                                  : isSharpSlot
                                    ? 'bg-rose-50 font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800/70 dark:text-slate-300'
                            }`}
                            title={`${slot.day_label} ${slot.hour_interval}: F-${slot.f_index} · ${slot.pressure_mmhg ?? '—'} мм`}
                          >
                            {slot.hour_interval.slice(0, 2)}ч
                          </button>
                        );
                      })}
                    </div>

                    {/* Selected slot factor & hourly meteo breakdown */}
                    {activeSlot && (
                      <div className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-1 text-slate-700 dark:text-slate-300">
                          <span className="font-semibold">
                            Слот {activeSlot.day_label}, {activeSlot.hour_interval}: F-{activeSlot.f_index}
                          </span>
                          {typeof activeSlot.temp_c === 'number' && (
                            <span className="font-mono text-slate-500 tabular-nums">
                              {activeSlot.temp_c}°C · {activeSlot.wind_speed_ms} м/с
                              {typeof activeSlot.wind_gusts_ms === 'number' && activeSlot.wind_gusts_ms >= 10
                                ? ` (пор. ${Math.round(activeSlot.wind_gusts_ms)})`
                                : ''}
                              {' · '}
                              {activeSlot.pressure_mmhg} мм
                              {typeof activeSlot.pressure_delta_6h === 'number' &&
                              Math.abs(activeSlot.pressure_delta_6h) >= 1.5
                                ? ` (${activeSlot.pressure_delta_6h > 0 ? '+' : ''}${activeSlot.pressure_delta_6h} гПа/6ч)`
                                : ''}
                              {' · об. '}
                              {activeSlot.cloud_cover_pct ?? 0}%
                              {typeof activeSlot.radiation_wm2 === 'number' && activeSlot.radiation_wm2 > 20
                                ? ` · ${activeSlot.radiation_wm2} Вт/м²`
                                : ''}
                            </span>
                          )}
                        </div>
                        {activeSlot.factors.length > 0 && (
                          <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                            Факторы: {activeSlot.factors.join(' · ')}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mt-4 text-xs text-slate-500">Нет данных прогноза для выбранного интервала.</div>
                )}

                <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {forecast?.disclaimer ??
                    'Прогноз носит вероятностный характер и не гарантирует результат.'}
                </p>
              </div>
            </div>

            {/* Matched Lures */}
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Рекомендуемые приманки для этого водоёма
              </h3>
              <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {recommendations.slice(0, 3).map((rec) => (
                  <div key={rec.lure.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {rec.lure.lure_type}
                      </span>
                      <span className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400 shrink-0 tabular-nums">
                        {rec.score}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{rec.lure.retrieve}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {rec.reasons.join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {subTab === 'depth' && (
          <>
            {/* Bathymetry status */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Waves className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Батиметрия и рельеф дна
                </span>
                {waterBody.max_depth_m !== null && (
                  <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                    макс. {waterBody.max_depth_m} м
                  </span>
                )}
              </div>

              {waterBody.has_bathymetry ? (
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                  Доступны изобаты и {depthPoints.length} промеров глубин (Seascape + краудсорсинг).
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
                  Для этого водоёма нет готовой карты глубин — вы можете добавить промер с эхолота или груза.
                </p>
              )}

              <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                Не для навигации. Данные приблизительные.
              </p>
            </div>

            {/* Bathymetry Bottom Profile Chart along Selected Line (Recharts) */}
            <div
              data-testid="bathymetry-profile-card"
              className="rounded-2xl border border-slate-200 p-3.5 space-y-3 dark:border-slate-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Профиль дна вдоль линии
                  </h3>
                  {profileSummary && (
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      Протяжённость ~{profileSummary.spanM} м · макс. {profileSummary.maxD.toFixed(1)} м · ср.{' '}
                      {profileSummary.avgD.toFixed(1)} м ({profileData.length} точ.)
                    </p>
                  )}
                </div>

                <select
                  aria-label="Линия профиля дна"
                  data-testid="bathymetry-line-select"
                  value={profileLineMode}
                  onChange={(e) => setProfileLineMode(e.target.value as BathymetryProfileLineMode)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="transect">Главная ось промеров</option>
                  <option value="west_east">Линия Запад → Восток</option>
                  <option value="south_north">Линия Юг → Север</option>
                </select>
              </div>

              {profileData.length >= 2 && profileSummary ? (
                <div className="h-[190px] w-full" data-testid="bathymetry-profile-chart">
                  <ResponsiveContainer width="100%" height={186}>
                    <AreaChart data={profileData} margin={{ top: 10, right: 12, left: -14, bottom: 2 }}>
                      <defs>
                        <linearGradient id="bathymetryWaterGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="#0C4A6E" stopOpacity={0.65} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" strokeOpacity={0.45} />
                      <XAxis
                        dataKey="distance_m"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v) => `${v} м`}
                        tick={{ fontSize: 10, fill: '#64748B' }}
                        axisLine={{ stroke: '#CBD5E1' }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[profileSummary.domainBottom, 0]}
                        tickFormatter={(v) => `${Math.abs(Number(v))} м`}
                        tick={{ fontSize: 10, fill: '#64748B' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <ReferenceLine y={0} stroke="#0D9488" strokeDasharray="4 2" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const pt = payload[0].payload as BathymetryProfilePoint;
                          return (
                            <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-md dark:border-slate-700 dark:bg-slate-900/95">
                              <div className="font-mono font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                                Глубина: {pt.depth_m.toFixed(1)} м
                              </div>
                              <div className="mt-0.5 text-slate-600 dark:text-slate-300 tabular-nums">
                                От начала линии: {pt.distance_m} м
                              </div>
                              <div className="text-slate-500 dark:text-slate-400">
                                Источник: {pt.source_label}
                              </div>
                              <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                                {pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="bottom_elevation_m"
                        baseValue={0}
                        stroke="#0369A1"
                        strokeWidth={2.5}
                        fill="url(#bathymetryWaterGradient)"
                        dot={{ r: 3.5, fill: '#0F172A', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                        activeDot={{ r: 5, fill: '#F59E0B', stroke: '#FFFFFF', strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : profileData.length === 1 ? (
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  Доступна 1 точка глубины (<span className="font-mono font-semibold">{profileData[0].depth_m.toFixed(1)} м</span>). Добавьте ещё хотя бы 1 промер на карте, чтобы построить профиль рельефа вдоль линии.
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  Для этого водоёма пока нет точек глубин. Поставьте 2 и более промеров ниже (или нажмите «Указать на карте»), чтобы увидеть срез рельефа дна.
                </div>
              )}
            </div>

            {/* Prospective Zones (Client-side calculated drop-offs & holes) */}
            {prospectiveZones.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Перспективные зоны (расчёт по изобатам)
                </h3>
                <div className="mt-2 space-y-1.5">
                  {prospectiveZones.map((z) => (
                    <div
                      key={z.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-800"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{z.label}</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {z.lat.toFixed(4)}, {z.lng.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Crowdsourced Depth Point Submission (FR-2.2) */}
            <form
              onSubmit={(e) => void handleDepthSubmit(e)}
              className="rounded-2xl border border-slate-200 p-3.5 space-y-3 dark:border-slate-800"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Добавить точку глубины
                </h3>
                <button
                  type="button"
                  onClick={onTogglePickDepthMode}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    pickDepthMode
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {pickDepthMode ? 'Режим выбора на карте' : 'Указать на карте'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="depth-input" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Глубина, м
                  </label>
                  <input
                    id="depth-input"
                    type="text"
                    inputMode="decimal"
                    value={depthVal}
                    onChange={(e) => setDepthVal(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="depth-source" className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Источник
                  </label>
                  <select
                    id="depth-source"
                    value={depthSource}
                    onChange={(e) => setDepthSource(e.target.value as 'manual' | 'sonar')}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="manual">Ручной промер</option>
                    <option value="sonar">Эхолот / сонар</option>
                  </select>
                </div>
              </div>

              <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                Координаты: {(pickedCoords?.lat ?? waterBody.center.lat).toFixed(5)},{' '}
                {(pickedCoords?.lng ?? waterBody.center.lng).toFixed(5)}
              </div>

              {depthError && <p className="text-xs font-medium text-rose-700">{depthError}</p>}
              {depthSavedMsg && <p className="text-xs font-medium text-teal-700 dark:text-teal-400">{depthSavedMsg}</p>}

              <button
                type="submit"
                className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-sky-700 dark:hover:bg-sky-800"
              >
                <Anchor className="h-3.5 w-3.5" aria-hidden="true" />
                Сохранить промер глубины
              </button>
            </form>

            {/* Sonar Log Importer (CSV / GPX -> Live Auto-Isobaths) */}
            {onImportDepthPoints && (
              <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2.5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                    <Upload className="h-4 w-4 text-teal-700 dark:text-teal-400" aria-hidden="true" />
                    Импорт логов эхолота (CSV / GPX)
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      const csv = buildSampleSonarCsv(waterBody);
                      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `sonar-${waterBody.id}.csv`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-400"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    Пример CSV
                  </button>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  Поддерживаются выгрузки <strong>Deeper</strong>, <strong>Garmin ActiveCaptain / Quickdraw</strong>,{' '}
                  <strong>Lowrance / Humminbird CSV</strong> и <strong>GPX</strong>. После загрузки изобаты на карте
                  строятся автоматически.
                </p>

                <label className="flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-teal-600/45 bg-teal-50/60 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-50 dark:border-teal-500/40 dark:bg-teal-950/30 dark:text-teal-200 dark:hover:bg-teal-950/50">
                  <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{sonarImporting ? 'Импорт промеров...' : 'Выбрать файл .csv, .txt или .gpx'}</span>
                  <input
                    type="file"
                    accept=".csv,.txt,.gpx,text/csv,application/gpx+xml"
                    disabled={sonarImporting}
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setSonarImportErr(null);
                      setSonarImportMsg(null);
                      if (file.size > 2 * 1024 * 1024) {
                        setSonarImportErr('Файл превышает лимит 2 МБ.');
                        return;
                      }
                      setSonarImporting(true);
                      try {
                        const text = await file.text();
                        const parsed = parseSonarDepthFile(text, file.name);
                        if (parsed.error || parsed.points.length === 0) {
                          setSonarImportErr(parsed.error ?? 'Не удалось прочитать глубины из файла.');
                          return;
                        }
                        const res = await onImportDepthPoints(parsed.points);
                        if (res.error) {
                          setSonarImportErr(res.error);
                        } else {
                          const extra = parsed.downsampled ? ' (сжато до 400 точек)' : '';
                          setSonarImportMsg(
                            `Загружено ${res.importedCount} промеров (${parsed.format.toUpperCase()})${extra} — изобаты обновлены.`
                          );
                        }
                      } catch {
                        setSonarImportErr('Не удалось прочитать файл лога эхолота.');
                      } finally {
                        setSonarImporting(false);
                      }
                    }}
                  />
                </label>

                {sonarImportErr && <p className="text-xs font-medium text-rose-700 dark:text-rose-400">{sonarImportErr}</p>}
                {sonarImportMsg && <p className="text-xs font-medium text-teal-700 dark:text-teal-400">{sonarImportMsg}</p>}
              </div>
            )}

            {/* Historic Pre-Flood Riverbed Map Image Overlay */}
            {onUploadHistoricMap && (
              <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2.5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                    <ImageIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    Подложка старой карты (до затопления)
                  </h3>
                  {historicOverlay && historicOverlay.waterBodyId === waterBody.id && onClearHistoricMap && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistoricErr(null);
                        onClearHistoricMap();
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      Убрать
                    </button>
                  )}
                </div>

                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  Наложите скриншот довоенной карты русла (РККА / Шуберт / Менде) поверх акватории, чтобы видеть старое
                  русло, овраги и броды.
                </p>

                {historicOverlay && historicOverlay.waterBodyId === waterBody.id ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                      <span className="truncate">{historicOverlay.fileName}</span>
                      <span className="font-mono shrink-0 ml-2">{Math.round(historicOpacity * 100)}%</span>
                    </div>
                    {onChangeHistoricOpacity && (
                      <input
                        type="range"
                        aria-label="Прозрачность старой карты"
                        min={10}
                        max={100}
                        step={5}
                        value={Math.round(historicOpacity * 100)}
                        onChange={(e) => onChangeHistoricOpacity(Number(e.target.value) / 100)}
                        className="w-full accent-amber-600"
                      />
                    )}
                  </div>
                ) : (
                  <label className="flex min-h-[38px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-800">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Загрузить изображение карты (PNG / JPG / WebP)</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setHistoricErr(null);
                        const err = await onUploadHistoricMap(file);
                        if (err) setHistoricErr(err);
                      }}
                    />
                  </label>
                )}

                {historicErr && <p className="text-xs font-medium text-rose-700 dark:text-rose-400">{historicErr}</p>}
              </div>
            )}

            {/* External Bathymetry & Historic Map Quick-Links */}
            <div className="rounded-2xl border border-slate-200 p-3.5 space-y-2.5 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Layers className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Внешние карты глубин и русел
                </h3>
                {onToggleOpenSeaMap && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openSeaMapEnabled}
                      disabled={!isOnline}
                      onChange={(e) => onToggleOpenSeaMap(e.target.checked)}
                      className="h-3.5 w-3.5 accent-sky-700"
                    />
                    OpenSeaMap слой
                  </label>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <a
                  href={`https://activecaptain.garmin.com/en-US/Map?lat=${waterBody.center.lat.toFixed(5)}&lon=${waterBody.center.lng.toFixed(5)}&zoom=13`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1 rounded-xl border border-slate-200 px-2.5 py-2 font-semibold text-slate-700 hover:border-sky-500 hover:text-sky-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-sky-500"
                >
                  <span className="truncate">Garmin Quickdraw</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
                <a
                  href={`https://map.openseamap.org/?zoom=13&lat=${waterBody.center.lat.toFixed(5)}&lon=${waterBody.center.lng.toFixed(5)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1 rounded-xl border border-slate-200 px-2.5 py-2 font-semibold text-slate-700 hover:border-sky-500 hover:text-sky-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-sky-500"
                >
                  <span className="truncate">OpenSeaMap</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
                <a
                  href="https://www.genesismaps.com/SocialMap"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1 rounded-xl border border-slate-200 px-2.5 py-2 font-semibold text-slate-700 hover:border-sky-500 hover:text-sky-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-sky-500"
                >
                  <span className="truncate">C-MAP Genesis</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
                <a
                  href={`https://retromap.ru/?z=13&l=${waterBody.center.lat.toFixed(5)},${waterBody.center.lng.toFixed(5)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-between gap-1 rounded-xl border border-slate-200 px-2.5 py-2 font-semibold text-slate-700 hover:border-amber-500 hover:text-amber-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-500"
                >
                  <span className="truncate">RetroMap (русло)</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* Unknown Water Body Recon (FR-4) */}
            <div className="rounded-2xl border border-slate-200 p-3.5 space-y-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Radar className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Разведка водоёма (Sentinel-2 + DEM)
                </h3>
                <button
                  type="button"
                  disabled={reconRunning}
                  onClick={onRunRecon}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3 w-3 ${reconRunning ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {reconRunning ? 'Анализ...' : 'Запустить анализ'}
                </button>
              </div>

              {analysis && (
                <div className="space-y-2 text-xs">
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    Вероятность наличия рыбы:{' '}
                    <span
                      className={
                        analysis.fish_probability === 'high'
                          ? 'text-teal-700 dark:text-teal-400'
                          : analysis.fish_probability === 'medium'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-rose-700 dark:text-rose-400'
                      }
                    >
                      {analysis.fish_probability === 'high'
                        ? 'высокая'
                        : analysis.fish_probability === 'medium'
                          ? 'средняя'
                          : 'низкая'}
                    </span>
                    <span className="ml-2 font-mono text-slate-500">({analysis.score}/100)</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">
                    Причины: {analysis.reasons.map((r) => r.detail).join(', ')}.
                  </p>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {crayfishPresence.shortLabel}
                    <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">
                      ({crayfishPresence.reasons.join(', ')})
                    </span>
                  </div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">{analysis.recommendation}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{analysis.disclaimer}</p>
                </div>
              )}
            </div>
          </>
        )}

        {subTab === 'route' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                  <Compass className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                  Навигация «от дома до лунки»
                </span>
                <button
                  type="button"
                  onClick={() => onBuildRoute(false)}
                  className="text-xs font-semibold text-sky-700 hover:underline dark:text-sky-400"
                >
                  Пересчитать
                </button>
              </div>

              <label className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <span>Избегать грунтовок без покрытия (avoid_unpaved)</span>
                <input
                  type="checkbox"
                  checked={avoidUnpaved}
                  onChange={(e) => onToggleAvoidUnpaved(e.target.checked)}
                  className="h-4 w-4 accent-sky-700"
                />
              </label>
            </div>

            {!isOnline && (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs font-medium text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/40 dark:text-teal-200">
                Офлайн-навигация: маршрут строится локально по сохранённым точкам подъезда и загруженному кэшу карты.
              </div>
            )}

            {routeLoading && (
              <div className="text-xs text-slate-500">Строим составной маршрут (авто + пешком)...</div>
            )}

            {routeResult && (
              <div className="space-y-3">
                {routeResult.quota_warning && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
                    {routeResult.quota_warning}
                  </div>
                )}

                {routeResult.driving_available && routeResult.driving_segment ? (
                  <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                        <Car className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                        На машине до точки подъезда
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                        {(routeResult.driving_segment.distance_m / 1000).toFixed(1)} км, ~
                        {Math.max(1, Math.round(routeResult.driving_segment.duration_s / 60))} мин
                      </span>
                    </div>
                    {routeResult.access_point && (
                      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                        Точка прибытия: {routeResult.access_point.notes}
                      </p>
                    )}
                  </div>
                ) : (
                  <div
                    data-testid="driving-unavailable-msg"
                    className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    {routeResult.unavailable_reason}
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      <Footprints className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      Пешком от парковки до точки ловли
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                      {(routeResult.walking_segment.distance_m / 1000).toFixed(2)} км, ~
                      {Math.max(1, Math.round(routeResult.walking_segment.duration_s / 60))} мин
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                  <a
                    href={routeResult.yandex_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 dark:bg-sky-700"
                  >
                    <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Открыть в Картах
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>

                  <button
                    type="button"
                    onClick={() => onBuildRoute(true)}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 underline"
                  >
                    Проверить fallback квоты
                  </button>
                </div>

                <p className="text-[11px] text-slate-500">
                  {routeResult.source === 'valhalla-osm'
                    ? 'Маршрут построен бесплатно через OpenStreetMap (Valhalla) · навигация без сохранения трека.'
                    : routeResult.source === 'osrm-public'
                      ? 'Маршрут построен бесплатно через OpenStreetMap (OSRM) · навигация без сохранения трека.'
                      : routeResult.source === 'ors-osm'
                        ? 'Маршрут построен через OpenRouteService (OSM) · навигация без сохранения трека.'
                        : routeResult.source === 'yandex-routing'
                          ? '© Яндекс Карты. Маршрутные данные не сохраняются в постоянную базу приложения.'
                          : 'Локальный расчёт маршрута по точкам подъезда (офлайн/резервный режим).'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
