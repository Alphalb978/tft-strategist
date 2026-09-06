import type Database from '@tauri-apps/plugin-sql';
import type { StaticData, SelectedPlan } from '../domain/models';
import { parsePlatform, type RiotPlatform } from '../providers/riotRouting';
export interface Settings {
  personalWeight: number;
  historyWindow: number;
  riotId: string;
  riotPlatform: RiotPlatform;
}
export const defaultSettings: Settings = {
  personalWeight: 0.05,
  historyWindow: 20,
  riotId: '',
  riotPlatform: 'EUW1',
};
export function normalizeSettings(value?: Partial<Settings> | null): Settings {
  let riotPlatform = defaultSettings.riotPlatform;
  try {
    riotPlatform = parsePlatform(value?.riotPlatform ?? riotPlatform);
  } catch {
    /* Unknown saved values fail closed to the explicit default. */
  }
  return {
    personalWeight: Math.min(
      0.1,
      Math.max(0.05, Number(value?.personalWeight) || defaultSettings.personalWeight),
    ),
    historyWindow: [10, 15, 20].includes(Number(value?.historyWindow))
      ? Number(value?.historyWindow)
      : defaultSettings.historyWindow,
    riotId: typeof value?.riotId === 'string' ? value.riotId : '',
    riotPlatform,
  };
}
export interface Repository {
  mode: 'SQLite' | 'Browser local storage' | 'Memory';
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}
export class MemoryRepository implements Repository {
  mode = 'Memory' as const;
  private entries = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    return structuredClone((this.entries.get(key) as T) ?? null);
  }
  async set<T>(key: string, value: T) {
    this.entries.set(key, structuredClone(value));
  }
}
class BrowserRepository implements Repository {
  mode = 'Browser local storage' as const;
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = localStorage.getItem(`strategist:v1:${key}`);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T) {
    localStorage.setItem(`strategist:v1:${key}`, JSON.stringify(value));
  }
}
class SqlRepository implements Repository {
  mode = 'SQLite' as const;
  constructor(private db: Database) {}
  async get<T>(key: string): Promise<T | null> {
    const rows = await this.db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows[0] ? (JSON.parse(rows[0].value) as T) : null;
  }
  async set<T>(key: string, value: T) {
    await this.db.execute(
      'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, JSON.stringify(value)],
    );
    if (key === 'static') {
      const data = value as StaticData;
      await this.db.execute(
        'INSERT INTO static_cache (key,payload,fetched_at,source_version) VALUES ($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,source_version=excluded.source_version',
        [key, JSON.stringify(value), data.version.provenance.fetchedAt, data.version.sourceVersion],
      );
    }
    if (key === 'selection' && value) {
      const plan = value as unknown as SelectedPlan;
      await this.db.execute(
        'INSERT INTO selected_plans (id,payload,match_id) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,match_id=excluded.match_id',
        [plan.id, JSON.stringify(plan), plan.matchId ?? null],
      );
    }
  }
}
export async function openRepository(): Promise<Repository> {
  if ('__TAURI_INTERNALS__' in window) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    return new SqlRepository(await Database.load('sqlite:strategist.db'));
  }
  return new BrowserRepository();
}
