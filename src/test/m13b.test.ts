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
  importMetaTFTExternal,
} from '../storage/knowledgeImporter';
import {
  SqlKnowledgeRepository,
  MemoryKnowledgeRepository,
  type SourceSnapshot,
} from '../storage/knowledgeRepository';
import { normalizeCommunityDragon, CommunityDragonProvider } from '../providers/communityDragon';
import { externalHash } from '../providers/externalMeta';
import { loadPlaybooks } from '../providers/playbooks';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import {
  loadApplication,
  createRecommendations,
  refreshApplication,
} from '../services/application';
import {
  loadRuntimeKnowledgeCatalog,
  materializeStaticData,
  projectExternalSnapshot,
} from '../services/knowledgeCatalog';
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

describe('M13B.1 — Knowledge Projection Integrity Hardening', () => {
  it('1. Problem 1: NULL patch/hotfix never becomes 18.1, current, or patchVerified', () => {
    const data = getBundledStaticData();
    const champions = data.champions.map((c) => ({
      id: c.id,
      name: c.name,
      snapshotId: 'snap-null',
      cost: c.cost,
      role: c.role ?? null,
      shopStatus: c.shopStatus,
      boardEligible: c.boardEligible,
      icon: c.icon,
      splash: c.splash,
      traitIds: c.traitIds,
      contentFingerprint: 'fp-champ',
      mechanics: null,
    }));
    const traits = data.traits.map((t) => ({
      id: t.id,
      name: t.name,
      snapshotId: 'snap-null',
      icon: t.icon,
      breakpoints: t.breakpoints.map((b) => ({ minUnits: b, maxUnits: b, effect: '', effects: {} })),
      counting: t.counting,
      availability: t.availability,
      contentFingerprint: 'fp-trait',
      mechanics: null,
    }));

    // Case A: Source snapshot has completely NULL patch, NULL hotfix, but claims "verified" and "current"
    const nullSnap: SourceSnapshot = {
      snapshotId: 'snap-null',
      sourceId: 'community-dragon',
      sourceType: 'static-cdn',
      setNumber: 15,
      balancePatch: null,
      hotfix: null,
      retrievedAt: new Date().toISOString(),
      publishedAt: null,
      sourceVersion: '15.unknown',
      schemaVersion: 2,
      contentHash: 'hash-null',
      provenanceStatus: 'verified',
      parityStatus: 'current',
      sourceUri: 'https://raw.communitydragon.org',
      notes: 'Test null patch',
      rawReference: null,
      createdAt: new Date().toISOString(),
    };

    const materialized = materializeStaticData(champions, traits, [], [], nullSnap);

    // Assert: patch and hotfix in provenance/knowledge are strictly NULL, not 18.1 or any fabricated string
    expect(materialized.version.provenance.patch).toBeNull();
    expect(materialized.knowledge?.balancePatch).toBeNull();
    expect(materialized.knowledge?.balanceHotfix).toBeNull();

    // Assert: absence of verified patch evidence must NEVER become patchVerified: true
    expect(materialized.version.patchVerified).toBe(false);

    // Assert: unknown/invalid patch parity conservatively becomes 'unverified', never 'current'
    expect(materialized.version.parityStatus).toBe('unverified');
    expect(materialized.knowledge?.parity).toBe('unverified');

    // Assert: display fallback is 'unknown', NOT '18.1' or hardcoded Set 18
    expect(materialized.version.patch).toBe('unknown');
    expect(materialized.version.name).toBe('Set 15');

    // Case B: Known patch exists ('15.2'), but provenance status is 'unverified'
    const unverifiedSnap: SourceSnapshot = {
      ...nullSnap,
      balancePatch: '15.2',
      provenanceStatus: 'unverified',
      parityStatus: 'current',
    };
    const matUnverified = materializeStaticData(champions, traits, [], [], unverifiedSnap);
    expect(matUnverified.version.patch).toBe('15.2');
    expect(matUnverified.version.provenance.patch).toBe('15.2');
    expect(matUnverified.version.patchVerified).toBe(false); // unverified provenance prevents patchVerified
    expect(matUnverified.version.parityStatus).toBe('current');

    // Case C: Known patch exists ('15.2'), provenance status is 'verified', parity is 'current'
    const fullyVerifiedSnap: SourceSnapshot = {
      ...nullSnap,
      balancePatch: '15.2',
      provenanceStatus: 'verified',
      parityStatus: 'current',
    };
    const matVerified = materializeStaticData(champions, traits, [], [], fullyVerifiedSnap);
    expect(matVerified.version.patchVerified).toBe(true);
    expect(matVerified.version.parityStatus).toBe('current');
  });

  it('2. Problem 2: Reconstruct external meta from real persisted scope (rank, region, window, queue, sampleSize)', async () => {
    const { adapter } = createMigratedDb();
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    // Import static & curated data first with explicit patch 18.1
    data.version.provenance.patch = '18.1';
    data.version.patch = '18.1';
    await importCommunityDragonKnowledge(adapter, data);
    const playbooks = loadPlaybooks(data);
    await importCuratedPlaybooks(adapter, playbooks, 'cd-test');

    // Prepare external snapshot with explicit, non-default scope
    const baseExternal = getBundledMetaSnapshot();
    const customMeta: ExternalSnapshot = structuredClone(baseExternal);
    customMeta.manifest.scope.set = data.version.set;
    customMeta.manifest.scope.patch = '18.1';
    customMeta.manifest.scope.rank = 'Master+';
    customMeta.manifest.scope.region = 'EUW';
    customMeta.manifest.scope.window = 'last-3-days';
    customMeta.manifest.scope.queue = 1100;
    customMeta.manifest.population = 87654;
    customMeta.manifest.contentHash = externalHash(customMeta);

    const importRes = await importMetaTFTExternal(adapter, customMeta, data);

    // Check typed repository getMetaSnapshot
    const metaRecord = await repo.getMetaSnapshot(importRes.snapshotId);
    expect(metaRecord).not.toBeNull();
    expect(metaRecord?.rankBracket).toBe('Master+');
    expect(metaRecord?.region).toBe('EUW');
    expect(metaRecord?.window).toBe('last-3-days');
    expect(metaRecord?.queue).toBe(1100);
    expect(metaRecord?.sampleSize).toBe(87654);

    // Load runtime catalog and verify projected external snapshot scope matches DB exactly
    const catalog = await loadRuntimeKnowledgeCatalog(repo);
    expect(catalog).not.toBeNull();
    expect(catalog?.externalSnapshot).not.toBeNull();

    const projected = catalog!.externalSnapshot!;
    expect(projected.manifest.scope.rank).toBe('Master+');
    expect(projected.manifest.scope.region).toBe('EUW');
    expect(projected.manifest.scope.window).toBe('last-3-days');
    expect(projected.manifest.scope.queue).toBe(1100);
    expect(projected.manifest.population).toBe(87654);
  });

  it('3. Problem 2: NULL / missing statistics project as NULL, never fake defaults (4.5, 0.5, 0.125, 1000)', async () => {
    // Test projectExternalSnapshot with observations having NULL statistics
    const activeMeta = {
      kind: 'external-meta' as const,
      snapshotId: 'meta:null-stats',
      setNumber: 18,
      balancePatch: '18.1',
      hotfix: null,
      sourceVersion: '18.1.0',
      contentHash: 'hash-null-stats',
      activatedAt: new Date().toISOString(),
    };

    const nullMetaRecord = {
      snapshotId: 'meta:null-stats',
      provider: 'MetaTFT',
      setNumber: 18,
      patch: '18.1',
      hotfix: null,
      rankBracket: null,
      region: null,
      window: null,
      queue: null,
      sampleSize: null,
      retrievedAt: new Date().toISOString(),
      contentHash: 'hash-null-stats',
    };

    const nullObservations = [
      {
        observationId: 'obs:1',
        snapshotId: 'meta:null-stats',
        compId: 'comp-empty',
        providerCompId: 'empty-comp-1',
        sampleSize: null,
        averagePlacement: null,
        top4Rate: null,
        winRate: null,
        pickRate: null,
        rawStats: {},
        positions: [{ championId: 'tft18_mordekaiser', row: 0, column: 0 }],
        itemPackages: [],
        observedAt: new Date().toISOString(),
      },
    ];

    const nullComps = [
      {
        id: 'comp-empty',
        name: 'Empty Comp',
        sourceKind: 'external-meta' as const,
        snapshotId: 'meta:null-stats',
        title: 'Empty Comp',
        subtitle: null,
        heroId: null,
        style: null,
        evidenceLabel: 'Emerging' as const,
        targetLevel: 8,
        levelPlan: null,
        playSignals: null,
        avoidSignals: null,
        contentFingerprint: 'fp-empty',
        units: [
          {
            compId: 'comp-empty',
            snapshotId: 'meta:null-stats',
            championId: 'tft18_mordekaiser',
            slot: 'core' as const,
            role: null,
            stage: 'final' as const,
          },
        ],
        itemPackages: [],
        payload: null,
      },
    ];

    const projected = projectExternalSnapshot(
      activeMeta,
      null,
      nullMetaRecord,
      nullObservations,
      nullComps,
    );

    expect(projected).not.toBeNull();
    const compStats = projected!.comps[0].stats;

    // Prove: NULL stats stay NULL and are NOT fabricated defaults
    expect(compStats.average).toBeNull();
    expect(compStats.top4).toBeNull();
    expect(compStats.win).toBeNull();
    expect(compStats.playRate).toBeNull();
    expect(compStats.sample).toBeNull();

    // Prove: scope fields are NULL when not in DB, not Diamond+/global/last-7-days/1100
    expect(projected!.manifest.scope.rank).toBeNull();
    expect(projected!.manifest.scope.region).toBeNull();
    expect(projected!.manifest.scope.window).toBeNull();
    expect(projected!.manifest.scope.queue).toBeNull();
    expect(projected!.manifest.population).toBeNull();

    // Prove: units, items, traits, augments are empty arrays, not filled with fake neutral statistics
    expect(projected!.units).toEqual([]);
    expect(projected!.items).toEqual([]);
    expect(projected!.traits).toEqual([]);
    expect(projected!.augments).toEqual([]);
  });

  it('4. Problem 3: source_snapshots.payload vs raw_reference separation', async () => {
    const { adapter } = createMigratedDb();
    const repo = new SqlKnowledgeRepository(adapter);
    const now = new Date().toISOString();

    // Insert a snapshot where raw_reference is a file path / URL (NOT JSON)
    // and payload is valid JSON metadata
    const testRawReference = 'C:/data/sources/raw_snapshot_123.bin';
    const testPayload = JSON.stringify({
      warnings: ['Warning A', 'Warning B'],
      name: 'Custom Set Name 18',
    });

    await adapter.execute(
      'INSERT OR IGNORE INTO knowledge_sources (source_id, name, source_type, base_url, created_at) VALUES ($1, $2, $3, $4, $5)',
      ['community-dragon', 'CommunityDragon', 'static-cdn', 'https://raw.communitydragon.org', now],
    );

    await adapter.execute(
      `INSERT INTO source_snapshots (
        snapshot_id, source_id, source_type, set_number, balance_patch, hotfix,
        retrieved_at, published_at, source_version, schema_version, content_hash,
        provenance_status, parity_status, source_uri, notes, raw_reference, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        'snap:payload-test',
        'community-dragon',
        'static-cdn',
        18,
        '18.1',
        null,
        now,
        null,
        '18.1.0',
        2,
        'hash-test-payload',
        'verified',
        'current',
        'https://raw.communitydragon.org',
        'Payload test notes',
        testRawReference,
        testPayload,
        now,
      ],
    );

    // 1. Check getSourceSnapshot returns typed rawReference and payload
    const fetched = await repo.getSourceSnapshot('snap:payload-test');
    expect(fetched).not.toBeNull();
    expect(fetched?.rawReference).toBe(testRawReference);
    expect(fetched?.payload).toBe(testPayload);

    // 2. Check listSourceSnapshots also returns typed rawReference and payload
    const list = await repo.listSourceSnapshots({ sourceId: 'community-dragon' });
    const target = list.find((s) => s.snapshotId === 'snap:payload-test');
    expect(target).toBeDefined();
    expect(target?.rawReference).toBe(testRawReference);
    expect(target?.payload).toBe(testPayload);

    // 3. Verify materializeStaticData reads payload for name and warnings, without failing on non-JSON rawReference
    const data = getBundledStaticData();
    const champions = data.champions.map((c) => ({
      id: c.id,
      name: c.name,
      snapshotId: 'snap:payload-test',
      cost: c.cost,
      role: c.role ?? null,
      shopStatus: c.shopStatus,
      boardEligible: c.boardEligible,
      icon: c.icon,
      splash: c.splash,
      traitIds: c.traitIds,
      contentFingerprint: 'fp-champ',
      mechanics: null,
    }));

    const mat = materializeStaticData(champions, [], [], [], fetched!);
    expect(mat.version.name).toBe('Custom Set Name 18');
    expect(mat.warnings).toEqual(['Warning A', 'Warning B']);
    expect(mat.version.provenance.patch).toBe('18.1');
    expect(mat.version.patchVerified).toBe(true);
  });

  it('5. MemoryKnowledgeRepository parity: getMetaSnapshot and setMetaSnapshot work consistently', async () => {
    const memRepo = new MemoryKnowledgeRepository();
    expect(await memRepo.getMetaSnapshot('nonexistent')).toBeNull();

    const metaRecord = {
      snapshotId: 'meta:mem-test',
      provider: 'MetaTFT',
      setNumber: 18,
      patch: '18.1',
      hotfix: 'b',
      rankBracket: 'Grandmaster',
      region: 'KR',
      window: 'last-24-hours',
      queue: 1100,
      sampleSize: 15000,
      retrievedAt: new Date().toISOString(),
      contentHash: 'hash-mem-test',
    };

    memRepo.setMetaSnapshot(metaRecord);
    const retrieved = await memRepo.getMetaSnapshot('meta:mem-test');
    expect(retrieved).toEqual(metaRecord);
  });
});
