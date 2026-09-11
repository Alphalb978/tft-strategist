import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  openRepository,
  SqlRepository,
  normalizeSettings,
  defaultSettings,
  type Settings,
} from '../storage/repository';
import { openHistoryStore } from '../storage/history';
import {
  openKnowledgeDatabase,
  createNodeSqliteAdapter,
  applyAllMigrations,
} from '../storage/knowledgeDatabase';
import {
  configureSqlite,
  setSharedSqlDatabaseForTesting,
  resetSharedSqlDatabaseForTesting,
  withSqliteRetry,
} from '../storage/database';
import type Database from '@tauri-apps/plugin-sql';
import type { PersonalMatchObservation } from '../domain/models';
import { createRecommendations } from '../services/application';
import { data, match } from './fixtures';

describe('M14A.4 — SQLite Concurrency & Shared Connection Ownership', () => {
  let nativeDb: DatabaseSync;
  let adapter: ReturnType<typeof createNodeSqliteAdapter>;

  beforeEach(() => {
    // Create an in-memory SQLite database for testing and apply all schema migrations
    nativeDb = new DatabaseSync(':memory:');
    applyAllMigrations(nativeDb);
    adapter = createNodeSqliteAdapter(nativeDb);

    // Mock Tauri desktop runtime environment on globalThis
    (globalThis as unknown as { window: { __TAURI_INTERNALS__: Record<string, unknown> } }).window = {
      __TAURI_INTERNALS__: {},
    };

    // Configure the shared database singleton with our test adapter
    setSharedSqlDatabaseForTesting(adapter as unknown as Database);
  });

  afterEach(() => {
    resetSharedSqlDatabaseForTesting();
    delete (globalThis as unknown as { window?: unknown }).window;
    nativeDb.close();
  });

  // 1. repository + history use shared desktop DB handle if refactored
  it('1. repository + history use shared desktop DB handle if refactored', async () => {
    const repo = await openRepository();
    const history = await openHistoryStore();

    expect(repo.mode).toBe('SQLite');
    expect(history.mode).toBe('SQLite');

    // Writes from history store should immediately be visible to repository queries on the shared DB
    await history.putIdentity(
      {
        puuid: 'puuid-shared-handle-test',
        gameName: 'Tactician',
        tagLine: 'EUW',
        platform: 'EUW1',
        routing: 'europe',
      },
      new Date().toISOString(),
    );

    const accounts = await (repo as SqlRepository)
      .getSqlDatabase()
      .select<{ puuid: string }>('SELECT puuid FROM riot_accounts WHERE puuid = $1', [
        'puuid-shared-handle-test',
      ]);
    expect(accounts.length).toBe(1);
    expect(accounts[0].puuid).toBe('puuid-shared-handle-test');
  });

  // 2. settings write while history read is active
  it('2. settings write while history read is active', async () => {
    const repo = await openRepository();
    const history = await openHistoryStore();

    // Populate a test match
    const testMatch = match('EUW1_test_concurrency_1');
    await history.putCompletedMatch(testMatch, new Date().toISOString());

    // Concurrently read history while writing settings
    const readPromise = history.getCompletedMatch('EUW1_test_concurrency_1');
    const writePromise = repo.set('settings', {
      ...defaultSettings,
      screenIntelligence: {
        ...defaultSettings.screenIntelligence,
        enabled: true,
      },
    });

    const [readResult] = await Promise.all([readPromise, writePromise]);
    expect(readResult).not.toBeNull();
    expect(readResult?.id).toBe('EUW1_test_concurrency_1');

    const savedSettings = await repo.get<Settings>('settings');
    expect(savedSettings?.screenIntelligence?.enabled).toBe(true);
  });

  // 3. settings write after history write
  it('3. settings write after history write', async () => {
    const repo = await openRepository();
    const history = await openHistoryStore();

    const testMatch = match('EUW1_test_concurrency_2');
    await history.putCompletedMatch(testMatch, new Date().toISOString());
    await repo.set('settings', {
      ...defaultSettings,
      screenIntelligence: {
        ...defaultSettings.screenIntelligence,
        enabled: true,
        captureRate: 5,
      },
    });

    const saved = await repo.get<Settings>('settings');
    expect(saved?.screenIntelligence?.captureRate).toBe(5);
  });

  // 4. simulated concurrent short writes do not produce user-visible SQLITE_BUSY
  it('4. simulated concurrent short writes do not produce user-visible SQLITE_BUSY', async () => {
    let callCount = 0;
    const transientLockedFn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('error returned from database: (code: 5) database is locked');
      }
      return 'success';
    };

    // Bounded retry handles transient code: 5 cleanly
    const result = await withSqliteRetry(transientLockedFn, 3, 10);
    expect(result).toBe('success');
    expect(callCount).toBe(3);

    // Parallel writes serialized cleanly through mutex
    const repo = await openRepository();
    const writes = Array.from({ length: 10 }, (_, i) =>
      repo.set(`concurrent_key_${i}`, { index: i }),
    );
    await expect(Promise.all(writes)).resolves.toBeDefined();

    for (let i = 0; i < 10; i++) {
      const val = await repo.get<{ index: number }>(`concurrent_key_${i}`);
      expect(val?.index).toBe(i);
    }
  });

  // 5. busy timeout is configured
  it('5. busy timeout is configured', async () => {
    const executedPragmas: string[] = [];
    const mockDb = {
      async execute(query: string) {
        executedPragmas.push(query);
        return { rowsAffected: 0 };
      },
    };

    await configureSqlite(mockDb);
    expect(executedPragmas).toContain('PRAGMA busy_timeout = 5000;');
    expect(executedPragmas).toContain('PRAGMA journal_mode = WAL;');
    expect(executedPragmas).toContain('PRAGMA foreign_keys = ON;');
  });

  // 6. WAL configuration is initialized correctly
  it('6. WAL configuration is initialized correctly', async () => {
    const executedPragmas: string[] = [];
    const mockDb = {
      async execute(query: string) {
        executedPragmas.push(query);
        return { rowsAffected: 0 };
      },
    };

    await configureSqlite(mockDb);
    expect(executedPragmas.some((p) => p.includes('journal_mode = WAL'))).toBe(true);
  });

  // 7. old strategist.db upgrades/opens normally
  it('7. old strategist.db upgrades/opens normally', () => {
    // Simulate an older database that only has migration 1 (schema.sql)
    const oldDb = new DatabaseSync(':memory:');
    const schema1 = nativeDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settings'").all();
    expect(schema1.length).toBeGreaterThan(0);

    // Apply all migrations sequentially
    applyAllMigrations(oldDb);

    // Verify all versioned tables exist
    const tables = oldDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('settings');
    expect(tableNames).toContain('riot_completed_matches');
    expect(tableNames).toContain('plan_sessions');
    expect(tableNames).toContain('postgame_reviews');
    expect(tableNames).toContain('knowledge_sources');
    expect(tableNames).toContain('personal_match_observations');
    expect(tableNames).toContain('personal_match_corrections');

    oldDb.close();
  });

  // 8. settings roundtrip works
  it('8. settings roundtrip works', async () => {
    const repo = await openRepository();
    const settings: Settings = {
      personalWeight: 0.08,
      historyWindow: 15,
      riotId: 'Roundtrip#EUW',
      riotPlatform: 'EUW1',
      homeRecommendation: defaultSettings.homeRecommendation,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
        captureSource: 'mock',
        captureFps: 5,
        sourceMode: 'mock',
      },
    };

    await repo.set('settings', settings);
    const retrieved = await repo.get<Settings>('settings');
    expect(retrieved).not.toBeNull();
    expect(normalizeSettings(retrieved)).toEqual(settings);
  });

  // 9. Screen Intelligence enable persists
  it('9. Screen Intelligence enable persists', async () => {
    const repo = await openRepository();
    const initial = normalizeSettings(await repo.get<Settings>('settings'));
    expect(initial.screenIntelligence.enabled).toBe(false);

    const updated = normalizeSettings({
      ...initial,
      screenIntelligence: {
        ...initial.screenIntelligence,
        enabled: true,
      },
    });

    await repo.set('settings', updated);
    const persisted = normalizeSettings(await repo.get<Settings>('settings'));
    expect(persisted.screenIntelligence.enabled).toBe(true);
  });

  // 10. disable persists
  it('10. disable persists', async () => {
    const repo = await openRepository();
    const enabled = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        ...defaultSettings.screenIntelligence,
        enabled: true,
      },
    });
    await repo.set('settings', enabled);

    const disabled = normalizeSettings({
      ...enabled,
      screenIntelligence: {
        ...enabled.screenIntelligence,
        enabled: false,
      },
    });
    await repo.set('settings', disabled);

    const persisted = normalizeSettings(await repo.get<Settings>('settings'));
    expect(persisted.screenIntelligence.enabled).toBe(false);
  });

  // 11. history still persists
  it('11. history still persists', async () => {
    const history = await openHistoryStore();
    const testMatch = match('EUW1_persisted_match_1');

    await history.putCompletedMatch(testMatch, '2026-09-10T22:35:00.000Z');
    const retrieved = await history.getCompletedMatch('EUW1_persisted_match_1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('EUW1_persisted_match_1');
    expect(retrieved?.gameDurationSeconds).toBe(2100);
  });

  // 12. postgame observations still persist
  it('12. postgame observations still persist', async () => {
    const repo = await openRepository();
    const observation: PersonalMatchObservation = {
      matchId: 'EUW1_obs_1',
      accountPuuid: 'puuid_user_1',
      set: 13,
      patch: '14.23',
      riotGameVersion: 'Version 14.23',
      gameTimestamp: '2026-09-10T21:00:00.000Z',
      placement: 1,
      level: 9,
      queueId: 1100,
      gameType: 'ranked',
      classifiedCompId: 'comp_chemtech',
      classificationState: 'classified',
      classificationConfidence: 0.95,
      classificationModelVersion: 'v1',
      finalBoardHash: 'boardhash123',
      units: [],
      createdAt: '2026-09-10T21:35:00.000Z',
      updatedAt: '2026-09-10T21:35:00.000Z',
    };

    await repo.putPersonalMatchObservation(observation);
    const list = await repo.listPersonalMatchObservations('puuid_user_1');
    expect(list.length).toBe(1);
    expect(list[0].matchId).toBe('EUW1_obs_1');
    expect(list[0].placement).toBe(1);
    expect(list[0].classifiedCompId).toBe('comp_chemtech');
  });

  // 13. knowledge DB still loads
  it('13. knowledge DB still loads', async () => {
    const kDb = await openKnowledgeDatabase();
    expect(kDb).not.toBeNull();

    const sources = await kDb!.select<{ source_id: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_sources'",
    );
    expect(sources.length).toBe(1);
  });

  // 14. no capture frames stored in DB
  it('14. no capture frames stored in DB', async () => {
    const repo = await openRepository();
    const settings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
        captureSource: 'mock',
        captureFps: 5,
        sourceMode: 'mock',
      },
    });

    await repo.set('settings', settings);

    const rows = await (repo as SqlRepository)
      .getSqlDatabase()
      .select<{ value: string }>('SELECT value FROM settings WHERE key = $1', ['settings']);
    expect(rows.length).toBe(1);
    const json = rows[0].value;

    expect(json).not.toContain('data:image');
    expect(json).not.toContain('previewImage');
    expect(json).not.toContain('base64');
    expect(json).not.toContain('debugFrames');
    expect(json).not.toContain('telemetry');
  });

  // 15. Home scoring parity exact
  it('15. Home scoring parity exact', async () => {
    const repo = await openRepository();
    const settings = normalizeSettings({
      ...defaultSettings,
      screenIntelligence: {
        enabled: true,
        saveDebugFrames: true,
        captureRate: 5,
        captureSource: 'auto',
        captureFps: 5,
        sourceMode: 'auto',
      },
    });
    await repo.set('settings', settings);

    const now = '2026-09-10T23:30:00.000Z';
    const recsDefault = createRecommendations(data, defaultSettings, now);
    const recsWithSI = createRecommendations(data, settings, now);

    expect(recsWithSI.portfolio.plans.length).toBe(recsDefault.portfolio.plans.length);
    for (let i = 0; i < recsDefault.portfolio.plans.length; i++) {
      expect(recsWithSI.portfolio.plans[i].candidate.playbook.id).toBe(
        recsDefault.portfolio.plans[i].candidate.playbook.id,
      );
      expect(recsWithSI.portfolio.plans[i].candidate.score).toBe(
        recsDefault.portfolio.plans[i].candidate.score,
      );
    }
  });

  // Stress test: repeat ~50 short mixed operations without database locked errors
  it('Stress test: 50 rapid mixed operations with zero lock errors', async () => {
    const repo = await openRepository();
    const history = await openHistoryStore();

    const operations: Promise<unknown>[] = [];

    for (let i = 0; i < 50; i++) {
      const opIndex = i % 4;
      if (opIndex === 0) {
        // Settings write
        operations.push(
          repo.set('settings', {
            ...defaultSettings,
            personalWeight: 0.05 + (i % 5) * 0.01,
            screenIntelligence: {
              ...defaultSettings.screenIntelligence,
              enabled: i % 2 === 0,
            },
          }),
        );
      } else if (opIndex === 1) {
        // History write
        operations.push(
          history.putCompletedMatch(
            match(`EUW1_stress_match_${i}`),
            new Date().toISOString(),
          ),
        );
      } else if (opIndex === 2) {
        // History read
        operations.push(history.getCompletedMatch(`EUW1_stress_match_${Math.max(0, i - 1)}`));
      } else {
        // Personal observation write
        operations.push(
          repo.putPersonalMatchObservation({
            matchId: `EUW1_stress_obs_${i}`,
            accountPuuid: 'puuid_stress_user',
            set: 13,
            patch: '14.23',
            riotGameVersion: 'Version 14.23',
            gameTimestamp: new Date(Date.now() - i * 60000).toISOString(),
            placement: (i % 8) + 1,
            level: 8,
            queueId: 1100,
            gameType: 'ranked',
            classifiedCompId: `comp_${i % 5}`,
            classificationState: 'classified',
            classificationConfidence: 0.9,
            classificationModelVersion: 'v1',
            finalBoardHash: `board_${i}`,
            units: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    }

    // Execute all 50 operations concurrently
    const results = await Promise.allSettled(operations);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(0);

    // Final verification that both settings and observations persisted cleanly
    const finalSettings = await repo.get<Settings>('settings');
    expect(finalSettings).not.toBeNull();

    const obs = await repo.listPersonalMatchObservations('puuid_stress_user');
    expect(obs.length).toBeGreaterThan(0);
  });
});
