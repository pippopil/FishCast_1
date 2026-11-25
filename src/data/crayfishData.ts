import type { LatLng, WaterBody } from '../lib/types';

export interface CrayfishSpot {
  id: string;
  name: string;
  region: string;
  waterType: 'Река' | 'Водохранилище' | 'Озеро' | 'Карьер';
  coords: LatLng;
  bottomType: string;
  depthRangeM: string;
  bestZones: string;
  peakSeason: string;
  waterQuality: 'Очень чистая' | 'Чистая' | 'Умеренно чистая';
  abundance: 'Высокая' | 'Средняя' | 'Локально высокая';
  tips: string;
}

export interface CrayfishMethod {
  id: string;
  name: string;
  effectiveness: 'Высокая' | 'Средняя';
  gearSpec: string;
  howToUse: string;
  bestFor: string;
  legalNote: string;
}

export interface CrayfishBait {
  id: string;
  name: string;
  seasonFit: string;
  prepTip: string;
  rating: number; // 1..5
}

export interface CrayfishMonthEntry {
  month: number; // 1..12
  shortName: string;
  activity: number; // 0..100
  phase: 'Зимовка' | 'Пробуждение' | 'Нерест / запрет' | 'Линька' | 'Жор / лучший сезон' | 'Угасание';
  note: string;
}

export const CRAYFISH_SPOTS: CrayfishSpot[] = [
  {
    id: 'cf-seym',
    name: 'Река Сейм',
    region: 'Курская область',
    waterType: 'Река',
    coords: { lat: 51.686, lng: 36.122 },
    bottomType: 'Глина, известняк, песчано-галечные бровки',
    depthRangeM: '1.0–3.5 м',
    bestZones: 'Подмытые глинистые яры с корнями ольхи, тихие заводи и каменные перекаты ниже Курска и в районе Курчатова/Льгова',
    peakSeason: 'Август – октябрь',
    waterQuality: 'Чистая',
    abundance: 'Высокая',
    tips: 'Ставьте раколовки на границе обратного течения и глинистой бровки на закате; хорошо работает свежая резаная плотва с чесноком.',
  },
  {
    id: 'cf-oka',
    name: 'Река Ока (среднее течение)',
    region: 'Московская / Калужская / Рязанская обл.',
    waterType: 'Река',
    coords: { lat: 54.845, lng: 37.982 },
    bottomType: 'Известняковые плиты, ракушечник, крупный песок',
    depthRangeM: '1.5–4.5 м',
    bestZones: 'Каменистые россыпи под обрывами, тихие старицы и обратки ниже Серпухова, Тарусы и Каширы',
    peakSeason: 'Конец августа – октябрь',
    waterQuality: 'Чистая',
    abundance: 'Высокая',
    tips: 'На сильном течении используйте утяжелённые раколовки; рак активно выходит на галечные мели после 21:00.',
  },
  {
    id: 'cf-istra',
    name: 'Истринское водохранилище',
    region: 'Московская область',
    waterType: 'Водохранилище',
    coords: { lat: 56.028, lng: 36.826 },
    bottomType: 'Твёрдая глина, песчаные мысы, затопленные коряги',
    depthRangeM: '1.5–4.0 м',
    bestZones: 'Каменистые и глинистые берега заливов в районе Лопотово, Пятницы и верховьев без густого ила',
    peakSeason: 'Август – сентябрь',
    waterQuality: 'Чистая',
    abundance: 'Средняя',
    tips: 'Выбирайте твёрдые прогалы между водорослями; при похолодании воды ниже +12°C смещайте снасти на 3.5–5 м.',
  },
  {
    id: 'cf-ozerna',
    name: 'Озернинское водохранилище',
    region: 'Московская область',
    waterType: 'Водохранилище',
    coords: { lat: 55.775, lng: 36.245 },
    bottomType: 'Глина, коряжник, песчаные бровки',
    depthRangeM: '1.2–3.8 м',
    bestZones: 'Изрезанные заливы с крутыми глинистыми берегами, участки у затопленного леса и мостов',
    peakSeason: 'Август – октябрь',
    waterQuality: 'Очень чистая',
    abundance: 'Локально высокая',
    tips: 'Один из самых чистых водоёмов Подмосковья — рак держится в норах под крутыми берегами и выходит кормиться к границе травы.',
  },
  {
    id: 'cf-mozhaysk',
    name: 'Можайское водохранилище',
    region: 'Московская область',
    waterType: 'Водохранилище',
    coords: { lat: 55.588, lng: 35.845 },
    bottomType: 'Глина, камни, ракушка на бровках',
    depthRangeM: '1.5–4.5 м',
    bestZones: 'Обрывистые глинистые берега в районе Красновидово, Горетово и устья Колочи',
    peakSeason: 'Конец августа – октябрь',
    waterQuality: 'Чистая',
    abundance: 'Средняя',
    tips: 'Проверяйте снасти каждые 40–50 минут, в ясные тёплые ночи пик попаданий приходится на 22:00–01:00.',
  },
  {
    id: 'cf-seliger',
    name: 'Озеро Селигер',
    region: 'Тверская область',
    waterType: 'Озеро',
    coords: { lat: 57.245, lng: 33.105 },
    bottomType: 'Чистый песок, валуны, известняк, корни сосен',
    depthRangeM: '0.8–3.5 м',
    bestZones: 'Проточные плёсы, каменистые отмели островов и заливы с ключевой водой',
    peakSeason: 'Конец июля – октябрь',
    waterQuality: 'Очень чистая',
    abundance: 'Высокая',
    tips: 'В прозрачной воде Селигера рак отлично виден с фонарём на мелководье ночью; при ловле раколовками лучше работает свежий окунь или ёрш.',
  },
  {
    id: 'cf-ugra-protva',
    name: 'Реки Угра и Протва',
    region: 'Калужская область',
    waterType: 'Река',
    coords: { lat: 54.695, lng: 35.865 },
    bottomType: 'Известняк, галька, подмытые корни, чистый песок',
    depthRangeM: '0.7–2.8 м',
    bestZones: 'Каменные завалы, тихие протоки за перекатами, норы в глинистых берегах',
    peakSeason: 'Август – сентябрь',
    waterQuality: 'Очень чистая',
    abundance: 'Высокая',
    tips: 'Проверьте границы нацпарка «Угра» перед выездом — на ряде участков действуют ограничения на вылов.',
  },
  {
    id: 'cf-don',
    name: 'Река Дон и старицы',
    region: 'Воронежская / Липецкая обл.',
    waterType: 'Река',
    coords: { lat: 51.515, lng: 39.045 },
    bottomType: 'Меловые и глинистые обрывы, коряжник, ракушка',
    depthRangeM: '1.2–4.0 м',
    bestZones: 'Подмытые меловые яры, затоны, приустьевые участки Битюга и Воронежа',
    peakSeason: 'Конец августа – ноябрь',
    waterQuality: 'Чистая',
    abundance: 'Высокая',
    tips: 'В южных областях вода остывает позже — осенний жор рака длится вплоть до начала ноября.',
  },
  {
    id: 'cf-khoper',
    name: 'Река Хопёр',
    region: 'Воронежская / Волгоградская обл.',
    waterType: 'Река',
    coords: { lat: 51.185, lng: 41.785 },
    bottomType: 'Чистый песок, затопленные дубы, глинистые бровки',
    depthRangeM: '1.0–3.5 м',
    bestZones: 'Участки с обратным течением у коряжников и обрывистых берегов (вне границ заповедника)',
    peakSeason: 'Август – октябрь',
    waterQuality: 'Очень чистая',
    abundance: 'Высокая',
    tips: 'Хопёр славится высокой чистотой воды — крупный широкопалый и узкопалый рак держится на песчано-глинистых бровках.',
  },
  {
    id: 'cf-akhtuba',
    name: 'Волга и Ахтуба (ерики и затоны)',
    region: 'Астраханская / Волгоградская обл.',
    waterType: 'Река',
    coords: { lat: 47.425, lng: 47.245 },
    bottomType: 'Твёрдая глина, коряги, ракушечник',
    depthRangeM: '1.0–3.5 м',
    bestZones: 'Проточные ерики, тихие затоны, обрывистые глинистые яры со спокойным течением',
    peakSeason: 'Сентябрь – ноябрь',
    waterQuality: 'Чистая',
    abundance: 'Высокая',
    tips: 'Из-за сильного течения на основном русле лучше облавливать проточные ерики и выходы из затонов.',
  },
  {
    id: 'cf-pra',
    name: 'Река Пра и озёра Мещёры',
    region: 'Рязанская область',
    waterType: 'Река',
    coords: { lat: 54.965, lng: 40.325 },
    bottomType: 'Песок, корни деревьев, локальная глина',
    depthRangeM: '0.8–2.5 м',
    bestZones: 'Проточные участки ниже озёр и заводи с подмытыми берегами (вне зон запрета нацпарка)',
    peakSeason: 'Август – сентябрь',
    waterQuality: 'Чистая',
    abundance: 'Средняя',
    tips: 'Лучше ставить снасти на границе тёмного торфяного дна и светлой песчаной косы с течением.',
  },
  {
    id: 'cf-sychevo',
    name: 'Чистые песчаные и известняковые карьеры',
    region: 'Московская / Тульская / Калужская обл.',
    waterType: 'Карьер',
    coords: { lat: 55.955, lng: 36.225 },
    bottomType: 'Песок, известняковые уступы, редкий коряжник',
    depthRangeM: '1.5–5.0 м',
    bestZones: 'Ступеньки и террасы на 1.5–3 м с твёрдым грунтом, затопленные плиты и кусты',
    peakSeason: 'Август – октябрь',
    waterQuality: 'Очень чистая',
    abundance: 'Локально высокая',
    tips: 'В глубоких карьерах с ключевой водой рак держится на верхних ступеньках до термоклина — не ставьте снасти глубже 5–6 м летом.',
  },
];

export const CRAYFISH_HABITAT_SIGNS: Array<{ title: string; detail: string }> = [
  {
    title: 'Чистая, богатая кислородом вода',
    detail: 'Рак — природный биоиндикатор. Он избегает заморных, цветущих и загрязнённых стоками водоёмов; предпочитает проточность или подземные ключи.',
  },
  {
    title: 'Твёрдое дно: глина, известняк, галька, крупный песок',
    detail: 'В глубоком мягком чёрном илу раку негде рыть норы. Ищите крутые подмытые глинистые берега, каменные россыпи и песчано-галечные бровки.',
  },
  {
    title: 'Укрытия и норы на глубине 0.5–4 м',
    detail: 'Днём рак прячется в норах (глубиной до 30–60 см) под корнями ольхи и ивы, под корягами, плитами и крупными камнями.',
  },
  {
    title: 'Сезонная смена глубины',
    detail: 'В июле–сентябре выходит кормиться на 0.5–2.5 м к границе водной растительности; с охлаждением воды ниже +10°C уходит на ямы и бровки 3–6 м.',
  },
];

export const CRAYFISH_METHODS: CrayfishMethod[] = [
  {
    id: 'm-rakolovka',
    name: 'Раколовка-чернильница / закрытый «зонтик»',
    effectiveness: 'Высокая',
    gearSpec: 'Диаметр до 80 см, ячея от 22 мм, 2–6 входов, груз на дно + прочный шнур с незаметным поплавком',
    howToUse: 'Закрепите приманку по центру дна, опустите на границе твёрдой бровки и ила на 40–60 минут. Поднимайте плавно без рывков, чтобы раки не вылетели на старте.',
    bestFor: 'Ночная ловля с берега или лодки на реках со слабым течением, озёрах и водохранилищах.',
    legalNote: 'Во многих регионах РФ разрешено до 3–5 раколовок на человека диаметром не более 80 см — сверяйтесь с правилами вашего рыбохозяйственного бассейна.',
  },
  {
    id: 'm-podyemnik',
    name: 'Открытая раколовка-подъёмник (круг / «тарелка»)',
    effectiveness: 'Высокая',
    gearSpec: '1 или 2 обруча (50–70 см), сетное полотно, приманка строго по центру, длинный шест или шнур',
    howToUse: 'Рак свободно заползает на запах приманки; проверяйте чаще — каждые 15–25 минут, поднимая снасть уверенным, но ровным движением вертикально вверх.',
    bestFor: 'Активный вечерний и ночной поиск рака с частыми перестановками вдоль берега.',
    legalNote: 'Удобна тем, что мелкого рака и икряных самок можно мгновенно и без травм отпустить обратно.',
  },
  {
    id: 'm-hands',
    name: 'Ловля руками с маской или фонарём на мелководье',
    effectiveness: 'Средняя',
    gearSpec: 'Маска + трубка днём (по норам под корягами и камнями) или налобный фонарь ночью по урезу 0.3–1.2 м, плотные перчатки',
    howToUse: 'Днём аккуратно проверяйте вход в нору под корнями и плоскими камнями; ночью в тихую погоду раки сами ползают по песчаным отмелям и собираются сачком/рукой.',
    bestFor: 'Прозрачные реки (Угра, Протва, Сейм, Хопёр), озёра (Селигер) и песчаные карьеры в тёплой воде.',
    legalNote: 'Запрещена в период нерестового запрета; помните о правилах безопасности в воде и не ловите с аквалангом (запрещено правилами).',
  },
  {
    id: 'm-rod',
    name: 'Поплавочная / донная «рачница» на кусок рыбы',
    effectiveness: 'Средняя',
    gearSpec: 'Обычное удилище, леска 0.25–0.3 мм, кусочек рыбы или мяса на нитке/безбородом крючке + подсачек',
    howToUse: 'Рак крепко хватает приманку клешнями и держит её при очень медленном подтягивании к берегу, где его аккуратно заводят в подсачек.',
    bestFor: 'Запасной способ, когда под рукой нет раколовок, но видно выход рака у берега.',
    legalNote: '100% щадящий способ, полностью законный в разрешённые сроки.',
  },
];

export const CRAYFISH_BAITS: CrayfishBait[] = [
  {
    id: 'b-fresh-fish',
    name: 'Свежая резаная рыба (плотва, карась, окунь, ёрш)',
    seasonFit: 'Универсально: лето и особенно осень',
    prepTip: 'Сделайте 3–4 надреза по бокам до хребта, чтобы шёл сок и запах. Вопреки мифу, свежая рыба в чистой воде часто работает лучше тухлой!',
    rating: 5,
  },
  {
    id: 'b-garlic-bread',
    name: 'Чёрный хлеб + давленый чеснок + жмых / укроп',
    seasonFit: 'Тёплая вода (июль – сентябрь)',
    prepTip: 'Смешайте мякиш ржаного хлеба с 2–3 зубчиками чеснока и поместите в марлевый/капроновый мешочек — сильный аромат собирает рака издалека.',
    rating: 4,
  },
  {
    id: 'b-liver',
    name: 'Куриная печень, сердце или говяжий край',
    seasonFit: 'Конец лета – поздняя осень',
    prepTip: 'Отлично держится в мешочке из сетки и даёт устойчивый кровяной след даже в холодной воде (+6…+12°C).',
    rating: 5,
  },
  {
    id: 'b-dried-fish',
    name: 'Слегка подвяленная / «с душком» рыба (лещ, мойва, скумбрия)',
    seasonFit: 'Стоячая вода, озёра и водохранилища',
    prepTip: 'Не доводите до сильного разложения — лёгкий аромат солёно-вяленой или чуть полежавшей рыбы работает лучше резкой гнили.',
    rating: 4,
  },
  {
    id: 'b-mussel',
    name: 'Мясо речной перловицы / беззубки',
    seasonFit: 'Лето и начало осени',
    prepTip: 'Естественный корм рака в этом же водоёме — раздавите ракушку и положите в раколовку вместе со створками.',
    rating: 4,
  },
];

export const CRAYFISH_CALENDAR: CrayfishMonthEntry[] = [
  { month: 1, shortName: 'Янв', activity: 10, phase: 'Зимовка', note: 'В глубоких норах на ямах, почти не питается.' },
  { month: 2, shortName: 'Фев', activity: 10, phase: 'Зимовка', note: 'Зимний покой; самки вынашивают икру под брюшком.' },
  { month: 3, shortName: 'Мар', activity: 18, phase: 'Зимовка', note: 'Слабая активность в оттепели, икра у самок сохраняется.' },
  { month: 4, shortName: 'Апр', activity: 35, phase: 'Пробуждение', note: 'При прогреве воды выше +7°C самцы начинают выходить из нор.' },
  { month: 5, shortName: 'Май', activity: 25, phase: 'Нерест / запрет', note: 'Весенний запрет! Самки с икрой/личинками — вылов запрещён.' },
  { month: 6, shortName: 'Июн', activity: 30, phase: 'Нерест / запрет', note: 'Вылупление молоди и первая линька; в большинстве регионов запрет до 10–30 июня.' },
  { month: 7, shortName: 'Июл', activity: 58, phase: 'Линька', note: 'После линьки рак начинает активно отъедаться по ночам на мелководье.' },
  { month: 8, shortName: 'Авг', activity: 85, phase: 'Жор / лучший сезон', note: 'Старт лучшего сезона (после второй линьки во второй половине августа).' },
  { month: 9, shortName: 'Сен', activity: 100, phase: 'Жор / лучший сезон', note: 'Пик сезона! Плотный панцирь, активный ночной жор перед зимой.' },
  { month: 10, shortName: 'Окт', activity: 92, phase: 'Жор / лучший сезон', note: 'Отличный осенний клёв на глубинах 2.5–5 м, особенно в тихие вечера.' },
  { month: 11, shortName: 'Ноя', activity: 45, phase: 'Угасание', note: 'При воде ниже +6°C рак уходит в зимовальные норы; клёв в южных областях.' },
  { month: 12, shortName: 'Дек', activity: 15, phase: 'Зимовка', note: 'Зимовка на глубине, активность минимальная.' },
];

export const CRAYFISH_TIMING_AND_RULES = {
  bestTimeOfDay: 'Сумерки и ночь: с 20:00 до 04:00 (пик выхода из нор — 21:00–01:00). Днём раки почти всегда сидят в укрытиях, кроме пасмурной погоды осенью.',
  bestWeather: 'Тёплые тихие безветренные ночи, стабильное атмосферное давление, умеренная облачность или слабый тёплый дождь. Резкое похолодание, сильный прибой и мутный паводок резко снижают выход.',
  legalSummary: 'Минимальный промысловый размер (от линии глаз до конца средних хвостовых пластин) — обычно 9–10 см; мелких и икряных самок обязательно отпускайте. В весенний период и период линьки действуют региональные запреты (уточняйте Правила рыболовства вашего бассейна).',
};

export interface CrayfishPresenceAssessment {
  level: 'high' | 'medium' | 'low';
  score: number;
  confirmedSpot: CrayfishSpot | null;
  shortLabel: string;
  compactBadge: string;
  summary: string;
  bestSeason: string;
  depthHint: string;
  reasons: string[];
}

const HYDRO_STOPWORDS = new Set([
  'река',
  'речка',
  'озеро',
  'водохранилище',
  'вдхр',
  'пруд',
  'карьер',
  'карьеры',
  'канал',
  'старица',
  'залив',
  'бассейн',
  'область',
  'обл',
  'среднее',
  'верхнее',
  'нижнее',
  'течение',
  'и',
]);

function normalizeHydroTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-zа-я0-9\s/-]+/g, ' ')
    .split(/[\s/-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !HYDRO_STOPWORDS.has(t));
}

function quickDistanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function matchKnownCrayfishSpot(waterBody: WaterBody): CrayfishSpot | null {
  const wbTokens = normalizeHydroTokens(waterBody.display_label);

  for (const spot of CRAYFISH_SPOTS) {
    const spotTokens = normalizeHydroTokens(spot.name);
    const nameMatch =
      wbTokens.length > 0 &&
      spotTokens.some((st) => {
        const stem = st.length >= 5 ? st.slice(0, st.length - 2) : st;
        return wbTokens.some((wt) => wt === st || (stem.length >= 4 && wt.startsWith(stem)));
      });
    if (nameMatch) {
      return spot;
    }

    // Spatial match within 12 km for matching water body class (e.g., unnamed or alternate-name segment)
    const distKm = quickDistanceKm(waterBody.center, spot.coords);
    const typeCompat =
      (waterBody.type === 'river' && spot.waterType === 'Река') ||
      (waterBody.type === 'reservoir' && spot.waterType === 'Водохранилище') ||
      ((waterBody.type === 'lake' || waterBody.type === 'quarry') &&
        (spot.waterType === 'Озеро' || spot.waterType === 'Карьер'));
    if (distKm <= 12 && typeCompat) {
      return spot;
    }
  }
  return null;
}

/**
 * Evaluates whether crayfish (раки) likely inhabit a given water body,
 * cross-referencing the curated CRAYFISH_SPOTS database first and falling back
 * to hydrological / ecological bioindicator criteria for any discovered OSM water body.
 */
export function assessCrayfishPresence(waterBody: WaterBody): CrayfishPresenceAssessment {
  const matched = matchKnownCrayfishSpot(waterBody);
  if (matched) {
    return {
      level: 'high',
      score: 92,
      confirmedSpot: matched,
      shortLabel: 'Раки: обитают (высокая вероятность)',
      compactBadge: 'Раки: обитают',
      summary: `${matched.bestZones}. ${matched.tips}`,
      bestSeason: matched.peakSeason,
      depthHint: matched.depthRangeM,
      reasons: [
        'Водоём в базе раковых мест',
        `вода: ${matched.waterQuality.toLowerCase()}`,
        `дно: ${matched.bottomType.toLowerCase()}`,
      ],
    };
  }

  let score = 46;
  const reasons: string[] = [];

  if (waterBody.water_clarity === 'clear') {
    score += 24;
    reasons.push('чистая вода (ключевой индикатор для раков)');
  } else if (waterBody.water_clarity === 'moderate') {
    score += 8;
    reasons.push('умеренная прозрачность воды');
  } else {
    score -= 18;
    reasons.push('мутная вода снижает шансы');
  }

  if (waterBody.type === 'river') {
    score += 16;
    reasons.push('проточная река, хороший кислородный режим');
  } else if (waterBody.type === 'reservoir') {
    score += 12;
    reasons.push('водохранилище с бровками и глинистыми свалами');
  } else if (waterBody.type === 'lake') {
    score += 10;
    reasons.push('озеро с прибрежными укрытиями');
  } else if (waterBody.type === 'quarry') {
    score += 12;
    reasons.push('карьер с твёрдым песчано-известняковым дном');
  } else if (waterBody.type === 'oxbow') {
    score += 2;
    reasons.push('старица (выход рака на твёрдые бровки)');
  } else {
    score -= 8;
    reasons.push('стоячий пруд (риск заиления)');
  }

  if (waterBody.connected_to) {
    score += 8;
    reasons.push('связан с речной сетью');
  }

  if (typeof waterBody.max_depth_m === 'number') {
    if (waterBody.max_depth_m >= 2.5) {
      score += 10;
      reasons.push(`глубина до ${waterBody.max_depth_m} м (пригодно для зимовки)`);
    } else if (waterBody.max_depth_m < 1.2) {
      score -= 22;
      reasons.push('малая глубина (риск промерзания зимой)');
    }
  }

  if (waterBody.ndwi_stability === 'dries_summer') {
    score -= 35;
    reasons.push('пересыхает летом');
  }

  if (waterBody.vegetation_index === 'algal_bloom') {
    score -= 20;
    reasons.push('цветение воды и дефицит кислорода');
  }

  if (waterBody.area_ha < 0.3) {
    score -= 14;
    reasons.push('очень малая площадь акватории');
  }

  const clamped = Math.max(5, Math.min(95, Math.round(score)));
  const depthHint =
    waterBody.type === 'river'
      ? '1.0–3.5 м (подмытые глинистые берега, обратки)'
      : waterBody.type === 'reservoir'
        ? '1.5–4.5 м (глинистые бровки, ракушечник)'
        : '1.0–3.0 м (твёрдое дно, корни, камни)';

  if (clamped >= 68) {
    return {
      level: 'high',
      score: clamped,
      confirmedSpot: null,
      shortLabel: 'Раки: высокая вероятность',
      compactBadge: 'Раки: высокая',
      summary:
        'Экологические условия благоприятны для речного рака — ищите твёрдое глинистое или каменистое дно, корни деревьев и подмытые берега на глубине 1–4 м.',
      bestSeason: 'Август – октябрь',
      depthHint,
      reasons: reasons.slice(0, 4),
    };
  }

  if (clamped >= 42) {
    return {
      level: 'medium',
      score: clamped,
      confirmedSpot: null,
      shortLabel: 'Раки: возможны локально',
      compactBadge: 'Раки: возможны',
      summary:
        'Раки могут встречаться локально на участках с чистым твёрдым дном, родниками или притоком свежей воды; избегайте сильно заиленных заливов.',
      bestSeason: 'Конец августа – октябрь',
      depthHint,
      reasons: reasons.slice(0, 4),
    };
  }

  return {
    level: 'low',
    score: clamped,
    confirmedSpot: null,
    shortLabel: 'Раки: маловероятны',
    compactBadge: 'Раки: маловер.',
    summary:
      'Условия водоёма (малая глубина, стоячая или мутная вода, риск замора) малопригодны для устойчивой популяции раков.',
    bestSeason: 'Август – сентябрь (только при наличии родников)',
    depthHint: 'Участки у родников и твёрдого берега',
    reasons: reasons.slice(0, 4),
  };
}

