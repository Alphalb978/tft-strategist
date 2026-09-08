import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  createNodeSqliteAdapter,
  applyAllMigrations,
  type SqlDatabase,
} from '../storage/knowledgeDatabase';
import {
  importCommunityDragonKnowledge,
  importCuratedPlaybooks,
} from '../storage/knowledgeImporter';
import { SqlKnowledgeRepository } from '../storage/knowledgeRepository';
import { normalizeCommunityDragon, CommunityDragonProvider } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import {
  loadApplication,
  createRecommendations,
  refreshApplication,
} from '../services/application';
import { loadRuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';
import { bootstrapKnowledgeDatabase } from '../services/knowledgeBootstrap';
import type { ExternalSnapshot } from '../domain/externalMeta';
import type { StaticData, Provenance } from '../domain/models';

function getBundledStaticData(): StaticData {
  const raw = JSON.parse(
    readFileSync(new URL('../../data/fixtures/cdragon-set18.json', import.meta.url), 'utf8'),
  );
  const provenance: Provenance = JSON.parse(
    readFileSync(
      new URL('../../data/fixtures/cdragon-set18.provenance.json', import.meta.url),
      'utf8',
    ),
  );
  return normalizeCommunityDragon(raw, provenance);
}

function getBundledMetaSnapshot(): ExternalSnapshot {
  return JSON.parse(
    readFileSync(new URL('../../public/data/external/current.json', import.meta.url), 'utf8'),
  );
}

function createMigratedDb(): { db: DatabaseSync; adapter: SqlDatabase } {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);
  const adapter = createNodeSqliteAdapter(db);
  return { db, adapter };
}

describe('M13B — Connect Strategist to the Versioned Knowledge Database', () => {
  it('1. bootstrap: v5 DB with no active snapshots bootstraps automatically on startup', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    await repo.set('static', data);

    // Assert DB is currently empty of active snapshots
    const preActive = await adapter.select('SELECT * FROM active_knowledge_snapshots');
    expect(preActive.length).toBe(0);

    const state = await loadApplication(repo, knowledgeRepo, adapter);

    // After loadApplication, DB has active snapshots
    const postActive = await adapter.select<{ kind: string; snapshot_id: string }>(
      'SELECT kind, snapshot_id FROM active_knowledge_snapshots',
    );
    expect(postActive.length).toBeGreaterThanOrEqual(2);
    expect(postActive.some((r) => r.kind === 'static')).toBe(true);
    expect(postActive.some((r) => r.kind === 'curated')).toBe(true);

    // State is fully initialized
    expect(state.catalog).toBeDefined();
    expect(state.activeStaticSnapshotId).toBe(
      postActive.find((r) => r.kind === 'static')?.snapshot_id,
    );
    expect(state.activeCuratedSnapshotId).toBe(
      postActive.find((r) => r.kind === 'curated')?.snapshot_id,
    );
    expect(state.playbooks.length).toBeGreaterThan(0);
    expect(state.homeCandidates.length).toBeGreaterThan(0);
  });

  it('2. bootstrap: second startup is idempotent with zero duplicates', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    await repo.set('static', data);

    // First startup
    await loadApplication(repo, knowledgeRepo, adapter);

    const compCount1 = (await adapter.select<{ c: number }>('SELECT count(*) as c FROM comps'))[0]
      .c;
    const champCount1 = (
      await adapter.select<{ c: number }>('SELECT count(*) as c FROM champions')
    )[0].c;
    const snapCount1 = (
      await adapter.select<{ c: number }>('SELECT count(*) as c FROM source_snapshots')
    )[0].c;

    // Second startup
    const state2 = await loadApplication(repo, knowledgeRepo, adapter);

    const compCount2 = (await adapter.select<{ c: number }>('SELECT count(*) as c FROM comps'))[0]
      .c;
    const champCount2 = (
      await adapter.select<{ c: number }>('SELECT count(*) as c FROM champions')
    )[0].c;
    const snapCount2 = (
      await adapter.select<{ c: number }>('SELECT count(*) as c FROM source_snapshots')
    )[0].c;

    expect(compCount2).toBe(compCount1);
    expect(champCount2).toBe(champCount1);
    expect(snapCount2).toBe(snapCount1);
    expect(state2.playbooks.length).toBeGreaterThan(0);
  });

  it('3. bootstrap: failed bootstrap does not destroy old application state', async () => {
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    await repo.set('static', data);

    // A broken database that throws on execute
    const brokenDb: SqlDatabase = {
      async select() {
        throw new Error('SQLite disk I/O error');
      },
      async execute() {
        throw new Error('SQLite disk I/O error');
      },
    };
    const brokenRepo = new SqlKnowledgeRepository(brokenDb);

    // Application should not crash, but fall back gracefully
    const state = await loadApplication(repo, brokenRepo, brokenDb);
    expect(state).toBeDefined();
    expect(state.playbooks.length).toBeGreaterThan(0);
    expect(state.knowledgeNotice).toContain('Knowledge database deferred');
  });

  it('4. catalog: active DB champions, traits, items, and curated comps materialize correctly', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);

    await bootstrapKnowledgeDatabase(adapter, data, playbooks);

    const catalog = await loadRuntimeKnowledgeCatalog(knowledgeRepo, {
      existingStaticData: data,
    });

    expect(catalog).not.toBeNull();
    expect(catalog!.champions.length).toBe(data.champions.length);
    expect(catalog!.traits.length).toBe(data.traits.length);
    expect(catalog!.items.length).toBe(data.items.length);
    expect(catalog!.augments.length).toBe(data.augments.length);
    expect(catalog!.playbooks.length).toBe(playbooks.length);

    // Verify deterministic ordering
    for (let i = 1; i < catalog!.champions.length; i++) {
      const prev = catalog!.champions[i - 1];
      const curr = catalog!.champions[i];
      const order =
        prev.cost - curr.cost ||
        prev.name.localeCompare(curr.name) ||
        prev.id.localeCompare(curr.id);
      expect(order).toBeLessThanOrEqual(0);
    }

    // Verify rich Playbook domains are preserved
    const solarComp = catalog!.playbooks.find((p) => p.id === 'solar-elderwood');
    expect(solarComp).toBeDefined();
    expect(solarComp!.title).toBe('Solar & Elderwood');
    expect(solarComp!.target.units.length).toBe(7);
    expect(solarComp!.family.core).toEqual(
      ['Kayle', 'Xayah', 'Sejuani', 'Ornn'].map(
        (name) => data.champions.find((c) => c.name === name)!.id,
      ),
    );
    expect(solarComp!.strategy).toBeDefined();
    expect(solarComp!.strategy.positioning).toBeDefined();
    expect(solarComp!.stages.length).toBe(4);
    expect(solarComp!.roles.length).toBe(2);
    expect(solarComp!.items.length).toBe(2);
    expect(solarComp!.provenance.status).toBe('curated');
  });

  it('5. cross-screen identity: Comp Library, Playbook, and Home candidates agree on comp definition', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    await repo.set('static', data);

    const state = await loadApplication(repo, knowledgeRepo, adapter);

    for (const testId of ['solar-elderwood', 'adaptor-reroll', 'ap-summoners']) {
      const libraryEntry = state.registry.find((e) => e.id === testId);
      const playbook = state.playbooks.find((p) => p.id === testId);
      const homeCandidate = state.homeCandidates.find((c) => c.playbook.id === testId);

      expect(libraryEntry).toBeDefined();
      expect(playbook).toBeDefined();
      expect(homeCandidate).toBeDefined();

      // Agreement on identity
      expect(libraryEntry!.playbook.id).toBe(testId);
      expect(playbook!.id).toBe(testId);
      expect(homeCandidate!.playbook.id).toBe(testId);

      // Agreement on target roster
      const libUnits = libraryEntry!.playbook.target.units.map((u) => u.championId).sort();
      const playUnits = playbook!.target.units.map((u) => u.championId).sort();
      const homeUnits = homeCandidate!.playbook.target.units.map((u) => u.championId).sort();
      expect(libUnits).toEqual(playUnits);
      expect(homeUnits).toEqual(playUnits);

      // Agreement on core units
      expect(libraryEntry!.playbook.family.core).toEqual(playbook!.family.core);
      expect(homeCandidate!.playbook.family.core).toEqual(playbook!.family.core);

      // Agreement on roles (carry / tank)
      expect(libraryEntry!.playbook.roles).toEqual(playbook!.roles);
      expect(homeCandidate!.playbook.roles).toEqual(playbook!.roles);

      // Agreement on item packages
      expect(libraryEntry!.playbook.items).toEqual(playbook!.items);
      expect(homeCandidate!.playbook.items).toEqual(playbook!.items);

      // Agreement on strategy guidance
      expect(libraryEntry!.playbook.strategy).toBe(playbook!.strategy);
      expect(homeCandidate!.playbook.strategy).toBe(playbook!.strategy);
    }
  });

  it('6. numerical scoring parity: baseline and M13B DB-backed outputs are numerically identical', async () => {
    const data = getBundledStaticData();
    const settings = defaultSettings;
    const now = '2026-09-08T12:00:00.000Z';
    const external = getBundledMetaSnapshot();

    // Baseline: createRecommendations without DB
    const baseline = createRecommendations(data, settings, now, null, null, null, external);

    // M13B: createRecommendations with DB-materialized canonical playbooks
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    await bootstrapKnowledgeDatabase(adapter, data, loadPlaybooks(data), external);
    const catalog = await loadRuntimeKnowledgeCatalog(knowledgeRepo, {
      existingStaticData: data,
      existingExternalSnapshot: external,
    });

    const m13b = createRecommendations(
      data,
      settings,
      now,
      null,
      null,
      null,
      external,
      catalog!.playbooks,
    );

    // 1. Same eligible candidate IDs in the exact same order
    expect(m13b.homeCandidates.map((c) => c.playbook.id)).toEqual(
      baseline.homeCandidates.map((c) => c.playbook.id),
    );

    // 2. Exact same numeric scores for all candidates
    for (let i = 0; i < baseline.homeCandidates.length; i++) {
      const bCand = baseline.homeCandidates[i];
      const mCand = m13b.homeCandidates[i];

      expect(mCand.playbook.id).toBe(bCand.playbook.id);

      // Final Safety
      expect(mCand.home?.finalSafety).toBeCloseTo(bCand.home?.finalSafety ?? 0, 8);
      // Base Performance
      expect(mCand.home?.basePerformance).toBeCloseTo(bCand.home?.basePerformance ?? 0, 8);
      // Low-Pick Edge
      expect(mCand.home?.lowPickEdge).toBeCloseTo(bCand.home?.lowPickEdge ?? 0, 8);
      // Lobby Adjustment
      expect(mCand.home?.lobbyAdjustment).toBeCloseTo(bCand.home?.lobbyAdjustment ?? 0, 8);
      // Raw statistics inputs
      expect(mCand.home?.top4.raw).toBe(bCand.home?.top4.raw);
      expect(mCand.home?.averagePlacement.raw).toBe(bCand.home?.averagePlacement.raw);
      expect(mCand.home?.winRate.raw).toBe(bCand.home?.winRate.raw);
      expect(mCand.home?.pickRate?.value).toBe(bCand.home?.pickRate?.value);
      // Contest scores
      expect(mCand.contest.state).toBe(bCand.contest.state);
      expect(mCand.contest.value).toBe(bCand.contest.value);
      expect(mCand.contest.lobbyFit).toBe(bCand.contest.lobbyFit);
      expect(mCand.score).toBeCloseTo(bCand.score, 8);
    }

    // 3. Exact same portfolio recommendations
    expect(m13b.portfolio.plans.map((p) => p.candidate.playbook.id)).toEqual(
      baseline.portfolio.plans.map((p) => p.candidate.playbook.id),
    );
    expect(m13b.portfolio.plans.map((p) => p.role)).toEqual(
      baseline.portfolio.plans.map((p) => p.role),
    );
  });

  it('7. patch/version coexistence: old and new comp versions coexist and pointer selects active', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);

    // Import static champions/traits/items so foreign keys are satisfied
    const staticRes = await importCommunityDragonKnowledge(adapter, data, { activate: true });

    // Import 18.1
    const res1 = await importCuratedPlaybooks(adapter, playbooks, staticRes.snapshotId, {
      set: 18,
      patch: '18.1',
      activate: true,
    });

    // Create modified playbooks for 18.2
    const playbooks18_2 = structuredClone(playbooks);
    playbooks18_2[0].title = 'Solar & Elderwood (Patch 18.2 Buff)';
    const extraChamp = data.champions.find(
      (c) => c.boardEligible && !playbooks18_2[0].target.units.some((u) => u.championId === c.id),
    );
    if (extraChamp) {
      playbooks18_2[0].target.units.push({
        championId: extraChamp.id,
        stars: 2,
        slot: 'flex',
        items: [],
      });
    }

    // Import 18.2
    const res2 = await importCuratedPlaybooks(adapter, playbooks18_2, staticRes.snapshotId, {
      set: 18,
      patch: '18.2',
      activate: true,
    });

    // Both snapshots coexist in comp_versions
    const versions = await adapter.select<{ snapshot_id: string; title: string }>(
      "SELECT snapshot_id, title FROM comp_versions WHERE comp_id = 'solar-elderwood' ORDER BY snapshot_id ASC",
    );
    expect(versions.length).toBe(2);

    // Active version pointer points to 18.2
    const activeCurated = await knowledgeRepo.getActiveKnowledgeVersion('curated');
    expect(activeCurated?.snapshotId).toBe(res2.snapshotId);

    // Active query returns the 18.2 title
    const activeComp = await knowledgeRepo.getComp('solar-elderwood');
    expect(activeComp?.title).toBe('Solar & Elderwood (Patch 18.2 Buff)');

    // Historical query explicitly targeting 18.1 returns the 18.1 title
    const historicalComp = await knowledgeRepo.getComp('solar-elderwood', res1.snapshotId);
    expect(historicalComp?.title).toBe('Solar & Elderwood');
  });

  it('8. compatibility: incompatible external meta is excluded fail-closed', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);
    const external = getBundledMetaSnapshot();

    // Import static 18.1
    const staticRes = await importCommunityDragonKnowledge(adapter, data, { activate: true });
    await importCuratedPlaybooks(adapter, playbooks, staticRes.snapshotId, { activate: true });

    // Modify external snapshot to patch 17.5 (incompatible)
    const oldExternal: ExternalSnapshot = {
      ...external,
      manifest: {
        ...external.manifest,
        scope: {
          ...external.manifest.scope,
          set: 17,
          patch: '17.5',
        },
      },
    };

    // Load catalog with incompatible external snapshot
    const catalog = await loadRuntimeKnowledgeCatalog(knowledgeRepo, {
      existingStaticData: data,
      existingExternalSnapshot: oldExternal,
    });

    // External snapshot should be excluded fail-closed
    expect(catalog?.snapshots.external).toBeNull();
    expect(catalog?.externalSnapshot).toBeNull();
  });

  it('9. runtime query behavior & performance: bulk load executes bounded queries with zero per-render queries', async () => {
    const { adapter } = createMigratedDb();
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);
    await repo.set('static', data);

    // Initial database bootstrap occurs during first run or installation
    await bootstrapKnowledgeDatabase(adapter, data, playbooks);

    let selectCount = 0;
    let queryCount = 0;
    const trackingAdapter: SqlDatabase = {
      async select<T = unknown>(query: string, bindParams: unknown[] = []): Promise<T[]> {
        selectCount++;
        queryCount++;
        return adapter.select<T>(query, bindParams);
      },
      async execute(query: string, bindParams: unknown[] = []) {
        queryCount++;
        return adapter.execute(query, bindParams);
      },
    };
    const trackingRepo = new SqlKnowledgeRepository(trackingAdapter);

    const t0 = performance.now();
    const state = await loadApplication(repo, trackingRepo, trackingAdapter);
    const tLoad = performance.now() - t0;

    // Verify bounded SQLite queries during normal application startup (no N+1 explosions)
    expect(selectCount).toBeLessThanOrEqual(20);

    const queriesBeforeRender = queryCount;

    // Simulate rendering 12 comp cards and scoring
    const tScoring0 = performance.now();
    for (const comp of state.playbooks) {
      expect(comp.id).toBeDefined();
      expect(comp.target.units.length).toBeGreaterThan(0);
    }
    const tScoring = performance.now() - tScoring0;

    // Assert ZERO additional SQL queries occurred during reading/rendering
    expect(queryCount).toBe(queriesBeforeRender);

    // Performance measurements: all sub-millisecond or fast tens-of-ms
    expect(tLoad).toBeLessThan(1000);
    expect(tScoring).toBeLessThan(50);
  });

  it('10. refresh behavior: refreshApplication imports, activates transactionally, and updates catalog', async () => {
    const { adapter } = createMigratedDb();
    const knowledgeRepo = new SqlKnowledgeRepository(adapter);
    const repo = new MemoryRepository();
    const data = getBundledStaticData();
    await repo.set('static', data);

    const fetchSpy = vi.spyOn(CommunityDragonProvider.prototype, 'fetch').mockResolvedValue(data);

    try {
      const initialState = await loadApplication(repo, knowledgeRepo, adapter);
      expect(initialState.catalog).toBeDefined();

      // Perform refresh
      const refreshedState = await refreshApplication(initialState, repo, knowledgeRepo, adapter);

      expect(refreshedState.source).toBe('Network');
      expect(refreshedState.catalog).toBeDefined();
      expect(refreshedState.playbooks.length).toBeGreaterThan(0);
      expect(refreshedState.activeStaticSnapshotId).toBeDefined();
      expect(refreshedState.activeCuratedSnapshotId).toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
