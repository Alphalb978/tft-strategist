import type Database from '@tauri-apps/plugin-sql';
import {
  SqlKnowledgeRepository,
  MemoryKnowledgeRepository,
  type KnowledgeRepository,
} from './knowledgeRepository';
import type { SqlDatabase } from './knowledgeDatabase';
import {
  hydrateDerived,
  referenceDerived,
  largeDerivedKey,
  readLargeDerived,
  writeLargeDerived,
} from './derivedCache';
import type {
  MatchReconciliation,
  HomeRecommendationModelConfig,
  PersonalMatchObservation,
  PersonalProfile,
  PlanSession,
  PostGameReview,
  StaticData,
  SelectedPlan,
} from '../domain/models';
import { planSessionSnapshotFingerprint, stableFingerprint } from '../domain/fingerprint';
import { parsePlatform, type RiotPlatform } from '../providers/riotRouting';
import {
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
  normalizeHomeRecommendationConfig,
} from '../strategy/homeScoring';
export interface Settings {
  personalWeight: number;
  historyWindow: number;
  riotId: string;
  riotPlatform: RiotPlatform;
  homeRecommendation: HomeRecommendationModelConfig;
}
export const defaultSettings: Settings = {
  personalWeight: 0.05,
  historyWindow: 10,
  riotId: '',
  riotPlatform: 'EUW1',
  homeRecommendation: DEFAULT_HOME_RECOMMENDATION_CONFIG,
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
    homeRecommendation: normalizeHomeRecommendationConfig(value?.homeRecommendation),
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
  listReconciliations(): Promise<MatchReconciliation[]>;
  putReconciliation(reconciliation: MatchReconciliation): Promise<void>;
  listPostGameReviews(): Promise<PostGameReview[]>;
  putPostGameReview(review: PostGameReview): Promise<void>;
  deletePostGameReview(chainId: string): Promise<void>;
  getPersonalProfile(set: number): Promise<PersonalProfile | null>;
  putPersonalProfile(profile: PersonalProfile): Promise<void>;
  listPersonalMatchObservations(accountPuuid?: string): Promise<PersonalMatchObservation[]>;
  putPersonalMatchObservation(observation: PersonalMatchObservation): Promise<void>;
  putPersonalMatchObservations(observations: PersonalMatchObservation[]): Promise<void>;
  getKnowledgeRepository?(): KnowledgeRepository;
  getSqlDatabase?(): SqlDatabase;
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
  private knowledgeRepo = new MemoryKnowledgeRepository();
  getKnowledgeRepository(): KnowledgeRepository {
    return this.knowledgeRepo;
  }
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
  async listReconciliations() {
    return structuredClone(
      (this.entries.get('postgame-reconciliations') as MatchReconciliation[] | undefined) ?? [],
    );
  }
  async putReconciliation(reconciliation: MatchReconciliation) {
    const rows = await this.listReconciliations();
    const existing = rows.find((row) => row.chainId === reconciliation.chainId);
    if (existing?.state === 'matched' && existing.matchId !== reconciliation.matchId)
      throw new Error('Unlink the existing match before choosing another candidate.');
    const conflict = rows.find(
      (row) =>
        row.chainId !== reconciliation.chainId &&
        (row.terminalSessionId === reconciliation.terminalSessionId ||
          (reconciliation.matchId && row.matchId === reconciliation.matchId)),
    );
    if (conflict) throw new Error('This match or session chain is already reconciled.');
    this.entries.set(
      'postgame-reconciliations',
      structuredClone([
        ...rows.filter((row) => row.chainId !== reconciliation.chainId),
        reconciliation,
      ]),
    );
  }
  async listPostGameReviews() {
    return structuredClone(
      (this.entries.get('postgame-reviews') as PostGameReview[] | undefined) ?? [],
    );
  }
  async putPostGameReview(review: PostGameReview) {
    const rows = await this.listPostGameReviews();
    const conflict = rows.find(
      (row) => row.chainId !== review.chainId && row.matchId === review.matchId,
    );
    if (conflict) throw new Error('This completed match already has a review.');
    this.entries.set(
      'postgame-reviews',
      structuredClone([...rows.filter((row) => row.chainId !== review.chainId), review]),
    );
  }
  async deletePostGameReview(chainId: string) {
    this.entries.set(
      'postgame-reviews',
      structuredClone((await this.listPostGameReviews()).filter((row) => row.chainId !== chainId)),
    );
  }
  async getPersonalProfile(set: number) {
    return structuredClone(
      (this.entries.get(`personal-profile:${set}`) as PersonalProfile | undefined) ?? null,
    );
  }
  async putPersonalProfile(profile: PersonalProfile) {
    this.entries.set(`personal-profile:${profile.set}`, structuredClone(profile));
  }
  async listPersonalMatchObservations(accountPuuid?: string) {
    const list = structuredClone(
      (this.entries.get('personal-match-observations') as PersonalMatchObservation[] | undefined) ??
        [],
    );
    const filtered = accountPuuid ? list.filter((obs) => obs.accountPuuid === accountPuuid) : list;
    return filtered.sort(
      (a, b) => Date.parse(b.gameTimestamp) - Date.parse(a.gameTimestamp) || a.matchId.localeCompare(b.matchId),
    );
  }
  async putPersonalMatchObservation(observation: PersonalMatchObservation) {
    const existing = await this.listPersonalMatchObservations();
    const filtered = existing.filter((obs) => obs.matchId !== observation.matchId);
    this.entries.set('personal-match-observations', structuredClone([...filtered, observation]));
  }
  async putPersonalMatchObservations(observations: PersonalMatchObservation[]) {
    const existing = await this.listPersonalMatchObservations();
    const map = new Map(existing.map((obs) => [obs.matchId, obs]));
    for (const obs of observations) {
      map.set(obs.matchId, obs);
    }
    this.entries.set('personal-match-observations', structuredClone([...map.values()]));
  }
}
class BrowserRepository implements Repository {
  mode = 'Browser local storage' as const;
  private knowledgeRepo = new MemoryKnowledgeRepository();
  getKnowledgeRepository(): KnowledgeRepository {
    return this.knowledgeRepo;
  }
  async get<T>(key: string): Promise<T | null> {
    try {
      if (largeDerivedKey(key)) return (await readLargeDerived(key)) as T | null;
      const value = localStorage.getItem(`strategist:v1:${key}`);
      if (!value) return null;
      let parsed = JSON.parse(value);
      if (typeof parsed?.derivedStorageRef === 'string')
        parsed = await readLargeDerived(parsed.derivedStorageRef);
      return (await hydrateDerived(parsed, (k) => this.get(k))) as T | null;
    } catch {
      return null;
    }
  }
  async set<T>(key: string, value: T) {
    if (largeDerivedKey(key)) return writeLargeDerived(key, value);
    const referenced = await referenceDerived(value, (k, v) => this.set(k, v));
    if (
      key === 'aggregate-meta' ||
      key === 'meta-current:v1' ||
      key.startsWith('meta-catalog:v1:')
    ) {
      const derivedStorageRef = `meta-bundle:${stableFingerprint(referenced)}`;
      await writeLargeDerived(derivedStorageRef, referenced);
      localStorage.setItem(`strategist:v1:${key}`, JSON.stringify({ derivedStorageRef }));
      return;
    }
    localStorage.setItem(`strategist:v1:${key}`, JSON.stringify(referenced));
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
  async listReconciliations() {
    return (await this.get<MatchReconciliation[]>('postgame-reconciliations')) ?? [];
  }
  async putReconciliation(reconciliation: MatchReconciliation) {
    const rows = await this.listReconciliations();
    const existing = rows.find((row) => row.chainId === reconciliation.chainId);
    if (existing?.state === 'matched' && existing.matchId !== reconciliation.matchId)
      throw new Error('Unlink the existing match before choosing another candidate.');
    if (
      rows.some(
        (row) =>
          row.chainId !== reconciliation.chainId &&
          (row.terminalSessionId === reconciliation.terminalSessionId ||
            (reconciliation.matchId && row.matchId === reconciliation.matchId)),
      )
    )
      throw new Error('This match or session chain is already reconciled.');
    await this.set('postgame-reconciliations', [
      ...rows.filter((row) => row.chainId !== reconciliation.chainId),
      reconciliation,
    ]);
  }
  async listPostGameReviews() {
    return (await this.get<PostGameReview[]>('postgame-reviews')) ?? [];
  }
  async putPostGameReview(review: PostGameReview) {
    const rows = await this.listPostGameReviews();
    if (rows.some((row) => row.chainId !== review.chainId && row.matchId === review.matchId))
      throw new Error('This completed match already has a review.');
    await this.set('postgame-reviews', [
      ...rows.filter((row) => row.chainId !== review.chainId),
      review,
    ]);
  }
  async deletePostGameReview(chainId: string) {
    await this.set(
      'postgame-reviews',
      (await this.listPostGameReviews()).filter((row) => row.chainId !== chainId),
    );
  }
  async getPersonalProfile(set: number) {
    return this.get<PersonalProfile>(`personal-profile:${set}`);
  }
  async putPersonalProfile(profile: PersonalProfile) {
    await this.set(`personal-profile:${profile.set}`, profile);
  }
  async listPersonalMatchObservations(accountPuuid?: string) {
    const list = (await this.get<PersonalMatchObservation[]>('personal-match-observations')) ?? [];
    const filtered = accountPuuid ? list.filter((obs) => obs.accountPuuid === accountPuuid) : list;
    return filtered.sort(
      (a, b) => Date.parse(b.gameTimestamp) - Date.parse(a.gameTimestamp) || a.matchId.localeCompare(b.matchId),
    );
  }
  async putPersonalMatchObservation(observation: PersonalMatchObservation) {
    const list = (await this.get<PersonalMatchObservation[]>('personal-match-observations')) ?? [];
    const filtered = list.filter((obs) => obs.matchId !== observation.matchId);
    await this.set('personal-match-observations', [...filtered, observation]);
  }
  async putPersonalMatchObservations(observations: PersonalMatchObservation[]) {
    const list = (await this.get<PersonalMatchObservation[]>('personal-match-observations')) ?? [];
    const map = new Map(list.map((obs) => [obs.matchId, obs]));
    for (const obs of observations) {
      map.set(obs.matchId, obs);
    }
    await this.set('personal-match-observations', [...map.values()]);
  }
}
class SqlRepository implements Repository {
  mode = 'SQLite' as const;
  constructor(private db: Database) {}
  getSqlDatabase(): SqlDatabase {
    return this.db;
  }
  getKnowledgeRepository(): KnowledgeRepository {
    return new SqlKnowledgeRepository(this.db);
  }
  async get<T>(key: string): Promise<T | null> {
    const rows = await this.db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows[0]
      ? ((await hydrateDerived(JSON.parse(rows[0].value), (k) => this.get(k))) as T)
      : null;
  }
  async set<T>(key: string, value: T) {
    const referenced = await referenceDerived(value, (k, v) => this.set(k, v));
    await this.db.execute(
      'INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, JSON.stringify(referenced)],
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
  async listReconciliations() {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM postgame_reconciliations ORDER BY checked_at DESC',
    );
    return rows.map((row) => JSON.parse(row.payload) as MatchReconciliation);
  }
  async putReconciliation(reconciliation: MatchReconciliation) {
    const existing = await this.db.select<{ state: string; match_id: string | null }[]>(
      'SELECT state,match_id FROM postgame_reconciliations WHERE chain_id=$1',
      [reconciliation.chainId],
    );
    if (existing[0]?.state === 'matched' && existing[0].match_id !== reconciliation.matchId)
      throw new Error('Unlink the existing match before choosing another candidate.');
    await this.db.execute(
      'INSERT INTO postgame_reconciliations (chain_id,terminal_session_id,state,match_id,payload,checked_at,decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(chain_id) DO UPDATE SET state=excluded.state,match_id=excluded.match_id,payload=excluded.payload,checked_at=excluded.checked_at,decided_at=excluded.decided_at',
      [
        reconciliation.chainId,
        reconciliation.terminalSessionId,
        reconciliation.state,
        reconciliation.matchId,
        JSON.stringify(reconciliation),
        reconciliation.checkedAt,
        reconciliation.decidedAt,
      ],
    );
  }
  async listPostGameReviews() {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM postgame_reviews ORDER BY created_at DESC',
    );
    return rows.map((row) => JSON.parse(row.payload) as PostGameReview);
  }
  async putPostGameReview(review: PostGameReview) {
    await this.db.execute(
      'INSERT INTO postgame_reviews (chain_id,match_id,derivation_fingerprint,payload,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(chain_id) DO UPDATE SET match_id=excluded.match_id,derivation_fingerprint=excluded.derivation_fingerprint,payload=excluded.payload,created_at=excluded.created_at',
      [
        review.chainId,
        review.matchId,
        review.derivationFingerprint,
        JSON.stringify(review),
        review.createdAt,
      ],
    );
  }
  async deletePostGameReview(chainId: string) {
    await this.db.execute('DELETE FROM postgame_reviews WHERE chain_id=$1', [chainId]);
  }
  async getPersonalProfile(set: number) {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM personal_profiles WHERE key=$1',
      [`set:${set}`],
    );
    return rows[0] ? (JSON.parse(rows[0].payload) as PersonalProfile) : null;
  }
  async putPersonalProfile(profile: PersonalProfile) {
    await this.db.execute(
      'INSERT INTO personal_profiles (key,payload) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
      [`set:${profile.set}`, JSON.stringify(profile)],
    );
  }
  async listPersonalMatchObservations(accountPuuid?: string) {
    const sql = accountPuuid
      ? 'SELECT * FROM personal_match_observations WHERE account_puuid = $1 ORDER BY game_timestamp DESC'
      : 'SELECT * FROM personal_match_observations ORDER BY game_timestamp DESC';
    const params = accountPuuid ? [accountPuuid] : [];
    const rows = await this.db.select<
      {
        match_id: string;
        account_puuid: string;
        set_number: number;
        patch: string | null;
        riot_game_version: string | null;
        game_timestamp: string;
        placement: number;
        level: number;
        queue_id: number | null;
        game_type: string | null;
        classified_comp_id: string | null;
        classification_state: string;
        classification_confidence: number;
        classification_model_version: string;
        final_board_hash: string;
        payload: string;
        created_at: string;
        updated_at: string;
      }[]
    >(sql, params);
    return rows.map((row) => {
      let parsed: { candidateCompIds?: string[]; runnerUpCompId?: string | null; units?: unknown[] } = {};
      try {
        parsed = JSON.parse(row.payload);
      } catch {
        // fallback
      }
      return {
        matchId: row.match_id,
        accountPuuid: row.account_puuid,
        set: row.set_number,
        patch: row.patch,
        riotGameVersion: row.riot_game_version,
        gameTimestamp: row.game_timestamp,
        placement: row.placement,
        level: row.level,
        queueId: row.queue_id,
        gameType: row.game_type,
        classifiedCompId: row.classified_comp_id,
        classificationState: row.classification_state as PersonalMatchObservation['classificationState'],
        classificationConfidence: row.classification_confidence,
        classificationModelVersion: row.classification_model_version,
        candidateCompIds: parsed.candidateCompIds,
        runnerUpCompId: parsed.runnerUpCompId,
        finalBoardHash: row.final_board_hash,
        units: (parsed.units as PersonalMatchObservation['units']) ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }
  async putPersonalMatchObservation(observation: PersonalMatchObservation) {
    const payload = JSON.stringify({
      candidateCompIds: observation.candidateCompIds,
      runnerUpCompId: observation.runnerUpCompId,
      units: observation.units,
    });
    await this.db.execute(
      `INSERT INTO personal_match_observations (
        match_id, account_puuid, set_number, patch, riot_game_version,
        game_timestamp, placement, level, queue_id, game_type,
        classified_comp_id, classification_state, classification_confidence,
        classification_model_version, final_board_hash, payload, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT(match_id) DO UPDATE SET
        patch=excluded.patch,
        riot_game_version=excluded.riot_game_version,
        placement=excluded.placement,
        level=excluded.level,
        queue_id=excluded.queue_id,
        game_type=excluded.game_type,
        classified_comp_id=excluded.classified_comp_id,
        classification_state=excluded.classification_state,
        classification_confidence=excluded.classification_confidence,
        classification_model_version=excluded.classification_model_version,
        final_board_hash=excluded.final_board_hash,
        payload=excluded.payload,
        updated_at=excluded.updated_at`,
      [
        observation.matchId,
        observation.accountPuuid,
        observation.set,
        observation.patch,
        observation.riotGameVersion,
        observation.gameTimestamp,
        observation.placement,
        observation.level,
        observation.queueId,
        observation.gameType,
        observation.classifiedCompId,
        observation.classificationState,
        observation.classificationConfidence,
        observation.classificationModelVersion,
        observation.finalBoardHash,
        payload,
        observation.createdAt,
        observation.updatedAt,
      ],
    );
  }
  async putPersonalMatchObservations(observations: PersonalMatchObservation[]) {
    for (const obs of observations) {
      await this.putPersonalMatchObservation(obs);
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

export async function openKnowledgeRepository(): Promise<KnowledgeRepository> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    return new SqlKnowledgeRepository(await Database.load('sqlite:strategist.db'));
  }
  return new MemoryKnowledgeRepository();
}
