import type { LatLng, MapBbox, WaterBody } from './types';

export interface RegionOption {
  id: string;
  name: string;
  shortName: string;
  center: LatLng;
  bbox: MapBbox;
  defaultRadiusKm: number;
  osmQueryHint: string;
  keywords: string[];
  featuredQueries?: string[];
}

export const REGIONS_CATALOG: RegionOption[] = [
  {
    id: 'moscow_oblast',
    name: 'Московская область',
    shortName: 'Московская обл.',
    center: { lat: 55.92, lng: 37.35 },
    bbox: { north: 56.96, south: 54.25, east: 40.25, west: 35.12 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Московская область',
    keywords: [
      'московск',
      'подмосков',
      'москва',
      'истринск',
      'можайск',
      'рузск',
      'озернинск',
      'пестовск',
      'учинск',
      'пяловск',
      'клязьминск',
      'пироговск',
      'икшинск',
      'сенеж',
      'звенигород',
      'волоколамск',
      'подольск',
      'клин',
      'наро-фоминск',
      'лотошин',
    ],
    featuredQueries: [
      'Пестовское водохранилище',
      'Учинское водохранилище',
      'Пироговское водохранилище',
      'Клязьминское водохранилище',
      'Канал имени Москвы',
    ],
  },
  {
    id: 'tver_oblast',
    name: 'Тверская область',
    shortName: 'Тверская обл.',
    center: { lat: 56.86, lng: 35.91 },
    bbox: { north: 58.85, south: 55.62, east: 38.45, west: 30.85 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Тверская область',
    keywords: ['тверск', 'иваньковск', 'селигер', 'шоша', 'конаков', 'дубна', 'угличск'],
    featuredQueries: ['Иваньковское водохранилище', 'озеро Селигер', 'Вышневолоцкое водохранилище'],
  },
  {
    id: 'kaluga_oblast',
    name: 'Калужская область',
    shortName: 'Калужская обл.',
    center: { lat: 54.51, lng: 36.26 },
    bbox: { north: 55.35, south: 53.25, east: 37.35, west: 33.45 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Калужская область',
    keywords: ['калужск', 'боровск', 'протва', 'угра', 'людинов'],
    featuredQueries: ['Людиновское водохранилище', 'Яченское водохранилище'],
  },
  {
    id: 'smolensk_oblast',
    name: 'Смоленская область',
    shortName: 'Смоленская обл.',
    center: { lat: 55.25, lng: 33.85 },
    bbox: { north: 56.25, south: 53.45, east: 35.42, west: 30.75 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Смоленская область',
    keywords: ['смоленск', 'яузск', 'вазузск', 'десногорск'],
    featuredQueries: ['Яузское водохранилище', 'Вазузское водохранилище', 'Десногорское водохранилище'],
  },
  {
    id: 'yaroslavl_oblast',
    name: 'Ярославская область',
    shortName: 'Ярославская обл.',
    center: { lat: 57.85, lng: 39.12 },
    bbox: { north: 59.05, south: 56.55, east: 41.25, west: 37.35 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Ярославская область',
    keywords: ['ярославск', 'рыбинск', 'угличск', 'плещеев', 'неро'],
    featuredQueries: ['Рыбинское водохранилище', 'Угличское водохранилище', 'Плещеево озеро'],
  },
  {
    id: 'kursk_oblast',
    name: 'Курская область',
    shortName: 'Курская обл.',
    center: { lat: 51.67, lng: 35.65 },
    bbox: { north: 52.48, south: 50.88, east: 38.55, west: 34.05 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Курская область',
    keywords: ['курск', 'сейм', 'льгов', 'сугров', 'курчатов', 'старооскольск', 'михайловск'],
    featuredQueries: ['Сейм', 'Городское озеро Льгов', 'Плотина в Сугрове', 'Курское водохранилище', 'Курчатовское водохранилище'],
  },
  {
    id: 'vladimir_oblast',
    name: 'Владимирская область',
    shortName: 'Владимирская обл.',
    center: { lat: 56.13, lng: 40.40 },
    bbox: { north: 56.85, south: 55.12, east: 42.95, west: 38.28 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Владимирская область',
    keywords: ['владимирск', 'клязьма', 'муром', 'ковров', 'александров'],
    featuredQueries: ['Клязьма', 'Ока'],
  },
  {
    id: 'ryazan_oblast',
    name: 'Рязанская область',
    shortName: 'Рязанская обл.',
    center: { lat: 54.62, lng: 39.73 },
    bbox: { north: 55.42, south: 53.30, east: 42.65, west: 38.55 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Рязанская область',
    keywords: ['рязанск', 'пронск', 'мокша', 'пра', 'мещер'],
    featuredQueries: ['Пронское водохранилище', 'Ока'],
  },
  {
    id: 'tula_oblast',
    name: 'Тульская область',
    shortName: 'Тульская обл.',
    center: { lat: 54.19, lng: 37.62 },
    bbox: { north: 54.85, south: 52.95, east: 38.95, west: 35.85 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Тульская область',
    keywords: ['тульск', 'пронск', 'шатск', 'черепетск', 'упа'],
    featuredQueries: ['Черепетское водохранилище', 'Шатское водохранилище'],
  },
  {
    id: 'leningrad_oblast',
    name: 'Ленинградская область',
    shortName: 'Ленинградская обл.',
    center: { lat: 60.05, lng: 30.85 },
    bbox: { north: 61.35, south: 58.42, east: 35.75, west: 27.75 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Ленинградская область',
    keywords: ['ленинградск', 'санкт-петербург', 'ладожск', 'вуокса', 'волхов', 'свирь', 'нарвск'],
    featuredQueries: ['Ладожское озеро', 'Вуокса', 'Нарвское водохранилище'],
  },
  {
    id: 'nizhny_oblast',
    name: 'Нижегородская область',
    shortName: 'Нижегородская обл.',
    center: { lat: 56.45, lng: 43.95 },
    bbox: { north: 58.10, south: 54.45, east: 47.75, west: 41.75 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Нижегородская область',
    keywords: ['нижегородск', 'горьковск', 'чебоксарск', 'ветлуга', 'сура'],
    featuredQueries: ['Горьковское водохранилище', 'Чебоксарское водохранилище'],
  },
  {
    id: 'voronezh_oblast',
    name: 'Воронежская область',
    shortName: 'Воронежская обл.',
    center: { lat: 51.67, lng: 39.20 },
    bbox: { north: 52.12, south: 49.55, east: 42.95, west: 38.15 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Воронежская область',
    keywords: ['воронежск', 'дон', 'битюг', 'хопёр'],
    featuredQueries: ['Воронежское водохранилище', 'Дон'],
  },
  {
    id: 'samara_oblast',
    name: 'Самарская область',
    shortName: 'Самарская обл.',
    center: { lat: 53.35, lng: 49.95 },
    bbox: { north: 54.68, south: 51.78, east: 52.58, west: 47.92 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Самарская область',
    keywords: ['самарск', 'куйбышевск', 'саратовск', 'жигулёвск', 'тольятти'],
    featuredQueries: ['Куйбышевское водохранилище', 'Саратовское водохранилище'],
  },
  {
    id: 'astrakhan_oblast',
    name: 'Астраханская область',
    shortName: 'Астраханская обл.',
    center: { lat: 46.55, lng: 48.03 },
    bbox: { north: 48.85, south: 45.55, east: 49.45, west: 44.95 },
    defaultRadiusKm: 35,
    osmQueryHint: 'Астраханская область',
    keywords: ['астраханск', 'ахтуба', 'бузан', 'бахтемир', 'волга'],
    featuredQueries: ['Ахтуба', 'Волга'],
  },
];

export function getRegionById(regionId?: string | null): RegionOption | undefined {
  if (!regionId || regionId === 'all') return undefined;
  return REGIONS_CATALOG.find((r) => r.id === regionId);
}

export function isPointInRegionBbox(point: LatLng, bbox: MapBbox): boolean {
  return (
    point.lat >= bbox.south &&
    point.lat <= bbox.north &&
    point.lng >= bbox.west &&
    point.lng <= bbox.east
  );
}

export function matchesWaterBodyRegion(wb: WaterBody, regionId?: string | null): boolean {
  if (!regionId || regionId === 'all') return true;
  const reg = getRegionById(regionId);
  if (!reg) {
    const q = regionId.trim().toLowerCase();
    return (
      wb.region.toLowerCase().includes(q) ||
      wb.display_label.toLowerCase().includes(q)
    );
  }

  const combinedText = `${wb.region || ''} ${wb.display_label || ''}`.toLowerCase();
  if (reg.keywords.some((kw) => combinedText.includes(kw))) {
    // Guard against distant identically named rivers outside the oblast bbox (tolerance ~0.5 deg)
    const pad = 0.55;
    if (
      wb.center.lat >= reg.bbox.south - pad &&
      wb.center.lat <= reg.bbox.north + pad &&
      wb.center.lng >= reg.bbox.west - pad &&
      wb.center.lng <= reg.bbox.east + pad
    ) {
      return true;
    }
  }

  return isPointInRegionBbox(wb.center, reg.bbox);
}

/**
 * Classifies whether a water body is a major target water body
 * (large reservoirs, large lakes, navigable canals, major rivers, large quarries)
 * vs minor tributaries, brooks, and small village ponds.
 */
export function isMajorWaterBody(wb: WaterBody): boolean {
  const label = (wb.display_label || '').toLowerCase();
  const area = Math.max(0, wb.area_ha || 0);
  const maxD = wb.max_depth_m ?? 0;

  if (wb.type === 'reservoir') {
    return area >= 40 || label.includes('водохранилище') || label.includes('вдхр');
  }
  if (wb.type === 'lake') {
    return area >= 45 || (area >= 25 && maxD >= 6);
  }
  if (wb.type === 'river') {
    if (label.includes('канал')) return true;
    return area >= 90 || (area >= 60 && maxD >= 4.0);
  }
  if (wb.type === 'quarry') {
    return area >= 35;
  }
  return false;
}

export function filterWaterBodiesByRegionAndScale(
  waterBodies: WaterBody[],
  options: { regionId?: string | null; majorOnly?: boolean }
): WaterBody[] {
  return waterBodies.filter((wb) => {
    if (options.regionId && options.regionId !== 'all' && !matchesWaterBodyRegion(wb, options.regionId)) {
      return false;
    }
    if (options.majorOnly && !isMajorWaterBody(wb)) {
      return false;
    }
    return true;
  });
}
