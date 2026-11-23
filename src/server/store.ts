import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import {
  SEED_ACCESS_POINTS,
  SEED_BATHYMETRY_POINTS,
  SEED_DATA_VERSION,
  SEED_KNOTS,
  SEED_REPORTS,
  SEED_SPECIES,
  SEED_WATER_BODIES,
} from '../data/seedData.ts';
import type {
  BathymetryPoint,
  BiteForecastResponse,
  CatchReport,
  FishSpecies,
  KnotGuide,
  RouteMultiResult,
  UserProfile,
  WaterBody,
  WaterBodyAccessPoint,
  WaterBodyAnalysis,
  WeatherSnapshot,
} from '../lib/types.ts';

export interface StoredUser extends UserProfile {
  password_hash: string;
}

export interface PersistedDatabase {
  seedVersion?: number;
  users: StoredUser[];
  waterBodies: WaterBody[];
  bathymetryPoints: BathymetryPoint[];
  accessPoints: WaterBodyAccessPoint[];
  catchReports: CatchReport[];
  analyses: Record<string, WaterBodyAnalysis>;
  seenClientEventIds: string[];
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'fishcast-db.json');

const RETIRED_SEED_IDS = new Set([
  'wb-unnamed-pesochnaya',
  'wb-unnamed-rodnik',
  'wb-buzharovo-pond',
  'wb-crowd-unverified',
]);

function createInitialDb(): PersistedDatabase {
  const demoHash = bcrypt.hashSync('fishcast2026', 8);
  return {
    seedVersion: SEED_DATA_VERSION,
    users: [
      {
        id: 'user-demo-1',
        email: 'angler@fishcast.ru',
        password_hash: demoHash,
        nickname: 'Сергей_Истра',
        verified: true,
        privacy_default: 'public',
        created_at: '2026-03-10T08:00:00Z',
      },
      {
        id: 'user-demo-2',
        email: 'andrey@fishcast.ru',
        password_hash: demoHash,
        nickname: 'Андрей_К',
        verified: true,
        privacy_default: 'public',
        created_at: '2026-04-01T10:00:00Z',
      },
    ],
    waterBodies: SEED_WATER_BODIES,
    bathymetryPoints: SEED_BATHYMETRY_POINTS,
    accessPoints: SEED_ACCESS_POINTS,
    catchReports: SEED_REPORTS,
    analyses: {},
    seenClientEventIds: SEED_REPORTS.map((r) => r.client_event_id),
  };
}

class FishCastStore {
  public db: PersistedDatabase;
  public species: FishSpecies[] = SEED_SPECIES;
  public knots: KnotGuide[] = SEED_KNOTS;

  // In-memory TTL caches for external API proxies
  public weatherCache = new Map<string, { data: WeatherSnapshot; expiresAt: number }>();
  public forecastCache = new Map<string, { data: BiteForecastResponse; expiresAt: number }>();
  public routeCache = new Map<string, { data: RouteMultiResult; expiresAt: number }>();
  public nearbyCache = new Map<string, { data: unknown; expiresAt: number }>();
  public reconJobs = new Map<
    string,
    { status: 'queued' | 'completed'; water_body_id: string; result?: WaterBodyAnalysis }
  >();

  // Rate limits and Yandex daily quota counter
  public rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  public yandexDailyUsage = { date: new Date().toISOString().slice(0, 10), routeCalls: 0, geocodeCalls: 0 };

  constructor() {
    this.db = this.loadFromDisk();
  }

  private loadFromDisk(): PersistedDatabase {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedDatabase;
        if (parsed && Array.isArray(parsed.waterBodies) && Array.isArray(parsed.catchReports)) {
          let changed = false;
          const seedWbById = new Map(SEED_WATER_BODIES.map((w) => [w.id, w]));
          const seedApById = new Map(SEED_ACCESS_POINTS.map((a) => [a.id, a]));
          const seedBpById = new Map(SEED_BATHYMETRY_POINTS.map((b) => [b.id, b]));
          const seedRepById = new Map(SEED_REPORTS.map((r) => [r.id, r]));

          if ((parsed.seedVersion ?? 1) < SEED_DATA_VERSION) {
            const customWbs = parsed.waterBodies.filter(
              (w) => !RETIRED_SEED_IDS.has(w.id) && !seedWbById.has(w.id)
            );
            parsed.waterBodies = [...SEED_WATER_BODIES, ...customWbs];

            const customAps = (parsed.accessPoints ?? []).filter(
              (ap) =>
                !RETIRED_SEED_IDS.has(ap.water_body_id) &&
                !seedApById.has(ap.id) &&
                !ap.id.startsWith('ap-')
            );
            parsed.accessPoints = [...SEED_ACCESS_POINTS, ...customAps];

            const customBps = (parsed.bathymetryPoints ?? []).filter(
              (bp) => !RETIRED_SEED_IDS.has(bp.water_body_id) && !seedBpById.has(bp.id)
            );
            parsed.bathymetryPoints = [...SEED_BATHYMETRY_POINTS, ...customBps];

            const customReports = parsed.catchReports.filter(
              (rep) =>
                (!rep.water_body_id || !RETIRED_SEED_IDS.has(rep.water_body_id)) &&
                !seedRepById.has(rep.id)
            );
            parsed.catchReports = [...SEED_REPORTS, ...customReports];

            const cleanedAnalyses: Record<string, WaterBodyAnalysis> = {};
            for (const [wbId, val] of Object.entries(parsed.analyses ?? {})) {
              if (!RETIRED_SEED_IDS.has(wbId) && !seedWbById.has(wbId)) {
                cleanedAnalyses[wbId] = val;
              }
            }
            parsed.analyses = cleanedAnalyses;

            const seenSet = new Set(parsed.seenClientEventIds ?? []);
            for (const r of SEED_REPORTS) seenSet.add(r.client_event_id);
            parsed.seenClientEventIds = Array.from(seenSet);

            parsed.seedVersion = SEED_DATA_VERSION;
            changed = true;
          } else {
            const existingWbIds = new Set(parsed.waterBodies.map((w) => w.id));
            for (const seedWb of SEED_WATER_BODIES) {
              if (!existingWbIds.has(seedWb.id)) {
                parsed.waterBodies.push(seedWb);
                changed = true;
              }
            }
            const existingApIds = new Set((parsed.accessPoints ?? []).map((a) => a.id));
            for (const seedAp of SEED_ACCESS_POINTS) {
              if (!existingApIds.has(seedAp.id)) {
                parsed.accessPoints.push(seedAp);
                changed = true;
              }
            }
          }

          if (changed) this.persist(parsed);
          return parsed;
        }
      }
    } catch {
      // Fallback to fresh seed if corrupted
    }
    const fresh = createInitialDb();
    this.persist(fresh);
    return fresh;
  }

  public persist(target: PersistedDatabase = this.db): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(target, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist store:', err);
    }
  }

  public checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const entry = this.rateLimitBuckets.get(key);
    if (!entry || entry.resetAt <= now) {
      this.rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= maxRequests) {
      return false;
    }
    entry.count += 1;
    return true;
  }

  public trackYandexQuota(kind: 'route' | 'geocode'): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (this.yandexDailyUsage.date !== today) {
      this.yandexDailyUsage = { date: today, routeCalls: 0, geocodeCalls: 0 };
    }
    if (kind === 'geocode') {
      if (this.yandexDailyUsage.geocodeCalls >= 950) return false;
      this.yandexDailyUsage.geocodeCalls += 1;
      return true;
    }
    if (this.yandexDailyUsage.routeCalls >= 950) return false;
    this.yandexDailyUsage.routeCalls += 1;
    return true;
  }
}

export const store = new FishCastStore();
