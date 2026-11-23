import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, Filter, Search, WifiOff } from 'lucide-react';
import { FishMap, type HistoricMapOverlay, type MapLayerToggles } from './components/FishMap';
import { TopNav, type AppTab } from './components/TopNav';
import { WaterBodySheet } from './components/WaterBodySheet';
import { WaterBodiesDirectory } from './components/WaterBodiesDirectory';
import { SpeciesReference } from './components/SpeciesReference';
import { DiaryAndProfile } from './components/DiaryAndProfile';
import { QuickMarkModal } from './components/QuickMarkModal';
import { GoodBiteWidget } from './components/GoodBiteWidget';
import { BiteAlertsModal } from './components/BiteAlertsModal';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { useRealtimeReports } from './hooks/useRealtimeReports';
import {
  apiUrl,
  buildFallbackWeather,
  discoverOsmWaterBodiesDirect,
  fetchOpenMeteoWeatherDirect,
} from './lib/apiClient';
import {
  analyzeWaterBody,
  applySpeciesVerificationVote,
  buildBiteForecastMetadata,
  buildSplitRouteMetrics,
  computeFIndexForecast,
  detectProspectiveZones,
  evaluateFIndexAlerts,
  evaluateGoodBiteWaterBodies,
  getWaterBodyImageBounds,
  haversineMeters,
  recommendLures,
  validateCatchReportInput,
  validateDepthPointInput,
  type SonarImportPoint,
} from './lib/fishLogic';
import {
  GPSFilter,
  detectUserLocation,
  getGpsHttpWarning,
  isMobileDeviceContext,
  loadSavedGpsOrigin,
  saveGpsOrigin,
} from './lib/geolocation';
import {
  filterWaterBodiesByRegionAndScale,
  getRegionById,
  isMajorWaterBody,
} from './lib/regions';
import {
  getNotificationPermissionState,
  requestPWANotificationPermission,
  sendPWABiteNotification,
  type PWANotificationPermission,
} from './lib/notifications';
import {
  downloadOfflineMapRegion,
  isPointInBbox,
  removeOfflineRegionTiles,
} from './lib/offlineMapRegions';
import {
  SEED_ACCESS_POINTS,
  SEED_BATHYMETRY_POINTS,
  SEED_DATA_VERSION,
  SEED_KNOTS,
  SEED_REPORTS,
  SEED_SPECIES,
  SEED_WATER_BODIES,
} from './data/seedData';
import type {
  BathymetryPoint,
  BiteAlertEvent,
  BiteAlertLogEntry,
  BiteAlertSettings,
  BiteForecastResponse,
  CatchReport,
  FishAbundance,
  FishSpecies,
  GoodBiteWaterBodyItem,
  KnotGuide,
  LatLng,
  MapBbox,
  NearbyWaterBody,
  OfflineMapRegion,
  ReportOutcome,
  ReportVisibility,
  ReportWeatherVector,
  RouteMultiResult,
  SyncQueueItem,
  UserProfile,
  WaterBody,
  WaterBodyAnalysis,
  WaterBodyType,
  WeatherSnapshot,
} from './lib/types';
import { offlineDb, type KnotsCacheMeta } from './utils/offlineDb';

const DEFAULT_ORIGIN: LatLng = { lat: 55.975, lng: 36.825 };
const DEFAULT_ALERT_SETTINGS: BiteAlertSettings = {
  enabled: true,
  threshold: 75,
  scope: 'favorites_and_nearby',
  nearby_radius_km: 35,
  last_notified: {},
};

export default function App() {
  const { isOnline, manualOffline, setManualOffline } = useOnlineStatus();
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('map');

  // Core data states (instant first-paint from seed data, refreshed from IndexedDB / API)
  const [waterBodies, setWaterBodies] = useState<WaterBody[]>(SEED_WATER_BODIES);
  const [nearbyItems, setNearbyItems] = useState<NearbyWaterBody[]>([]);
  const [selectedWaterBody, setSelectedWaterBody] = useState<WaterBody | null>(SEED_WATER_BODIES[0] ?? null);
  const [speciesList, setSpeciesList] = useState<FishSpecies[]>(SEED_SPECIES);
  const [knotsList, setKnotsList] = useState<KnotGuide[]>(SEED_KNOTS);
  const [knotsCacheMeta, setKnotsCacheMeta] = useState<KnotsCacheMeta | null>(null);
  const [reports, setReports] = useState<CatchReport[]>(SEED_REPORTS);
  const [depthPoints, setDepthPoints] = useState<BathymetryPoint[]>([]);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [forecast, setForecast] = useState<BiteForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [analysis, setAnalysis] = useState<WaterBodyAnalysis | null>(null);
  const [reconRunning, setReconRunning] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteMultiResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);

  // Filters & interactive controls
  const [selectedFishId, setSelectedFishId] = useState('pike');
  const [selectedRegionId, setSelectedRegionId] = useState('all');
  const [majorOnly, setMajorOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState(35);
  const [includeUnnamed, setIncludeUnnamed] = useState(true);
  const [avoidUnpaved, setAvoidUnpaved] = useState(true);
  const [reportSpeciesFilter, setReportSpeciesFilter] = useState('all');
  const [reportSinceFilter, setReportSinceFilter] = useState('all');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    {
      id: string;
      title: string;
      subtitle: string;
      water_body_id: string | null;
      lat?: number;
      lng?: number;
      is_water_body?: boolean;
      water_type?: WaterBodyType;
    }[]
  >([]);
  const [discoveringOsm, setDiscoveringOsm] = useState(false);
  const [mapFocusPoint, setMapFocusPoint] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(null);

  // Map & Modal states
  const [layers, setLayers] = useState<MapLayerToggles>({
    baseStyle: 'scheme',
    contours: true,
    heatmap: true,
    prospective: true,
    openSeaMap: false,
    topoOverlay: false,
    historicOpacity: 0.55,
  });
  const [historicOverlay, setHistoricOverlay] = useState<HistoricMapOverlay | null>(null);
  const [pickDepthMode, setPickDepthMode] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<LatLng | null>(null);
  const [quickMarkOpen, setQuickMarkOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [goodBiteSpeciesId, setGoodBiteSpeciesId] = useState('all');
  const [goodBiteDay, setGoodBiteDay] = useState<'Сегодня' | 'Завтра'>('Сегодня');
  const [goodBiteExpandedDesktop, setGoodBiteExpandedDesktop] = useState(true);
  const [goodBiteMobileOpen, setGoodBiteMobileOpen] = useState(false);
  const [userOrigin, setUserOrigin] = useState<LatLng>(() => loadSavedGpsOrigin() ?? DEFAULT_ORIGIN);
  const [usingRealGps, setUsingRealGps] = useState<boolean>(() => Boolean(loadSavedGpsOrigin()));
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Favorites, PWA Bite Alerts & Offline Map Regions
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [alertSettings, setAlertSettings] = useState<BiteAlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [alertHistory, setAlertHistory] = useState<BiteAlertLogEntry[]>([]);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<PWANotificationPermission>(() =>
    getNotificationPermissionState()
  );
  const [offlineRegions, setOfflineRegions] = useState<OfflineMapRegion[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const alertDispatchLockRef = useRef<Set<string>>(new Set());
  const waterBodiesRef = useRef<WaterBody[]>(waterBodies);
  const mobileGpsBootstrappedRef = useRef(false);

  useEffect(() => {
    waterBodiesRef.current = waterBodies;
  }, [waterBodies]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((prev) => (prev === msg ? null : prev)), 4000);
  }, []);

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // WebSocket realtime handler (idempotent by id & client_event_id)
  const handleIncomingReport = useCallback((incoming: CatchReport) => {
    setReports((prev) => {
      if (prev.some((r) => r.id === incoming.id || r.client_event_id === incoming.client_event_id)) {
        return prev;
      }
      return [incoming, ...prev];
    });
  }, []);

  const handleIncomingDepthPoint = useCallback((pt: BathymetryPoint) => {
    setDepthPoints((prev) => {
      if (prev.some((p) => p.id === pt.id)) return prev;
      return [...prev, pt];
    });
  }, []);

  const { wsConnected } = useRealtimeReports({
    isOnline,
    onNewReport: handleIncomingReport,
    onNewDepthPoint: handleIncomingDepthPoint,
  });

  // Hydrate persistent favorites, alert settings, alert history, and offline regions
  useEffect(() => {
    let active = true;
    async function loadPreferences() {
      const [favs, savedAlerts, savedHistory, savedRegions] = await Promise.all([
        offlineDb.getFavoriteIds(),
        offlineDb.getAlertSettings(),
        offlineDb.getAlertHistory(),
        offlineDb.getOfflineRegions(),
      ]);
      if (!active) return;
      setFavoriteIds(favs);
      if (savedAlerts) setAlertSettings(savedAlerts);
      setAlertHistory(savedHistory);
      setOfflineRegions(savedRegions);
      setNotificationPermission(getNotificationPermissionState());
      setPrefsLoaded(true);
    }
    void loadPreferences();
    return () => {
      active = false;
    };
  }, []);

  // Initial bootstrap (network-first with IndexedDB & seed offline fallback)
  useEffect(() => {
    let active = true;
    async function bootstrap() {
      const storedSeedVersion = await offlineDb.getSeedVersion();
      if (storedSeedVersion !== SEED_DATA_VERSION) {
        await offlineDb.clearStaleSeedCaches();
        await offlineDb.setSeedVersion(SEED_DATA_VERSION);
      }

      const existingQueue = await offlineDb.getQueue();
      if (active) setSyncQueue(existingQueue);

      if (!isOnline) {
        const [cachedWbs, cachedRef, cachedKnots, cachedKnotsMeta, cachedReports, cachedWeather, lastWb] = await Promise.all([
          offlineDb.getWaterBodies(),
          offlineDb.getSpeciesAndKnots(),
          offlineDb.getKnotsCache(),
          offlineDb.getKnotsCacheMeta(),
          offlineDb.getReportsCache(),
          offlineDb.getWeather(),
          offlineDb.getLastOpenedWaterBody(),
        ]);
        if (!active) return;
        const wbs = cachedWbs.length > 0 ? cachedWbs : SEED_WATER_BODIES;
        const sp = cachedRef.species.length > 0 ? cachedRef.species : SEED_SPECIES;
        const kn = cachedKnots.length > 0 ? cachedKnots : cachedRef.knots.length > 0 ? cachedRef.knots : SEED_KNOTS;
        const reps = cachedReports.length > 0 ? cachedReports : SEED_REPORTS;
        setWaterBodies(wbs);
        setSpeciesList(sp);
        setKnotsList(kn);
        setReports(reps);
        setWeather(cachedWeather);
        if (cachedKnotsMeta) {
          setKnotsCacheMeta(cachedKnotsMeta);
        } else {
          const savedMeta = await offlineDb.saveKnotsCache(kn);
          if (active) setKnotsCacheMeta(savedMeta);
        }
        if (lastWb) {
          setSelectedWaterBody(lastWb.water_body);
          setDepthPoints(lastWb.depth_points);
          setAnalysis(lastWb.analysis);
          if (lastWb.forecast) setForecast(lastWb.forecast);
        } else if (wbs.length > 0) {
          setSelectedWaterBody((prev) => prev ?? wbs[0]);
        }
        return;
      }

      try {
        const [wbRes, spRes, knotsRes, repRes, weatherRes, meRes] = await Promise.all([
          fetch(apiUrl('/api/v1/water-bodies?include_unnamed=true')),
          fetch(apiUrl('/api/v1/species')),
          fetch(apiUrl('/api/v1/knots')),
          fetch(apiUrl('/api/v1/reports')),
          fetch(apiUrl(`/api/v1/weather?lat=${DEFAULT_ORIGIN.lat}&lng=${DEFAULT_ORIGIN.lng}`)),
          fetch(apiUrl('/api/v1/auth/me')),
        ]);

        const [wbJson, spJson, knotsJson, repJson, weatherJson, meJson] = await Promise.all([
          wbRes.json(),
          spRes.json(),
          knotsRes.ok ? knotsRes.json() : Promise.resolve({ items: null }),
          repRes.json(),
          weatherRes.json(),
          meRes.json(),
        ]);

        if (!active) return;
        const wbs: WaterBody[] = wbJson.items ?? [];
        const sp: FishSpecies[] = spJson.species ?? [];
        const kn: KnotGuide[] =
          Array.isArray(knotsJson.items) && knotsJson.items.length > 0
            ? knotsJson.items
            : spJson.knots ?? [];
        const reps: CatchReport[] = repJson.items ?? [];

        setWaterBodies(wbs);
        setSpeciesList(sp);
        setKnotsList(kn);
        setReports(reps);
        setWeather(weatherJson.weather ?? null);
        setUser(meJson.user ?? null);

        if (wbs.length > 0) {
          setSelectedWaterBody((prev) =>
            prev ? wbs.find((w) => w.id === prev.id) ?? wbs[0] : wbs[0]
          );
        }

        const [, knotsMeta] = await Promise.all([
          offlineDb.saveWaterBodies(wbs),
          offlineDb.saveSpeciesAndKnots(sp, kn),
          offlineDb.saveReportsCache(reps),
          weatherJson.weather ? offlineDb.saveWeather(weatherJson.weather) : Promise.resolve(),
        ]);
        if (active) setKnotsCacheMeta(knotsMeta);
      } catch {
        // Standalone Capacitor APK or unreachable server: use IndexedDB cache or embedded seed catalog
        const [cachedWbs, cachedRef, cachedKnots, cachedReports, cachedWeather] = await Promise.all([
          offlineDb.getWaterBodies(),
          offlineDb.getSpeciesAndKnots(),
          offlineDb.getKnotsCache(),
          offlineDb.getReportsCache(),
          offlineDb.getWeather(),
        ]);
        const wbs = cachedWbs.length > 0 ? cachedWbs : SEED_WATER_BODIES;
        const sp = cachedRef.species.length > 0 ? cachedRef.species : SEED_SPECIES;
        const kn = cachedKnots.length > 0 ? cachedKnots : cachedRef.knots.length > 0 ? cachedRef.knots : SEED_KNOTS;
        const reps = cachedReports.length > 0 ? cachedReports : SEED_REPORTS;
        const wx = cachedWeather ?? (await fetchOpenMeteoWeatherDirect(DEFAULT_ORIGIN.lat, DEFAULT_ORIGIN.lng));

        if (!active) return;
        setWaterBodies(wbs);
        setSpeciesList(sp);
        setKnotsList(kn);
        setReports(reps);
        setWeather(wx);
        setSelectedWaterBody((prev) => prev ?? wbs[0] ?? null);

        const [, knotsMeta] = await Promise.all([
          offlineDb.saveWaterBodies(wbs),
          offlineDb.saveSpeciesAndKnots(sp, kn),
          offlineDb.saveReportsCache(reps),
          offlineDb.saveWeather(wx),
        ]);
        if (active) setKnotsCacheMeta(knotsMeta);
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, [isOnline]);

  const handleRefreshKnotsCache = useCallback(async () => {
    if (!isOnline) {
      const cached = await offlineDb.getKnotsCache();
      if (cached.length > 0) setKnotsList(cached);
      const meta = await offlineDb.getKnotsCacheMeta();
      if (meta) setKnotsCacheMeta(meta);
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/v1/knots'));
      if (res.ok) {
        const json = (await res.json()) as { items?: KnotGuide[] };
        const items = Array.isArray(json.items) && json.items.length > 0 ? json.items : knotsList;
        setKnotsList(items);
        const meta = await offlineDb.saveKnotsCache(items);
        setKnotsCacheMeta(meta);
        showToast(`Справочник узлов (${meta.count}) обновлён и сохранён в IndexedDB для офлайн-режима.`);
        return;
      }
    } catch {
      // Fallback to caching current list
    }
    const meta = await offlineDb.saveKnotsCache(knotsList);
    setKnotsCacheMeta(meta);
    showToast(`Справочник узлов (${meta.count}) сохранён в IndexedDB.`);
  }, [isOnline, knotsList, showToast]);

  // Fetch nearby list when radius, origin, region, majorOnly or includeUnnamed changes (with standalone fallback)
  useEffect(() => {
    const computeLocalNearby = () => {
      const regionActive = selectedRegionId !== 'all' && Boolean(getRegionById(selectedRegionId));
      const base = filterWaterBodiesByRegionAndScale(waterBodies, {
        regionId: selectedRegionId,
        majorOnly,
      });
      const filtered = base
        .filter((wb) => (includeUnnamed ? true : wb.name !== null && wb.name.trim().length > 0))
        .map((wb) => {
          const straight_distance_m = Math.round(haversineMeters(userOrigin, wb.center));
          const accessPoints = SEED_ACCESS_POINTS.filter((ap) => ap.water_body_id === wb.id);
          const route = buildSplitRouteMetrics({
            origin: userOrigin,
            waterBody: wb,
            accessPoints,
            avoidUnpaved,
          });
          return {
            water_body: wb,
            straight_distance_m,
            driving_distance_m: route.driving_segment?.distance_m ?? null,
            driving_duration_s: route.driving_segment?.duration_s ?? null,
            walking_distance_m: route.walking_segment.distance_m,
            walking_duration_s: route.walking_segment.duration_s,
            driving_available: route.driving_available,
          } satisfies NearbyWaterBody;
        })
        .filter((item) => regionActive || item.straight_distance_m <= radiusKm * 1000)
        .sort((a, b) => a.straight_distance_m - b.straight_distance_m);
      setNearbyItems(filtered);
    };

    if (!isOnline) {
      computeLocalNearby();
      return;
    }

    const qs = new URLSearchParams({
      lat: String(userOrigin.lat),
      lng: String(userOrigin.lng),
      radius: String(radiusKm),
      include_unnamed: String(includeUnnamed),
      region_id: selectedRegionId,
      major_only: String(majorOnly),
    });

    fetch(apiUrl(`/api/v1/water-bodies/nearby?${qs.toString()}`))
      .then((r) => r.json())
      .then((json: { items?: NearbyWaterBody[] }) => {
        if (json.items) {
          setNearbyItems(json.items);
        } else {
          computeLocalNearby();
        }
      })
      .catch(() => {
        computeLocalNearby();
      });
  }, [
    isOnline,
    radiusKm,
    includeUnnamed,
    selectedRegionId,
    majorOnly,
    waterBodies,
    userOrigin.lat,
    userOrigin.lng,
    avoidUnpaved,
  ]);

  // Fetch filtered reports
  useEffect(() => {
    if (!isOnline) return;
    const params = new URLSearchParams();
    if (reportSpeciesFilter !== 'all') params.set('species', reportSpeciesFilter);
    if (reportSinceFilter !== 'all') params.set('since', reportSinceFilter);
    if (verifiedOnly) params.set('verified_only', 'true');

    fetch(`/api/v1/reports?${params.toString()}`)
      .then((r) => r.json())
      .then((json: { items?: CatchReport[] }) => {
        if (json.items) {
          setReports(json.items);
          void offlineDb.saveReportsCache(json.items);
        }
      })
      .catch(() => {});
  }, [isOnline, reportSpeciesFilter, reportSinceFilter, verifiedOnly]);

  // Load selected water body details (bathymetry, analysis, forecast, weather)
  useEffect(() => {
    if (!selectedWaterBody) return;
    let active = true;
    const wb = selectedWaterBody;
    setPickedCoords(null);
    setRouteResult(null);

    async function loadDetails() {
      if (!isOnline) {
        const cached = await offlineDb.getLastOpenedWaterBody(wb.id);
        if (active && cached) {
          setDepthPoints(cached.depth_points);
          setAnalysis(cached.analysis);
          if (cached.forecast) setForecast(cached.forecast);
        }
        return;
      }

      try {
        setForecastLoading(true);
        const [detailRes, forecastRes, weatherRes] = await Promise.all([
          fetch(apiUrl(`/api/v1/water-bodies/${wb.id}`)),
          fetch(
            apiUrl(
              `/api/v1/forecast?lat=${wb.center.lat}&lng=${wb.center.lng}&fish_id=${selectedFishId}&water_body_id=${encodeURIComponent(wb.id)}`
            )
          ),
          fetch(apiUrl(`/api/v1/weather?lat=${wb.center.lat}&lng=${wb.center.lng}`)),
        ]);
        const [detailJson, forecastJson, weatherJson] = await Promise.all([
          detailRes.json(),
          forecastRes.json(),
          weatherRes.json(),
        ]);
        if (!active) return;
        const pts: BathymetryPoint[] = detailJson.depth_points ?? [];
        const an: WaterBodyAnalysis =
          detailJson.analysis ?? analyzeWaterBody({ waterBody: wb, crowdReportCount: 0 });
        setDepthPoints(pts);
        setAnalysis(an);
        setForecast(forecastJson);
        if (weatherJson.weather) setWeather(weatherJson.weather);

        await offlineDb.saveLastOpenedWaterBody({
          water_body: wb,
          access_points: detailJson.access_points ?? [],
          depth_points: pts,
          analysis: an,
          forecast: forecastJson,
          cached_at: new Date().toISOString(),
        });
      } catch {
        // Standalone Capacitor APK fallback: compute local bathymetry, analysis, weather and F-Index
        const pts = SEED_BATHYMETRY_POINTS.filter((p) => p.water_body_id === wb.id);
        const an = analyzeWaterBody({
          waterBody: wb,
          crowdReportCount: reports.filter((r) => r.water_body_id === wb.id && r.outcome !== 'no_bite').length,
        });
        const wx =
          (await fetchOpenMeteoWeatherDirect(wb.center.lat, wb.center.lng)) ??
          buildFallbackWeather(wb.center.lat, wb.center.lng);
        const sp = speciesList.find((s) => s.id === selectedFishId) ?? SEED_SPECIES[0];
        const nowDate = new Date();
        const slots = computeFIndexForecast({
          species: sp,
          weather: wx,
          baseDate: nowDate,
          waterBody: wb,
          reports,
        });
        const meta = buildBiteForecastMetadata({
          weather: wx,
          species: sp,
          waterBody: wb,
          reports,
          baseDate: nowDate,
        });
        const fc: BiteForecastResponse = {
          lat: wb.center.lat,
          lng: wb.center.lng,
          fish_id: sp.id,
          fish_name: sp.name,
          water_body_id: wb.id,
          source: 'open-meteo-fallback',
          cached: false,
          disclaimer:
            'Автономный вероятностный расчёт F-Индекса по почасовым данным Open-Meteo, параметрам водоёма и локальным отчётам.',
          slots,
          ...meta,
        };
        if (!active) return;
        setDepthPoints(pts);
        setAnalysis(an);
        setWeather(wx);
        setForecast(fc);
        await offlineDb.saveLastOpenedWaterBody({
          water_body: wb,
          access_points: SEED_ACCESS_POINTS.filter((ap) => ap.water_body_id === wb.id),
          depth_points: pts,
          analysis: an,
          forecast: fc,
          cached_at: new Date().toISOString(),
        });
      } finally {
        if (active) setForecastLoading(false);
      }
    }

    void loadDetails();
    return () => {
      active = false;
    };
  }, [selectedWaterBody?.id, selectedFishId, isOnline, reports.length]);

  // Auto-flush IndexedDB sync_queue when connectivity returns
  const flushSyncQueue = useCallback(async () => {
    if (!isOnline) return;
    const items = await offlineDb.getQueue();
    if (items.length === 0) return;

    for (const item of items) {
      try {
        if (item.entity_type === 'report_create') {
          const res = await fetch('/api/v1/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
          if (res.ok) {
            const json = (await res.json()) as { report: CatchReport };
            handleIncomingReport(json.report);
            await offlineDb.removeQueueItem(item.local_id);
          }
        }
      } catch {
        await offlineDb.updateQueueItem({ ...item, retry_count: item.retry_count + 1 });
      }
    }

    const remaining = await offlineDb.getQueue();
    setSyncQueue(remaining);
    if (remaining.length === 0) {
      showToast('Офлайн-записи успешно синхронизированы с сервером.');
    }
  }, [isOnline, handleIncomingReport, showToast]);

  useEffect(() => {
    if (isOnline) {
      void flushSyncQueue();
    }
  }, [isOnline, flushSyncQueue]);

  // Derived prospective zones & lure recommendations
  const prospectiveZones = useMemo(() => detectProspectiveZones(depthPoints), [depthPoints]);

  const activeSpecies = useMemo(
    () => speciesList.find((s) => s.id === selectedFishId) ?? speciesList[0],
    [speciesList, selectedFishId]
  );

  const recommendations = useMemo(() => {
    if (!activeSpecies) return [];
    return recommendLures({
      species: activeSpecies,
      waterBody: selectedWaterBody,
      month: new Date().getMonth() + 1,
      isIceRegime: forecast?.regime === 'ice',
    });
  }, [activeSpecies, selectedWaterBody, forecast?.regime]);

  // Fallback weather snapshot when offline before first fetch
  const effectiveWeather = useMemo<WeatherSnapshot>(
    () =>
      weather ?? {
        lat: DEFAULT_ORIGIN.lat,
        lng: DEFAULT_ORIGIN.lng,
        captured_at: new Date().toISOString(),
        pressure_hpa: 1015,
        pressure_mmhg: 761,
        pressure_trend: 'steady',
        air_temp_c: 4.5,
        water_temp_c: 5.8,
        wind_speed_ms: 3.8,
        wind_direction_deg: 235,
        wind_direction_label: 'ЮЗ',
        precipitation_mm: 0,
        moon_phase: 'Растущая луна',
        moon_illumination: 50,
        source: 'offline-fallback',
      },
    [weather]
  );

  const visibleWaterBodies = useMemo(() => {
    const filtered = filterWaterBodiesByRegionAndScale(waterBodies, {
      regionId: selectedRegionId,
      majorOnly,
    });
    if (selectedWaterBody && !filtered.some((w) => w.id === selectedWaterBody.id)) {
      return [...filtered, selectedWaterBody];
    }
    return filtered;
  }, [waterBodies, selectedRegionId, majorOnly, selectedWaterBody]);

  const totalIn100Km = useMemo(() => {
    const filtered = filterWaterBodiesByRegionAndScale(waterBodies, {
      regionId: selectedRegionId,
      majorOnly,
    });
    if (selectedRegionId !== 'all') return filtered.length;
    return filtered.filter((wb) => haversineMeters(userOrigin, wb.center) <= 100 * 1000).length;
  }, [waterBodies, userOrigin, selectedRegionId, majorOnly]);

  const goodBiteItems = useMemo(
    () =>
      evaluateGoodBiteWaterBodies({
        origin: userOrigin,
        waterBodies,
        speciesList,
        weather: effectiveWeather,
        reports,
        baseDate: new Date(),
        radiusKm: 100,
        fishId: goodBiteSpeciesId,
        dayLabel: goodBiteDay,
        minFIndex: 66,
        regionId: selectedRegionId,
        majorOnly,
      }),
    [
      userOrigin,
      waterBodies,
      speciesList,
      effectiveWeather,
      reports,
      goodBiteSpeciesId,
      goodBiteDay,
      selectedRegionId,
      majorOnly,
    ]
  );

  const allScoredForAlerts = useMemo(
    () =>
      evaluateGoodBiteWaterBodies({
        origin: userOrigin,
        waterBodies,
        speciesList,
        weather: effectiveWeather,
        reports,
        baseDate: new Date(),
        radiusKm: 1000,
        fishId: 'all',
        dayLabel: 'Сегодня',
        minFIndex: 0,
      }),
    [userOrigin, waterBodies, speciesList, effectiveWeather, reports]
  );

  const goodBiteById = useMemo(() => {
    const map: Record<string, GoodBiteWaterBodyItem> = {};
    for (const item of allScoredForAlerts) {
      if (item.distance_km <= 100) {
        map[item.water_body.id] = item;
      }
    }
    return map;
  }, [allScoredForAlerts]);

  const dispatchBiteAlerts = useCallback(
    async (events: BiteAlertEvent[], announceToast = true) => {
      if (events.length === 0) return;
      const nowIso = new Date().toISOString();
      const newLogs: BiteAlertLogEntry[] = [];
      const updatedNotified: Record<string, { f_index: number; notified_at: string }> = {};

      for (const ev of events) {
        updatedNotified[ev.water_body_id] = { f_index: ev.f_index, notified_at: nowIso };
      }

      for (const ev of events.slice(0, 2)) {
        const via = await sendPWABiteNotification({
          title: ev.title,
          body: ev.body,
          tag: `fishcast-bite-${ev.water_body_id}`,
          waterBodyId: ev.water_body_id,
        });
        newLogs.push({
          id: `alert-${Date.now()}-${ev.water_body_id}`,
          water_body_id: ev.water_body_id,
          water_body_name: ev.water_body_name,
          f_index: ev.f_index,
          species_name: ev.best_species_name,
          peak_hour: ev.peak_hour,
          is_favorite: ev.is_favorite,
          delivered_via: via,
          created_at: nowIso,
        });
      }

      setAlertSettings((prev) => {
        const next: BiteAlertSettings = {
          ...prev,
          last_notified: { ...prev.last_notified, ...updatedNotified },
        };
        void offlineDb.saveAlertSettings(next);
        return next;
      });

      setAlertHistory((prev) => {
        const next = [...newLogs, ...prev].slice(0, 30);
        void offlineDb.saveAlertHistory(next);
        return next;
      });

      if (announceToast && newLogs[0]) {
        showToast(`${newLogs[0].water_body_name}: прогноз вырос до F-${newLogs[0].f_index} (${newLogs[0].species_name})`);
      }
    },
    [showToast]
  );

  // Automatic F-Index threshold trigger for favorites & nearby water bodies
  useEffect(() => {
    if (!prefsLoaded || !alertSettings.enabled || allScoredForAlerts.length === 0) return;
    const triggered = evaluateFIndexAlerts({
      items: allScoredForAlerts,
      favoriteIds,
      settings: alertSettings,
    }).filter((ev) => !alertDispatchLockRef.current.has(`${ev.water_body_id}:${ev.f_index}`));

    if (triggered.length === 0) return;
    for (const ev of triggered.slice(0, 2)) {
      alertDispatchLockRef.current.add(`${ev.water_body_id}:${ev.f_index}`);
    }
    void dispatchBiteAlerts(triggered, false);
  }, [prefsLoaded, alertSettings, favoriteIds, allScoredForAlerts, dispatchBiteAlerts]);

  const handleToggleFavorite = useCallback(
    (waterBodyId: string) => {
      setFavoriteIds((prev) => {
        const exists = prev.includes(waterBodyId);
        const next = exists ? prev.filter((id) => id !== waterBodyId) : [...prev, waterBodyId];
        void offlineDb.saveFavoriteIds(next);
        showToast(
          exists
            ? 'Водоём удалён из избранного.'
            : 'Водоём добавлен в избранное — уведомления F-Индекса включены.'
        );
        return next;
      });
    },
    [showToast]
  );

  const handleUpdateAlertSettings = useCallback((next: BiteAlertSettings) => {
    setAlertSettings(next);
    void offlineDb.saveAlertSettings(next);
  }, []);

  const handleRequestNotificationPermission = useCallback(async () => {
    const nextPerm = await requestPWANotificationPermission();
    setNotificationPermission(nextPerm);
    if (nextPerm === 'granted') {
      showToast('Push-уведомления браузера (PWA) активированы.');
    } else if (nextPerm === 'denied') {
      showToast('Доступ к push отклонён — оповещения будут отображаться в журнале.');
    }
  }, [showToast]);

  const handleCheckAlertsNow = useCallback(async () => {
    const events = evaluateFIndexAlerts({
      items: allScoredForAlerts,
      favoriteIds,
      settings: alertSettings,
      force: true,
    });
    if (events.length === 0) {
      showToast(`Нет водоёмов с прогнозом F ≥ ${alertSettings.threshold} по выбранному фильтру.`);
      return;
    }
    await dispatchBiteAlerts(events.slice(0, 1), true);
  }, [allScoredForAlerts, favoriteIds, alertSettings, dispatchBiteAlerts, showToast]);

  const handleDownloadOfflineRegion = useCallback(
    async (params: {
      id: string;
      name: string;
      bbox: MapBbox;
      minZoom: number;
      maxZoom: number;
      signal: AbortSignal;
      onProgress: (done: number, total: number) => void;
    }) => {
      const region = await downloadOfflineMapRegion({
        ...params,
        waterBodies,
      });

      // Cache water bodies inside this region (access points, bathymetry, analysis & forecast) for full offline navigation
      const covered = waterBodies.filter((wb) => isPointInBbox(wb.center, params.bbox));
      const sp = speciesList.find((s) => s.id === selectedFishId) ?? speciesList[0] ?? SEED_SPECIES[0];
      await Promise.all(
        covered.map(async (wb) => {
          const pts = SEED_BATHYMETRY_POINTS.filter((p) => p.water_body_id === wb.id);
          const aps = SEED_ACCESS_POINTS.filter((ap) => ap.water_body_id === wb.id);
          const an = analyzeWaterBody({
            waterBody: wb,
            crowdReportCount: reports.filter((r) => r.water_body_id === wb.id).length,
          });
          const fc: BiteForecastResponse = {
            lat: wb.center.lat,
            lng: wb.center.lng,
            fish_id: sp.id,
            fish_name: sp.name,
            source: 'open-meteo-fallback',
            cached: true,
            disclaimer: 'Автономный вероятностный расчёт F-Индекса по сохранённому региону.',
            slots: computeFIndexForecast({ species: sp, weather: effectiveWeather, baseDate: new Date() }),
          };
          await offlineDb.saveLastOpenedWaterBody({
            water_body: wb,
            access_points: aps,
            depth_points: pts,
            analysis: an,
            forecast: fc,
            cached_at: region.downloaded_at,
          });
        })
      );

      setOfflineRegions((prev) => {
        const next = [region, ...prev.filter((r) => r.id !== region.id)];
        void offlineDb.saveOfflineRegions(next);
        return next;
      });
      showToast(
        `Область «${region.name}» сохранена в IndexedDB (${region.cached_tiles} плиток, ${region.water_body_ids.length} водоёмов).`
      );
    },
    [waterBodies, speciesList, selectedFishId, reports, effectiveWeather, showToast]
  );

  const handleDeleteOfflineRegion = useCallback(
    async (region: OfflineMapRegion) => {
      const remaining = offlineRegions.filter((r) => r.id !== region.id);
      setOfflineRegions(remaining);
      await offlineDb.saveOfflineRegions(remaining);
      await removeOfflineRegionTiles(region, remaining);
      showToast(`Офлайн-область «${region.name}» удалена из IndexedDB.`);
    },
    [offlineRegions, showToast]
  );

  // Handlers
  const handleSelectWaterBody = (wb: WaterBody) => {
    setSelectedWaterBody(wb);
    setActiveTab('map');
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileSheetOpen(true);
    }
  };

  const handleSearchChange = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    if (!isOnline) {
      const local = waterBodies
        .filter((w) => w.display_label.toLowerCase().includes(text.trim().toLowerCase()))
        .slice(0, 6)
        .map((w) => ({
          id: w.id,
          title: w.display_label,
          subtitle: `${w.region} · ${w.area_ha} га`,
          water_body_id: w.id,
        }));
      setSearchResults(local);
      return;
    }
    try {
      const qs = new URLSearchParams({
        text,
        kind: 'hydro',
        region_id: selectedRegionId,
        major_only: String(majorOnly),
      });
      const res = await fetch(apiUrl(`/api/v1/geocode/search?${qs.toString()}`));
      const json = (await res.json()) as { items?: typeof searchResults };
      setSearchResults(json.items ?? []);
    } catch {
      setSearchResults([]);
    }
  };

  const handleRunRecon = async () => {
    if (!selectedWaterBody || !isOnline) {
      showToast('Для запуска спутниковой разведки требуется подключение к сети.');
      return;
    }
    setReconRunning(true);
    try {
      const res = await fetch(`/api/v1/water-bodies/${selectedWaterBody.id}/analyze`, {
        method: 'POST',
      });
      const json = (await res.json()) as { job_id?: string };
      if (!json.job_id) return;

      // Poll async job until completed
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const jobRes = await fetch(`/api/v1/jobs/${json.job_id}`);
        const jobJson = (await jobRes.json()) as {
          status: string;
          result?: WaterBodyAnalysis;
        };
        if (jobJson.status === 'completed' && jobJson.result) {
          setAnalysis(jobJson.result);
          showToast('Разведка водоёма завершена.');
          break;
        }
      }
    } finally {
      setReconRunning(false);
    }
  };

  const handleAddDepthPoint = async (payload: {
    lat: number;
    lng: number;
    depth_m: number;
    source: 'manual' | 'sonar';
  }): Promise<string | null> => {
    if (!selectedWaterBody) return 'Сначала выберите водоём.';
    const err = validateDepthPointInput(payload);
    if (err) return err;

    try {
      const res = await fetch(`/api/v1/water-bodies/${selectedWaterBody.id}/depth-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { point?: BathymetryPoint; water_body?: WaterBody; error?: string };
      if (!res.ok) return json.error ?? 'Не удалось сохранить глубину.';
      if (json.point) {
        handleIncomingDepthPoint(json.point);
      }
      if (json.water_body) {
        const updatedWb = json.water_body;
        setSelectedWaterBody((prev) => (prev?.id === updatedWb.id ? { ...prev, ...updatedWb } : prev));
        setWaterBodies((prev) => prev.map((w) => (w.id === updatedWb.id ? { ...w, ...updatedWb } : w)));
      }
      setPickDepthMode(false);
      return null;
    } catch {
      return 'Ошибка сети при сохранении точки глубины.';
    }
  };

  const handleImportDepthPoints = async (
    points: SonarImportPoint[]
  ): Promise<{ importedCount: number; error?: string }> => {
    if (!selectedWaterBody) return { importedCount: 0, error: 'Сначала выберите водоём.' };
    if (points.length === 0) return { importedCount: 0, error: 'Нет точек для импорта.' };

    const applyLocalFallback = () => {
      const nowIso = new Date().toISOString();
      const localPts: BathymetryPoint[] = points.map((p, idx) => ({
        id: `bp-local-${Date.now()}-${idx}`,
        water_body_id: selectedWaterBody.id,
        lat: p.lat,
        lng: p.lng,
        depth_m: Number(p.depth_m.toFixed(1)),
        source: 'sonar',
        user_id: user?.id ?? 'guest',
        created_at: nowIso,
        confidence: 0.78,
      }));
      setDepthPoints((prev) => {
        const next = [...prev, ...localPts];
        const maxD = Number(Math.max(...next.map((x) => x.depth_m)).toFixed(1));
        const avgD = Number((next.reduce((acc, x) => acc + x.depth_m, 0) / next.length).toFixed(1));
        setSelectedWaterBody((wb) =>
          wb && wb.id === selectedWaterBody.id
            ? { ...wb, has_bathymetry: true, max_depth_m: maxD, avg_depth_m: avgD }
            : wb
        );
        return next;
      });
      setLayers((prev) => ({ ...prev, contours: true }));
      showToast(`Локально импортировано ${localPts.length} промеров эхолота — изобаты обновлены.`);
      return { importedCount: localPts.length };
    };

    if (!isOnline) {
      return applyLocalFallback();
    }

    try {
      const res = await fetch(apiUrl(`/api/v1/water-bodies/${selectedWaterBody.id}/depth-points/import`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points, source: 'sonar' }),
      });
      const json = (await res.json()) as {
        imported_count?: number;
        points?: BathymetryPoint[];
        water_body?: WaterBody;
        error?: string;
      };
      if (!res.ok) {
        return { importedCount: 0, error: json.error ?? 'Не удалось импортировать промеры.' };
      }
      if (json.points && json.points.length > 0) {
        setDepthPoints((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const added = json.points!.filter((p) => !existingIds.has(p.id));
          return [...prev, ...added];
        });
      }
      if (json.water_body) {
        const updatedWb = json.water_body;
        setSelectedWaterBody((prev) => (prev?.id === updatedWb.id ? { ...prev, ...updatedWb } : prev));
        setWaterBodies((prev) => prev.map((w) => (w.id === updatedWb.id ? { ...w, ...updatedWb } : w)));
      }
      setLayers((prev) => ({ ...prev, contours: true }));
      const count = json.imported_count ?? json.points?.length ?? points.length;
      showToast(`Импортировано ${count} промеров эхолота — изобаты построены автоматически.`);
      return { importedCount: count };
    } catch {
      return applyLocalFallback();
    }
  };

  const handleUploadHistoricMap = async (file: File): Promise<string | null> => {
    if (!selectedWaterBody) return 'Сначала выберите водоём.';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return 'Допустимые форматы: PNG, JPG, WebP.';
    }
    if (file.size > 5 * 1024 * 1024) {
      return 'Размер изображения превышает лимит 5 МБ.';
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result.startsWith('data:image/')) {
          resolve('Не удалось прочитать изображение карты.');
          return;
        }
        setHistoricOverlay({
          waterBodyId: selectedWaterBody.id,
          fileName: file.name.slice(0, 60),
          imageUrl: result,
          bounds: getWaterBodyImageBounds(selectedWaterBody),
        });
        showToast(`Подложка «${file.name}» наложена на акваторию «${selectedWaterBody.display_label}».`);
        resolve(null);
      };
      reader.onerror = () => resolve('Ошибка чтения файла изображения.');
      reader.readAsDataURL(file);
    });
  };

  const handleBuildRoute = async (simulateQuota = false) => {
    if (!selectedWaterBody) return;
    setRouteLoading(true);
    try {
      if (isOnline) {
        const res = await fetch(apiUrl('/api/v1/route-multi'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: userOrigin,
            water_body_id: selectedWaterBody.id,
            avoid_unpaved: avoidUnpaved,
            simulate_quota_exceeded: simulateQuota,
          }),
        });
        const json = (await res.json()) as { route?: RouteMultiResult };
        if (json.route) {
          setRouteResult(json.route);
          return;
        }
      }
    } catch {
      // Standalone APK or unreachable backend fallback
    } finally {
      setRouteLoading(false);
    }

    const cachedBundle = await offlineDb.getLastOpenedWaterBody(selectedWaterBody.id);
    const accessPoints =
      cachedBundle && cachedBundle.access_points.length > 0
        ? cachedBundle.access_points
        : SEED_ACCESS_POINTS.filter((ap) => ap.water_body_id === selectedWaterBody.id);
    setRouteResult(
      buildSplitRouteMetrics({
        origin: userOrigin,
        waterBody: selectedWaterBody,
        accessPoints,
        avoidUnpaved,
        quotaExceeded: simulateQuota,
      })
    );
  };

  // Recompute route when avoidUnpaved toggles while route already open
  useEffect(() => {
    if (routeResult && selectedWaterBody) {
      void handleBuildRoute(false);
    }
  }, [avoidUnpaved]);

  const submitReportOrQueue = async (payload: {
    lat: number | null;
    lng: number | null;
    fish_species_id: string;
    water_body_id: string | null;
    outcome?: ReportOutcome;
    weight_kg?: number | null;
    length_cm?: number | null;
    depth_m?: number | null;
    gps_accuracy_m?: number | null;
    bait: string;
    retrieve?: string;
    notes: string;
    visibility: ReportVisibility;
    photo_url: string | null;
    photo_size_bytes?: number;
    photo_mime?: string;
    source: 'quick_mark' | 'diary';
  }): Promise<string | null> => {
    const err = validateCatchReportInput(payload);
    if (err) return err;

    const clientEventId = crypto.randomUUID();
    const species = speciesList.find((s) => s.id === payload.fish_species_id) ?? speciesList[0];
    const wb = payload.water_body_id
      ? waterBodies.find((w) => w.id === payload.water_body_id) ?? null
      : null;
    const outcome: ReportOutcome = payload.outcome === 'no_bite' ? 'no_bite' : 'catch';

    const weatherVector: ReportWeatherVector | undefined = weather
      ? {
          pressure_hpa: weather.pressure_hpa,
          pressure_trend: weather.pressure_trend,
          pressure_delta_6h: weather.pressure_delta_6h,
          water_temp_c: forecast?.estimated_water_temp_c ?? weather.water_temp_c,
          air_temp_c: weather.air_temp_c,
          wind_speed_ms: weather.wind_speed_ms,
          wind_direction_label: weather.wind_direction_label,
          cloud_cover_pct: weather.cloud_cover_pct,
          precipitation_mm: weather.precipitation_mm,
          hour_local: new Date().getHours(),
        }
      : undefined;

    const nowDate = new Date();
    const currentBlockHour = Math.floor(nowDate.getHours() / 3) * 3;
    const currentHourLabel = `${currentBlockHour.toString().padStart(2, '0')}:00`;
    let predictedFIndex: number | null = null;
    if (
      forecast &&
      forecast.fish_id === (species?.id ?? payload.fish_species_id) &&
      (forecast.water_body_id ?? null) === (wb?.id ?? null)
    ) {
      const slot =
        forecast.slots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === currentHourLabel) ??
        forecast.slots[0];
      predictedFIndex = slot ? slot.f_index : null;
    } else if (species) {
      const computedSlots = computeFIndexForecast({
        species,
        weather: effectiveWeather,
        baseDate: nowDate,
        waterBody: wb,
        reports,
      });
      const slot =
        computedSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === currentHourLabel) ??
        computedSlots[0];
      predictedFIndex = slot ? slot.f_index : null;
    }

    const fullPayload = {
      ...payload,
      outcome,
      weight_kg: outcome === 'no_bite' ? null : payload.weight_kg ?? null,
      length_cm: outcome === 'no_bite' ? null : payload.length_cm ?? null,
      client_event_id: clientEventId,
      weather_summary: weather
        ? `${weather.pressure_mmhg} мм рт. ст. · ${weather.air_temp_c}°C · ${weather.wind_direction_label} ${weather.wind_speed_ms} м/с`
        : '',
      weather_snapshot: weatherVector,
      predicted_f_index: predictedFIndex,
      created_at: nowDate.toISOString(),
    };

    if (!isOnline) {
      const localReport: CatchReport = {
        id: `local-${clientEventId.slice(0, 8)}`,
        client_event_id: clientEventId,
        user_id: user?.id ?? 'guest-local',
        author_nickname: user?.nickname ?? 'Вы (офлайн)',
        author_verified: user?.verified ?? false,
        water_body_id: wb?.id ?? null,
        water_body_name: wb?.display_label ?? 'Точка на карте',
        lat: Number(payload.lat),
        lng: Number(payload.lng),
        created_at: fullPayload.created_at,
        updated_at: fullPayload.created_at,
        fish_species_id: species?.id ?? payload.fish_species_id,
        fish_species_name: species?.name ?? payload.fish_species_id,
        outcome,
        weight_kg: fullPayload.weight_kg,
        length_cm: fullPayload.length_cm,
        depth_m: payload.depth_m ?? null,
        gps_accuracy_m: payload.gps_accuracy_m ?? null,
        bait: payload.bait,
        retrieve: payload.retrieve ?? '',
        weather_summary: fullPayload.weather_summary,
        weather_snapshot: weatherVector,
        predicted_f_index: predictedFIndex,
        photo_url: payload.photo_url,
        notes: payload.notes,
        visibility: payload.visibility,
        source: payload.source,
      };
      handleIncomingReport(localReport);

      const qItem: SyncQueueItem = {
        local_id: clientEventId,
        entity_type: 'report_create',
        payload: fullPayload,
        created_at: fullPayload.created_at,
        retry_count: 0,
        status: 'pending',
      };
      await offlineDb.enqueueOperation(qItem);
      const q = await offlineDb.getQueue();
      setSyncQueue(q);
      showToast('Запись сохранена локально и добавлена в очередь синхронизации.');
      return null;
    }

    try {
      const res = await fetch('/api/v1/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload),
      });
      const json = (await res.json()) as { report?: CatchReport; water_body?: WaterBody | null; error?: string };
      if (!res.ok) return json.error ?? 'Ошибка отправки отметки.';
      if (json.report) {
        handleIncomingReport(json.report);
      }
      if (json.water_body) {
        const updatedWb = json.water_body;
        setWaterBodies((prev) => prev.map((w) => (w.id === updatedWb.id ? { ...w, ...updatedWb } : w)));
        setSelectedWaterBody((prev) => (prev?.id === updatedWb.id ? { ...prev, ...updatedWb } : prev));
      }
      showToast(
        outcome === 'no_bite'
          ? 'Отметка «Клёва не было» сохранена и учтена в калибровке прогноза.'
          : payload.source === 'quick_mark'
            ? 'Метка «Клюёт сейчас» отправлена и учтена в прогнозе!'
            : 'Запись добавлена в дневник и учтена в калибровке прогноза.'
      );
      return null;
    } catch {
      return 'Ошибка сети при отправке.';
    }
  };

  const handleAddWaterBody = async (payload: {
    name: string | null;
    type: WaterBodyType;
    lat: number;
    lng: number;
    area_ha: number;
  }): Promise<string | null> => {
    try {
      const res = await fetch('/api/v1/water-bodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { water_body?: WaterBody; error?: string };
      if (!res.ok) return json.error ?? 'Ошибка добавления водоёма.';
      if (json.water_body) {
        setWaterBodies((prev) => [...prev, json.water_body!]);
        setSelectedWaterBody(json.water_body);
        showToast('Водоём добавлен со статусом «непроверено» (ожидает модерации).');
      }
      return null;
    } catch {
      return 'Ошибка сети.';
    }
  };

  const handleDiscoverOsmWaterBodies = useCallback(
    async (params: {
      lat: number;
      lng: number;
      radius_km?: number;
      query?: string;
      region_id?: string;
      major_only?: boolean;
      select_title?: string;
      select_type?: WaterBodyType;
      select_region?: string;
      silent?: boolean;
      autoSelectNearest?: boolean;
    }) => {
      if (!isOnline) {
        if (!params.silent) {
          showToast('Для загрузки новых водоёмов из OpenStreetMap требуется подключение к сети.');
        }
        return;
      }
      setDiscoveringOsm(true);

      const mergeDiscovered = (incoming: WaterBody[], selectedHit: WaterBody | null, addedCount?: number) => {
        if (incoming.length > 0) {
          setWaterBodies((prev) => {
            const map = new Map<string, WaterBody>(prev.map((w) => [w.id, w]));
            for (const wb of incoming) {
              map.set(wb.id, wb);
            }
            const merged = Array.from(map.values());
            void offlineDb.saveWaterBodies(merged);
            return merged;
          });
        }

        if (selectedHit) {
          handleSelectWaterBody(selectedHit);
          if (!params.silent) showToast(`Открыт водоём из OSM: ${selectedHit.display_label}`);
        } else if (params.autoSelectNearest && incoming.length > 0) {
          const sorted = [...incoming].sort(
            (a, b) =>
              haversineMeters({ lat: params.lat, lng: params.lng }, a.center) -
              haversineMeters({ lat: params.lat, lng: params.lng }, b.center)
          );
          setSelectedWaterBody(sorted[0]);
          if (!params.silent) {
            showToast(`Найдено рядом с вами (OSM): ${incoming.length} водоём(ов). Открыт: ${sorted[0].display_label}`);
          }
        } else if (!params.silent) {
          if (incoming.length > 0) {
            showToast(
              addedCount && addedCount > 0
                ? `Добавлено из OpenStreetMap: ${addedCount} водоём(ов).`
                : `В каталоге найдено ${incoming.length} водоём(ов) OSM в этом районе.`
            );
          } else {
            showToast('В указанной точке водоёмы OpenStreetMap не найдены.');
          }
        }
      };

      try {
        const res = await fetch(apiUrl('/api/v1/water-bodies/discover'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: params.lat,
            lng: params.lng,
            radius_km: params.radius_km,
            query: params.query,
            region_id: params.region_id,
            major_only: params.major_only,
            select_title: params.select_title,
            select_type: params.select_type,
            select_region: params.select_region,
          }),
        });
        const json = (await res.json()) as {
          discovered?: WaterBody[];
          items?: WaterBody[];
          added_count?: number;
          selected?: WaterBody | null;
          error?: string;
        };
        if (!res.ok) {
          if (!params.silent) showToast(json.error ?? 'Не удалось загрузить водоёмы из OSM.');
          return;
        }

        const incoming = [...(json.discovered ?? json.items ?? []), ...(json.selected ? [json.selected] : [])];
        mergeDiscovered(incoming, json.selected ?? null, json.added_count);
      } catch {
        // Standalone Capacitor APK fallback: direct Photon OSM reverse/search discovery
        try {
          const directList = await discoverOsmWaterBodiesDirect({
            lat: params.lat,
            lng: params.lng,
            radiusKm: params.radius_km ?? 20,
            query: params.query ?? params.select_title,
            majorOnly: params.major_only,
          });
          mergeDiscovered(directList, null, directList.length);
        } catch {
          if (!params.silent) showToast('Ошибка сети при обращении к OpenStreetMap.');
        }
      } finally {
        setDiscoveringOsm(false);
      }
    },
    [isOnline, showToast]
  );

  const applyLocatedOrigin = useCallback(
    async (coords: LatLng, options: { silentToast?: boolean; forceDiscover?: boolean } = {}) => {
      saveGpsOrigin(coords);
      setUserOrigin(coords);
      setUsingRealGps(true);
      setMapFocusPoint({ lat: coords.lat, lng: coords.lng, zoom: 11, ts: Date.now() });

      // Refresh live weather for the user's real GPS point
      if (isOnline) {
        fetch(apiUrl(`/api/v1/weather?lat=${coords.lat}&lng=${coords.lng}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((wxJson: { weather?: WeatherSnapshot } | null) => {
            if (wxJson?.weather) {
              setWeather(wxJson.weather);
              void offlineDb.saveWeather(wxJson.weather);
            }
          })
          .catch(async () => {
            const directWx = await fetchOpenMeteoWeatherDirect(coords.lat, coords.lng);
            if (directWx) {
              setWeather(directWx);
              void offlineDb.saveWeather(directWx);
            }
          });
      }

      const nearbyLocal = waterBodiesRef.current
        .map((wb) => ({ wb, distM: haversineMeters(coords, wb.center) }))
        .sort((a, b) => a.distM - b.distM);

      const closeCount = nearbyLocal.filter((x) => x.distM <= 25_000).length;
      if (isOnline && (options.forceDiscover || closeCount < 3)) {
        if (!options.silentToast) {
          showToast('Геопозиция определена — ищем водоёмы вокруг вашей точки в OSM...');
        }
        await handleDiscoverOsmWaterBodies({
          lat: coords.lat,
          lng: coords.lng,
          radius_km: 18,
          major_only: majorOnly,
          autoSelectNearest: closeCount === 0,
          silent: options.silentToast,
        });
      } else {
        if (nearbyLocal[0] && nearbyLocal[0].distM <= 60_000) {
          setSelectedWaterBody(nearbyLocal[0].wb);
        }
        if (!options.silentToast) {
          showToast('Карта и поиск водоёмов обновлены по вашей текущей GPS-точке.');
        }
      }
    },
    [isOnline, majorOnly, handleDiscoverOsmWaterBodies, showToast]
  );

  const gpsFilterRef = useRef(new GPSFilter());

  const handleLocateUser = useCallback(() => {
    void (async () => {
      const fix = await detectUserLocation({ highAccuracy: true, timeoutMs: 10000, forceFresh: true });
      if (!fix) {
        const httpWarn = getGpsHttpWarning();
        showToast(httpWarn ?? 'Нет доступа к GPS — расчёт ведётся от базовой точки.');
        return;
      }
      const filtered = gpsFilterRef.current.addPoint({
        lat: fix.coords.lat,
        lng: fix.coords.lng,
        accuracy_m: fix.accuracy_m,
        timestamp: fix.timestamp,
      });
      await applyLocatedOrigin(filtered.coords, {
        forceDiscover: true,
        silentToast: fix.accuracy_m !== null,
      });
      if (fix.accuracy_m !== null) {
        showToast(
          `GPS обновлён (±${fix.accuracy_m} м)${filtered.smoothed ? ' · сглажен дрейф' : ''}.`
        );
      }
    })();
  }, [applyLocatedOrigin, showToast]);

  // Mobile / Capacitor startup: automatically locate user GPS point (reuses 5-min cache to save battery)
  useEffect(() => {
    if (mobileGpsBootstrappedRef.current) return;
    if (!isMobileDeviceContext()) return;
    mobileGpsBootstrappedRef.current = true;

    let active = true;
    void (async () => {
      const fix = await detectUserLocation({ highAccuracy: true, useCache: true, cacheTtlMs: 300_000 });
      if (!active || !fix) return;
      const filtered = gpsFilterRef.current.addPoint({
        lat: fix.coords.lat,
        lng: fix.coords.lng,
        accuracy_m: fix.accuracy_m,
        timestamp: fix.timestamp,
      });
      await applyLocatedOrigin(filtered.coords, { silentToast: false, forceDiscover: false });
    })();
    return () => {
      active = false;
    };
  }, [applyLocatedOrigin]);

  const handleChangeRegionId = useCallback(
    (nextRegionId: string) => {
      setSelectedRegionId(nextRegionId);
      if (nextRegionId === 'all') return;
      const reg = getRegionById(nextRegionId);
      if (!reg) return;

      setMapFocusPoint({ lat: reg.center.lat, lng: reg.center.lng, zoom: 8.8, ts: Date.now() });

      const inRegionMajor = waterBodiesRef.current.filter(
        (wb) =>
          isMajorWaterBody(wb) &&
          filterWaterBodiesByRegionAndScale([wb], { regionId: reg.id, majorOnly: true }).length > 0
      );

      if (inRegionMajor.length > 0) {
        setSelectedWaterBody(inRegionMajor[0]);
      }

      if (isOnline && inRegionMajor.length < 4) {
        showToast(`Загружаем крупные водоёмы региона «${reg.name}» из OpenStreetMap...`);
        void handleDiscoverOsmWaterBodies({
          lat: reg.center.lat,
          lng: reg.center.lng,
          radius_km: reg.defaultRadiusKm,
          region_id: reg.id,
          major_only: true,
        });
      }
    },
    [isOnline, handleDiscoverOsmWaterBodies, showToast]
  );

  const handleVerifySpecies = useCallback(
    async (payload: {
      waterBodyId: string;
      speciesId: string;
      action: 'confirm' | 'absent';
      abundance?: FishAbundance;
      note?: string;
    }): Promise<string | null> => {
      const applyLocalVerification = () => {
        const actorId = user ? `user:${user.id}` : 'local-angler';
        const actorName = user?.nickname ?? 'Вы (локально)';
        let updatedTarget: WaterBody | null = null;
        setWaterBodies((prev) => {
          const next = prev.map((wb) => {
            if (wb.id !== payload.waterBodyId) return wb;
            updatedTarget = {
              ...wb,
              verified_species: applySpeciesVerificationVote({
                existing: wb.verified_species,
                speciesId: payload.speciesId,
                action: payload.action,
                actorId,
                authorNickname: actorName,
                abundance: payload.abundance,
                note: payload.note,
              }),
            };
            return updatedTarget;
          });
          void offlineDb.saveWaterBodies(next);
          return next;
        });
        if (updatedTarget) {
          setSelectedWaterBody((prev) => (prev?.id === payload.waterBodyId ? updatedTarget : prev));
        }
      };

      if (!isOnline) {
        applyLocalVerification();
        showToast('Правка по видам рыб сохранена локально.');
        return null;
      }

      try {
        const res = await fetch(apiUrl(`/api/v1/water-bodies/${payload.waterBodyId}/species-verification`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            species_id: payload.speciesId,
            action: payload.action,
            abundance: payload.abundance,
            note: payload.note,
          }),
        });
        const json = (await res.json()) as { water_body?: WaterBody; error?: string };
        if (!res.ok) {
          return json.error ?? 'Не удалось сохранить правку по видам рыб.';
        }
        if (json.water_body) {
          const updated = json.water_body;
          setWaterBodies((prev) => {
            const next = prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w));
            void offlineDb.saveWaterBodies(next);
            return next;
          });
          setSelectedWaterBody((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
        }
        showToast(
          payload.action === 'confirm'
            ? 'Подтверждение вида сохранено в базе водоёма.'
            : 'Отметка об отсутствии вида учтена — база знаний обновлена.'
        );
        return null;
      } catch {
        applyLocalVerification();
        showToast('Правка по видам рыб применена локально.');
        return null;
      }
    },
    [isOnline, user, showToast]
  );

  const handleDeleteReport = async (id: string) => {
    setReports((prev) => prev.filter((r) => r.id !== id));
    if (isOnline && !id.startsWith('local-')) {
      await fetch(`/api/v1/reports/${id}`, { method: 'DELETE' });
    }
  };

  const handleAuthLogin = async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok) return json.error ?? 'Ошибка входа.';
      setUser(json.user ?? null);
      showToast(`Добро пожаловать, ${json.user?.nickname}!`);
      return null;
    } catch {
      return 'Ошибка сети при авторизации.';
    }
  };

  const handleAuthRegister = async (
    email: string,
    password: string,
    nickname: string
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nickname }),
      });
      const json = (await res.json()) as { user?: UserProfile; error?: string };
      if (!res.ok) return json.error ?? 'Ошибка регистрации.';
      setUser(json.user ?? null);
      showToast(`Профиль ${json.user?.nickname} создан!`);
      return null;
    } catch {
      return 'Ошибка сети при регистрации.';
    }
  };

  const handleAuthLogout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
  };

  const handleUpdatePrivacy = async (privacy: ReportVisibility) => {
    const res = await fetch('/api/v1/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privacy_default: privacy }),
    });
    const json = (await res.json()) as { user?: UserProfile };
    if (json.user) setUser(json.user);
  };

  return (
    <div className="min-h-screen bg-[#F4F7F9] text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenQuickMark={() => setQuickMarkOpen(true)}
        isOnline={isOnline}
        wsConnected={wsConnected}
        pendingSyncCount={syncQueue.length}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white flex items-center justify-center gap-2">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Офлайн-режим: доступны кэш водоёма, справочник рыб и очередь дневника ({syncQueue.length})</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {activeTab === 'map' && (
          <div className="relative flex flex-col lg:flex-row h-[calc(100dvh-117px)] lg:h-[calc(100dvh-57px)] overflow-hidden">
            {/* Map Canvas Column */}
            <div className="relative flex-1 h-full">
              {/* Top-Center / Right Map Search & Live Filter Overlay */}
              <div className="absolute left-3 right-3 top-14 z-10 flex flex-col gap-2 sm:left-auto sm:right-14 sm:top-3 sm:w-96">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <label htmlFor="map-hydro-search" className="sr-only">
                      Поиск водоёма на карте
                    </label>
                    <input
                      id="map-hydro-search"
                      type="search"
                      placeholder="Найти водоём (Истра, Сычёво, Тростенское...)"
                      value={searchQuery}
                      onChange={(e) => void handleSearchChange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white/95 py-2.5 pl-9 pr-3 text-xs font-medium text-slate-900 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Фильтры меток на карте"
                    onClick={() => setShowFilters((v) => !v)}
                    className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur ${
                      showFilters
                        ? 'border-sky-600 bg-sky-700 text-white'
                        : 'border-slate-200 bg-white/95 text-slate-700 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200'
                    }`}
                  >
                    <Filter className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Search dropdown results */}
                {searchResults.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {searchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          const found = item.water_body_id
                            ? waterBodies.find((w) => w.id === item.water_body_id)
                            : undefined;
                          if (found) {
                            handleSelectWaterBody(found);
                            setMapFocusPoint({ lat: found.center.lat, lng: found.center.lng, zoom: 11.5, ts: Date.now() });
                          } else if (typeof item.lat === 'number' && typeof item.lng === 'number') {
                            setMapFocusPoint({ lat: item.lat, lng: item.lng, zoom: 11.5, ts: Date.now() });
                            showToast(`Загружаем водоёмы OSM в районе «${item.title}»...`);
                            void handleDiscoverOsmWaterBodies({
                              lat: item.lat,
                              lng: item.lng,
                              radius_km: 12,
                              query: item.is_water_body ? item.title : undefined,
                              select_title: item.is_water_body ? item.title : undefined,
                              select_type: item.water_type,
                              select_region: item.subtitle,
                            });
                          }
                          setSearchResults([]);
                          setSearchQuery('');
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</span>
                        <span className="truncate text-slate-500">{item.subtitle}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Report Filters Drawer */}
                {showFilters && (
                  <div className="rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur space-y-2.5 dark:border-slate-700 dark:bg-slate-900/95">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="flt-species" className="block text-[11px] font-medium text-slate-500">
                          Вид рыбы
                        </label>
                        <select
                          id="flt-species"
                          value={reportSpeciesFilter}
                          onChange={(e) => setReportSpeciesFilter(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                        >
                          <option value="all">Все виды</option>
                          {speciesList.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="flt-since" className="block text-[11px] font-medium text-slate-500">
                          Давность меток
                        </label>
                        <select
                          id="flt-since"
                          value={reportSinceFilter}
                          onChange={(e) => setReportSinceFilter(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                        >
                          <option value="all">За всё время</option>
                          <option value="hour">За час</option>
                          <option value="today">Сегодня</option>
                          <option value="week">За неделю</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={verifiedOnly}
                        onChange={(e) => setVerifiedOnly(e.target.checked)}
                        className="h-4 w-4 accent-sky-700"
                      />
                      Только проверенные пользователи
                    </label>
                  </div>
                )}
              </div>

              <FishMap
                waterBodies={visibleWaterBodies}
                selectedWaterBody={selectedWaterBody}
                onSelectWaterBody={handleSelectWaterBody}
                reports={reports}
                depthPoints={depthPoints}
                prospectiveZones={prospectiveZones}
                activeRoute={routeResult}
                layers={layers}
                onToggleLayers={setLayers}
                historicOverlay={historicOverlay}
                userOrigin={userOrigin}
                onLocateUser={handleLocateUser}
                pickDepthMode={pickDepthMode}
                onPickCoordinate={(coords) => {
                  setPickedCoords(coords);
                  showToast(`Координаты выбраны: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
                }}
                isOnline={isOnline}
                offlineRegions={offlineRegions}
                onDownloadOfflineRegion={handleDownloadOfflineRegion}
                onDeleteOfflineRegion={handleDeleteOfflineRegion}
                onOpenAlerts={() => setAlertsModalOpen(true)}
                alertsEnabled={alertSettings.enabled}
                focusPoint={mapFocusPoint}
                onDiscoverNearby={(center) =>
                  handleDiscoverOsmWaterBodies({
                    lat: center.lat,
                    lng: center.lng,
                    radius_km: 16,
                    region_id: selectedRegionId,
                    major_only: majorOnly,
                  })
                }
                discoveringOsm={discoveringOsm}
              />

              <GoodBiteWidget
                items={goodBiteItems}
                totalInRadius={totalIn100Km}
                speciesList={speciesList}
                selectedSpeciesId={goodBiteSpeciesId}
                onSelectSpeciesId={setGoodBiteSpeciesId}
                selectedDay={goodBiteDay}
                onSelectDay={setGoodBiteDay}
                selectedWaterBodyId={selectedWaterBody?.id ?? null}
                onSelectWaterBody={(wb, spId) => {
                  setSelectedFishId(spId);
                  handleSelectWaterBody(wb);
                }}
                onOpenDirectory100Km={() => {
                  setRadiusKm(100);
                  setActiveTab('waterbodies');
                }}
                usingRealGps={usingRealGps}
                onLocateUser={handleLocateUser}
                expandedDesktop={goodBiteExpandedDesktop}
                onToggleDesktop={() => setGoodBiteExpandedDesktop((v) => !v)}
                mobileOpen={goodBiteMobileOpen}
                onOpenMobile={() => setGoodBiteMobileOpen(true)}
                onCloseMobile={() => setGoodBiteMobileOpen(false)}
                favoriteIds={favoriteIds}
                onOpenAlerts={() => setAlertsModalOpen(true)}
                alertsEnabled={alertSettings.enabled}
                selectedRegionId={selectedRegionId}
                onChangeRegionId={handleChangeRegionId}
                majorOnly={majorOnly}
                onToggleMajorOnly={setMajorOnly}
              />

              {/* Mobile Compact Selected Water Body Bar */}
              {selectedWaterBody && !mobileSheetOpen && (
                <div className="lg:hidden fixed bottom-16 left-0 right-0 z-20 p-3 pointer-events-none">
                  <button
                    type="button"
                    onClick={() => setMobileSheetOpen(true)}
                    className="pointer-events-auto flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-left shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {selectedWaterBody.display_label}
                      </div>
                      <div className="text-xs text-slate-500">
                        Прогноз, батиметрия и маршрут до берега
                      </div>
                    </div>
                    <ChevronUp className="h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {/* Desktop Right Detail Inspector */}
            {selectedWaterBody && (
              <aside className="hidden lg:block lg:w-[400px] xl:w-[440px] 2xl:w-[460px] shrink-0 border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
                <WaterBodySheet
                  waterBody={selectedWaterBody}
                  weather={weather}
                  forecast={forecast}
                  forecastLoading={forecastLoading}
                  speciesList={speciesList}
                  reports={reports}
                  selectedFishId={selectedFishId}
                  onSelectFishId={setSelectedFishId}
                  recommendations={recommendations}
                  depthPoints={depthPoints}
                  prospectiveZones={prospectiveZones}
                  analysis={analysis}
                  reconRunning={reconRunning}
                  onRunRecon={() => void handleRunRecon()}
                  onAddDepthPoint={handleAddDepthPoint}
                  onImportDepthPoints={handleImportDepthPoints}
                  historicOverlay={
                    historicOverlay ? { waterBodyId: historicOverlay.waterBodyId, fileName: historicOverlay.fileName } : null
                  }
                  historicOpacity={layers.historicOpacity}
                  onChangeHistoricOpacity={(val) => setLayers((prev) => ({ ...prev, historicOpacity: val }))}
                  onUploadHistoricMap={handleUploadHistoricMap}
                  onClearHistoricMap={() => setHistoricOverlay(null)}
                  openSeaMapEnabled={layers.openSeaMap}
                  onToggleOpenSeaMap={(enabled) => setLayers((prev) => ({ ...prev, openSeaMap: enabled }))}
                  pickDepthMode={pickDepthMode}
                  onTogglePickDepthMode={() => setPickDepthMode((p) => !p)}
                  pickedCoords={pickedCoords}
                  routeResult={routeResult}
                  routeLoading={routeLoading}
                  avoidUnpaved={avoidUnpaved}
                  onToggleAvoidUnpaved={setAvoidUnpaved}
                  onBuildRoute={(simQuota) => void handleBuildRoute(simQuota)}
                  isFavorite={favoriteIds.includes(selectedWaterBody.id)}
                  onToggleFavorite={() => handleToggleFavorite(selectedWaterBody.id)}
                  onOpenAlerts={() => setAlertsModalOpen(true)}
                  isOnline={isOnline}
                  onVerifySpecies={handleVerifySpecies}
                />
              </aside>
            )}

            {/* Mobile Expanded Bottom Sheet */}
            {selectedWaterBody && mobileSheetOpen && (
              <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/50 backdrop-blur-xs">
                <div className="h-[85vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900">
                  <WaterBodySheet
                    waterBody={selectedWaterBody}
                    weather={weather}
                    forecast={forecast}
                    forecastLoading={forecastLoading}
                    speciesList={speciesList}
                    reports={reports}
                    selectedFishId={selectedFishId}
                    onSelectFishId={setSelectedFishId}
                    recommendations={recommendations}
                    depthPoints={depthPoints}
                    prospectiveZones={prospectiveZones}
                    analysis={analysis}
                    reconRunning={reconRunning}
                    onRunRecon={() => void handleRunRecon()}
                    onAddDepthPoint={handleAddDepthPoint}
                    onImportDepthPoints={handleImportDepthPoints}
                    historicOverlay={
                      historicOverlay ? { waterBodyId: historicOverlay.waterBodyId, fileName: historicOverlay.fileName } : null
                    }
                    historicOpacity={layers.historicOpacity}
                    onChangeHistoricOpacity={(val) => setLayers((prev) => ({ ...prev, historicOpacity: val }))}
                    onUploadHistoricMap={handleUploadHistoricMap}
                    onClearHistoricMap={() => setHistoricOverlay(null)}
                    openSeaMapEnabled={layers.openSeaMap}
                    onToggleOpenSeaMap={(enabled) => setLayers((prev) => ({ ...prev, openSeaMap: enabled }))}
                    pickDepthMode={pickDepthMode}
                    onTogglePickDepthMode={() => {
                      setPickDepthMode((p) => !p);
                      setMobileSheetOpen(false);
                    }}
                    pickedCoords={pickedCoords}
                    routeResult={routeResult}
                    routeLoading={routeLoading}
                    avoidUnpaved={avoidUnpaved}
                    onToggleAvoidUnpaved={setAvoidUnpaved}
                    onBuildRoute={(simQuota) => void handleBuildRoute(simQuota)}
                    onCloseMobile={() => setMobileSheetOpen(false)}
                    isFavorite={favoriteIds.includes(selectedWaterBody.id)}
                    onToggleFavorite={() => handleToggleFavorite(selectedWaterBody.id)}
                    onOpenAlerts={() => {
                      setMobileSheetOpen(false);
                      setAlertsModalOpen(true);
                    }}
                    isOnline={isOnline}
                    onVerifySpecies={handleVerifySpecies}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'waterbodies' && (
          <WaterBodiesDirectory
            nearbyItems={nearbyItems}
            goodBiteById={goodBiteById}
            goodBiteItems={goodBiteItems}
            speciesList={speciesList}
            reports={reports}
            radiusKm={radiusKm}
            onChangeRadiusKm={setRadiusKm}
            includeUnnamed={includeUnnamed}
            onToggleIncludeUnnamed={setIncludeUnnamed}
            onSelectWaterBody={handleSelectWaterBody}
            onAddWaterBody={handleAddWaterBody}
            onDiscoverOsmNearby={(q) => {
              const reg = selectedRegionId !== 'all' ? getRegionById(selectedRegionId) : null;
              return handleDiscoverOsmWaterBodies({
                lat: reg ? reg.center.lat : userOrigin.lat,
                lng: reg ? reg.center.lng : userOrigin.lng,
                radius_km: reg ? reg.defaultRadiusKm : Math.min(25, Math.max(12, radiusKm)),
                query: q,
                region_id: selectedRegionId,
                major_only: majorOnly,
              });
            }}
            discoveringOsm={discoveringOsm}
            userOrigin={userOrigin}
            favoriteIds={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
            selectedRegionId={selectedRegionId}
            onChangeRegionId={handleChangeRegionId}
            majorOnly={majorOnly}
            onToggleMajorOnly={setMajorOnly}
          />
        )}

        {activeTab === 'reference' && (
          <SpeciesReference
            speciesList={speciesList}
            knotsList={knotsList}
            waterBodies={waterBodies}
            selectedWaterBody={selectedWaterBody}
            knotsCacheMeta={knotsCacheMeta}
            isOnline={isOnline}
            onRefreshKnotsCache={handleRefreshKnotsCache}
          />
        )}

        {activeTab === 'diary' && (
          <DiaryAndProfile
            reports={reports}
            speciesList={speciesList}
            waterBodies={waterBodies}
            weather={weather}
            user={user}
            isOnline={isOnline}
            manualOffline={manualOffline}
            onToggleManualOffline={setManualOffline}
            syncQueue={syncQueue}
            onFlushSyncQueue={() => void flushSyncQueue()}
            onCreateDiaryEntry={(p) => submitReportOrQueue({ ...p, source: 'diary' })}
            onDeleteReport={handleDeleteReport}
            onAuthLogin={handleAuthLogin}
            onAuthRegister={handleAuthRegister}
            onAuthLogout={handleAuthLogout}
            onUpdatePrivacy={handleUpdatePrivacy}
          />
        )}
      </main>

      {/* Quick Mark Modal */}
      <QuickMarkModal
        isOpen={quickMarkOpen}
        onClose={() => setQuickMarkOpen(false)}
        speciesList={speciesList}
        waterBodies={waterBodies}
        selectedWaterBody={selectedWaterBody}
        currentCoords={selectedWaterBody?.center ?? DEFAULT_ORIGIN}
        onSubmit={(p) => submitReportOrQueue({ ...p, source: 'quick_mark' })}
      />

      {/* PWA Bite Alerts Modal */}
      <BiteAlertsModal
        open={alertsModalOpen}
        onClose={() => setAlertsModalOpen(false)}
        settings={alertSettings}
        onUpdateSettings={handleUpdateAlertSettings}
        permission={notificationPermission}
        onRequestPermission={handleRequestNotificationPermission}
        onCheckNow={handleCheckAlertsNow}
        favoriteIds={favoriteIds}
        onToggleFavorite={handleToggleFavorite}
        waterBodies={waterBodies}
        goodBiteItems={allScoredForAlerts}
        alertHistory={alertHistory}
        onClearHistory={() => {
          setAlertHistory([]);
          void offlineDb.saveAlertHistory([]);
        }}
        onSelectWaterBody={handleSelectWaterBody}
      />

      {/* Non-intrusive Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-24 left-3 z-50 max-w-sm rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg dark:bg-sky-700 lg:bottom-20 lg:left-3"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
