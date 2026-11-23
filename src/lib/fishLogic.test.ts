import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBarometricWindow,
  analyzeWaterBody,
  buildBiteForecastMetadata,
  buildSampleSonarCsv,
  buildSplitRouteMetrics,
  computeBiologicalPhase,
  computeFIndexForecast,
  computeHydrologyModifier,
  computeOxygenAndIcePhase,
  computeReportCalibration,
  computeSunTimes,
  computeWaterBodyHabitatModifier,
  computeWindwardShoreHint,
  decodePolyline6,
  detectProspectiveZones,
  estimateWaterTempC,
  evaluateFIndexAlerts,
  evaluateForecastAccuracy,
  evaluateGoodBiteWaterBodies,
  generateBathymetryContours,
  getExpectedFishForWaterBody,
  getWaterBodyImageBounds,
  parseSonarDepthFile,
  pointInWaterBody,
  recommendLures,
  selectBestAccessPoint,
  validateCatchReportInput,
  validateDepthPointInput,
} from './fishLogic';
import {
  computeTileCoordsForBbox,
  estimateRegionTileCount,
  isPointInBbox,
  normalizeBboxSelection,
} from './offlineMapRegions';
import { GPSFilter, snapPointToWaterShore } from './geolocation';
import { parseOsmWaterTags } from '../server/proxies';
import type {
  BathymetryPoint,
  CatchReport,
  FishSpecies,
  GoodBiteWaterBodyItem,
  HourlyWeatherPoint,
  WaterBody,
  WaterBodyAccessPoint,
  WeatherSnapshot,
} from './types';

const sampleSpecies: FishSpecies = {
  id: 'pike',
  name: 'Щука',
  latin_name: 'Esox lucius',
  category: 'predator',
  water_types: ['reservoir', 'river', 'lake', 'pond', 'oxbow'],
  depth_range_m: [1.5, 6.0],
  optimal_water_temp_c: [8, 16],
  time_of_day: 'Утро, сумерки',
  season_activity: { 1: 40, 2: 35, 3: 65, 4: 80, 5: 75, 6: 65, 7: 50, 8: 60, 9: 85, 10: 92, 11: 78, 12: 50 },
  min_legal_size_cm: 32,
  release_note: 'Проверьте правила рыболовства вашего региона (не является юридической консультацией).',
  lures: [
    {
      id: 'jig-vibro',
      lure_type: 'Силиконовый виброхвост 10–12 см',
      category: 'джиг',
      depth_min_m: 2.0,
      depth_max_m: 8.0,
      best_seasons: [9, 10, 11, 4, 5],
      best_clarity: ['clear', 'moderate', 'murky'],
      water_types: ['reservoir', 'river', 'lake'],
      retrieve: 'Ступенчатая проводка 2 оборота — пауза 2 сек',
      rationale: 'Классика по осенним бровкам',
      source: 'editorial',
      base_rank: 9,
    },
    {
      id: 'topwater-popper',
      lure_type: 'Поппер 70 мм',
      category: 'воблер',
      depth_min_m: 0.2,
      depth_max_m: 1.2,
      best_seasons: [6, 7, 8],
      best_clarity: ['clear', 'moderate'],
      water_types: ['pond', 'oxbow', 'lake'],
      retrieve: 'Короткие рывки с паузами',
      rationale: 'Работает по летнему мелководью',
      source: 'lurepassion',
      base_rank: 6,
    },
  ],
};

const sampleWeather: WeatherSnapshot = {
  lat: 55.975,
  lng: 36.825,
  captured_at: '2026-11-13T09:00:00Z',
  pressure_hpa: 1016,
  pressure_mmhg: 762,
  pressure_trend: 'steady',
  air_temp_c: 5,
  water_temp_c: 7.5,
  wind_speed_ms: 3.5,
  wind_direction_deg: 240,
  wind_direction_label: 'ЮЗ',
  precipitation_mm: 0,
  moon_phase: 'Растущая луна',
  moon_illumination: 64,
  source: 'open-meteo',
};

const sampleWaterBody: WaterBody = {
  id: 'wb-1',
  name: 'Пруд у ручья',
  display_label: 'Пруд у ручья',
  type: 'pond',
  center: { lat: 55.98, lng: 36.83 },
  polygon: [[36.829, 55.979], [36.831, 55.979], [36.831, 55.981], [36.829, 55.981], [36.829, 55.979]],
  area_ha: 0.8,
  source: 'satellite',
  confidence: 0.72,
  moderation_status: 'verified',
  connected_to: 'wb-river',
  connected_name: 'р. Истра',
  has_bathymetry: true,
  max_depth_m: 3.2,
  avg_depth_m: 2.2,
  region: 'Московская область',
  ndwi_stability: 'year_round',
  vegetation_index: 'moderate',
  water_clarity: 'moderate',
  target_zone: { lat: 55.9805, lng: 36.8305 },
};

test('computeFIndexForecast generates 56 3-hour slots for 7 days with probabilistic phrasing and barometric trend metadata', () => {
  const slots = computeFIndexForecast({
    species: sampleSpecies,
    weather: sampleWeather,
    baseDate: new Date('2026-11-13T09:00:00Z'),
  });
  assert.equal(slots.length, 56);
  assert.equal(slots[0].day_label, 'Сегодня');
  assert.equal(slots[8].day_label, 'Завтра');
  assert.equal(slots[16].day_label, 'Послезавтра');
  assert.match(slots[24].day_label, /^(Вс|Пн|Вт|Ср|Чт|Пт|Сб), \d{2}\.\d{2}$/);
  assert.equal(new Set(slots.map((s) => s.date)).size, 7);
  for (const s of slots) {
    assert.ok(s.f_index >= 0 && s.f_index <= 100);
    assert.ok(s.probability_label.includes('вероятность'));
    assert.ok(typeof s.pressure_mmhg === 'number');
    assert.ok(typeof s.pressure_trend === 'string');
  }
});

test('analyzeWaterBody classifies connected year-round pond as high and tiny isolated dry pond as low', () => {
  const highRes = analyzeWaterBody({ waterBody: sampleWaterBody, crowdReportCount: 2 });
  assert.equal(highRes.fish_probability, 'high');
  assert.ok(highRes.reasons.some((r) => r.detail.includes('(+)')));
  assert.ok(highRes.disclaimer.includes('не гарантирует'));

  const tinyDryPond: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-tiny',
    connected_to: null,
    area_ha: 0.06,
    ndwi_stability: 'dries_summer',
    max_depth_m: 0.4,
    vegetation_index: 'algal_bloom',
  };
  const lowRes = analyzeWaterBody({ waterBody: tinyDryPond, crowdReportCount: 0 });
  assert.equal(lowRes.fish_probability, 'low');
  assert.ok(lowRes.reasons.some((r) => r.detail.includes('(−)')));
});

test('detectProspectiveZones finds holes and drop-offs from bathymetry points', () => {
  const pts: BathymetryPoint[] = [
    { id: 'p1', water_body_id: 'wb-1', lat: 55.9800, lng: 36.8300, depth_m: 1.5, source: 'seascape', created_at: '', confidence: 0.9 },
    { id: 'p2', water_body_id: 'wb-1', lat: 55.9804, lng: 36.8304, depth_m: 6.2, source: 'seascape', created_at: '', confidence: 0.9 },
    { id: 'p3', water_body_id: 'wb-1', lat: 55.9810, lng: 36.8310, depth_m: 2.1, source: 'manual', created_at: '', confidence: 0.6 },
  ];
  const zones = detectProspectiveZones(pts);
  assert.ok(zones.some((z) => z.kind === 'hole' && z.depth_m === 6.2));
  assert.ok(zones.some((z) => z.kind === 'dropoff'));
});

test('recommendLures ranks seasonal deep jig above summer topwater in November', () => {
  const recs = recommendLures({
    species: sampleSpecies,
    waterBody: { ...sampleWaterBody, type: 'reservoir', avg_depth_m: 4.5 },
    month: 11,
  });
  assert.equal(recs[0].lure.id, 'jig-vibro');
  assert.ok(recs[0].score > recs[1].score);
});

test('selectBestAccessPoint respects avoidUnpaved and picks shortest walking distance', () => {
  const accessPoints: WaterBodyAccessPoint[] = [
    {
      id: 'ap-dirt',
      water_body_id: 'wb-1',
      lat: 55.9804,
      lng: 36.8302,
      type: 'road_end',
      source: 'osm',
      confidence: 0.8,
      unpaved: true,
      driving_reachable: true,
      notes: 'Грунтовка',
    },
    {
      id: 'ap-paved',
      water_body_id: 'wb-1',
      lat: 55.978,
      lng: 36.827,
      type: 'parking',
      source: 'osm',
      confidence: 0.95,
      unpaved: false,
      driving_reachable: true,
      notes: 'Асфальтовая парковка',
    },
  ];

  const pavedOnly = selectBestAccessPoint({
    accessPoints,
    targetPoint: { lat: 55.9805, lng: 36.8305 },
    avoidUnpaved: true,
  });
  assert.equal(pavedOnly.selected?.id, 'ap-paved');
  assert.equal(pavedOnly.drivingAvailable, true);

  const routeUnavailable = buildSplitRouteMetrics({
    origin: { lat: 55.9, lng: 36.7 },
    waterBody: sampleWaterBody,
    accessPoints: [{ ...accessPoints[0], driving_reachable: false }],
    avoidUnpaved: true,
  });
  assert.equal(routeUnavailable.driving_available, false);
  assert.ok(routeUnavailable.unavailable_reason?.includes('Автомобильный маршрут недоступен'));
});

test('validation rejects missing geolocation, out-of-range coordinates, and oversized photos', () => {
  assert.ok(validateCatchReportInput({ lat: null, lng: 36.8, fish_species_id: 'pike' }) !== null);
  assert.ok(validateCatchReportInput({ lat: 95, lng: 36.8, fish_species_id: 'pike' }) !== null);
  assert.ok(
    validateCatchReportInput({
      lat: 55.9,
      lng: 36.8,
      fish_species_id: 'pike',
      photo_size_bytes: 6 * 1024 * 1024,
    }) !== null
  );
  assert.equal(
    validateCatchReportInput({
      lat: 55.9,
      lng: 36.8,
      fish_species_id: 'pike',
      photo_size_bytes: 1024 * 500,
      photo_mime: 'image/jpeg',
    }),
    null
  );
  assert.ok(validateDepthPointInput({ lat: 55.9, lng: 36.8, depth_m: 0 }) !== null);
  assert.equal(validateDepthPointInput({ lat: 55.9, lng: 36.8, depth_m: 4.5 }), null);
});

test('evaluateGoodBiteWaterBodies filters by 100 km radius, ecological suitability, species, and recent reports', () => {
  const origin = { lat: 55.975, lng: 36.825 };
  const reservoirGood: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-good-res',
    display_label: 'Озернинское вдхр.',
    type: 'reservoir',
    center: { lat: 55.775, lng: 36.265 }, // ~41 km
    area_ha: 2300,
    max_depth_m: 18,
    avg_depth_m: 6.5,
  };
  const farAwayRes: WaterBody = {
    ...reservoirGood,
    id: 'wb-far',
    display_label: 'Дальнее вдхр.',
    center: { lat: 57.5, lng: 36.825 }, // ~170 km (> 100 km)
  };
  const shallowDryPond: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-dry',
    display_label: 'Пересыхающий пруд',
    type: 'pond',
    center: { lat: 55.97, lng: 36.82 }, // ~0.6 km
    connected_to: null,
    area_ha: 0.08,
    max_depth_m: 0.4,
    avg_depth_m: 0.3,
    ndwi_stability: 'dries_summer',
    vegetation_index: 'algal_bloom',
  };
  const warmCarp: FishSpecies = {
    ...sampleSpecies,
    id: 'karp',
    name: 'Карп',
    category: 'peaceful',
    water_types: ['pond', 'lake', 'reservoir'],
    optimal_water_temp_c: [18, 25],
    season_activity: { ...sampleSpecies.season_activity, 11: 12 },
  };
  const recentReport: CatchReport = {
    id: 'rep-test',
    client_event_id: 'c-1',
    user_id: 'u-1',
    author_nickname: 'Тест',
    author_verified: true,
    water_body_id: 'wb-good-res',
    water_body_name: 'Озернинское вдхр.',
    lat: 55.775,
    lng: 36.265,
    created_at: '2026-11-13T07:00:00Z',
    updated_at: '2026-11-13T07:00:00Z',
    fish_species_id: 'pike',
    fish_species_name: 'Щука',
    weight_kg: 2.1,
    length_cm: 60,
    bait: 'Джиг',
    retrieve: 'Ступенька',
    weather_summary: '762 мм',
    photo_url: null,
    notes: '',
    visibility: 'public',
    source: 'quick_mark',
  };

  const goodPike = evaluateGoodBiteWaterBodies({
    origin,
    waterBodies: [reservoirGood, farAwayRes, shallowDryPond],
    speciesList: [sampleSpecies, warmCarp],
    weather: sampleWeather,
    reports: [recentReport],
    baseDate: new Date('2026-11-13T09:00:00Z'),
    radiusKm: 100,
    fishId: 'all',
  });

  assert.equal(goodPike.length, 1);
  assert.equal(goodPike[0].water_body.id, 'wb-good-res');
  assert.ok(goodPike[0].distance_km <= 100);
  assert.ok(goodPike[0].f_index >= 66);
  assert.equal(goodPike[0].recent_reports_count, 1);

  const carpOnly = evaluateGoodBiteWaterBodies({
    origin,
    waterBodies: [reservoirGood, farAwayRes, shallowDryPond],
    speciesList: [sampleSpecies, warmCarp],
    weather: sampleWeather,
    reports: [recentReport],
    baseDate: new Date('2026-11-13T09:00:00Z'),
    radiusKm: 100,
    fishId: 'karp',
  });
  assert.equal(carpOnly.length, 0);
});

test('evaluateFIndexAlerts triggers for favorite/nearby above threshold and respects scope and cooldown', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  const items: GoodBiteWaterBodyItem[] = [
    {
      water_body: { ...sampleWaterBody, id: 'wb-fav', display_label: 'Озеро Сенеж' },
      distance_km: 48,
      f_index: 84,
      probability_label: 'высокая вероятность',
      best_species_id: 'pike',
      best_species_name: 'Щука',
      peak_hour: '06:00',
      day_label: 'Сегодня',
      recent_reports_count: 1,
      reasons: [],
    },
    {
      water_body: { ...sampleWaterBody, id: 'wb-near', display_label: 'Река Истра' },
      distance_km: 4.5,
      f_index: 79,
      probability_label: 'высокая вероятность',
      best_species_id: 'nalim',
      best_species_name: 'Налим',
      peak_hour: '00:00',
      day_label: 'Сегодня',
      recent_reports_count: 0,
      reasons: [],
    },
    {
      water_body: { ...sampleWaterBody, id: 'wb-below', display_label: 'Дальний пруд' },
      distance_km: 60,
      f_index: 71,
      probability_label: 'высокая вероятность',
      best_species_id: 'okun',
      best_species_name: 'Окунь',
      peak_hour: '09:00',
      day_label: 'Сегодня',
      recent_reports_count: 0,
      reasons: [],
    },
  ];

  const triggered = evaluateFIndexAlerts({
    items,
    favoriteIds: ['wb-fav'],
    settings: {
      enabled: true,
      threshold: 75,
      scope: 'favorites_and_nearby',
      nearby_radius_km: 25,
      last_notified: {
        'wb-near': { f_index: 78, notified_at: '2026-11-15T09:00:00Z' },
      },
    },
    now,
  });

  // wb-fav passes threshold & favorite; wb-near is within 6h cooldown (+1 delta < 5); wb-below < 75
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].water_body_id, 'wb-fav');
  assert.equal(triggered[0].is_favorite, true);

  const favOnly = evaluateFIndexAlerts({
    items,
    favoriteIds: ['wb-fav'],
    settings: {
      enabled: true,
      threshold: 75,
      scope: 'favorites_only',
      nearby_radius_km: 25,
      last_notified: {},
    },
    now,
  });
  assert.equal(favOnly.length, 1);
  assert.equal(favOnly[0].water_body_id, 'wb-fav');
});

test('offlineMapRegions computes valid slippy tile coordinates and bbox membership', () => {
  const bbox = { north: 56.08, south: 55.89, east: 36.93, west: 36.68 };
  const count = estimateRegionTileCount(bbox, 10, 12);
  const tiles = computeTileCoordsForBbox(bbox, 10, 12);
  assert.equal(tiles.length, count);
  assert.ok(tiles.length > 0 && tiles.length <= 220);
  assert.ok(tiles[0].url.startsWith('https://tile.openstreetmap.org/'));
  assert.equal(isPointInBbox({ lat: 56.012, lng: 36.822 }, bbox), true);
  assert.equal(isPointInBbox({ lat: 54.0, lng: 36.822 }, bbox), false);

  const swapped = normalizeBboxSelection({ lat: 56.05, lng: 36.9 }, { lat: 55.95, lng: 36.7 });
  assert.equal(swapped.north, 56.05);
  assert.equal(swapped.south, 55.95);
  assert.equal(swapped.east, 36.9);
  assert.equal(swapped.west, 36.7);

  const pointBox = normalizeBboxSelection({ lat: 56.0, lng: 36.8 }, { lat: 56.0, lng: 36.8 });
  assert.ok(pointBox.north - pointBox.south >= 0.014);
  assert.ok(pointBox.east - pointBox.west >= 0.014);
});

test('decodePolyline6 decodes precision-6 polylines into [lng, lat] coordinates cleanly', () => {
  // Precision-6 encoded coordinates near Moscow/Istra: (55.755800, 37.617300) -> (55.756800, 37.618300)
  const encodeCoord = (val: number) => Math.round(val * 1e6);
  const encodeSigned = (n: number) => {
    let v = n < 0 ? ~(n << 1) : n << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  const encoded =
    encodeSigned(encodeCoord(55.7558)) +
    encodeSigned(encodeCoord(37.6173)) +
    encodeSigned(encodeCoord(55.7568) - encodeCoord(55.7558)) +
    encodeSigned(encodeCoord(37.6183) - encodeCoord(37.6173));

  const pts = decodePolyline6(encoded);
  assert.equal(pts.length, 2);
  assert.ok(Math.abs(pts[0][0] - 37.6173) < 0.00001);
  assert.ok(Math.abs(pts[0][1] - 55.7558) < 0.00001);
  assert.ok(Math.abs(pts[1][0] - 37.6183) < 0.00001);
  assert.ok(Math.abs(pts[1][1] - 55.7568) < 0.00001);
  assert.deepEqual(decodePolyline6(''), []);
});

test('seed database includes Lama river near Volokolamsk with shore access point', async () => {
  const { SEED_ACCESS_POINTS, SEED_WATER_BODIES } = await import('../data/seedData');
  const lama = SEED_WATER_BODIES.find((w) => w.id === 'wb-lama-volokolamsk');
  assert.ok(lama, 'Expected wb-lama-volokolamsk in SEED_WATER_BODIES');
  assert.ok(lama.display_label.toLowerCase().includes('лама'));
  assert.ok(lama.region.toLowerCase().includes('волоколам'));
  assert.ok(lama.polygon.length >= 4);
  const access = SEED_ACCESS_POINTS.find((ap) => ap.water_body_id === 'wb-lama-volokolamsk');
  assert.ok(access, 'Expected shore access point for wb-lama-volokolamsk');
});

test('buildBathymetryProfile orders points along chosen transect line and computes underwater elevations', async () => {
  const { buildBathymetryProfile } = await import('./fishLogic');
  const pts: BathymetryPoint[] = [
    { id: 'p-east', water_body_id: 'wb-1', lat: 56.014, lng: 36.826, depth_m: 3.0, source: 'sonar', created_at: '', confidence: 0.9 },
    { id: 'p-west', water_body_id: 'wb-1', lat: 56.011, lng: 36.818, depth_m: 2.1, source: 'seascape', created_at: '', confidence: 0.9 },
    { id: 'p-mid', water_body_id: 'wb-1', lat: 56.0125, lng: 36.822, depth_m: 11.4, source: 'manual', created_at: '', confidence: 0.8 },
  ];

  const transect = buildBathymetryProfile(pts, 'transect');
  assert.equal(transect.length, 3);
  assert.equal(transect[0].id, 'p-west');
  assert.equal(transect[0].distance_m, 0);
  assert.equal(transect[1].id, 'p-mid');
  assert.equal(transect[1].bottom_elevation_m, -11.4);
  assert.equal(transect[2].id, 'p-east');
  assert.ok(transect[2].distance_m > 400);

  const southNorth = buildBathymetryProfile(pts, 'south_north');
  assert.equal(southNorth[0].id, 'p-west');
  assert.equal(southNorth[2].id, 'p-east');
  assert.deepEqual(buildBathymetryProfile([], 'transect'), []);
});

test('pointInWaterBody excludes interior island holes from open water', () => {
  const wbWithIsland: Pick<WaterBody, 'polygon' | 'polygon_rings'> = {
    polygon: [
      [36.0, 56.0],
      [36.2, 56.0],
      [36.2, 56.2],
      [36.0, 56.2],
      [36.0, 56.0],
    ],
    polygon_rings: [
      [
        [36.0, 56.0],
        [36.2, 56.0],
        [36.2, 56.2],
        [36.0, 56.2],
        [36.0, 56.0],
      ],
      [
        [36.06, 56.06],
        [36.14, 56.06],
        [36.14, 56.14],
        [36.06, 56.14],
        [36.06, 56.06],
      ],
    ],
  };

  assert.equal(pointInWaterBody({ lat: 56.02, lng: 36.02 }, wbWithIsland), true);
  assert.equal(pointInWaterBody({ lat: 56.1, lng: 36.1 }, wbWithIsland), false);
  assert.equal(pointInWaterBody({ lat: 56.5, lng: 36.5 }, wbWithIsland), false);
});

test('all seed water bodies, contours, bathymetry points, reports, and access points obey real water/shore invariants', async () => {
  const {
    SEED_ACCESS_POINTS,
    SEED_BATHYMETRY_POINTS,
    SEED_DATA_VERSION,
    SEED_REPORTS,
    SEED_WATER_BODIES,
  } = await import('../data/seedData');

  assert.ok(SEED_DATA_VERSION >= 2);

  const retiredIds = [
    'wb-unnamed-pesochnaya',
    'wb-unnamed-rodnik',
    'wb-buzharovo-pond',
    'wb-crowd-unverified',
  ];
  for (const id of retiredIds) {
    assert.equal(SEED_WATER_BODIES.some((w) => w.id === id), false, `Retired ${id} must not exist`);
    assert.equal(
      SEED_ACCESS_POINTS.some((ap) => ap.water_body_id === id),
      false,
      `Access point for retired ${id} must not exist`
    );
    assert.equal(
      SEED_BATHYMETRY_POINTS.some((bp) => bp.water_body_id === id),
      false,
      `Bathymetry for retired ${id} must not exist`
    );
    assert.equal(
      SEED_REPORTS.some((r) => r.water_body_id === id),
      false,
      `Report for retired ${id} must not exist`
    );
  }

  const wbMap = new Map(SEED_WATER_BODIES.map((w) => [w.id, w]));

  for (const wb of SEED_WATER_BODIES) {
    assert.ok(wb.polygon.length >= 4, `${wb.id} must have closed polygon`);
    const first = wb.polygon[0];
    const last = wb.polygon[wb.polygon.length - 1];
    assert.equal(first[0], last[0], `${wb.id} polygon lng must be closed`);
    assert.equal(first[1], last[1], `${wb.id} polygon lat must be closed`);

    assert.equal(pointInWaterBody(wb.center, wb), true, `${wb.id} center must be inside water`);
    if (wb.target_zone) {
      assert.equal(
        pointInWaterBody(wb.target_zone, wb),
        true,
        `${wb.id} target_zone must be inside water`
      );
    }

    if (wb.contours) {
      for (const c of wb.contours) {
        assert.ok(c.coordinates.length >= 4, `${wb.id} contour ${c.depth_m}m must be closed`);
        for (const [lng, lat] of c.coordinates) {
          assert.equal(
            pointInWaterBody({ lat, lng }, wb),
            true,
            `${wb.id} contour ${c.depth_m}m vertex must be inside water`
          );
        }
      }
    }
  }

  for (const bp of SEED_BATHYMETRY_POINTS) {
    const wb = wbMap.get(bp.water_body_id);
    assert.ok(wb, `Bathymetry ${bp.id} missing water body ${bp.water_body_id}`);
    assert.equal(
      pointInWaterBody({ lat: bp.lat, lng: bp.lng }, wb),
      true,
      `Bathymetry ${bp.id} must be inside water of ${wb.id}`
    );
  }

  for (const rep of SEED_REPORTS) {
    assert.ok(rep.water_body_id, `Report ${rep.id} must reference a water body`);
    const wb = wbMap.get(rep.water_body_id);
    assert.ok(wb, `Report ${rep.id} missing water body ${rep.water_body_id}`);
    assert.equal(
      pointInWaterBody({ lat: rep.lat, lng: rep.lng }, wb),
      true,
      `Report ${rep.id} must be inside water of ${wb.id}`
    );
  }

  for (const ap of SEED_ACCESS_POINTS) {
    const wb = wbMap.get(ap.water_body_id);
    assert.ok(wb, `Access point ${ap.id} missing water body ${ap.water_body_id}`);
    assert.equal(
      pointInWaterBody({ lat: ap.lat, lng: ap.lng }, wb),
      false,
      `Shore access point ${ap.id} should stay on shore outside water of ${wb.id}`
    );
  }
});

test('computeSunTimes returns seasonal sunrise and sunset for Moscow/Istra latitude', () => {
  const nov = computeSunTimes(56.02, 36.83, new Date('2026-11-15T12:00:00Z'));
  const jun = computeSunTimes(56.02, 36.83, new Date('2026-06-21T12:00:00Z'));

  assert.ok(nov.sunriseHour >= 7.0 && nov.sunriseHour <= 9.0, `Expected Nov sunrise ~8h, got ${nov.sunriseHour}`);
  assert.ok(nov.sunsetHour >= 15.0 && nov.sunsetHour <= 17.5, `Expected Nov sunset ~16:20, got ${nov.sunsetHour}`);
  assert.ok(jun.sunriseHour >= 2.5 && jun.sunriseHour <= 5.0, `Expected Jun sunrise ~3:45, got ${jun.sunriseHour}`);
  assert.ok(jun.sunsetHour >= 20.0 && jun.sunsetHour <= 22.5, `Expected Jun sunset ~21:15, got ${jun.sunsetHour}`);
  assert.ok(jun.sunsetHour - jun.sunriseHour > nov.sunsetHour - nov.sunriseHour + 6);
  assert.match(nov.sunriseStr, /^\d{2}:\d{2}$/);
  assert.match(jun.sunsetStr, /^\d{2}:\d{2}$/);
});

test('estimateWaterTempC models deep thermal inertia and triggers under-ice regime on prolonged freeze', () => {
  const coldSnapWeather: WeatherSnapshot = {
    ...sampleWeather,
    air_temp_c: -2,
    avg_air_temp_7d_c: 6,
    avg_air_temp_14d_c: 11,
  };
  const deepRes: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-deep',
    type: 'reservoir',
    avg_depth_m: 6.5,
    max_depth_m: 18,
    connected_to: null,
  };
  const shallowPond: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-shallow',
    type: 'pond',
    avg_depth_m: 1.4,
    max_depth_m: 2.0,
    connected_to: null,
  };

  const deepEst = estimateWaterTempC(coldSnapWeather, deepRes);
  const shallowEst = estimateWaterTempC(coldSnapWeather, shallowPond);
  assert.equal(deepEst.isIceRegime, false);
  assert.equal(shallowEst.isIceRegime, false);
  assert.ok(
    deepEst.waterTempC > shallowEst.waterTempC + 1.5,
    `Deep reservoir (${deepEst.waterTempC}C) should hold heat better than shallow pond (${shallowEst.waterTempC}C)`
  );

  const deepFreezeWeather: WeatherSnapshot = {
    ...sampleWeather,
    air_temp_c: -11,
    avg_air_temp_7d_c: -7.5,
    avg_air_temp_14d_c: -6.0,
  };
  const iceDeep = estimateWaterTempC(deepFreezeWeather, deepRes);
  const iceShallow = estimateWaterTempC(deepFreezeWeather, shallowPond);
  assert.equal(iceDeep.isIceRegime, true);
  assert.equal(iceShallow.isIceRegime, true);
  assert.ok(iceDeep.waterTempC >= 1.2 && iceDeep.waterTempC <= 2.6);
  assert.ok(iceShallow.waterTempC >= 1.2 && iceShallow.waterTempC <= 2.6);
});

test('analyzeBarometricWindow and computeFIndexForecast penalize sharp 6h pressure crash vs 48h stability', () => {
  const buildHourly = (mode: 'stable' | 'crash' | 'prefontal'): HourlyWeatherPoint[] => {
    const startMs = Date.parse('2026-11-11T00:00:00Z');
    const out: HourlyWeatherPoint[] = [];
    for (let h = 0; h < 120; h++) {
      const tMs = startMs + h * 3600000;
      let pressure = 1016;
      if (mode === 'crash' && h >= 54 && h <= 72) {
        // Drop 1.2 hPa per hour -> delta6h ~ -7.2 hPa around Nov 13 09:00..15:00
        pressure = 1016 - (h - 54) * 1.2;
      } else if (mode === 'prefontal' && h >= 54 && h <= 72) {
        // Gentle pre-frontal drop ~ -0.3 hPa/h -> delta6h = -1.8 hPa
        pressure = 1016 - (h - 54) * 0.3;
      }
      out.push({
        time: new Date(tMs).toISOString().slice(0, 16) + ':00Z',
        temp_c: 5,
        pressure_hpa: Number(pressure.toFixed(1)),
        wind_speed_ms: 3.5,
        wind_direction_deg: 240,
        cloud_cover_pct: 75,
        precipitation_mm: 0,
      });
    }
    return out;
  };

  const baseDate = new Date('2026-11-13T09:00:00Z');
  const targetMs = Date.parse('2026-11-13T12:00:00Z');

  const stableHourly = buildHourly('stable');
  const crashHourly = buildHourly('crash');
  const prefrontalHourly = buildHourly('prefontal');

  const stableBaro = analyzeBarometricWindow(stableHourly, targetMs, sampleWeather);
  const crashBaro = analyzeBarometricWindow(crashHourly, targetMs, sampleWeather);
  const prefrontalBaro = analyzeBarometricWindow(prefrontalHourly, targetMs, sampleWeather);

  assert.ok(stableBaro.stability48h >= 0.9);
  assert.ok(crashBaro.delta6h <= -5.0, `Expected crash delta6h <= -5, got ${crashBaro.delta6h}`);
  assert.ok(prefrontalBaro.delta6h <= -1.2 && prefrontalBaro.delta6h >= -2.5);

  const stableSlots = computeFIndexForecast({
    species: sampleSpecies,
    weather: { ...sampleWeather, hourly: stableHourly, avg_air_temp_7d_c: 6, avg_air_temp_14d_c: 7 },
    baseDate,
  });
  const crashSlots = computeFIndexForecast({
    species: sampleSpecies,
    weather: { ...sampleWeather, hourly: crashHourly, avg_air_temp_7d_c: 6, avg_air_temp_14d_c: 7 },
    baseDate,
  });
  const prefrontalSlots = computeFIndexForecast({
    species: sampleSpecies,
    weather: { ...sampleWeather, hourly: prefrontalHourly, avg_air_temp_7d_c: 6, avg_air_temp_14d_c: 7 },
    baseDate,
  });

  const stableMidday = stableSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '15:00')!;
  const crashMidday = crashSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '15:00')!;
  const prefrontalMidday = prefrontalSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '15:00')!;

  assert.ok(
    stableMidday.f_index > crashMidday.f_index + 15,
    `Stable (${stableMidday.f_index}) should strongly beat pressure crash (${crashMidday.f_index})`
  );
  assert.ok(
    prefrontalMidday.f_index > crashMidday.f_index + 15,
    `Pre-frontal gentle drop (${prefrontalMidday.f_index}) should favor predator over crash (${crashMidday.f_index})`
  );
  assert.ok(crashMidday.factors.some((f) => f.includes('Резкий скачок давления')));
});

test('computeWaterBodyHabitatModifier penalizes river flood turbidity after heavy 72h rain', () => {
  const riverWb: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-river-test',
    type: 'river',
    connected_to: 'wb-main',
  };
  const dryMod = computeWaterBodyHabitatModifier({
    waterBody: riverWb,
    species: sampleSpecies,
    weather: { ...sampleWeather, recent_rain_72h_mm: 2 },
  });
  const floodMod = computeWaterBodyHabitatModifier({
    waterBody: riverWb,
    species: sampleSpecies,
    weather: { ...sampleWeather, recent_rain_72h_mm: 40 },
  });

  assert.ok(floodMod.modifier <= dryMod.modifier - 7);
  assert.ok(floodMod.reasons.some((r) => r.includes('паводковая мутность')));
});

test('computeReportCalibration applies Bayesian shrinkage, weights weather similarity, and handles no_bite reports', () => {
  const baseDate = new Date('2026-11-13T12:00:00Z');
  const makeReport = (
    id: string,
    outcome: 'catch' | 'no_bite',
    pressureHpa: number,
    waterTempC: number
  ): CatchReport => ({
    id,
    client_event_id: id,
    user_id: 'u-1',
    author_nickname: 'Тест',
    author_verified: true,
    water_body_id: sampleWaterBody.id,
    water_body_name: sampleWaterBody.display_label,
    lat: sampleWaterBody.center.lat,
    lng: sampleWaterBody.center.lng,
    created_at: '2026-11-13T08:00:00Z',
    updated_at: '2026-11-13T08:00:00Z',
    fish_species_id: sampleSpecies.id,
    fish_species_name: sampleSpecies.name,
    weight_kg: outcome === 'catch' ? 1.8 : null,
    length_cm: outcome === 'catch' ? 54 : null,
    bait: 'Джиг',
    retrieve: 'Ступенька',
    weather_summary: '762 мм',
    photo_url: null,
    notes: '',
    visibility: 'public',
    source: 'diary',
    outcome,
    weather_snapshot: {
      pressure_hpa: pressureHpa,
      pressure_trend: 'steady',
      air_temp_c: 5,
      water_temp_c: waterTempC,
      wind_speed_ms: 3.5,
      wind_direction_label: 'ЮЗ',
      cloud_cover_pct: 60,
      precipitation_mm: 0,
    },
  });

  // Single catch report should be shrunk modestly (not an extreme +12 swing)
  const singleCatch = computeReportCalibration({
    waterBody: sampleWaterBody,
    species: sampleSpecies,
    weather: sampleWeather,
    reports: [makeReport('r1', 'catch', 1016, 7.5)],
    baseDate,
  });
  assert.ok(singleCatch.delta > 0 && singleCatch.delta <= 6, `Single report delta should be shrunk, got ${singleCatch.delta}`);
  assert.equal(singleCatch.catchCount, 1);

  // Weather-similar reports should yield stronger delta than weather-mismatched reports
  const similarMulti = computeReportCalibration({
    waterBody: sampleWaterBody,
    species: sampleSpecies,
    weather: sampleWeather,
    reports: [
      makeReport('s1', 'catch', 1016, 7.5),
      makeReport('s2', 'catch', 1017, 7.6),
      makeReport('s3', 'catch', 1015, 7.4),
    ],
    baseDate,
  });
  const mismatchedMulti = computeReportCalibration({
    waterBody: sampleWaterBody,
    species: sampleSpecies,
    weather: sampleWeather,
    reports: [
      makeReport('m1', 'catch', 990, 22),
      makeReport('m2', 'catch', 988, 23),
      makeReport('m3', 'catch', 992, 21),
    ],
    baseDate,
  });
  assert.ok(
    similarMulti.delta > mismatchedMulti.delta,
    `Weather-similar (${similarMulti.delta}) should outweigh weather-mismatched (${mismatchedMulti.delta})`
  );

  // Multiple no_bite reports should yield negative calibration delta
  const noBiteCal = computeReportCalibration({
    waterBody: sampleWaterBody,
    species: sampleSpecies,
    weather: sampleWeather,
    reports: [
      makeReport('nb1', 'no_bite', 1016, 7.5),
      makeReport('nb2', 'no_bite', 1016, 7.4),
      makeReport('nb3', 'no_bite', 1015, 7.6),
    ],
    baseDate,
  });
  assert.ok(noBiteCal.delta <= -4, `Expected negative delta for no_bite cluster, got ${noBiteCal.delta}`);
  assert.equal(noBiteCal.noBiteCount, 3);
  assert.ok(noBiteCal.summaryReason?.includes('без клёва'));
});

test('buildBiteForecastMetadata distinguishes high-confidence live hourly+reports from low-confidence offline fallback', () => {
  const baseDate = new Date('2026-11-13T09:00:00Z');
  const hourly24: HourlyWeatherPoint[] = Array.from({ length: 48 }, (_, i) => ({
    time: new Date(Date.parse('2026-11-12T00:00:00Z') + i * 3600000).toISOString().slice(0, 16) + ':00Z',
    temp_c: 5,
    pressure_hpa: 1016,
    wind_speed_ms: 3.5,
    wind_direction_deg: 240,
    cloud_cover_pct: 60,
    precipitation_mm: 0,
  }));

  const highMeta = buildBiteForecastMetadata({
    weather: { ...sampleWeather, source: 'open-meteo', hourly: hourly24, avg_air_temp_7d_c: 6, avg_air_temp_14d_c: 7 },
    species: sampleSpecies,
    waterBody: sampleWaterBody,
    baseDate,
  });
  assert.equal(highMeta.confidence_level, 'high');
  assert.ok((highMeta.confidence_score ?? 0) >= 75);
  assert.equal(highMeta.regime, 'open_water');

  const lowMeta = buildBiteForecastMetadata({
    weather: { ...sampleWeather, source: 'offline-fallback', hourly: undefined },
    species: sampleSpecies,
    waterBody: null,
    baseDate,
  });
  assert.equal(lowMeta.confidence_level, 'low');
  assert.ok((lowMeta.confidence_score ?? 100) < 52);
});

test('recommendLures boosts ice-fishing lures (балансир/мормышка) over воблер in ice regime', () => {
  const winterSpecies: FishSpecies = {
    ...sampleSpecies,
    lures: [
      {
        id: 'wobbler-minnow',
        lure_type: 'Воблер-минноу 90 мм',
        category: 'воблер',
        depth_min_m: 1.0,
        depth_max_m: 3.5,
        best_seasons: [1, 2, 12],
        best_clarity: ['clear', 'moderate'],
        water_types: ['pond', 'lake', 'reservoir'],
        retrieve: 'Твичинг',
        rationale: 'Открытая вода',
        source: 'editorial',
        base_rank: 9,
      },
      {
        id: 'ice-balancer',
        lure_type: 'Балансир 5 см',
        category: 'балансир',
        depth_min_m: 1.0,
        depth_max_m: 6.0,
        best_seasons: [1, 2, 12],
        best_clarity: ['clear', 'moderate'],
        water_types: ['pond', 'lake', 'reservoir'],
        retrieve: 'Взмах — пауза 4 сек',
        rationale: 'Подлёдная ловля',
        source: 'editorial',
        base_rank: 8,
      },
    ],
  };

  const openWaterRecs = recommendLures({
    species: winterSpecies,
    waterBody: sampleWaterBody,
    month: 1,
    isIceRegime: false,
  });
  const iceRecs = recommendLures({
    species: winterSpecies,
    waterBody: sampleWaterBody,
    month: 1,
    isIceRegime: true,
  });

  assert.equal(openWaterRecs[0].lure.id, 'wobbler-minnow');
  assert.equal(iceRecs[0].lure.id, 'ice-balancer');
  assert.ok(iceRecs[0].reasons.some((r) => r.includes('подлёдной')));
});

test('all seed water bodies define valid inhabiting_species and getExpectedFishForWaterBody resolves catalog, reports, and ecological fallback', async () => {
  const { SEED_KNOTS, SEED_SPECIES, SEED_WATER_BODIES } = await import('../data/seedData');
  const speciesIds = new Set(SEED_SPECIES.map((s) => s.id));

  assert.ok(SEED_KNOTS.length >= 8, `Expected at least 8 knots in encyclopedia, got ${SEED_KNOTS.length}`);
  for (const wb of SEED_WATER_BODIES) {
    assert.ok(
      wb.inhabiting_species && wb.inhabiting_species.length >= 5,
      `${wb.id} must have curated inhabiting_species`
    );
    for (const item of wb.inhabiting_species) {
      assert.ok(speciesIds.has(item.species_id), `${wb.id} references unknown species ${item.species_id}`);
    }
  }

  const istra = SEED_WATER_BODIES.find((w) => w.id === 'wb-istra-res')!;
  const istraFish = getExpectedFishForWaterBody({
    waterBody: istra,
    speciesList: SEED_SPECIES,
    reports: [
      {
        id: 'r-conf',
        client_event_id: 'r-conf',
        user_id: 'u-1',
        author_nickname: 'Тест',
        author_verified: true,
        water_body_id: 'wb-istra-res',
        water_body_name: istra.display_label,
        lat: istra.center.lat,
        lng: istra.center.lng,
        created_at: '2026-11-18T08:00:00Z',
        updated_at: '2026-11-18T08:00:00Z',
        fish_species_id: 'sudak',
        fish_species_name: 'Судак',
        outcome: 'catch',
        weight_kg: 1.5,
        length_cm: 48,
        bait: 'Джиг',
        retrieve: 'Ступенька',
        weather_summary: '',
        photo_url: null,
        notes: '',
        visibility: 'public',
        source: 'diary',
      },
    ],
  });
  assert.ok(istraFish.some((f) => f.species_id === 'sudak' && f.source === 'confirmed_report'));
  assert.ok(istraFish.some((f) => f.species_id === 'lesh' && f.abundance === 'common'));
  assert.equal(istraFish.some((f) => f.species_id === 'rotan'), false);

  // Ecological fallback for newly discovered shallow summer-drying pond without curated catalog
  const unknownShallowPond: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-shallow',
    inhabiting_species: undefined,
    type: 'pond',
    area_ha: 0.3,
    max_depth_m: 0.6,
    ndwi_stability: 'dries_summer',
  };
  const fallbackFish = getExpectedFishForWaterBody({
    waterBody: unknownShallowPond,
    speciesList: SEED_SPECIES,
  });
  assert.ok(fallbackFish.every((f) => f.source === 'ecological_model'));
  assert.ok(fallbackFish.some((f) => f.species_id === 'karas'));
  assert.equal(fallbackFish.some((f) => f.species_id === 'sudak'), false);
});

test('computeBiologicalPhase models pre-spawn, spawning dip, post-spawn by water temp and spring shallow warming', () => {
  const springDate = new Date('2026-04-18T10:00:00Z');
  const warmingWeather: WeatherSnapshot = {
    ...sampleWeather,
    avg_air_temp_7d_c: 10.5,
    avg_air_temp_14d_c: 7.2,
  };

  const preSpawn = computeBiologicalPhase({
    species: sampleSpecies, // pike spawn 4.5-8.0C
    waterTempC: 3.5,
    weather: warmingWeather,
    date: springDate,
    isIceRegime: false,
  });
  const spawning = computeBiologicalPhase({
    species: sampleSpecies,
    waterTempC: 6.2,
    weather: warmingWeather,
    date: springDate,
    isIceRegime: false,
  });
  const postSpawn = computeBiologicalPhase({
    species: sampleSpecies,
    waterTempC: 10.2,
    weather: warmingWeather,
    date: springDate,
    isIceRegime: false,
  });

  assert.equal(preSpawn.phase, 'pre_spawn');
  assert.ok(preSpawn.modifier > 0);
  assert.equal(spawning.phase, 'spawning');
  assert.ok(spawning.modifier <= -8);
  assert.equal(postSpawn.phase, 'post_spawn');
  assert.ok(postSpawn.modifier > 0);

  const peacefulKaras: FishSpecies = {
    ...sampleSpecies,
    id: 'karas',
    name: 'Карась',
    category: 'peaceful',
  };
  const springKaras = computeBiologicalPhase({
    species: peacefulKaras,
    waterTempC: 10.5,
    weather: warmingWeather,
    date: new Date('2026-04-22T12:00:00Z'),
    isIceRegime: false,
  });
  assert.ok(springKaras.springMiddayBoost >= 4);
});

test('computeHydrologyModifier penalizes river flood surge, rewards receding/steady flow, and ignores isolated ponds', () => {
  const riverWb: WaterBody = { ...sampleWaterBody, type: 'river', connected_to: 'wb-main' };
  const isolatedPond: WaterBody = { ...sampleWaterBody, type: 'pond', connected_to: null };

  const floodRes = computeHydrologyModifier({
    weather: { ...sampleWeather, river_discharge_m3s: 42.5, river_discharge_ratio: 1.9, river_discharge_trend: 'rising_fast' },
    waterBody: riverWb,
  });
  const recedingRes = computeHydrologyModifier({
    weather: { ...sampleWeather, river_discharge_m3s: 18.2, river_discharge_ratio: 1.25, river_discharge_trend: 'falling' },
    waterBody: riverWb,
  });
  const isolatedRes = computeHydrologyModifier({
    weather: { ...sampleWeather, river_discharge_m3s: 42.5, river_discharge_ratio: 1.9, river_discharge_trend: 'rising_fast' },
    waterBody: isolatedPond,
  });

  assert.ok(floodRes.modifier <= -9);
  assert.ok(floodRes.label?.includes('Паводок'));
  assert.ok(recedingRes.modifier >= 3);
  assert.equal(isolatedRes.modifier, 0);
});

test('computeOxygenAndIcePhase models summer oxygen stress and winter first_ice / midwinter / last_ice phases', () => {
  const shallowIsolated: WaterBody = {
    ...sampleWaterBody,
    type: 'pond',
    connected_to: null,
    avg_depth_m: 1.5,
    max_depth_m: 2.2,
    vegetation_index: 'algal_bloom',
  };

  const summerStress = computeOxygenAndIcePhase({
    species: sampleSpecies,
    waterTempC: 25.5,
    weather: { ...sampleWeather, air_temp_c: 29, wind_speed_ms: 1.4 },
    waterBody: shallowIsolated,
    date: new Date('2026-07-22T12:00:00Z'),
    isIceRegime: false,
  });
  assert.equal(summerStress.oxygenRisk, 'high');
  assert.ok(summerStress.middayPenalty <= -7);
  assert.ok(summerStress.dawnBoost >= 4);

  const firstIce = computeOxygenAndIcePhase({
    species: sampleSpecies,
    waterTempC: 1.6,
    weather: { ...sampleWeather, air_temp_c: -4, avg_air_temp_7d_c: -3.5, avg_air_temp_14d_c: -1.5 },
    waterBody: shallowIsolated,
    date: new Date('2026-12-08T10:00:00Z'),
    isIceRegime: true,
  });
  const midwinter = computeOxygenAndIcePhase({
    species: sampleSpecies,
    waterTempC: 1.4,
    weather: { ...sampleWeather, air_temp_c: -14, avg_air_temp_7d_c: -12, avg_air_temp_14d_c: -11 },
    waterBody: shallowIsolated,
    date: new Date('2026-01-25T10:00:00Z'),
    isIceRegime: true,
  });
  const lastIce = computeOxygenAndIcePhase({
    species: sampleSpecies,
    waterTempC: 1.6,
    weather: { ...sampleWeather, air_temp_c: 1.0, avg_air_temp_7d_c: -2.0, avg_air_temp_14d_c: -5.5 },
    waterBody: shallowIsolated,
    date: new Date('2026-03-18T10:00:00Z'),
    isIceRegime: true,
  });

  assert.equal(firstIce.icePhase, 'first_ice');
  assert.ok(firstIce.modifier > 0);
  assert.equal(midwinter.icePhase, 'midwinter');
  assert.equal(midwinter.oxygenRisk, 'high');
  assert.ok(midwinter.modifier <= -7);
  assert.equal(lastIce.icePhase, 'last_ice');
  assert.ok(lastIce.modifier > 0);
});

test('computeFIndexForecast scores solar radiation in clear water, strong wind gusts, 48h cold front, and windward shore hint', () => {
  const sudak: FishSpecies = {
    ...sampleSpecies,
    id: 'sudak',
    name: 'Судак',
    category: 'predator',
    optimal_water_temp_c: [12, 18],
    season_activity: { ...sampleSpecies.season_activity, 9: 85 },
  };
  const clearReservoir: WaterBody = {
    ...sampleWaterBody,
    type: 'reservoir',
    water_clarity: 'clear',
    area_ha: 1500,
    max_depth_m: 14,
    avg_depth_m: 5.5,
  };
  const septDate = new Date('2026-09-12T09:00:00Z');

  const calmDiffused = computeFIndexForecast({
    species: sudak,
    weather: {
      ...sampleWeather,
      air_temp_c: 15,
      water_temp_c: 15,
      wind_speed_ms: 4.0,
      wind_gusts_ms: 6.0,
      shortwave_radiation_wm2: 110,
      air_temp_delta_48h_c: 0,
    },
    baseDate: septDate,
    waterBody: clearReservoir,
  });
  const harshGlareGustsFront = computeFIndexForecast({
    species: sudak,
    weather: {
      ...sampleWeather,
      air_temp_c: 15,
      water_temp_c: 15,
      wind_speed_ms: 4.0,
      wind_gusts_ms: 18.0,
      shortwave_radiation_wm2: 650,
      air_temp_delta_48h_c: -9.5,
    },
    baseDate: septDate,
    waterBody: clearReservoir,
  });

  const diffusedNoon = calmDiffused.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '12:00')!;
  const harshNoon = harshGlareGustsFront.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '12:00')!;
  assert.ok(
    diffusedNoon.f_index >= harshNoon.f_index + 16,
    `Diffused (${diffusedNoon.f_index}) should strongly beat glare+gusts+front (${harshNoon.f_index})`
  );

  // SW wind (225 deg) blows toward NE shore (прибойный = СВ, укрытый = ЮЗ)
  const shoreHint = computeWindwardShoreHint(225, 4.5, false);
  assert.ok(shoreHint.includes('СВ') && shoreHint.includes('ЮЗ'));
});

test('evaluateForecastAccuracy computes hit rate, Brier score, and catch vs no_bite averages, and adaptive calibration triggers with weather snapshots', () => {
  const baseRep: Omit<CatchReport, 'id' | 'client_event_id' | 'outcome' | 'predicted_f_index'> = {
    user_id: 'u-1',
    author_nickname: 'Тест',
    author_verified: true,
    water_body_id: sampleWaterBody.id,
    water_body_name: sampleWaterBody.display_label,
    lat: sampleWaterBody.center.lat,
    lng: sampleWaterBody.center.lng,
    created_at: '2026-11-13T07:00:00Z',
    updated_at: '2026-11-13T07:00:00Z',
    fish_species_id: sampleSpecies.id,
    fish_species_name: sampleSpecies.name,
    weight_kg: 1.5,
    length_cm: 50,
    bait: 'Джиг',
    retrieve: 'Ступенька',
    weather_summary: '',
    photo_url: null,
    notes: '',
    visibility: 'public',
    source: 'diary',
    weather_snapshot: {
      pressure_hpa: 1016,
      pressure_trend: 'steady',
      air_temp_c: 5,
      water_temp_c: 7.5,
      wind_speed_ms: 3.5,
      wind_direction_label: 'ЮЗ',
      cloud_cover_pct: 60,
      precipitation_mm: 0,
      hour_local: 8,
    },
  };

  const reports: CatchReport[] = [
    { ...baseRep, id: 'a1', client_event_id: 'a1', outcome: 'catch', predicted_f_index: 78 },
    { ...baseRep, id: 'a2', client_event_id: 'a2', outcome: 'catch', predicted_f_index: 72 },
    { ...baseRep, id: 'a3', client_event_id: 'a3', outcome: 'no_bite', weight_kg: null, length_cm: null, predicted_f_index: 34 },
    { ...baseRep, id: 'a4', client_event_id: 'a4', outcome: 'no_bite', weight_kg: null, length_cm: null, predicted_f_index: 64 },
  ];

  const acc = evaluateForecastAccuracy(reports);
  assert.equal(acc.evaluatedCount, 4);
  assert.equal(acc.hitRatePct, 75);
  assert.ok(acc.brierScore !== null && acc.brierScore < 0.2);
  assert.equal(acc.avgCatchF, 75);
  assert.equal(acc.avgNoBiteF, 49);

  // Adaptive calibration with consistent catch cluster matching current steady pressure + moderate wind
  const adaptiveCal = computeReportCalibration({
    waterBody: sampleWaterBody,
    species: sampleSpecies,
    weather: sampleWeather,
    reports: [
      { ...baseRep, id: 'c1', client_event_id: 'c1', outcome: 'catch' },
      { ...baseRep, id: 'c2', client_event_id: 'c2', outcome: 'catch' },
      { ...baseRep, id: 'c3', client_event_id: 'c3', outcome: 'catch' },
    ],
    baseDate: new Date('2026-11-13T09:00:00Z'),
    slotHour: 8,
  });
  assert.ok(adaptiveCal.adaptiveDelta >= 2, `Expected positive adaptiveDelta, got ${adaptiveCal.adaptiveDelta}`);
  assert.ok(adaptiveCal.adaptiveNote?.includes('Адаптация по водоёму'));
});

test('parseSonarDepthFile parses Deeper/Garmin CSV (comma, semicolon, feet->meters, downsampling)', () => {
  const sampleCsv = buildSampleSonarCsv(sampleWaterBody);
  const parsedSample = parseSonarDepthFile(sampleCsv, 'deeper-log.csv');
  assert.equal(parsedSample.format, 'csv');
  assert.equal(parsedSample.error, undefined);
  assert.equal(parsedSample.points.length, 14);
  assert.equal(parsedSample.skippedCount, 0);

  // Semicolon CSV with feet header and invalid row
  const feetCsv = [
    'Latitude;Longitude;Depth_ft',
    '56,0120;36,8120;10,0',
    '56,0130;36,8130;20,0',
    '999;36,8140;15,0',
    '56,0140;36,8140;0.01',
  ].join('\n');
  const parsedFeet = parseSonarDepthFile(feetCsv, 'garmin-ft.csv');
  assert.equal(parsedFeet.points.length, 2);
  assert.equal(parsedFeet.skippedCount, 2);
  assert.ok(Math.abs(parsedFeet.points[0].depth_m - 3.05) < 0.05);
  assert.ok(Math.abs(parsedFeet.points[1].depth_m - 6.1) < 0.05);

  // Downsampling when > 400 rows
  const hugeRows = ['lat,lon,depth'];
  for (let i = 0; i < 480; i++) {
    hugeRows.push(`${(56.0 + i * 0.0001).toFixed(5)},${(36.8 + i * 0.0001).toFixed(5)},${(2 + (i % 8)).toFixed(1)}`);
  }
  const parsedHuge = parseSonarDepthFile(hugeRows.join('\n'), 'huge.csv');
  assert.equal(parsedHuge.points.length, 400);
  assert.equal(parsedHuge.downsampled, true);
});

test('parseSonarDepthFile parses GPX trkpt/wpt depth tags safely', () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1">
    <trk><trkseg>
      <trkpt lat="56.0110" lon="36.8110"><extensions><gpxtpx:TrackPointExtension><gpxtpx:depth>4.2</gpxtpx:depth></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="56.0120" lon="36.8120"><depth>7.8</depth></trkpt>
      <trkpt lat="56.0130" lon="36.8130"><ele>-5.5</ele></trkpt>
      <trkpt lat="56.0140" lon="36.8140"><ele>142.0</ele></trkpt>
    </trkseg></trk>
  </gpx>`;
  const res = parseSonarDepthFile(gpx, 'track.gpx');
  assert.equal(res.format, 'gpx');
  assert.equal(res.error, undefined);
  assert.equal(res.points.length, 3);
  assert.equal(res.skippedCount, 1);
  assert.equal(res.points[0].depth_m, 4.2);
  assert.equal(res.points[1].depth_m, 7.8);
  assert.equal(res.points[2].depth_m, 5.5);
});

test('generateBathymetryContours builds valid interpolated isobaths and image bounds', () => {
  const sampleCsv = buildSampleSonarCsv({ center: { lat: 56.02, lng: 36.83 }, max_depth_m: 10 });
  const parsed = parseSonarDepthFile(sampleCsv, 'test.csv');
  const pts: BathymetryPoint[] = parsed.points.map((p, idx) => ({
    id: `p-${idx}`,
    water_body_id: 'wb-test',
    lat: p.lat,
    lng: p.lng,
    depth_m: p.depth_m,
    source: 'sonar',
    created_at: new Date().toISOString(),
    confidence: 0.8,
  }));

  const contours = generateBathymetryContours(pts);
  assert.ok(contours.length >= 2, `Expected >= 2 contours, got ${contours.length}`);
  for (const c of contours) {
    assert.ok(c.depth_m >= 1 && c.depth_m <= 10);
    assert.ok(c.coordinates.length >= 3);
  }

  // Fewer than 3 points returns empty contours
  assert.deepEqual(generateBathymetryContours(pts.slice(0, 2)), []);

  const bounds = getWaterBodyImageBounds(sampleWaterBody);
  assert.equal(bounds.length, 4);
  assert.ok(bounds[0][0] < bounds[1][0], 'west < east');
  assert.ok(bounds[0][1] > bounds[3][1], 'north > south');
});

test('getExpectedFishForWaterBody enforces realistic habitat thresholds by water body size, depth, and type', async () => {
  const { SEED_SPECIES } = await import('../data/seedData');

  const smallRiver: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-small-river',
    display_label: 'Река Вязь',
    inhabiting_species: undefined,
    type: 'river',
    area_ha: 8,
    max_depth_m: 1.6,
    avg_depth_m: 0.9,
    water_clarity: 'moderate',
    vegetation_index: 'moderate',
  };
  const smallRiverIds = new Set(
    getExpectedFishForWaterBody({ waterBody: smallRiver, speciesList: SEED_SPECIES }).map((f) => f.species_id)
  );
  assert.equal(smallRiverIds.has('plotva'), true);
  assert.equal(smallRiverIds.has('okun'), true);
  assert.equal(smallRiverIds.has('golavl'), true);
  assert.equal(smallRiverIds.has('pike'), true);
  assert.equal(smallRiverIds.has('sudak'), false, 'small shallow river must not have sudak');
  assert.equal(smallRiverIds.has('som'), false, 'small shallow river must not have som');
  assert.equal(smallRiverIds.has('zherekh'), false, 'small shallow river must not have zherekh');
  assert.equal(smallRiverIds.has('yaz'), false, 'small shallow river must not have yaz');
  assert.equal(smallRiverIds.has('nalim'), false, 'small shallow river must not have nalim');
  assert.equal(smallRiverIds.has('lesh'), false, 'small shallow river must not have lesh');

  const smallLake: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-small-lake',
    display_label: 'Лесное озеро',
    inhabiting_species: undefined,
    type: 'lake',
    area_ha: 10,
    max_depth_m: 2.5,
    avg_depth_m: 1.4,
    water_clarity: 'moderate',
    vegetation_index: 'moderate',
  };
  const smallLakeIds = new Set(
    getExpectedFishForWaterBody({ waterBody: smallLake, speciesList: SEED_SPECIES }).map((f) => f.species_id)
  );
  assert.equal(smallLakeIds.has('okun'), true);
  assert.equal(smallLakeIds.has('plotva'), true);
  assert.equal(smallLakeIds.has('pike'), true);
  assert.equal(smallLakeIds.has('karas'), true);
  assert.equal(smallLakeIds.has('lin'), true);
  assert.equal(smallLakeIds.has('sudak'), false, 'small shallow lake must not have sudak');
  assert.equal(smallLakeIds.has('yaz'), false, 'lake must not have yaz');
  assert.equal(smallLakeIds.has('nalim'), false, 'shallow lake must not have nalim');
  assert.equal(smallLakeIds.has('lesh'), false, 'small shallow lake must not have lesh');
  assert.equal(smallLakeIds.has('karp'), false, 'wild small lake must not auto-populate karp');

  const largeReservoir: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-pestovskoe',
    display_label: 'Пестовское водохранилище',
    inhabiting_species: undefined,
    type: 'reservoir',
    area_ha: 1160,
    max_depth_m: 14,
    avg_depth_m: 5.5,
    water_clarity: 'moderate',
    vegetation_index: 'moderate',
  };
  const resIds = new Set(
    getExpectedFishForWaterBody({ waterBody: largeReservoir, speciesList: SEED_SPECIES }).map((f) => f.species_id)
  );
  assert.equal(resIds.has('sudak'), true);
  assert.equal(resIds.has('lesh'), true);
  assert.equal(resIds.has('pike'), true);
  assert.equal(resIds.has('okun'), true);
  assert.equal(resIds.has('plotva'), true);
  assert.equal(resIds.has('gustera'), true);
  assert.equal(resIds.has('nalim'), true);
  assert.equal(resIds.has('som'), false, 'medium 1160 ha reservoir should not auto-claim som');

  const majorRiver: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-seym',
    display_label: 'Сейм',
    inhabiting_species: undefined,
    type: 'river',
    area_ha: 210,
    max_depth_m: 6.5,
    avg_depth_m: 3.1,
    water_clarity: 'moderate',
    vegetation_index: 'low',
  };
  const majorRiverIds = new Set(
    getExpectedFishForWaterBody({ waterBody: majorRiver, speciesList: SEED_SPECIES }).map((f) => f.species_id)
  );
  assert.equal(majorRiverIds.has('sudak'), true);
  assert.equal(majorRiverIds.has('lesh'), true);
  assert.equal(majorRiverIds.has('zherekh'), true);
  assert.equal(majorRiverIds.has('yaz'), true);
  assert.equal(majorRiverIds.has('pike'), true);

  const tinyPond: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-tiny-pond',
    display_label: 'Деревенский пруд',
    inhabiting_species: undefined,
    type: 'pond',
    connected_to: null,
    area_ha: 0.8,
    max_depth_m: 1.2,
    avg_depth_m: 0.7,
    water_clarity: 'murky',
    vegetation_index: 'algal_bloom',
  };
  const tinyPondIds = new Set(
    getExpectedFishForWaterBody({ waterBody: tinyPond, speciesList: SEED_SPECIES }).map((f) => f.species_id)
  );
  assert.equal(tinyPondIds.has('karas'), true);
  assert.equal(tinyPondIds.has('rotan'), true);
  assert.equal(tinyPondIds.has('pike'), false);
  assert.equal(tinyPondIds.has('sudak'), false);
});

test('OSM water feature filter accepts reservoirs and canals while rejecting dams and boatyards', async () => {
  const { isPhotonWaterFeature, inferWaterBodyTypeFromOsm } = await import('../server/proxies');

  assert.equal(
    isPhotonWaterFeature({ name: 'Пестовское водохранилище', osm_key: 'water', osm_value: 'reservoir' }),
    true
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Учинское водохранилище', osm_key: 'water', osm_value: 'reservoir' }),
    true
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Канал имени Москвы', osm_key: 'waterway', osm_value: 'canal' }),
    true
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Сейм', osm_key: 'waterway', osm_value: 'river' }),
    true
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Пестовская Плотина', osm_key: 'waterway', osm_value: 'dam' }),
    false
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Прокат САП бордов', osm_key: 'waterway', osm_value: 'boatyard' }),
    false
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Канава', osm_key: 'waterway', osm_value: 'drain' }),
    false
  );
  assert.equal(
    isPhotonWaterFeature({ name: 'Пестовское водохранилище', osm_key: 'highway', osm_value: 'bus_stop' }),
    false
  );

  assert.equal(inferWaterBodyTypeFromOsm({ water: 'reservoir' }, 'Пестовское водохранилище'), 'reservoir');
  assert.equal(inferWaterBodyTypeFromOsm({ landuse: 'reservoir' }, 'Учинское'), 'reservoir');
  assert.equal(inferWaterBodyTypeFromOsm({ waterway: 'canal' }, 'Канал имени Москвы'), 'river');
});

test('applySpeciesVerificationVote deduplicates actor votes and switches between confirm and absent', async () => {
  const { applySpeciesVerificationVote } = await import('./fishLogic');

  let entries = applySpeciesVerificationVote({
    existing: [],
    speciesId: 'sudak',
    action: 'confirm',
    actorId: 'user:1',
    authorNickname: 'Иван',
    abundance: 'regular',
    note: 'Поймал на джиг с бровки 7 м',
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'confirmed');
  assert.equal(entries[0].confirm_count, 1);
  assert.equal(entries[0].absent_count, 0);

  // Same user voting confirm again must not inflate count
  entries = applySpeciesVerificationVote({
    existing: entries,
    speciesId: 'sudak',
    action: 'confirm',
    actorId: 'user:1',
  });
  assert.equal(entries[0].confirm_count, 1);

  // Second user confirms
  entries = applySpeciesVerificationVote({
    existing: entries,
    speciesId: 'sudak',
    action: 'confirm',
    actorId: 'user:2',
    authorNickname: 'Пётр',
  });
  assert.equal(entries[0].confirm_count, 2);
  assert.equal(entries[0].status, 'confirmed');

  // Two distinct users vote absent + user:1 switches vote to absent -> status flips to absent
  entries = applySpeciesVerificationVote({
    existing: entries,
    speciesId: 'sudak',
    action: 'absent',
    actorId: 'user:1',
  });
  entries = applySpeciesVerificationVote({
    existing: entries,
    speciesId: 'sudak',
    action: 'absent',
    actorId: 'user:3',
  });
  assert.equal(entries[0].confirm_count, 1);
  assert.equal(entries[0].absent_count, 2);
  assert.equal(entries[0].status, 'absent');
});

test('verified_species excludes mistaken automatic species and promotes community-confirmed species', async () => {
  const {
    applySpeciesVerificationVote,
    getExcludedVerifiedSpecies,
    getExpectedFishForWaterBody,
  } = await import('./fishLogic');
  const { SEED_SPECIES } = await import('../data/seedData');

  const lakeWb: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-verify-lake',
    display_label: 'Озеро Лесное',
    inhabiting_species: undefined,
    type: 'lake',
    area_ha: 65,
    max_depth_m: 6.0,
    avg_depth_m: 2.8,
  };

  // Baseline expects pike and okun, but not sudak
  const before = getExpectedFishForWaterBody({ waterBody: lakeWb, speciesList: SEED_SPECIES });
  assert.equal(before.some((f) => f.species_id === 'pike'), true);
  assert.equal(before.some((f) => f.species_id === 'sudak'), false);

  // Community marks pike absent and confirms sudak (stocked reservoir-like lake)
  let verified = applySpeciesVerificationVote({
    existing: [],
    speciesId: 'pike',
    action: 'absent',
    actorId: 'user:10',
    note: 'Заморный водоём, щуки нет',
  });
  verified = applySpeciesVerificationVote({
    existing: verified,
    speciesId: 'sudak',
    action: 'confirm',
    actorId: 'user:11',
    abundance: 'regular',
    note: 'Зарыблён судаком, ловится на яме',
  });

  const verifiedWb: WaterBody = { ...lakeWb, verified_species: verified };
  const after = getExpectedFishForWaterBody({ waterBody: verifiedWb, speciesList: SEED_SPECIES });
  assert.equal(after.some((f) => f.species_id === 'pike'), false, 'Absent vote should hide automatic pike');
  const sudakEntry = after.find((f) => f.species_id === 'sudak');
  assert.ok(sudakEntry, 'Community confirmed sudak should appear');
  assert.equal(sudakEntry.source, 'verified_community');
  assert.equal(sudakEntry.confirm_count, 1);

  const excluded = getExcludedVerifiedSpecies({ waterBody: verifiedWb, speciesList: SEED_SPECIES });
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].species_id, 'pike');

  // GoodBite analysis must skip water bodies for a species marked absent
  const gbPike = evaluateGoodBiteWaterBodies({
    origin: verifiedWb.center,
    waterBodies: [verifiedWb],
    speciesList: SEED_SPECIES,
    weather: sampleWeather,
    reports: [],
    baseDate: new Date('2026-10-15T09:00:00Z'),
    radiusKm: 50,
    fishId: 'pike',
    minFIndex: 0,
  });
  assert.equal(gbPike.length, 0);
});

test('regional and major-only filters select Moscow Oblast major reservoirs and filter out minor tributaries', async () => {
  const {
    filterWaterBodiesByRegionAndScale,
    isMajorWaterBody,
    matchesWaterBodyRegion,
  } = await import('./regions');
  const { SEED_SPECIES, SEED_WATER_BODIES } = await import('../data/seedData');

  const minorTributary: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-vyaz',
    name: 'Вязь',
    display_label: 'Река Вязь',
    type: 'river',
    center: { lat: 56.075, lng: 37.67 },
    area_ha: 11,
    max_depth_m: 1.6,
    avg_depth_m: 0.8,
    region: 'Московская область',
  };

  const kurskRiver: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-osm-seym-kursk',
    name: 'Сейм',
    display_label: 'Река Сейм',
    type: 'river',
    center: { lat: 51.72, lng: 36.18 },
    area_ha: 220,
    max_depth_m: 6.5,
    avg_depth_m: 3.0,
    region: 'Курская область',
  };

  const dataset = [...SEED_WATER_BODIES, minorTributary, kurskRiver];

  assert.equal(isMajorWaterBody(minorTributary), false);
  assert.equal(isMajorWaterBody(kurskRiver), true);
  assert.equal(matchesWaterBodyRegion(kurskRiver, 'kursk_oblast'), true);
  assert.equal(matchesWaterBodyRegion(kurskRiver, 'moscow_oblast'), false);

  const moscowMajor = filterWaterBodiesByRegionAndScale(dataset, {
    regionId: 'moscow_oblast',
    majorOnly: true,
  });
  const moscowIds = new Set(moscowMajor.map((w) => w.id));

  assert.equal(moscowIds.has('wb-istra-res'), true);
  assert.equal(moscowIds.has('wb-mozhaysk-res'), true);
  assert.equal(moscowIds.has('wb-ruza-res'), true);
  assert.equal(moscowIds.has('wb-ozerna-res'), true);
  assert.equal(moscowIds.has('wb-oxbow-luchinskoe'), false, 'Tiny oxbow must be excluded in major-only mode');
  assert.equal(moscowIds.has('wb-osm-vyaz'), false, 'Minor tributary must be excluded in major-only mode');
  assert.equal(moscowIds.has('wb-osm-seym-kursk'), false, 'Kursk river must not appear in Moscow Oblast');

  const gbMoscowMajor = evaluateGoodBiteWaterBodies({
    origin: { lat: 55.975, lng: 36.825 },
    waterBodies: dataset,
    speciesList: SEED_SPECIES,
    weather: sampleWeather,
    reports: [],
    baseDate: new Date('2026-10-15T09:00:00Z'),
    radiusKm: 100,
    fishId: 'all',
    minFIndex: 0,
    regionId: 'moscow_oblast',
    majorOnly: true,
  });
  assert.ok(gbMoscowMajor.length >= 4);
  assert.equal(
    gbMoscowMajor.some((item) => item.water_body.id === 'wb-osm-vyaz' || item.water_body.id === 'wb-osm-seym-kursk'),
    false
  );
});

test('all SEED_SPECIES define valid active_hours and computeFIndexForecast respects species active_hours profile', async () => {
  const { SEED_SPECIES } = await import('../data/seedData');
  for (const sp of SEED_SPECIES) {
    assert.ok(
      Array.isArray(sp.active_hours) && sp.active_hours.length >= 6,
      `${sp.id} must define active_hours with at least 6 active hours`
    );
    for (const h of sp.active_hours) {
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 23, `${sp.id} active_hours value ${h} out of 0..23`);
    }
  }

  const baseDate = new Date('2026-10-18T09:00:00Z');
  const calmWeather: WeatherSnapshot = {
    ...sampleWeather,
    air_temp_c: 9,
    water_temp_c: 10,
    wind_speed_ms: 3.0,
    cloud_cover_pct: 60,
    moon_phase: 'Растущая луна',
    moon_illumination: 45,
  };

  // Custom diurnal vs custom nocturnal active_hours on the same water body
  const diurnalCustom: FishSpecies = {
    ...sampleSpecies,
    id: 'okun',
    name: 'Окунь',
    active_hours: [9, 10, 11, 12, 13, 14, 15],
  };
  const nocturnalCustom: FishSpecies = {
    ...sampleSpecies,
    id: 'nalim',
    name: 'Налим',
    optimal_water_temp_c: [2, 11],
    active_hours: [21, 22, 23, 0, 1, 2, 3, 4],
    lunar_preference: 'dark_moon',
  };

  const diurnalSlots = computeFIndexForecast({
    species: diurnalCustom,
    weather: calmWeather,
    baseDate,
    waterBody: sampleWaterBody,
  });
  const nocturnalSlots = computeFIndexForecast({
    species: nocturnalCustom,
    weather: calmWeather,
    baseDate,
    waterBody: sampleWaterBody,
  });

  const diurnalNoon = diurnalSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '12:00')!;
  const diurnalMidnight = diurnalSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '00:00')!;
  assert.equal(diurnalNoon.active_hour_match, 'peak');
  assert.equal(diurnalMidnight.active_hour_match, 'off_peak');
  assert.ok(
    diurnalNoon.f_index >= diurnalMidnight.f_index + 12,
    `Diurnal midday (${diurnalNoon.f_index}) must beat off-peak midnight (${diurnalMidnight.f_index})`
  );

  const nocturnalMidnight = nocturnalSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '00:00')!;
  const nocturnalNoon = nocturnalSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '12:00')!;
  assert.equal(nocturnalMidnight.active_hour_match, 'peak');
  assert.equal(nocturnalNoon.active_hour_match, 'off_peak');
  assert.ok(
    nocturnalMidnight.f_index >= nocturnalNoon.f_index + 15,
    `Nocturnal midnight (${nocturnalMidnight.f_index}) must beat off-peak midday (${nocturnalNoon.f_index})`
  );
});

test('computeFIndexForecast analyzes lunar cycles, clear-water moonlight glare, cloud cover mitigation, and solunar transits', async () => {
  const { computeLunarCycleState } = await import('./fishLogic');
  const { SEED_SPECIES } = await import('../data/seedData');

  const nalim = SEED_SPECIES.find((s) => s.id === 'nalim')!;
  const clearReservoir: WaterBody = {
    ...sampleWaterBody,
    id: 'wb-clear-res',
    type: 'reservoir',
    water_clarity: 'clear',
    area_ha: 900,
    max_depth_m: 12,
    avg_depth_m: 4.5,
  };
  const baseDate = new Date('2026-10-12T09:00:00Z');

  // New moon vs bright cloudless full moon at night for light-wary dark_moon species (nalim)
  const newMoonClearSlots = computeFIndexForecast({
    species: nalim,
    weather: {
      ...sampleWeather,
      air_temp_c: 8,
      water_temp_c: 9.5,
      cloud_cover_pct: 10,
      moon_phase: 'Новолуние',
      moon_illumination: 4,
    },
    baseDate,
    waterBody: clearReservoir,
  });
  const fullMoonClearSlots = computeFIndexForecast({
    species: nalim,
    weather: {
      ...sampleWeather,
      air_temp_c: 8,
      water_temp_c: 9.5,
      cloud_cover_pct: 10,
      moon_phase: 'Полнолуние',
      moon_illumination: 98,
    },
    baseDate,
    waterBody: clearReservoir,
  });
  const fullMoonOvercastSlots = computeFIndexForecast({
    species: nalim,
    weather: {
      ...sampleWeather,
      air_temp_c: 8,
      water_temp_c: 9.5,
      cloud_cover_pct: 95,
      moon_phase: 'Полнолуние',
      moon_illumination: 98,
    },
    baseDate,
    waterBody: clearReservoir,
  });

  const newMoonNight = newMoonClearSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '21:00')!;
  const fullMoonClearNight = fullMoonClearSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '21:00')!;
  const fullMoonOvercastNight = fullMoonOvercastSlots.find((s) => s.day_label === 'Сегодня' && s.hour_interval === '21:00')!;

  assert.equal(newMoonNight.moon_phase_label, 'Новолуние');
  assert.equal(fullMoonClearNight.moon_phase_label, 'Полнолуние');
  assert.ok(
    newMoonNight.f_index >= fullMoonClearNight.f_index + 8,
    `New moon night (${newMoonNight.f_index}) should strongly beat bright clear full moon (${fullMoonClearNight.f_index}) for nalim`
  );
  assert.ok(
    fullMoonOvercastNight.f_index > fullMoonClearNight.f_index,
    `Overcast full moon (${fullMoonOvercastNight.f_index}) should mitigate bright clear full moon glare (${fullMoonClearNight.f_index})`
  );
  assert.ok(fullMoonClearNight.factors.some((f) => f.includes('полнолуние')));
  assert.ok(newMoonNight.factors.some((f) => f.includes('новолуния')));

  // Solunar transit metadata and lunar_summary in buildBiteForecastMetadata
  const lunarState = computeLunarCycleState({
    date: baseDate,
    slotHour: 0,
    weatherMoonIllumination: 98,
    weatherMoonPhase: 'Полнолуние',
    useWeatherOverride: true,
  });
  assert.equal(lunarState.phaseType, 'full_moon');
  assert.equal(lunarState.solunarWindow, 'major'); // Full moon transits near 00:00 & 12:00

  const meta = buildBiteForecastMetadata({
    weather: {
      ...sampleWeather,
      air_temp_c: 3,
      water_temp_c: 5,
      moon_phase: 'Полнолуние',
      moon_illumination: 98,
    },
    species: nalim,
    waterBody: clearReservoir,
    baseDate,
  });
  assert.ok(meta.lunar_summary?.includes('Полнолуние'));
  assert.ok(meta.lunar_summary?.includes('Налим'));
  assert.ok(meta.lunar_summary?.includes('солунарные транзиты'));
});

test('computeFIndexForecast models 7-day synoptic planning, sharp pressure rise/drop, and barometric reversal', () => {
  const startMs = Date.parse('2026-10-10T00:00:00Z');
  const build7dHourly = (mode: 'steady' | 'sharp_rise' | 'reversal'): HourlyWeatherPoint[] => {
    const out: HourlyWeatherPoint[] = [];
    for (let h = 0; h < 216; h++) {
      const tMs = startMs + h * 3600000;
      let pressure = 1015;
      // Day 4 (2026-10-15, h around 120..144)
      if (mode === 'sharp_rise' && h >= 120 && h <= 138) {
        pressure = 1006 + (h - 120) * 1.1; // +6.6 hPa/6h sharp rise
      } else if (mode === 'reversal' && h >= 114 && h <= 138) {
        // Drops sharply for 6h then snaps sharply up for 6h around h=126
        pressure = h <= 126 ? 1016 - (h - 114) * 0.6 : 1008.8 + (h - 126) * 0.6;
      }
      out.push({
        time: new Date(tMs).toISOString().slice(0, 16) + ':00Z',
        temp_c: 10,
        pressure_hpa: Number(pressure.toFixed(1)),
        wind_speed_ms: 3.2,
        wind_direction_deg: 230,
        cloud_cover_pct: 60,
        precipitation_mm: 0,
      });
    }
    return out;
  };

  const baseDate = new Date('2026-10-12T09:00:00Z');
  const peacefulLesh: FishSpecies = {
    ...sampleSpecies,
    id: 'lesh',
    name: 'Лещ',
    category: 'peaceful',
    optimal_water_temp_c: [10, 18],
    active_hours: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  };

  const steadySlots = computeFIndexForecast({
    species: peacefulLesh,
    weather: { ...sampleWeather, air_temp_c: 10, water_temp_c: 11, hourly: build7dHourly('steady') },
    baseDate,
  });
  const riseSlots = computeFIndexForecast({
    species: peacefulLesh,
    weather: { ...sampleWeather, air_temp_c: 10, water_temp_c: 11, hourly: build7dHourly('sharp_rise') },
    baseDate,
  });
  const reversalSlots = computeFIndexForecast({
    species: peacefulLesh,
    weather: { ...sampleWeather, air_temp_c: 10, water_temp_c: 11, hourly: build7dHourly('reversal') },
    baseDate,
  });

  assert.equal(steadySlots.length, 56);
  const steadyDay4 = steadySlots.find((s) => s.date === '2026-10-15' && s.hour_interval === '12:00')!;
  const riseDay4 = riseSlots.find((s) => s.date === '2026-10-15' && s.hour_interval === '12:00')!;
  const reversalDay4 = reversalSlots.find((s) => s.date === '2026-10-15' && s.hour_interval === '12:00')!;

  assert.equal(steadyDay4.pressure_trend, 'steady');
  assert.equal(riseDay4.pressure_trend, 'sharp_rise');
  assert.ok(
    steadyDay4.f_index >= riseDay4.f_index + 15,
    `Steady day 4 (${steadyDay4.f_index}) must strongly beat sharp barometric jump (${riseDay4.f_index})`
  );
  assert.ok(riseDay4.factors.some((f) => f.includes('Резкий скачок давления')));
  assert.ok(
    steadyDay4.f_index >= reversalDay4.f_index + 12,
    `Steady day 4 (${steadyDay4.f_index}) must beat barometric reversal (${reversalDay4.f_index})`
  );
  assert.ok(reversalDay4.factors.some((f) => f.includes('Перелом давления')));
});

test('GPSFilter rejects speed spikes and poor accuracy, and smooths static shore jitter', () => {
  const filter = new GPSFilter({ maxSpeedMs: 30, maxAccuracyM: 80, jitterRadiusM: 10, smoothingAlpha: 0.25 });
  const t0 = 1_700_000_000_000;

  const p1 = filter.addPoint({ lat: 56.02, lng: 36.83, accuracy_m: 12, timestamp: t0 });
  assert.equal(p1.rejected, false);
  assert.equal(p1.smoothed, false);

  // Unrealistic jump (~1.1 km in 2 seconds -> ~550 m/s) must be rejected
  const spike = filter.addPoint({ lat: 56.03, lng: 36.83, accuracy_m: 15, timestamp: t0 + 2000 });
  assert.equal(spike.rejected, true);
  assert.equal(spike.reason, 'speed_spike');
  assert.equal(spike.coords.lat, 56.02);

  // Degraded accuracy (> 80 m) right after a good fix must be rejected
  const badAcc = filter.addPoint({ lat: 56.0202, lng: 36.8302, accuracy_m: 180, timestamp: t0 + 10_000 });
  assert.equal(badAcc.rejected, true);
  assert.equal(badAcc.reason, 'low_accuracy');

  // Small 4m static drift within 15m accuracy should be exponentially smoothed
  const jitter = filter.addPoint({ lat: 56.02004, lng: 36.83, accuracy_m: 15, timestamp: t0 + 15_000 });
  assert.equal(jitter.rejected, false);
  assert.equal(jitter.smoothed, true);
  assert.equal(jitter.reason, 'static_jitter');
  assert.ok(jitter.coords.lat > 56.02 && jitter.coords.lat < 56.02004);
});

test('snapPointToWaterShore snaps near-shore points within 30m and keeps distant/interior points untouched', () => {
  const pond: Pick<WaterBody, 'id' | 'polygon'> = {
    id: 'wb-test-pond',
    polygon: [
      [36.8, 56.0],
      [36.804, 56.0],
      [36.804, 56.002],
      [36.8, 56.002],
      [36.8, 56.0],
    ],
  };

  // Point ~11m south of the south shore (56.0 -> 55.9999 ≈ 11.1m)
  const nearShore = snapPointToWaterShore({ lat: 55.9999, lng: 36.802 }, [pond], 30);
  assert.equal(nearShore.snapped, true);
  assert.equal(nearShore.waterBodyId, 'wb-test-pond');
  assert.equal(nearShore.coords.lat, 56);
  assert.ok((nearShore.distance_m ?? 99) <= 15);

  // Point ~110m south of shore should not snap
  const farAway = snapPointToWaterShore({ lat: 55.999, lng: 36.802 }, [pond], 30);
  assert.equal(farAway.snapped, false);
  assert.equal(farAway.waterBodyId, null);

  // Point already inside water stays untouched
  const inside = snapPointToWaterShore({ lat: 56.001, lng: 36.802 }, [pond], 30);
  assert.equal(inside.snapped, false);
  assert.equal(inside.waterBodyId, 'wb-test-pond');
  assert.equal(inside.distance_m, 0);
});

test('parseOsmWaterTags extracts real max_depth, fishing legality, and Cyrillic/Latin species tags', () => {
  const res = parseOsmWaterTags({
    max_depth: '14,5 м',
    fishing: 'permit',
    species: 'щука; судак; окунь; bream',
  });
  assert.equal(res.max_depth_m, 14.5);
  assert.equal(res.depth_source, 'osm');
  assert.ok(res.avg_depth_m && res.avg_depth_m > 5 && res.avg_depth_m < 9);
  assert.equal(res.fishing_access, 'paid');
  const ids = (res.inhabiting_species ?? []).map((s) => s.species_id).sort();
  assert.deepEqual(ids, ['bream', 'perch', 'pike', 'zander']);

  const forbidden = parseOsmWaterTags({ fishing: 'no', depth: '3.2 m' });
  assert.equal(forbidden.fishing_access, 'forbidden');
  assert.equal(forbidden.avg_depth_m, 3.2);
  assert.equal(forbidden.depth_source, 'osm');

  const allowed = parseOsmWaterTags({ leisure: 'fishing' });
  assert.equal(allowed.fishing_access, 'allowed');
});






