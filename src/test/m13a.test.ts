import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  createNodeSqliteAdapter,
  applyAllMigrations,
  MIGRATION_SQL_FILES,
} from '../storage/knowledgeDatabase';
import {
  importCommunityDragonKnowledge,
  importCuratedPlaybooks,
  importMetaTFTExternal,
  activateKnowledgeSnapshot,
} from '../storage/knowledgeImporter';
import { SqlKnowledgeRepository, MemoryKnowledgeRepository } from '../storage/knowledgeRepository';
import { normalizeCommunityDragon } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import { entityMapper, externalHash } from '../providers/externalMeta';
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

describe('M13A — Versioned TFT Knowledge Database Foundation', () => {
  it('1. migration v5 upgrades an existing v4 DB without data loss', () => {
    const db = new DatabaseSync(':memory:');
    // Run migrations v1-v4
    for (const file of MIGRATION_SQL_FILES.slice(0, 4)) {
      const sql = readFileSync(new URL(`../storage/${file}`, import.meta.url), 'utf8');
      db.exec(sql);
    }

    // Insert legacy v1-v4 data
    db.prepare('INSERT INTO settings VALUES (?, ?)').run('test_setting', '{"value": 42}');
    db.prepare('INSERT INTO completed_matches VALUES (?, ?, ?, ?)').run(
      'match_1',
      '{"id": 1}',
      18,
      '18.1',
    );
    db.prepare('INSERT INTO riot_accounts VALUES (?, ?, ?, ?, ?, ?)').run(
      'puuid_1',
      'PlayerOne',
      'EUW',
      'EUW1',
      'europe',
      '2026-09-08T00:00:00Z',
    );
    db.prepare('INSERT INTO riot_completed_matches VALUES (?, ?, ?, ?, ?, ?)').run(
      'riot_m1',
      '{"id": "riot_m1"}',
      18,
      '18.1',
      '2026-09-08T00:00:00Z',
      '2026-09-08T00:00:00Z',
    );
    db.prepare('INSERT INTO plan_sessions VALUES (?, ?, ?, ?, ?, ?)').run(
      'session_1',
      'active',
      '2026-09-08T00:00:00Z',
      null,
      '{"state":"active"}',
      null,
    );
    db.prepare('INSERT INTO postgame_reconciliations VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'chain_1',
      'session_1',
      'unmatched',
      null,
      '{}',
      '2026-09-08T00:00:00Z',
      null,
    );

    // Apply migration v5
    const v5Sql = readFileSync(new URL('../storage/schema_m13.sql', import.meta.url), 'utf8');
    db.exec(v5Sql);

    // Verify all legacy data is preserved
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('test_setting')).toEqual({
      value: '{"value": 42}',
    });
    expect(
      db
        .prepare('SELECT set_number, patch FROM completed_matches WHERE match_id = ?')
        .get('match_1'),
    ).toEqual({
      set_number: 18,
      patch: '18.1',
    });
    expect(
      db.prepare('SELECT game_name FROM riot_accounts WHERE puuid = ?').get('puuid_1'),
    ).toEqual({
      game_name: 'PlayerOne',
    });
    expect(db.prepare('SELECT state FROM plan_sessions WHERE id = ?').get('session_1')).toEqual({
      state: 'active',
    });
    expect(
      db.prepare('SELECT state FROM postgame_reconciliations WHERE chain_id = ?').get('chain_1'),
    ).toEqual({
      state: 'unmatched',
    });

    // Verify new v5 tables exist
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const tableNames = new Set(tableRows.map((t) => t.name));
    for (const expected of [
      'knowledge_sources',
      'source_snapshots',
      'active_knowledge_snapshots',
      'champions',
      'champion_versions',
      'champion_traits',
      'traits',
      'trait_versions',
      'trait_breakpoints',
      'items',
      'item_versions',
      'item_components',
      'augments',
      'augment_versions',
      'augment_required_traits',
      'comps',
      'comp_versions',
      'comp_units',
      'comp_item_packages',
      'meta_snapshots',
      'comp_meta_observations',
    ]) {
      expect(tableNames.has(expected)).toBe(true);
    }
  });

  it('2. stable entity identity survives multiple versions', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const data = getBundledStaticData();

    // Import first version
    const res1 = await importCommunityDragonKnowledge(adapter, data);
    expect(res1.created).toBe(true);

    // Prepare modified version with same champion DA_18_Xayah but different cost
    const modifiedData: StaticData = structuredClone(data);
    const xayah = modifiedData.champions.find((c) => c.id === 'DA_18_Xayah')!;
    xayah.cost = 5;
    modifiedData.version.sourceVersion = 'patch-18.2-modified';
    if (modifiedData.knowledge) {
      delete (modifiedData as { knowledge?: unknown }).knowledge; // force recalculation of fingerprint
    }

    const res2 = await importCommunityDragonKnowledge(adapter, modifiedData);
    expect(res2.created).toBe(true);
    expect(res2.snapshotId).not.toBe(res1.snapshotId);

    // Check entity identity table: exactly 1 row for DA_18_Xayah
    const champRows = db.prepare('SELECT * FROM champions WHERE id = ?').all('DA_18_Xayah');
    expect(champRows.length).toBe(1);

    // Check version table: 2 distinct version rows
    const versionRows = db
      .prepare(
        'SELECT snapshot_id, cost FROM champion_versions WHERE champion_id = ? ORDER BY cost ASC',
      )
      .all('DA_18_Xayah') as { snapshot_id: string; cost: number }[];
    expect(versionRows.length).toBe(2);
    expect(versionRows[0].cost).toBe(1);
    expect(versionRows[1].cost).toBe(5);
  });

  it('3. two patches/snapshots of one champion remain queryable', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    const res1 = await importCommunityDragonKnowledge(adapter, data);
    const modifiedData: StaticData = structuredClone(data);
    modifiedData.champions.find((c) => c.id === 'DA_18_Xayah')!.cost = 99;
    modifiedData.version.sourceVersion = 'patch-18.3-test';
    delete (modifiedData as { knowledge?: unknown }).knowledge;
    const res2 = await importCommunityDragonKnowledge(adapter, modifiedData);

    const v1 = await repo.getChampion('DA_18_Xayah', res1.snapshotId);
    const v2 = await repo.getChampion('DA_18_Xayah', res2.snapshotId);

    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v1?.cost).toBe(1);
    expect(v2?.cost).toBe(99);
    expect(v1?.snapshotId).toBe(res1.snapshotId);
    expect(v2?.snapshotId).toBe(res2.snapshotId);
  });

  it('4. same snapshot import is idempotent', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const data = getBundledStaticData();

    const countBefore = (
      db.prepare('SELECT count(*) AS c FROM champion_versions').get() as { c: number }
    ).c;
    expect(countBefore).toBe(0);

    const first = await importCommunityDragonKnowledge(adapter, data);
    expect(first.created).toBe(true);

    const countAfterFirst = (
      db.prepare('SELECT count(*) AS c FROM champion_versions').get() as { c: number }
    ).c;
    expect(countAfterFirst).toBe(data.champions.length);

    // Re-import identical snapshot
    const second = await importCommunityDragonKnowledge(adapter, data);
    expect(second.created).toBe(false);
    expect(second.snapshotId).toBe(first.snapshotId);

    const countAfterSecond = (
      db.prepare('SELECT count(*) AS c FROM champion_versions').get() as { c: number }
    ).c;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('5. changed snapshot creates a new version and old rows remain queryable', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    const res1 = await importCommunityDragonKnowledge(adapter, data);
    await activateKnowledgeSnapshot(adapter, 'static', res1.snapshotId);

    const modified = structuredClone(data);
    modified.champions[0].cost += 1;
    modified.version.sourceVersion = 'diff-v2';
    delete (modified as { knowledge?: unknown }).knowledge;

    const res2 = await importCommunityDragonKnowledge(adapter, modified);
    expect(res2.created).toBe(true);
    expect(res2.snapshotId).not.toBe(res1.snapshotId);

    const diff = await repo.getKnowledgeDiff(res1.snapshotId, res2.snapshotId);
    expect(diff).not.toBeNull();
    expect(diff?.championsChanged).toContain(modified.champions[0].id);
  });

  it('6. failed import leaves previous active snapshot untouched', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    // Import and activate good snapshot
    const res1 = await importCommunityDragonKnowledge(adapter, data);
    await activateKnowledgeSnapshot(adapter, 'static', res1.snapshotId);

    const activeBefore = await repo.getActiveKnowledgeVersion('static');
    expect(activeBefore?.snapshotId).toBe(res1.snapshotId);

    // Prepare a malformed static data that fails SQLite check constraints
    const badData = structuredClone(data);
    badData.champions[0].shopStatus = 'invalid-status' as unknown as 'pool'; // violates CHECK constraint
    badData.version.sourceVersion = 'bad-version';
    delete (badData as { knowledge?: unknown }).knowledge;

    await expect(importCommunityDragonKnowledge(adapter, badData)).rejects.toThrow();

    // Active knowledge version must be completely untouched
    const activeAfter = await repo.getActiveKnowledgeVersion('static');
    expect(activeAfter?.snapshotId).toBe(res1.snapshotId);

    // No corrupt snapshot row created
    const snapshots = db.prepare('SELECT count(*) AS c FROM source_snapshots').get() as {
      c: number;
    };
    expect(snapshots.c).toBe(1);
  });

  it('7. provenance survives round trip', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    const res = await importCommunityDragonKnowledge(adapter, data, {
      rawReference: 'data/fixtures/cdragon-set18.json',
    });

    const snapshot = await repo.getSourceSnapshot(res.snapshotId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceId).toBe('community-dragon');
    expect(snapshot?.sourceType).toBe('static-cdn');
    expect(snapshot?.setNumber).toBe(data.version.set);
    expect(snapshot?.retrievedAt).toBe(data.version.provenance.fetchedAt);
    expect(snapshot?.sourceUri).toBe(data.version.provenance.source);
    expect(snapshot?.notes).toBe(data.version.provenance.note);
    expect(snapshot?.rawReference).toBe('data/fixtures/cdragon-set18.json');
    expect(snapshot?.parityStatus).toBe(data.version.parityStatus);
  });

  it('8. unknown/null patch remains unknown, not silently assigned active patch', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    // CDragon data has provenance.patch = null
    expect(data.version.provenance.patch).toBeNull();

    const res = await importCommunityDragonKnowledge(adapter, data);
    const snap = await repo.getSourceSnapshot(res.snapshotId);

    expect(snap?.balancePatch).toBeNull();
    expect(snap?.balancePatch).not.toBe('18.1');
  });

  it('9. trait relationships/breakpoints round-trip', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    const res = await importCommunityDragonKnowledge(adapter, data);

    const trait = data.traits[0];
    const retrieved = await repo.getTrait(trait.id, res.snapshotId);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(trait.id);
    expect(retrieved?.name).toBe(trait.name);
    expect(retrieved?.breakpoints.map((b) => b.minUnits)).toEqual(trait.breakpoints);

    // Test champion trait querying
    const champWithTrait = data.champions.find((c) => c.traitIds.includes(trait.id))!;
    const champsForTrait = await repo.listChampions({
      snapshotId: res.snapshotId,
      traitId: trait.id,
    });
    expect(champsForTrait.some((c) => c.id === champWithTrait.id)).toBe(true);
  });

  it('10. item components round-trip in exact order', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    const res = await importCommunityDragonKnowledge(adapter, data);

    const guinsoo = data.items.find((i) => i.id === 'DA_GuinsoosRageblade')!;
    const retrieved = await repo.getItem(guinsoo.id, res.snapshotId);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.category).toBe('combined');
    expect(retrieved?.components).toEqual(guinsoo.components);
  });

  it('11. curated comp core/flex/role relationships round-trip', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);

    const staticRes = await importCommunityDragonKnowledge(adapter, data);
    const curatedRes = await importCuratedPlaybooks(adapter, playbooks, staticRes.snapshotId);

    const comp = await repo.getComp('solar-elderwood', curatedRes.snapshotId);
    expect(comp).not.toBeNull();
    expect(comp?.title).toBe('Solar & Elderwood');
    expect(comp?.evidenceLabel).toBe('Experimental');

    const units = comp!.units;
    const coreUnits = units
      .filter((u) => u.stage === 'final' && u.slot === 'core')
      .map((u) => u.championId);
    const flexUnits = units
      .filter((u) => u.stage === 'final' && u.slot === 'flex')
      .map((u) => u.championId);

    // Kayle, Xayah, Sejuani, Ornn are core
    expect(coreUnits).toContain('DA_18_Kayle');
    expect(coreUnits).toContain('DA_18_Xayah');
    expect(coreUnits).toContain('DA_18_Sejuani');
    expect(coreUnits).toContain('DA_18_Ornn');

    // Hecarim is flex
    expect(flexUnits).toContain('DA_18_Hecarim');

    // Roles: Kayle is carry, Sejuani is tank, Ornn has role null
    const kayle = units.find((u) => u.stage === 'final' && u.championId === 'DA_18_Kayle');
    const sejuani = units.find((u) => u.stage === 'final' && u.championId === 'DA_18_Sejuani');
    const ornn = units.find((u) => u.stage === 'final' && u.championId === 'DA_18_Ornn');

    expect(kayle?.role).toBe('carry');
    expect(sejuani?.role).toBe('tank');
    expect(ornn?.role).toBeNull();

    // Item packages round-trip
    expect(comp!.itemPackages.length).toBeGreaterThan(0);
    const kaylePkg = comp!.itemPackages.filter((p) => p.holderId === 'DA_18_Kayle');
    expect(kaylePkg.map((p) => p.itemId)).toEqual(['DA_GuinsoosRageblade', 'DA_RabadonsDeathcap']);
  });

  it('12. unsupported/missing curated facts remain unavailable rather than invented', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);

    const staticRes = await importCommunityDragonKnowledge(adapter, data);
    const curatedRes = await importCuratedPlaybooks(adapter, playbooks, staticRes.snapshotId);

    const comp = await repo.getComp('solar-elderwood', curatedRes.snapshotId);
    expect(comp?.avoidSignals).toBeNull(); // avoidSignals is unverified/unavailable in source

    // A unit without tank/carry role is stored as null
    const leona = comp?.units.find((u) => u.championId === 'DA_18_Leona');
    expect(leona?.role).toBeNull();
  });

  it('13. MetaTFT scope/sample/statistics round-trip', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const metaRaw = getBundledMetaSnapshot();

    const metaRes = await importMetaTFTExternal(adapter, metaRaw, data);
    expect(metaRes.created).toBe(true);

    const metaSnap = await repo.getSourceSnapshot(metaRes.snapshotId);
    expect(metaSnap?.sourceId).toBe('metatft');
    expect(metaSnap?.balancePatch).toBe(metaRaw.manifest.scope.patch);
    expect(metaSnap?.hotfix).toBe(metaRaw.manifest.scope.hotfix);

    // Pick first comp and verify observation
    const firstComp = metaRaw.comps[0];
    const obs = await repo.getLatestMetaForComp(`external-meta:${firstComp.id}`);
    expect(obs).not.toBeNull();
    expect(obs?.providerCompId).toBe(firstComp.id);
    expect(obs?.sampleSize).toBe(firstComp.stats.sample);
    expect(obs?.averagePlacement).toBe(firstComp.stats.average);
    expect(obs?.top4Rate).toBe(firstComp.stats.top4);
    expect(obs?.winRate).toBe(firstComp.stats.win);
  });

  it('14. ambiguous entity mappings fail closed', () => {
    const mapper = entityMapper([
      { id: 'DA_18_Xayah', name: 'Xayah' },
      { id: 'DA_18_Xayah_Alt', name: 'Xayah' }, // duplicate name
      { id: 'DA_18_Unique', name: 'Unique Champion' },
    ]);

    // Exact ID matches
    expect(mapper('DA_18_Xayah')).toBe('DA_18_Xayah');
    expect(mapper('DA_18_Unique')).toBe('DA_18_Unique');

    // Unique display name matches
    expect(mapper('Unique Champion')).toBe('DA_18_Unique');

    // Ambiguous display name fails closed (returns null)
    expect(mapper('Xayah')).toBeNull();

    // Unknown name fails closed
    expect(mapper('NonExistent')).toBeNull();
  });

  it('15. old Riot completed matches/opponent profiles remain untouched', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);

    // Seed prior riot history
    db.prepare('INSERT INTO riot_completed_matches VALUES (?, ?, ?, ?, ?, ?)').run(
      'riot_match_100',
      '{"id":"riot_match_100","sample":true}',
      18,
      '18.1',
      '2026-09-08T12:00:00Z',
      '2026-09-08T12:00:00Z',
    );
    db.prepare('INSERT INTO riot_opponent_profiles VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'puuid_999',
      18,
      '18.1',
      'derivation_v1',
      'fp_999',
      '{"profile": true}',
      '2026-09-08T12:00:00Z',
    );

    const data = getBundledStaticData();
    await importCommunityDragonKnowledge(adapter, data);

    const matchRow = db
      .prepare('SELECT payload FROM riot_completed_matches WHERE match_id = ?')
      .get('riot_match_100') as { payload: string };
    expect(matchRow.payload).toBe('{"id":"riot_match_100","sample":true}');

    const profileRow = db
      .prepare('SELECT payload FROM riot_opponent_profiles WHERE puuid = ?')
      .get('puuid_999') as { payload: string };
    expect(profileRow.payload).toBe('{"profile": true}');
  });

  it('16. in-memory repository satisfies interface deterministically', async () => {
    const memRepo = new MemoryKnowledgeRepository();
    memRepo.setActiveKnowledgeVersion({
      kind: 'static',
      snapshotId: 'mem_snap_1',
      setNumber: 18,
      balancePatch: '18.1',
      hotfix: null,
      sourceVersion: 'v1',
      contentHash: 'hash1',
      activatedAt: '2026-09-08T00:00:00Z',
    });

    memRepo.setChampion({
      id: 'DA_18_Xayah',
      name: 'Xayah',
      snapshotId: 'mem_snap_1',
      cost: 4,
      role: null,
      shopStatus: 'pool',
      boardEligible: true,
      icon: null,
      splash: null,
      traitIds: ['trait_1'],
      contentFingerprint: 'fp_x',
      mechanics: null,
    });

    const active = await memRepo.getActiveKnowledgeVersion('static');
    expect(active?.snapshotId).toBe('mem_snap_1');

    const champ = await memRepo.getChampion('DA_18_Xayah');
    expect(champ?.cost).toBe(4);

    const list = await memRepo.listChampions({ cost: 4 });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('DA_18_Xayah');
  });

  it('17. two snapshots from the exact same patch/hotfix coexist when content differs', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    // Set explicit patch and hotfix on both
    const snapA: StaticData = structuredClone(data);
    snapA.version.provenance.patch = '18.1';
    snapA.version.sourceVersion = 'patch-18.1-build-A';
    delete (snapA as { knowledge?: unknown }).knowledge;

    const snapB: StaticData = structuredClone(data);
    snapB.version.provenance.patch = '18.1';
    snapB.version.sourceVersion = 'patch-18.1-build-B';
    // Modify one champion in B
    snapB.champions[0].cost += 1;
    delete (snapB as { knowledge?: unknown }).knowledge;

    const resA = await importCommunityDragonKnowledge(adapter, snapA);
    const resB = await importCommunityDragonKnowledge(adapter, snapB);

    expect(resA.snapshotId).not.toBe(resB.snapshotId);

    const sA = await repo.getSourceSnapshot(resA.snapshotId);
    const sB = await repo.getSourceSnapshot(resB.snapshotId);

    // Same set and patch
    expect(sA?.setNumber).toBe(18);
    expect(sB?.setNumber).toBe(18);
    expect(sA?.balancePatch).toBe('18.1');
    expect(sB?.balancePatch).toBe('18.1');

    // Both coexist simultaneously in source_snapshots
    const count = (
      db
        .prepare("SELECT count(*) AS c FROM source_snapshots WHERE balance_patch = '18.1'")
        .get() as { c: number }
    ).c;
    expect(count).toBe(2);
  });

  it('18. curated comp IDs cannot fuzzy-merge with external-provider comp IDs', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();
    const playbooks = loadPlaybooks(data);

    const staticRes = await importCommunityDragonKnowledge(adapter, data);
    const curatedRes = await importCuratedPlaybooks(adapter, playbooks, staticRes.snapshotId);

    // Create a mock external snapshot that has a comp with identical id 'solar-elderwood'
    const metaRaw = getBundledMetaSnapshot();
    const collidingMeta = structuredClone(metaRaw);
    collidingMeta.comps[0].id = 'solar-elderwood'; // same id as curated comp!
    collidingMeta.manifest.contentHash = externalHash(collidingMeta);

    const metaRes = await importMetaTFTExternal(adapter, collidingMeta, data);

    // In comps table, curated comp has id 'solar-elderwood' and external has 'external-meta:solar-elderwood'
    const curatedComp = await repo.getComp('solar-elderwood', curatedRes.snapshotId);
    const externalComp = await repo.getComp('external-meta:solar-elderwood', metaRes.snapshotId);

    expect(curatedComp).not.toBeNull();
    expect(externalComp).not.toBeNull();

    expect(curatedComp?.sourceKind).toBe('curated');
    expect(externalComp?.sourceKind).toBe('external-meta');

    // Querying 'solar-elderwood' in external-meta snapshot returns null (no accidental fuzzy merge)
    const crossQuery = await repo.getComp('solar-elderwood', metaRes.snapshotId);
    expect(crossQuery).toBeNull();
  });

  it('19. foreign keys protect relationship tables when PRAGMA foreign_keys = ON', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);

    const data = getBundledStaticData();
    const staticRes = await importCommunityDragonKnowledge(adapter, data);

    // Attempting to insert a comp_unit with a non-existent champion must be rejected by foreign keys
    await expect(
      adapter.execute(
        'INSERT INTO comp_units (comp_id, snapshot_id, champion_id, slot, role, stage) VALUES (?, ?, ?, ?, ?, ?)',
        ['some-comp', staticRes.snapshotId, 'NON_EXISTENT_CHAMPION_ID', 'core', null, 'final'],
      ),
    ).rejects.toThrow();

    // Attempting to insert a champion_version with a non-existent snapshot_id must be rejected
    await expect(
      adapter.execute(
        'INSERT INTO champion_versions (champion_id, snapshot_id, cost, role, shop_status, board_eligible, icon, splash, content_fingerprint, mechanics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['DA_18_Xayah', 'non-existent-snapshot', 1, null, 'pool', 1, null, null, 'fp', null],
      ),
    ).rejects.toThrow();
  });

  it('20. activating a new snapshot never orphans or alters historical versions', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlKnowledgeRepository(adapter);
    const data = getBundledStaticData();

    // Import and activate v1
    const res1 = await importCommunityDragonKnowledge(adapter, data);
    await activateKnowledgeSnapshot(adapter, 'static', res1.snapshotId);

    const v1ChampsBefore = await repo.listChampions({ snapshotId: res1.snapshotId });

    // Import and activate v2 with different stats
    const modified = structuredClone(data);
    modified.champions[0].cost += 2;
    modified.version.sourceVersion = 'patch-18.2';
    delete (modified as { knowledge?: unknown }).knowledge;

    const res2 = await importCommunityDragonKnowledge(adapter, modified);
    await activateKnowledgeSnapshot(adapter, 'static', res2.snapshotId);

    // Active pointer points to v2
    const active = await repo.getActiveKnowledgeVersion('static');
    expect(active?.snapshotId).toBe(res2.snapshotId);

    // Historical v1 is completely intact and queryable
    const v1ChampsAfter = await repo.listChampions({ snapshotId: res1.snapshotId });
    expect(v1ChampsAfter.length).toBe(v1ChampsBefore.length);
    expect(v1ChampsAfter[0].cost).toBe(v1ChampsBefore[0].cost);
  });

  it('21. re-importing exact same snapshot is a true DB-level no-op for version rows', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const data = getBundledStaticData();

    // First import
    await importCommunityDragonKnowledge(adapter, data);

    const totalBefore = (
      db.prepare('SELECT count(*) AS c FROM champion_versions').get() as { c: number }
    ).c;

    // Capture statement run count by intercepting adapter execute
    let executedInserts = 0;
    const trackingAdapter = {
      ...adapter,
      async execute(query: string, params: unknown[] = []) {
        if (/insert\s+into\s+champion_versions/i.test(query)) {
          executedInserts++;
        }
        return adapter.execute(query, params);
      },
    };

    // Second import on tracking adapter
    const second = await importCommunityDragonKnowledge(trackingAdapter, data);

    expect(second.created).toBe(false);
    expect(executedInserts).toBe(0);

    const totalAfter = (
      db.prepare('SELECT count(*) AS c FROM champion_versions').get() as { c: number }
    ).c;
    expect(totalAfter).toBe(totalBefore);
  });
});
