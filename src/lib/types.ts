export type WaterBodyType = 'reservoir' | 'river' | 'lake' | 'pond' | 'quarry' | 'oxbow';
export type DataSourceType = 'registry' | 'osm' | 'google_places' | 'satellite' | 'user';
export type ModerationStatus = 'verified' | 'unverified';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BathymetryContour {
  depth_m: number;
  coordinates: [number, number][]; // [lng, lat][]
}

export interface BathymetryPoint {
  id: string;
  water_body_id: string;
  lat: number;
  lng: number;
  depth_m: number;
  source: 'seascape' | 'manual' | 'sonar';
  user_id?: string;
  created_at: string;
  confidence: number;
}

export interface ProspectiveZone {
  id: string;
  kind: 'dropoff' | 'hole';
  label: string;
  lat: number;
  lng: number;
  depth_m: number;
  gradient_m_per_10m?: number;
}

export interface WaterBodyAccessPoint {
  id: string;
  water_body_id: string;
  lat: number;
  lng: number;
  type: 'parking' | 'road_end' | 'settlement' | 'transport_stop';
  source: 'osm' | 'user' | 'satellite';
  confidence: number;
  unpaved: boolean;
  driving_reachable: boolean;
  notes: string;
}

export interface WaterBodyAnalysis {
  id: string;
  water_body_id: string;
  analyzed_at: string;
  fish_probability: 'low' | 'medium' | 'high';
  score: number;
  reasons: { factor: string; impact: '+' | '-' | '0'; detail: string }[];
  recommendation: string;
  disclaimer: string;
  satellite_snapshot_date: string;
  model_version: string;
}

export type FishAbundance = 'common' | 'regular' | 'rare';
export type SpeciesVerificationStatus = 'confirmed' | 'absent';

export interface WaterBodyInhabitingSpecies {
  species_id: string;
  abundance: FishAbundance;
  note?: string;
}

export interface VerifiedSpeciesEntry {
  species_id: string;
  status: SpeciesVerificationStatus;
  abundance?: FishAbundance;
  confirm_count: number;
  absent_count: number;
  confirmed_by?: string[];
  absent_by?: string[];
  note?: string;
  updated_at: string;
  last_author?: string;
}

export interface WaterBodyFishPresence {
  species_id: string;
  species_name: string;
  category: 'predator' | 'peaceful';
  abundance: FishAbundance;
  source: 'confirmed_report' | 'verified_community' | 'catalog' | 'ecological_model';
  confirm_count?: number;
  absent_count?: number;
  note?: string;
}

export interface WaterBody {
  id: string;
  name: string | null;
  display_label: string;
  type: WaterBodyType;
  center: LatLng;
  polygon: [number, number][]; // [lng, lat][] closed ring
  polygon_rings?: [number, number][][]; // Optional [outer, ...holes] closed rings for reservoirs with islands
  polygon_parts?: [number, number][][][]; // Optional GeoJSON MultiPolygon parts ([outer, ...holes][]) for multi-basin waters
  river_lines?: [number, number][][]; // Optional exact river channel centerlines ([lng, lat][][]) so rivers highlight water, not land
  geometry_quality?: 'exact' | 'centerline' | 'approximate'; // Distinguishes real OSM contours from point placeholders
  area_ha: number;
  source: DataSourceType;
  confidence: number; // 0..1
  moderation_status: ModerationStatus;
  connected_to: string | null;
  connected_name?: string | null;
  has_bathymetry: boolean;
  max_depth_m: number | null;
  avg_depth_m: number | null;
  depth_source?: 'osm' | 'sonar' | 'catalog' | 'estimated';
  fishing_access?: 'allowed' | 'paid' | 'forbidden' | 'unknown';
  fishing_access_note?: string;
  region: string;
  external_id?: string;
  google_place_id?: string;
  google_maps_uri?: string;
  ndwi_stability: 'year_round' | 'seasonal_low' | 'dries_summer';
  vegetation_index: 'low' | 'moderate' | 'algal_bloom';
  water_clarity: 'clear' | 'moderate' | 'murky';
  contours?: BathymetryContour[];
  target_zone?: LatLng;
  inhabiting_species?: WaterBodyInhabitingSpecies[];
  verified_species?: VerifiedSpeciesEntry[];
}

export interface NearbyWaterBody {
  water_body: WaterBody;
  straight_distance_m: number;
  driving_distance_m: number | null;
  driving_duration_s: number | null;
  walking_distance_m: number;
  walking_duration_s: number;
  driving_available: boolean;
}

export interface LureArchetype {
  id: string;
  lure_type: string;
  category: 'джиг' | 'воблер' | 'блесна' | 'фидер' | 'поплавок' | 'мормышка' | 'балансир';
  depth_min_m: number;
  depth_max_m: number;
  best_seasons: number[]; // 1..12
  best_clarity: ('clear' | 'moderate' | 'murky')[];
  water_types: WaterBodyType[];
  retrieve: string;
  rationale: string;
  source: 'editorial' | 'lurepassion' | 'crowd';
  base_rank: number;
}

export type LunarPreference = 'dark_moon' | 'bright_moon' | 'balanced';

export interface FishSpecies {
  id: string;
  name: string;
  latin_name: string;
  category: 'predator' | 'peaceful';
  water_types: WaterBodyType[];
  depth_range_m: [number, number];
  optimal_water_temp_c: [number, number];
  time_of_day: string;
  active_hours?: number[]; // local hours 0..23 when species actively feeds
  lunar_preference?: LunarPreference;
  season_activity: Record<number, number>; // month 1..12 -> 0..100
  min_legal_size_cm: number | null;
  release_note: string;
  lures: LureArchetype[];
}

export interface LureRecommendationResult {
  lure: LureArchetype;
  score: number;
  reasons: string[];
}

export interface HourlyWeatherPoint {
  time: string; // ISO local/UTC timestamp
  temp_c: number;
  pressure_hpa: number;
  wind_speed_ms: number;
  wind_gusts_ms?: number;
  wind_direction_deg: number;
  cloud_cover_pct: number;
  shortwave_radiation_wm2?: number;
  precipitation_mm: number;
}

export interface WeatherSnapshot {
  lat: number;
  lng: number;
  captured_at: string;
  pressure_hpa: number;
  pressure_mmhg: number;
  pressure_trend: 'rising' | 'steady' | 'falling';
  pressure_delta_6h?: number; // hPa change over last 6h
  pressure_stability_48h?: number; // 0..1 (1 = rock steady over 48h)
  air_temp_c: number;
  air_temp_delta_48h_c?: number; // °C change vs same hour 48h ago
  water_temp_c: number;
  avg_air_temp_7d_c?: number;
  avg_air_temp_14d_c?: number;
  wind_speed_ms: number;
  wind_gusts_ms?: number;
  wind_direction_deg: number;
  wind_direction_label: string;
  cloud_cover_pct?: number; // 0..100
  shortwave_radiation_wm2?: number; // W/m² solar irradiance
  precipitation_mm: number;
  recent_rain_72h_mm?: number; // cumulative mm over past 72h
  river_discharge_m3s?: number; // Open-Meteo Flood API daily discharge
  river_discharge_ratio?: number; // current / 14d baseline ratio
  river_discharge_trend?: 'rising_fast' | 'rising' | 'steady' | 'falling';
  moon_phase: string;
  moon_illumination: number;
  hourly?: HourlyWeatherPoint[];
  source: 'open-meteo' | 'open-meteo-cached' | 'offline-fallback';
}

export type SlotPressureTrend = 'sharp_drop' | 'falling' | 'steady' | 'rising' | 'sharp_rise';

export interface BiteForecastSlot {
  date: string; // YYYY-MM-DD
  day_label: string;
  hour_interval: string; // e.g. '06:00'
  f_index: number; // 0..100
  probability_label: 'высокая вероятность' | 'средняя вероятность' | 'низкая вероятность';
  factors: string[];
  temp_c?: number;
  wind_speed_ms?: number;
  wind_gusts_ms?: number;
  pressure_mmhg?: number;
  pressure_hpa?: number;
  pressure_delta_6h?: number;
  pressure_delta_12h?: number;
  pressure_trend?: SlotPressureTrend;
  cloud_cover_pct?: number;
  radiation_wm2?: number;
  moon_phase_label?: string;
  moon_illumination?: number;
  solunar_window?: 'major' | 'minor' | null;
  active_hour_match?: 'peak' | 'active' | 'off_peak';
}

export interface BiteForecastResponse {
  lat: number;
  lng: number;
  fish_id: string;
  fish_name: string;
  water_body_id?: string | null;
  source: 'actigator' | 'open-meteo-fallback';
  cached: boolean;
  disclaimer: string;
  slots: BiteForecastSlot[];
  confidence_level?: 'high' | 'medium' | 'low';
  confidence_score?: number; // 0..100
  confidence_label?: string;
  calibration_delta?: number;
  calibration_reports_used?: number;
  regime?: 'open_water' | 'ice';
  sunrise?: string;
  sunset?: string;
  estimated_water_temp_c?: number;
  bio_phase_label?: string | null;
  ice_phase?: 'first_ice' | 'midwinter' | 'last_ice' | null;
  oxygen_risk?: 'normal' | 'moderate' | 'high';
  oxygen_label?: string | null;
  hydrology_label?: string | null;
  windward_shore_hint?: string | null;
  adaptive_factors_note?: string | null;
  lunar_summary?: string | null;
}

export interface GoodBiteWaterBodyItem {
  water_body: WaterBody;
  distance_km: number;
  f_index: number;
  probability_label: BiteForecastSlot['probability_label'];
  best_species_id: string;
  best_species_name: string;
  peak_hour: string;
  day_label: 'Сегодня' | 'Завтра';
  recent_reports_count: number;
  reasons: string[];
}

export type ReportVisibility = 'public' | 'friends' | 'private';
export type ReportSource = 'quick_mark' | 'diary';
export type ReportOutcome = 'catch' | 'no_bite';

export interface ReportWeatherVector {
  pressure_hpa: number;
  pressure_trend: 'rising' | 'steady' | 'falling';
  pressure_delta_6h?: number;
  water_temp_c: number;
  air_temp_c: number;
  wind_speed_ms: number;
  wind_direction_label: string;
  cloud_cover_pct?: number;
  precipitation_mm: number;
  hour_local?: number;
}

export interface CatchReport {
  id: string;
  client_event_id: string;
  user_id: string;
  author_nickname: string;
  author_verified: boolean;
  water_body_id: string | null;
  water_body_name: string;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
  fish_species_id: string;
  fish_species_name: string;
  outcome?: ReportOutcome;
  weight_kg: number | null;
  length_cm: number | null;
  depth_m?: number | null;
  gps_accuracy_m?: number | null;
  bait: string;
  retrieve: string;
  weather_summary: string;
  weather_snapshot?: ReportWeatherVector;
  predicted_f_index?: number | null;
  photo_url: string | null;
  notes: string;
  visibility: ReportVisibility;
  source: ReportSource;
}

export interface RouteSegment {
  mode: 'driving' | 'walking';
  distance_m: number;
  duration_s: number;
  geometry: [number, number][]; // [lng, lat][]
}

export interface RouteMultiResult {
  water_body_id: string;
  access_point: WaterBodyAccessPoint | null;
  target_point: LatLng;
  driving_available: boolean;
  driving_segment: RouteSegment | null;
  walking_segment: RouteSegment;
  unavailable_reason?: string;
  yandex_maps_url: string;
  avoid_unpaved: boolean;
  source: 'valhalla-osm' | 'osrm-public' | 'ors-osm' | 'yandex-routing' | 'yandex-fallback-osrm';
  quota_warning?: string;
}

export interface KnotGuide {
  id: string;
  name: string;
  purpose: string;
  line_types: string;
  strength_pct: number;
  difficulty: 'Простой' | 'Средний' | 'Продвинутый';
  steps: string[];
  svg_type: 'palomar' | 'clinch' | 'albright' | 'loop' | 'feeder';
}

export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  verified: boolean;
  privacy_default: ReportVisibility;
  created_at: string;
}

export interface SyncQueueItem {
  local_id: string;
  entity_type: 'report_create' | 'depth_create' | 'water_body_create';
  payload: Record<string, unknown>;
  created_at: string;
  retry_count: number;
  status: 'pending' | 'syncing' | 'conflict' | 'failed';
  error_message?: string;
}

export type BiteAlertScope = 'favorites_and_nearby' | 'favorites_only' | 'nearby_only';

export interface BiteAlertSettings {
  enabled: boolean;
  threshold: number; // 50..95
  scope: BiteAlertScope;
  nearby_radius_km: number;
  last_notified: Record<string, { f_index: number; notified_at: string }>;
}

export interface BiteAlertEvent {
  water_body_id: string;
  water_body_name: string;
  is_favorite: boolean;
  distance_km: number;
  f_index: number;
  best_species_id: string;
  best_species_name: string;
  peak_hour: string;
  title: string;
  body: string;
}

export interface BiteAlertLogEntry {
  id: string;
  water_body_id: string;
  water_body_name: string;
  f_index: number;
  species_name: string;
  peak_hour: string;
  is_favorite: boolean;
  delivered_via: 'pwa' | 'in-app';
  created_at: string;
}

export interface MapBbox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface OfflineMapRegion {
  id: string;
  name: string;
  bbox: MapBbox;
  min_zoom: number;
  max_zoom: number;
  tile_count: number;
  cached_tiles: number;
  size_bytes: number;
  water_body_ids: string[];
  downloaded_at: string;
}

export interface GpxTrackPoint {
  lat: number;
  lng: number;
  ele_m?: number | null;
  time?: string | null;
}

export interface GpxWaypoint {
  name: string;
  lat: number;
  lng: number;
  ele_m?: number | null;
  desc?: string | null;
}

export interface GpxRouteTrack {
  id: string;
  name: string;
  file_name: string;
  description?: string;
  color: string;
  visible: boolean;
  segments: [number, number][][]; // [lng, lat][] per track segment
  waypoints: GpxWaypoint[];
  start_point: LatLng;
  end_point: LatLng;
  bbox: MapBbox;
  distance_m: number;
  duration_s: number | null;
  elevation_gain_m: number | null;
  point_count: number;
  recorded_at: string | null;
  imported_at: string;
}

