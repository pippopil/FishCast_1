import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Bell,
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation2,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { generateBathymetryContours, haversineMeters } from '../lib/fishLogic';
import {
  bboxToPolygonRing,
  estimateRegionTileCount,
  isPointInBbox,
  normalizeBboxSelection,
  OFFLINE_TILE_CACHE_NAME,
  PRESET_MAP_REGIONS,
} from '../lib/offlineMapRegions';
import { offlineDb } from '../utils/offlineDb';
import type {
  BathymetryPoint,
  CatchReport,
  LatLng,
  MapBbox,
  OfflineMapRegion,
  ProspectiveZone,
  RouteMultiResult,
  WaterBody,
} from '../lib/types';

maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');

let offlineTileProtocolReady = false;
let globalMapOnlineFlag = true;

// 1x1 transparent PNG so uncached map tiles outside downloaded offline regions stay silent without MapLibre console errors
const TRANSPARENT_TILE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function getTransparentTileBuffer(): ArrayBuffer {
  const binary = atob(TRANSPARENT_TILE_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function ensureOfflineTileProtocol() {
  if (offlineTileProtocolReady) return;
  offlineTileProtocolReady = true;
  maplibregl.addProtocol('fishcast-tile', async (params, abortController) => {
    const rawPath = params.url.replace('fishcast-tile://', '');
    const osmUrl = `https://tile.openstreetmap.org/${rawPath}`;

    if (typeof indexedDB !== 'undefined') {
      try {
        const idbTile = await offlineDb.getMapTile(osmUrl);
        if (idbTile && idbTile.data && idbTile.data.byteLength > 0) {
          return { data: idbTile.data.slice(0) };
        }
      } catch {
        // Fallback to Cache Storage or network
      }
    }

    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(OFFLINE_TILE_CACHE_NAME);
        const cached = await cache.match(osmUrl);
        if (cached) {
          return { data: await cached.arrayBuffer() };
        }
      } catch {
        // Ignore Cache Storage errors and fall back to network if online
      }
    }

    if (!globalMapOnlineFlag || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return { data: getTransparentTileBuffer() };
    }

    try {
      const res = await fetch(osmUrl, { signal: abortController.signal });
      if (!res.ok) {
        return { data: getTransparentTileBuffer() };
      }
      return { data: await res.arrayBuffer() };
    } catch {
      return { data: getTransparentTileBuffer() };
    }
  });
}

export interface HistoricMapOverlay {
  waterBodyId: string;
  fileName: string;
  imageUrl: string;
  bounds: [[number, number], [number, number], [number, number], [number, number]];
}

export interface MapLayerToggles {
  baseStyle: 'scheme' | 'satellite';
  contours: boolean;
  heatmap: boolean;
  prospective: boolean;
  openSeaMap: boolean;
  topoOverlay: boolean;
  historicOpacity: number;
}

interface FishMapProps {
  waterBodies: WaterBody[];
  selectedWaterBody: WaterBody | null;
  onSelectWaterBody: (wb: WaterBody) => void;
  reports: CatchReport[];
  depthPoints: BathymetryPoint[];
  prospectiveZones: ProspectiveZone[];
  activeRoute: RouteMultiResult | null;
  layers: MapLayerToggles;
  onToggleLayers: (next: MapLayerToggles) => void;
  historicOverlay?: HistoricMapOverlay | null;
  userOrigin: LatLng;
  onLocateUser?: () => void;
  onPickCoordinate?: (coords: LatLng) => void;
  pickDepthMode: boolean;
  isOnline: boolean;
  offlineRegions: OfflineMapRegion[];
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
  onOpenAlerts?: () => void;
  alertsEnabled?: boolean;
  focusPoint?: { lat: number; lng: number; zoom?: number; ts: number } | null;
  onDiscoverNearby?: (center: LatLng) => Promise<void> | void;
  discoveringOsm?: boolean;
}

function buildHydroStyle(baseStyle: 'scheme' | 'satellite'): maplibregl.StyleSpecification {
  const isSat = baseStyle === 'satellite';
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['fishcast-tile://{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap · © Seascape (openwaters.io)',
      },
      opentopo: {
        type: 'raster',
        tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '© OpenTopoMap (CC-BY-SA)',
      },
      openseamap: {
        type: 'raster',
        tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: '© OpenSeaMap',
      },
    },
    layers: [
      {
        id: 'hydro-background',
        type: 'background',
        paint: {
          'background-color': isSat ? '#0F1C24' : '#EAF0F2',
        },
      },
      {
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm',
        paint: {
          'raster-opacity': isSat ? 0.25 : 0.85,
          'raster-saturation': isSat ? -0.6 : -0.25,
          'raster-brightness-max': isSat ? 0.55 : 1.0,
        },
      },
      {
        id: 'opentopo-tiles',
        type: 'raster',
        source: 'opentopo',
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0.58,
        },
      },
      {
        id: 'openseamap-tiles',
        type: 'raster',
        source: 'openseamap',
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0.92,
        },
      },
    ],
  };
}

export const FishMap: React.FC<FishMapProps> = ({
  waterBodies,
  selectedWaterBody,
  onSelectWaterBody,
  reports,
  depthPoints,
  prospectiveZones,
  activeRoute,
  layers,
  onToggleLayers,
  historicOverlay = null,
  userOrigin,
  onLocateUser,
  onPickCoordinate,
  pickDepthMode,
  isOnline,
  offlineRegions,
  onDownloadOfflineRegion,
  onDeleteOfflineRegion,
  onOpenAlerts,
  alertsEnabled = false,
  focusPoint = null,
  onDiscoverNearby,
  discoveringOsm = false,
}) => {
  ensureOfflineTileProtocol();
  globalMapOnlineFlag = isOnline;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showOfflineMenu, setShowOfflineMenu] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('viewport');
  const [customBbox, setCustomBbox] = useState<MapBbox | null>(null);
  const [isSelectingCustomArea, setIsSelectingCustomArea] = useState(false);
  const [detailMode, setDetailMode] = useState<'standard' | 'detailed'>('standard');
  const [viewportBbox, setViewportBbox] = useState<MapBbox>({
    north: userOrigin.lat + 0.08,
    south: userOrigin.lat - 0.08,
    east: userOrigin.lng + 0.12,
    west: userOrigin.lng - 0.12,
  });
  const [mapCenter, setMapCenter] = useState<LatLng>(userOrigin);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const [idbStats, setIdbStats] = useState<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 });

  const onSelectRef = useRef(onSelectWaterBody);
  const onPickRef = useRef(onPickCoordinate);
  const pickDepthRef = useRef(pickDepthMode);
  const selectingCustomRef = useRef(isSelectingCustomArea);
  const dragAnchorRef = useRef<LatLng | null>(null);
  const waterBodiesRef = useRef(waterBodies);
  onSelectRef.current = onSelectWaterBody;
  onPickRef.current = onPickCoordinate;
  pickDepthRef.current = pickDepthMode;
  selectingCustomRef.current = isSelectingCustomArea;
  waterBodiesRef.current = waterBodies;

  useEffect(() => {
    void offlineDb.getMapTilesStats().then(setIdbStats);
  }, [showOfflineMenu, offlineRegions.length]);

  const activeDownloadTarget = useMemo(() => {
    if (selectedPresetId === 'custom') {
      const box = customBbox ?? viewportBbox;
      return {
        id: `region-custom-${box.north.toFixed(2)}-${box.west.toFixed(2)}-${box.south.toFixed(2)}-${box.east.toFixed(2)}`,
        name: 'Выделенная область карты',
        bbox: box,
      };
    }
    if (selectedPresetId === 'viewport') {
      return {
        id: `region-viewport-${viewportBbox.north.toFixed(2)}-${viewportBbox.west.toFixed(2)}`,
        name: 'Текущий экран карты',
        bbox: viewportBbox,
      };
    }
    const found = PRESET_MAP_REGIONS.find((r) => r.id === selectedPresetId) ?? PRESET_MAP_REGIONS[0];
    return {
      id: found.id,
      name: found.name,
      bbox: found.bbox,
    };
  }, [selectedPresetId, customBbox, viewportBbox]);

  const minZoom = detailMode === 'detailed' ? 11 : 10;
  const maxZoom = detailMode === 'detailed' ? 14 : 13;
  const estimatedTiles = useMemo(
    () => estimateRegionTileCount(activeDownloadTarget.bbox, minZoom, maxZoom, 220),
    [activeDownloadTarget.bbox, minZoom, maxZoom]
  );
  const estimatedMb = ((estimatedTiles * 18) / 1024).toFixed(1);
  const waterBodiesInTarget = useMemo(
    () => waterBodies.filter((wb) => isPointInBbox(wb.center, activeDownloadTarget.bbox)).length,
    [waterBodies, activeDownloadTarget.bbox]
  );
  const hasWaterBodiesNearCenter = useMemo(
    () =>
      waterBodies.some(
        (wb) => isPointInBbox(wb.center, viewportBbox) || haversineMeters(mapCenter, wb.center) <= 8000
      ),
    [waterBodies, viewportBbox, mapCenter]
  );

  const offlineRegionsGeoJson = useMemo(() => {
    const features: Array<{
      type: 'Feature';
      properties: { kind: 'downloaded' | 'preview'; name: string };
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    }> = [];
    for (const reg of offlineRegions) {
      features.push({
        type: 'Feature',
        properties: { kind: 'downloaded', name: reg.name },
        geometry: { type: 'Polygon', coordinates: [bboxToPolygonRing(reg.bbox)] },
      });
    }
    if (showOfflineMenu) {
      features.push({
        type: 'Feature',
        properties: { kind: 'preview', name: activeDownloadTarget.name },
        geometry: { type: 'Polygon', coordinates: [bboxToPolygonRing(activeDownloadTarget.bbox)] },
      });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [offlineRegions, showOfflineMenu, activeDownloadTarget]);

  // Build GeoJSON sources memoized
  const waterGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: waterBodies.map((wb) => ({
        type: 'Feature' as const,
        id: wb.id,
        properties: {
          id: wb.id,
          title: wb.display_label,
          type: wb.type,
          confidence: wb.confidence,
          unverified: wb.moderation_status === 'unverified' ? 1 : 0,
          selected: selectedWaterBody?.id === wb.id ? 1 : 0,
          has_bathymetry: wb.has_bathymetry ? 1 : 0,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates:
            wb.polygon_rings && wb.polygon_rings.length > 0 ? wb.polygon_rings : [wb.polygon],
        },
      })),
    };
  }, [waterBodies, selectedWaterBody?.id]);

  const activeContours = useMemo(() => {
    const staticContours = selectedWaterBody?.contours ?? [];
    const sonarOrManualCount = depthPoints.filter((p) => p.source === 'sonar' || p.source === 'manual').length;
    if (depthPoints.length >= 3 && (staticContours.length === 0 || sonarOrManualCount >= 3)) {
      const generated = generateBathymetryContours(depthPoints, selectedWaterBody);
      if (generated.length > 0) return generated;
    }
    return staticContours;
  }, [selectedWaterBody, depthPoints]);

  const contoursGeoJson = useMemo(() => {
    const features: Array<{
      type: 'Feature';
      properties: { depth_m: number; label: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }> = [];
    for (const c of activeContours) {
      features.push({
        type: 'Feature',
        properties: { depth_m: c.depth_m, label: `${c.depth_m} м` },
        geometry: { type: 'LineString', coordinates: c.coordinates },
      });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [activeContours]);

  const depthPointsGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: depthPoints.map((pt) => ({
        type: 'Feature' as const,
        properties: {
          id: pt.id,
          depth_m: pt.depth_m,
          label: `${pt.depth_m.toFixed(1)} м`,
          source: pt.source,
        },
        geometry: { type: 'Point' as const, coordinates: [pt.lng, pt.lat] },
      })),
    };
  }, [depthPoints]);

  const zonesGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: prospectiveZones.map((z) => ({
        type: 'Feature' as const,
        properties: { id: z.id, kind: z.kind, label: z.label },
        geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] },
      })),
    };
  }, [prospectiveZones]);

  const reportsGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: reports
        .filter((r) => r.visibility !== 'private')
        .map((r) => ({
          type: 'Feature' as const,
          properties: {
            id: r.id,
            species: r.fish_species_name,
            outcome: r.outcome ?? 'catch',
            author: r.author_nickname,
            verified: r.author_verified ? 1 : 0,
            bait: r.bait || '—',
            water_body: r.water_body_name,
          },
          geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
        })),
    };
  }, [reports]);

  const routeGeoJson = useMemo(() => {
    const features: Array<{
      type: 'Feature';
      properties: { kind: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    }> = [];
    if (activeRoute) {
      if (activeRoute.driving_segment) {
        features.push({
          type: 'Feature',
          properties: { kind: 'driving' },
          geometry: { type: 'LineString', coordinates: activeRoute.driving_segment.geometry },
        });
      }
      features.push({
        type: 'Feature',
        properties: { kind: 'walking' },
        geometry: { type: 'LineString', coordinates: activeRoute.walking_segment.geometry },
      });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [activeRoute]);

  const accessPinGeoJson = useMemo(() => {
    if (!activeRoute?.access_point) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {
            label: activeRoute.driving_available ? 'Парковка / подъезд' : 'Ближайшая дорога',
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [activeRoute.access_point.lng, activeRoute.access_point.lat],
          },
        },
        {
          type: 'Feature' as const,
          properties: { label: 'Точка ловли' },
          geometry: {
            type: 'Point' as const,
            coordinates: [activeRoute.target_point.lng, activeRoute.target_point.lat],
          },
        },
      ],
    };
  }, [activeRoute]);

  // Mount MapLibre once
  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildHydroStyle(layers.baseStyle),
        center: [userOrigin.lng, userOrigin.lat],
        zoom: 11.2,
        attributionControl: false,
      });
    } catch {
      setWebglError(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const initLayers = () => {
      if (!map.getSource('water-bodies')) {
        map.addSource('water-bodies', { type: 'geojson', data: waterGeoJson });
        map.addLayer({
          id: 'water-bodies-fill',
          type: 'fill',
          source: 'water-bodies',
          paint: {
            'fill-color': [
              'case',
              ['==', ['get', 'selected'], 1],
              '#0284C7',
              ['==', ['get', 'unverified'], 1],
              '#D97706',
              '#0EA5E9',
            ],
            'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.45, 0.28],
          },
        });
        map.addLayer({
          id: 'water-bodies-outline',
          type: 'line',
          source: 'water-bodies',
          paint: {
            'line-color': ['case', ['==', ['get', 'selected'], 1], '#0369A1', '#0C4A6E'],
            'line-width': ['case', ['==', ['get', 'selected'], 1], 3, 1.5],
          },
        });
      }

      if (!map.getSource('bathymetry-points')) {
        map.addSource('bathymetry-points', { type: 'geojson', data: depthPointsGeoJson });
        map.addLayer({
          id: 'bathymetry-heatmap',
          type: 'heatmap',
          source: 'bathymetry-points',
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'depth_m'], 0, 0.1, 12, 1],
            'heatmap-intensity': 1.2,
            'heatmap-radius': 34,
            'heatmap-opacity': 0.55,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(14, 165, 233, 0)',
              0.3,
              'rgba(56, 189, 248, 0.45)',
              0.6,
              'rgba(2, 132, 199, 0.7)',
              1,
              'rgba(12, 74, 110, 0.9)',
            ],
          },
        });
        map.addLayer({
          id: 'bathymetry-dots',
          type: 'circle',
          source: 'bathymetry-points',
          paint: {
            'circle-radius': 6,
            'circle-color': [
              'match',
              ['get', 'source'],
              'sonar',
              '#0D9488',
              'manual',
              '#F59E0B',
              '#0369A1',
            ],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }

      if (!map.getSource('bathymetry-contours')) {
        map.addSource('bathymetry-contours', { type: 'geojson', data: contoursGeoJson });
        map.addLayer({
          id: 'contours-line',
          type: 'line',
          source: 'bathymetry-contours',
          paint: {
            'line-color': [
              'interpolate',
              ['linear'],
              ['get', 'depth_m'],
              1,
              '#0284C7',
              5,
              '#0369A1',
              10,
              '#1E3A8A',
            ],
            'line-width': 1.8,
            'line-dasharray': [2, 1],
          },
        });
      }

      if (!map.getSource('prospective-zones')) {
        map.addSource('prospective-zones', { type: 'geojson', data: zonesGeoJson });
        map.addLayer({
          id: 'prospective-circles',
          type: 'circle',
          source: 'prospective-zones',
          paint: {
            'circle-radius': 7,
            'circle-color': ['match', ['get', 'kind'], 'hole', '#7C3AED', '#0D9488'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }

      if (!map.getSource('split-route')) {
        map.addSource('split-route', { type: 'geojson', data: routeGeoJson });
        map.addLayer({
          id: 'route-driving',
          type: 'line',
          source: 'split-route',
          filter: ['==', ['get', 'kind'], 'driving'],
          paint: {
            'line-color': '#0369A1',
            'line-width': 4,
          },
        });
        map.addLayer({
          id: 'route-walking',
          type: 'line',
          source: 'split-route',
          filter: ['==', ['get', 'kind'], 'walking'],
          paint: {
            'line-color': '#D97706',
            'line-width': 3.5,
            'line-dasharray': [2, 1.5],
          },
        });
      }

      if (!map.getSource('access-pins')) {
        map.addSource('access-pins', { type: 'geojson', data: accessPinGeoJson });
        map.addLayer({
          id: 'access-pins-circle',
          type: 'circle',
          source: 'access-pins',
          paint: {
            'circle-radius': 7,
            'circle-color': '#0F172A',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FBBF24',
          },
        });
      }

      if (!map.getSource('catch-reports')) {
        map.addSource('catch-reports', {
          type: 'geojson',
          data: reportsGeoJson,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 42,
        });
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'catch-reports',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#0D9488',
            'circle-radius': 17,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });
        map.addLayer({
          id: 'unclustered-report',
          type: 'circle',
          source: 'catch-reports',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['case', ['==', ['get', 'outcome'], 'no_bite'], '#64748B', '#E11D48'],
            'circle-radius': 7,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
          },
        });
      }

      if (!map.getSource('offline-regions')) {
        map.addSource('offline-regions', { type: 'geojson', data: offlineRegionsGeoJson });
        map.addLayer({
          id: 'offline-regions-downloaded-fill',
          type: 'fill',
          source: 'offline-regions',
          filter: ['==', ['get', 'kind'], 'downloaded'],
          paint: {
            'fill-color': '#0D9488',
            'fill-opacity': 0.09,
          },
        });
        map.addLayer({
          id: 'offline-regions-downloaded',
          type: 'line',
          source: 'offline-regions',
          filter: ['==', ['get', 'kind'], 'downloaded'],
          paint: {
            'line-color': '#0D9488',
            'line-width': 2,
            'line-opacity': 0.78,
          },
        });
        map.addLayer({
          id: 'offline-regions-preview-fill',
          type: 'fill',
          source: 'offline-regions',
          filter: ['==', ['get', 'kind'], 'preview'],
          paint: {
            'fill-color': '#0284C7',
            'fill-opacity': 0.14,
          },
        });
        map.addLayer({
          id: 'offline-regions-preview',
          type: 'line',
          source: 'offline-regions',
          filter: ['==', ['get', 'kind'], 'preview'],
          paint: {
            'line-color': '#0284C7',
            'line-width': 2.5,
            'line-dasharray': [3, 2],
          },
        });
      }
    };

    const syncViewportBounds = () => {
      const b = map.getBounds();
      const center = b.getCenter();
      setMapCenter({
        lat: Number(center.lat.toFixed(5)),
        lng: Number(center.lng.toFixed(5)),
      });
      // Clamp viewport span to <= ~0.28 deg so tile count remains brisk and safe
      const halfLat = Math.min(0.14, Math.max(0.03, (b.getNorth() - b.getSouth()) / 2));
      const halfLng = Math.min(0.22, Math.max(0.04, (b.getEast() - b.getWest()) / 2));
      setViewportBbox({
        north: Number((center.lat + halfLat).toFixed(4)),
        south: Number((center.lat - halfLat).toFixed(4)),
        east: Number((center.lng + halfLng).toFixed(4)),
        west: Number((center.lng - halfLng).toFixed(4)),
      });
    };

    map.on('load', () => {
      initLayers();
      syncViewportBounds();
      setMapReady(true);
    });

    map.on('moveend', syncViewportBounds);

    map.on('style.load', () => {
      initLayers();
    });

    map.on('click', 'water-bodies-fill', (e: maplibregl.MapLayerMouseEvent) => {
      if (selectingCustomRef.current) return;
      if (pickDepthRef.current && onPickRef.current) {
        onPickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        return;
      }
      const feature = e.features?.[0];
      const wbId = feature?.properties?.id as string | undefined;
      if (wbId) {
        const found = waterBodiesRef.current.find((w) => w.id === wbId);
        if (found) onSelectRef.current(found);
      }
    });

    map.on('click', 'unclustered-report', (e: maplibregl.MapLayerMouseEvent) => {
      if (selectingCustomRef.current) return;
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const coords = f.geometry.coordinates as [number, number];
      const p = f.properties as {
        species?: string;
        outcome?: string;
        author?: string;
        bait?: string;
        water_body?: string;
      };
      const headline =
        p.outcome === 'no_bite'
          ? `Отметка рыбака — клёва не было (${p.species ?? 'Рыба'})`
          : `По отметкам рыбаков — клюёт: ${p.species ?? 'Рыба'}`;
      new maplibregl.Popup({ offset: 12 })
        .setLngLat(coords)
        .setHTML(
          `<div class="text-xs text-slate-800">
            <div class="font-bold text-slate-900">${headline}</div>
            <div class="mt-1 text-slate-600">${p.water_body ?? ''}</div>
            <div class="mt-0.5 text-slate-600">Приманка: ${p.bait ?? '—'}</div>
            <div class="mt-0.5 text-slate-500">Автор: ${p.author ?? ''}</div>
          </div>`
        )
        .addTo(map);
    });

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      if (selectingCustomRef.current) return;
      if (pickDepthRef.current && onPickRef.current) {
        onPickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Lock map dragPan while dragging a custom offline area box
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (isSelectingCustomArea) {
      map.dragPan.disable();
    } else {
      map.dragPan.enable();
    }
    return () => {
      map.dragPan.enable();
    };
  }, [mapReady, isSelectingCustomArea]);

  // Update GeoJSON data reactively
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource('water-bodies') as maplibregl.GeoJSONSource | undefined)?.setData(waterGeoJson);
    (map.getSource('bathymetry-contours') as maplibregl.GeoJSONSource | undefined)?.setData(contoursGeoJson);
    (map.getSource('bathymetry-points') as maplibregl.GeoJSONSource | undefined)?.setData(depthPointsGeoJson);
    (map.getSource('prospective-zones') as maplibregl.GeoJSONSource | undefined)?.setData(zonesGeoJson);
    (map.getSource('catch-reports') as maplibregl.GeoJSONSource | undefined)?.setData(reportsGeoJson);
    (map.getSource('split-route') as maplibregl.GeoJSONSource | undefined)?.setData(routeGeoJson);
    (map.getSource('access-pins') as maplibregl.GeoJSONSource | undefined)?.setData(accessPinGeoJson);
    (map.getSource('offline-regions') as maplibregl.GeoJSONSource | undefined)?.setData(offlineRegionsGeoJson);
  }, [mapReady, waterGeoJson, contoursGeoJson, depthPointsGeoJson, zonesGeoJson, reportsGeoJson, routeGeoJson, accessPinGeoJson, offlineRegionsGeoJson]);

  // Layer visibility toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const setVis = (id: string, on: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      }
    };
    setVis('contours-line', layers.contours);
    setVis('bathymetry-heatmap', layers.heatmap);
    setVis('prospective-circles', layers.prospective);
    setVis('openseamap-tiles', layers.openSeaMap && isOnline);
    setVis('opentopo-tiles', layers.topoOverlay && isOnline);
  }, [mapReady, layers, isOnline]);

  // User-uploaded historic / pre-flood riverbed map image overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const sourceId = 'historic-map-source';
    const layerId = 'historic-map-layer';

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (
      historicOverlay &&
      selectedWaterBody &&
      historicOverlay.waterBodyId === selectedWaterBody.id &&
      historicOverlay.imageUrl.startsWith('data:image/')
    ) {
      map.addSource(sourceId, {
        type: 'image',
        url: historicOverlay.imageUrl,
        coordinates: historicOverlay.bounds,
      });
      const beforeId = map.getLayer('water-bodies-outline') ? 'water-bodies-outline' : undefined;
      map.addLayer(
        {
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': Math.max(0.05, Math.min(1, layers.historicOpacity)),
            'raster-fade-duration': 0,
          },
        },
        beforeId
      );
    }

    return () => {
      if (!mapRef.current) return;
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // Ignore cleanup errors when map is unmounting
      }
    };
  }, [mapReady, historicOverlay, selectedWaterBody?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer('historic-map-layer')) {
      map.setPaintProperty(
        'historic-map-layer',
        'raster-opacity',
        Math.max(0.05, Math.min(1, layers.historicOpacity))
      );
    }
  }, [mapReady, layers.historicOpacity]);

  // Crisp DOM Markers for isobath depth badges, prospective drop-offs/holes, and route parking pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    if (layers.contours && activeContours.length > 0) {
      const labeledDepths = new Set<number>();
      for (const contour of activeContours) {
        if (labeledDepths.size >= 5) break;
        if (labeledDepths.has(contour.depth_m) || contour.coordinates.length < 2) continue;
        labeledDepths.add(contour.depth_m);
        const mid = contour.coordinates[Math.floor(contour.coordinates.length / 2)];
        const el = document.createElement('div');
        el.className =
          'rounded bg-sky-900/85 px-1 py-0.5 text-[9px] font-mono font-bold text-white shadow-xs pointer-events-none';
        el.textContent = `${contour.depth_m}м`;
        markersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([mid[0], mid[1]])
            .addTo(map)
        );
      }
    }

    if (layers.prospective) {
      for (const z of prospectiveZones.slice(0, 5)) {
        const el = document.createElement('div');
        el.className =
          'rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900 shadow-sm border border-slate-300 pointer-events-none';
        el.textContent = z.label;
        markersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -8] })
            .setLngLat([z.lng, z.lat])
            .addTo(map)
        );
      }
    }

    if (activeRoute?.access_point) {
      const el = document.createElement('div');
      el.className =
        'rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-amber-300 shadow-sm pointer-events-none';
      el.textContent = activeRoute.driving_available ? 'Парковка' : 'Ближайшая дорога';
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 8] })
          .setLngLat([activeRoute.access_point.lng, activeRoute.access_point.lat])
          .addTo(map)
      );
    }
  }, [mapReady, prospectiveZones, activeRoute, layers.prospective, layers.contours, activeContours]);

  // Update base map style when scheme/satellite changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const isSat = layers.baseStyle === 'satellite';
    if (map.getLayer('hydro-background')) {
      map.setPaintProperty('hydro-background', 'background-color', isSat ? '#0F1C24' : '#EAF0F2');
    }
    if (map.getLayer('osm-tiles')) {
      map.setPaintProperty('osm-tiles', 'raster-opacity', isSat ? 0.25 : 0.85);
      map.setPaintProperty('osm-tiles', 'raster-brightness-max', isSat ? 0.55 : 1.0);
    }
  }, [mapReady, layers.baseStyle]);

  // Pan to selected water body
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedWaterBody) return;
    map.easeTo({
      center: [selectedWaterBody.center.lng, selectedWaterBody.center.lat],
      zoom: selectedWaterBody.area_ha > 200 ? 12.2 : 13.6,
      duration: 500,
    });
  }, [mapReady, selectedWaterBody?.id]);

  // Pan to searched geographic place (Photon OSM geocoding result)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusPoint) return;
    map.easeTo({
      center: [focusPoint.lng, focusPoint.lat],
      zoom: focusPoint.zoom ?? 11.5,
      duration: 550,
    });
  }, [mapReady, focusPoint?.ts]);

  return (
    <div className="relative h-full min-h-[400px] w-full overflow-hidden bg-[#EAF0F2] dark:bg-slate-900">
      {/* MapLibre Canvas */}
      <div
        ref={containerRef}
        data-testid="fish-map-canvas"
        className={`h-full w-full ${pickDepthMode || isSelectingCustomArea ? 'cursor-crosshair' : ''}`}
      />

      {/* Software / No-WebGL Graceful Fallback Map */}
      {webglError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#EAF0F2] p-6 text-center dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Интерактивный список водоёмов (режим без WebGL)
          </p>
          <div className="mt-4 grid w-full max-w-md gap-2">
            {waterBodies.slice(0, 6).map((wb) => (
              <button
                key={wb.id}
                type="button"
                onClick={() => onSelectWaterBody(wb)}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-xs font-medium text-slate-800 hover:border-sky-500"
              >
                <span>{wb.display_label}</span>
                <span className="font-mono text-slate-500">{wb.area_ha} га</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Full-canvas pointer-capture overlay for selecting a custom offline region */}
      {isSelectingCustomArea && (
        <div
          data-testid="custom-area-drag-overlay"
          className="absolute inset-0 z-30 cursor-crosshair touch-none select-none bg-sky-900/5"
          onPointerDown={(e) => {
            const map = mapRef.current;
            if (!map) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const rect = e.currentTarget.getBoundingClientRect();
            const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
            const start = { lat: lngLat.lat, lng: lngLat.lng };
            dragAnchorRef.current = start;
            setCustomBbox(normalizeBboxSelection(start, start));
          }}
          onPointerMove={(e) => {
            const map = mapRef.current;
            if (!map || !dragAnchorRef.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
            setCustomBbox(normalizeBboxSelection(dragAnchorRef.current, { lat: lngLat.lat, lng: lngLat.lng }));
          }}
          onPointerUp={(e) => {
            const map = mapRef.current;
            if (map && dragAnchorRef.current) {
              const rect = e.currentTarget.getBoundingClientRect();
              const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
              setCustomBbox(normalizeBboxSelection(dragAnchorRef.current, { lat: lngLat.lat, lng: lngLat.lng }));
            }
            dragAnchorRef.current = null;
            setIsSelectingCustomArea(false);
          }}
          onPointerCancel={() => {
            dragAnchorRef.current = null;
            setIsSelectingCustomArea(false);
          }}
        />
      )}

      {/* Top-Left Layer Switcher, Offline Map Downloader & Quick Controls */}
      <div className={`absolute left-3 top-3 ${isSelectingCustomArea ? 'z-40' : 'z-20'} flex flex-col items-start gap-2`}>
        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={() => {
              setShowLayerMenu((v) => !v);
              setShowOfflineMenu(false);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 md:gap-2 rounded-xl border border-slate-200 bg-white/95 px-2.5 md:px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 whitespace-nowrap"
          >
            <Layers className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            Слои глубин
          </button>

          <button
            type="button"
            onClick={() => {
              onLocateUser?.();
              mapRef.current?.easeTo({
                center: [userOrigin.lng, userOrigin.lat],
                zoom: 11.4,
                duration: 400,
              });
            }}
            aria-label="Центрировать на моей позиции"
            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white/95 px-2.5 md:px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          </button>

          {onDiscoverNearby && hasWaterBodiesNearCenter && !isSelectingCustomArea && (
            <button
              type="button"
              data-testid="map-discover-osm-mobile-btn"
              disabled={discoveringOsm || !isOnline}
              onClick={() => void onDiscoverNearby(mapCenter)}
              aria-label="Загрузить водоёмы из OSM в текущей области"
              title="Найти водоёмы OSM в этой области"
              className="md:hidden inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-sky-600/35 bg-white/95 px-2.5 py-2 text-xs font-semibold text-sky-800 shadow-sm backdrop-blur hover:bg-sky-50 disabled:opacity-60 dark:border-sky-500/40 dark:bg-slate-900/95 dark:text-sky-300"
            >
              {discoveringOsm ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Compass className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {/* Desktop & Tablet Row 2 (below search bar y-level): Offline Maps + Bite Alerts + OSM Refresh */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowOfflineMenu((v) => !v);
              setShowLayerMenu(false);
            }}
            data-testid="offline-maps-trigger"
            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition-colors whitespace-nowrap ${
              showOfflineMenu || offlineRegions.length > 0
                ? 'border-teal-600/35 bg-white/95 text-slate-900 dark:border-teal-500/40 dark:bg-slate-900/95 dark:text-slate-100'
                : 'border-slate-200 bg-white/95 text-slate-800 hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100'
            }`}
          >
            <Download className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" aria-hidden="true" />
            <span>Офлайн-карты</span>
            {offlineRegions.length > 0 && (
              <span className="font-mono font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                ({offlineRegions.length})
              </span>
            )}
          </button>

          {onOpenAlerts && (
            <button
              type="button"
              onClick={onOpenAlerts}
              data-testid="alerts-trigger-map"
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur transition-colors whitespace-nowrap ${
                alertsEnabled
                  ? 'border-sky-600/35 bg-white/95 text-sky-800 dark:border-sky-500/40 dark:bg-slate-900/95 dark:text-sky-300'
                  : 'border-slate-200 bg-white/95 text-slate-800 hover:bg-white dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100'
              }`}
            >
              <Bell className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              <span>Уведомления F</span>
            </button>
          )}

          {onDiscoverNearby && hasWaterBodiesNearCenter && !isSelectingCustomArea && (
            <button
              type="button"
              data-testid="map-discover-osm-btn"
              disabled={discoveringOsm || !isOnline}
              onClick={() => void onDiscoverNearby(mapCenter)}
              title="Найти водохранилища, озёра и реки из OpenStreetMap в текущей области карты"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-sky-600/30 bg-white/95 px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-sm backdrop-blur transition-colors hover:border-sky-600 hover:bg-sky-50 disabled:opacity-60 dark:border-sky-500/40 dark:bg-slate-900/95 dark:text-sky-300 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {discoveringOsm ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-700 dark:text-sky-400" aria-hidden="true" />
              ) : (
                <Compass className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" aria-hidden="true" />
              )}
              <span>{discoveringOsm ? 'Поиск в OSM...' : 'Найти водоёмы'}</span>
            </button>
          )}
        </div>

        {showLayerMenu && (
          <div className="w-64 rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Подложка карты</div>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onToggleLayers({ ...layers, baseStyle: 'scheme' })}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  layers.baseStyle === 'scheme'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Схема
              </button>
              <button
                type="button"
                onClick={() => onToggleLayers({ ...layers, baseStyle: 'satellite' })}
                className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                  layers.baseStyle === 'satellite'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Спутник
              </button>
            </div>

            <div className="mt-3 space-y-2 text-xs text-slate-700 dark:text-slate-300">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Изобаты с подписями</span>
                <input
                  type="checkbox"
                  checked={layers.contours}
                  onChange={(e) => onToggleLayers({ ...layers, contours: e.target.checked })}
                  className="h-4 w-4 accent-sky-700"
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Тепловая карта глубин</span>
                <input
                  type="checkbox"
                  checked={layers.heatmap}
                  onChange={(e) => onToggleLayers({ ...layers, heatmap: e.target.checked })}
                  className="h-4 w-4 accent-sky-700"
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Бровки и ямы (расчёт)</span>
                <input
                  type="checkbox"
                  checked={layers.prospective}
                  onChange={(e) => onToggleLayers({ ...layers, prospective: e.target.checked })}
                  className="h-4 w-4 accent-sky-700"
                />
              </label>

              <div className="border-t border-slate-100 pt-2 dark:border-slate-800 space-y-2">
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  Внешние слои (онлайн)
                </div>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>OpenSeaMap (фарватер / знаки)</span>
                  <input
                    type="checkbox"
                    checked={layers.openSeaMap}
                    disabled={!isOnline}
                    onChange={(e) => onToggleLayers({ ...layers, openSeaMap: e.target.checked })}
                    className="h-4 w-4 accent-sky-700 disabled:opacity-40"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>Топо-рельеф (OpenTopoMap)</span>
                  <input
                    type="checkbox"
                    checked={layers.topoOverlay}
                    disabled={!isOnline}
                    onChange={(e) => onToggleLayers({ ...layers, topoOverlay: e.target.checked })}
                    className="h-4 w-4 accent-sky-700 disabled:opacity-40"
                  />
                </label>
              </div>

              {historicOverlay && selectedWaterBody?.id === historicOverlay.waterBodyId && (
                <div className="border-t border-slate-100 pt-2 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                    <span>Старая карта русла</span>
                    <span className="font-mono">{Math.round(layers.historicOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={Math.round(layers.historicOpacity * 100)}
                    onChange={(e) =>
                      onToggleLayers({
                        ...layers,
                        historicOpacity: Number(e.target.value) / 100,
                      })
                    }
                    className="w-full accent-amber-600"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Offline Map Regions Downloader Panel */}
        {showOfflineMenu && !isSelectingCustomArea && (
          <section
            aria-label="Загрузка офлайн-регионов карты"
            data-testid="offline-maps-panel"
            className="w-[calc(100vw-24px)] sm:w-[332px] max-h-[65vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Офлайн-регионы карты
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Сохраняет плитки ландшафта в IndexedDB для просмотра и навигации без интернета
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSelectingCustomArea(false);
                  setShowOfflineMenu(false);
                }}
                aria-label="Закрыть панель офлайн-карт"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="offline-region-select" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Область для загрузки
              </label>
              <select
                id="offline-region-select"
                value={selectedPresetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedPresetId(nextId);
                  if (nextId !== 'custom') {
                    setIsSelectingCustomArea(false);
                  }
                  if (nextId !== 'viewport' && nextId !== 'custom') {
                    const found = PRESET_MAP_REGIONS.find((r) => r.id === nextId);
                    if (found && mapRef.current) {
                      mapRef.current.fitBounds(
                        [
                          [found.bbox.west, found.bbox.south],
                          [found.bbox.east, found.bbox.north],
                        ],
                        { padding: 36, duration: 400 }
                      );
                    }
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="viewport">Текущий экран карты</option>
                <option value="custom">Выделенная область на карте</option>
                {PRESET_MAP_REGIONS.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                data-testid="select-custom-area-btn"
                onClick={() => {
                  setSelectedPresetId('custom');
                  setIsSelectingCustomArea((prev) => !prev);
                }}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  isSelectingCustomArea
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-sky-600/30 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-300'
                }`}
              >
                {isSelectingCustomArea
                  ? 'Зажмите и проведите рамку по карте… (отмена)'
                  : 'Выделить область рамкой на карте'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setDetailMode('standard')}
                className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                  detailMode === 'standard'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Обзор (z10–13)
              </button>
              <button
                type="button"
                onClick={() => setDetailMode('detailed')}
                className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                  detailMode === 'detailed'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Детально (z11–14)
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
              <span>~{estimatedTiles} плиток · ~{estimatedMb} МБ</span>
              <span>Водоёмов: {waterBodiesInTarget}</span>
            </div>

            <div
              data-testid="idb-tiles-stats"
              className="flex items-center justify-between rounded-lg bg-slate-100/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 tabular-nums"
            >
              <span>IndexedDB хранилище</span>
              <span className="font-mono font-semibold">
                {idbStats.count} плит. ({(idbStats.totalBytes / (1024 * 1024)).toFixed(1)} МБ)
              </span>
            </div>

            {downloadProgress ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-sky-800 dark:text-sky-300 tabular-nums">
                  <span>Загрузка плиток в IndexedDB…</span>
                  <span>
                    {downloadProgress.done} / {downloadProgress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full bg-teal-600 transition-all"
                    style={{
                      width: `${Math.round((downloadProgress.done / Math.max(1, downloadProgress.total)) * 100)}%`,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => downloadAbortRef.current?.abort()}
                  className="w-full rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  Отменить загрузку
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!isOnline}
                onClick={() => {
                  const controller = new AbortController();
                  downloadAbortRef.current = controller;
                  setDownloadProgress({ done: 0, total: estimatedTiles });
                  void onDownloadOfflineRegion({
                    id: activeDownloadTarget.id,
                    name: activeDownloadTarget.name,
                    bbox: activeDownloadTarget.bbox,
                    minZoom,
                    maxZoom,
                    signal: controller.signal,
                    onProgress: (done, total) => setDownloadProgress({ done, total }),
                  }).finally(() => {
                    setDownloadProgress(null);
                    downloadAbortRef.current = null;
                    void offlineDb.getMapTilesStats().then(setIdbStats);
                  });
                }}
                className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {isOnline ? 'Скачать область в IndexedDB' : 'Подключитесь к сети для загрузки'}
              </button>
            )}

            {/* Downloaded regions list */}
            <div className="border-t border-slate-100 pt-2.5 dark:border-slate-800">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Скачанные области ({offlineRegions.length})
              </div>
              {offlineRegions.length > 0 ? (
                <div className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {offlineRegions.map((reg) => (
                    <div key={reg.id} className="flex items-center justify-between gap-2 px-2.5 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                          <span className="truncate">{reg.name}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {reg.cached_tiles}/{reg.tile_count} плит. · водоёмов: {reg.water_body_ids.length} · z{reg.min_zoom}–{reg.max_zoom}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            mapRef.current?.fitBounds(
                              [
                                [reg.bbox.west, reg.bbox.south],
                                [reg.bbox.east, reg.bbox.north],
                              ],
                              { padding: 36, duration: 400 }
                            );
                          }}
                          aria-label={`Показать регион ${reg.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sky-700 hover:bg-slate-100 dark:text-sky-400 dark:hover:bg-slate-800"
                        >
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void onDeleteOfflineRegion(reg).then(() =>
                              offlineDb.getMapTilesStats().then(setIdbStats)
                            )
                          }
                          aria-label={`Удалить регион ${reg.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Области ещё не загружены. Выделите участок карты и скачайте плитки перед выездом без связи.
                </p>
              )}
            </div>
          </section>
        )}

        {isSelectingCustomArea && (
          <div
            data-testid="custom-area-selection-banner"
            className="flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50/95 px-3 py-2 text-xs font-semibold text-sky-900 shadow-sm backdrop-blur"
          >
            <span>Проведите прямоугольник по карте для области</span>
            <button
              type="button"
              onClick={() => {
                dragAnchorRef.current = null;
                setIsSelectingCustomArea(false);
              }}
              className="rounded-lg border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
            >
              Отмена
            </button>
          </div>
        )}

        {pickDepthMode && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-sm">
            Нажмите на карту водоёма, чтобы поставить точку глубины
          </div>
        )}
      </div>

      {/* Mobile (< md) Top-Right Offline Maps Trigger (clear of GoodBite trigger and search bar) */}
      <div className="md:hidden absolute right-3 top-3 z-20">
        <button
          type="button"
          onClick={() => {
            setShowOfflineMenu((v) => !v);
            setShowLayerMenu(false);
          }}
          aria-label="Офлайн-карты регионов"
          data-testid="offline-maps-trigger-mobile"
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-xl border border-teal-600/35 bg-white/95 text-teal-700 shadow-sm backdrop-blur hover:bg-white dark:border-teal-500/40 dark:bg-slate-900/95 dark:text-teal-400"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Empty-area prompt: Discover OSM water bodies around current map center */}
      {onDiscoverNearby && !hasWaterBodiesNearCenter && !isSelectingCustomArea && (
        <div className="pointer-events-none absolute top-[110px] sm:top-[64px] left-1/2 z-20 -translate-x-1/2">
          <button
            type="button"
            data-testid="map-discover-nearby-btn"
            disabled={discoveringOsm || !isOnline}
            onClick={() => void onDiscoverNearby(mapCenter)}
            className="pointer-events-auto inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-sky-600/30 bg-white/95 px-4 py-2 text-xs font-semibold text-sky-800 shadow-lg backdrop-blur transition-colors hover:border-sky-600 hover:bg-sky-50 disabled:opacity-60 dark:border-sky-500/40 dark:bg-slate-900/95 dark:text-sky-300 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            {discoveringOsm ? (
              <Loader2 className="h-4 w-4 animate-spin text-sky-700 dark:text-sky-400" aria-hidden="true" />
            ) : (
              <Compass className="h-4 w-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
            )}
            <span>
              {discoveringOsm
                ? 'Ищем водоёмы в OSM...'
                : isOnline
                  ? 'Найти водоёмы поблизости'
                  : 'Найти водоёмы поблизости (нужна сеть)'}
            </span>
          </button>
        </div>
      )}

      {/* Bottom-Left Mandatory Bathymetry Disclaimer & Yandex Attribution / Open in Maps (FR-2.3, FR-9.7) */}
      <div className="pointer-events-auto absolute bottom-[92px] lg:bottom-3 left-3 z-10 flex flex-col gap-1.5 max-w-[calc(100%-24px)] md:max-w-[260px] lg:max-w-[265px] xl:max-w-none">
        <div
          data-testid="bathymetry-disclaimer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300"
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>Не для навигации. Данные приблизительные · Seascape / OSM</span>
        </div>

        <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/90 bg-white/90 px-2.5 py-1 text-[11px] text-slate-600 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300">
          <span>© Яндекс Карты · © OpenStreetMap</span>
          <a
            href={
              activeRoute?.yandex_maps_url ??
              `https://yandex.ru/maps/?ll=${(selectedWaterBody?.center.lng ?? userOrigin.lng).toFixed(4)},${(selectedWaterBody?.center.lat ?? userOrigin.lat).toFixed(4)}&z=13`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline dark:text-sky-400"
          >
            <Navigation2 className="h-3 w-3" aria-hidden="true" />
            Открыть в Картах
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
};
