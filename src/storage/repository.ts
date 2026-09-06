import type Database from '@tauri-apps/plugin-sql';
import type { PlanSession, StaticData, SelectedPlan } from '../domain/models';
import { planSessionSnapshotFingerprint } from '../domain/fingerprint';
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
  getActivePlanSession(): Promise<PlanSession | null>;
  listPlanSessions(): Promise<PlanSession[]>;
  createPlanSession(session: PlanSession): Promise<void>;
  replacePlanSession(previous: PlanSession, next: PlanSession): Promise<void>;
  updatePlanSession(session: PlanSession): Promise<void>;
}
function assertSessionSnapshotIntegrity(session: PlanSession, existing?: PlanSession) {
  if (planSessionSnapshotFingerprint(session.snapshot) !== session.snapshotFingerprint)
    throw new Error('Plan session snapshot fingerprint is invalid.');
  if (
    existing &&
    (existing.snapshotFingerprint !== session.snapshotFingerprint ||
      JSON.stringify(existing.snapshot) !== JSON.stringify(session.snapshot))
  )
    throw new Error('A locked plan-session snapshot cannot be changed.');
}
function assertSessionLifecycle(session: PlanSession, existing?: PlanSession) {
  if (
    (session.state === 'active' &&
      (session.endedAt !== null ||
        session.endReason !== null ||
        session.replacedBySessionId !== null)) ||
    (session.state === 'ended' && (!session.endedAt || !session.endReason))
  )
    throw new Error('Plan session lifecycle fields do not match its state.');
  if (existing?.state === 'ended' && session.state !== 'ended')
    throw new Error('An ended plan session cannot be reactivated.');
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
  async getActivePlanSession() {
    return structuredClone(
      [...((this.entries.get('plan-sessions') as PlanSession[] | undefined) ?? [])].find(
        (session) => session.state === 'active',
      ) ?? null,
    );
  }
  async listPlanSessions() {
    return structuredClone((this.entries.get('plan-sessions') as PlanSession[] | undefined) ?? []);
  }
  async createPlanSession(session: PlanSession) {
    assertSessionSnapshotIntegrity(session);
    assertSessionLifecycle(session);
    const sessions = await this.listPlanSessions();
    if (sessions.some((entry) => entry.state === 'active'))
      throw new Error('An active plan session already exists.');
    this.entries.set('plan-sessions', structuredClone([...sessions, session]));
  }
  async replacePlanSession(previous: PlanSession, next: PlanSession) {
    const sessions = await this.listPlanSessions();
    const active = sessions.filter((entry) => entry.state === 'active');
    assertSessionSnapshotIntegrity(previous, active[0]);
    assertSessionSnapshotIntegrity(next);
    assertSessionLifecycle(previous, active[0]);
    assertSessionLifecycle(next);
    if (
      active.length !== 1 ||
      active[0].id !== previous.id ||
      previous.state !== 'ended' ||
      next.state !== 'active' ||
      next.replacesSessionId !== previous.id ||
      previous.replacedBySessionId !== next.id
    )
      throw new Error('The active plan session changed before it could be replaced.');
    this.entries.set(
      'plan-sessions',
      structuredClone([...sessions.filter((entry) => entry.id !== previous.id), previous, next]),
    );
  }
  async updatePlanSession(session: PlanSession) {
    const sessions = await this.listPlanSessions();
    const existing = sessions.find((entry) => entry.id === session.id);
    if (!existing) throw new Error('Plan session does not exist.');
    assertSessionSnapshotIntegrity(session, existing);
    assertSessionLifecycle(session, existing);
    const others = sessions.filter((entry) => entry.id !== session.id);
    if (session.state === 'active' && others.some((entry) => entry.state === 'active'))
      throw new Error('An active plan session already exists.');
    this.entries.set('plan-sessions', structuredClone([...others, session]));
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
  async getActivePlanSession() {
    return (await this.listPlanSessions()).find((session) => session.state === 'active') ?? null;
  }
  async listPlanSessions() {
    return (await this.get<PlanSession[]>('plan-sessions')) ?? [];
  }
  async createPlanSession(session: PlanSession) {
    assertSessionSnapshotIntegrity(session);
    assertSessionLifecycle(session);
    const sessions = await this.listPlanSessions();
    if (sessions.some((entry) => entry.state === 'active'))
      throw new Error('An active plan session already exists.');
    await this.set('plan-sessions', [...sessions, session]);
  }
  async replacePlanSession(previous: PlanSession, next: PlanSession) {
    const sessions = await this.listPlanSessions();
    const active = sessions.filter((entry) => entry.state === 'active');
    assertSessionSnapshotIntegrity(previous, active[0]);
    assertSessionSnapshotIntegrity(next);
    assertSessionLifecycle(previous, active[0]);
    assertSessionLifecycle(next);
    if (
      active.length !== 1 ||
      active[0].id !== previous.id ||
      previous.state !== 'ended' ||
      next.state !== 'active' ||
      next.replacesSessionId !== previous.id ||
      previous.replacedBySessionId !== next.id
    )
      throw new Error('The active plan session changed before it could be replaced.');
    await this.set('plan-sessions', [
      ...sessions.filter((entry) => entry.id !== previous.id),
      previous,
      next,
    ]);
  }
  async updatePlanSession(session: PlanSession) {
    const sessions = await this.listPlanSessions();
    const existing = sessions.find((entry) => entry.id === session.id);
    if (!existing) throw new Error('Plan session does not exist.');
    assertSessionSnapshotIntegrity(session, existing);
    assertSessionLifecycle(session, existing);
    const others = sessions.filter((entry) => entry.id !== session.id);
    if (session.state === 'active' && others.some((entry) => entry.state === 'active'))
      throw new Error('An active plan session already exists.');
    await this.set('plan-sessions', [...others, session]);
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
  async getActivePlanSession() {
    const rows = await this.db.select<{ payload: string }[]>(
      "SELECT payload FROM plan_sessions WHERE state='active' ORDER BY locked_at DESC LIMIT 1",
    );
    return rows[0] ? (JSON.parse(rows[0].payload) as PlanSession) : null;
  }
  async listPlanSessions() {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM plan_sessions ORDER BY locked_at ASC, id ASC',
    );
    return rows.map((row) => JSON.parse(row.payload) as PlanSession);
  }
  private async insertPlanSession(session: PlanSession) {
    await this.db.execute(
      'INSERT INTO plan_sessions (id,state,locked_at,ended_at,payload,match_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        session.id,
        session.state,
        session.lockedAt,
        session.endedAt,
        JSON.stringify(session),
        session.reconciliation.matchId,
      ],
    );
  }
  async createPlanSession(session: PlanSession) {
    if (session.state !== 'active') throw new Error('A new plan session must be active.');
    assertSessionSnapshotIntegrity(session);
    assertSessionLifecycle(session);
    await this.insertPlanSession(session);
  }
  async replacePlanSession(previous: PlanSession, next: PlanSession) {
    assertSessionSnapshotIntegrity(previous);
    assertSessionSnapshotIntegrity(next);
    assertSessionLifecycle(previous);
    assertSessionLifecycle(next);
    if (
      previous.state !== 'ended' ||
      next.state !== 'active' ||
      next.replacesSessionId !== previous.id ||
      previous.replacedBySessionId !== next.id
    )
      throw new Error('Invalid plan-session replacement transition.');
    // The M8 replacement triggers validate and end the named active predecessor in the
    // same SQLite statement that inserts the successor. The unique partial index remains
    // the final one-active-session guard.
    await this.insertPlanSession(next);
  }
  async updatePlanSession(session: PlanSession) {
    assertSessionSnapshotIntegrity(session);
    assertSessionLifecycle(session);
    const result = await this.db.execute(
      'UPDATE plan_sessions SET state=$1,ended_at=$2,payload=$3,match_id=$4 WHERE id=$5',
      [
        session.state,
        session.endedAt,
        JSON.stringify(session),
        session.reconciliation.matchId,
        session.id,
      ],
    );
    if (!result.rowsAffected) throw new Error('Plan session does not exist.');
  }
}
export async function openRepository(): Promise<Repository> {
  if ('__TAURI_INTERNALS__' in window) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    return new SqlRepository(await Database.load('sqlite:strategist.db'));
  }
  return new BrowserRepository();
}
