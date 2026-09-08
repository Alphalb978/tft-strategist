import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeSqliteAdapter, applyAllMigrations } from '../src/storage/knowledgeDatabase';
import {
  importCommunityDragonKnowledge,
  importCuratedPlaybooks,
  importMetaTFTExternal,
  activateKnowledgeSnapshot,
} from '../src/storage/knowledgeImporter';
import { SqlKnowledgeRepository } from '../src/storage/knowledgeRepository';
import { normalizeCommunityDragon } from '../src/providers/communityDragon';
import { loadPlaybooks } from '../src/providers/playbooks';
import { auditStaticData } from '../src/rules/ruleSet';
import { validateExternal } from '../src/providers/externalMeta';
import type { Provenance } from '../src/domain/models';

function resolveDbPath(): string {
  const custom = process.argv.find((a) => a.startsWith('--db='))?.slice(5);
  if (custom) return custom;
  const localApp = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'tft-strategist', 'strategist.db')
    : null;
  if (localApp && existsSync(localApp)) return localApp;
  const appData = process.env.APPDATA
    ? join(process.env.APPDATA, 'local.tft-strategist.desktop', 'strategist.db')
    : null;
  if (appData && existsSync(appData)) return appData;
  return 'strategist.db';
}

async function main() {
  console.log('=== TFT Strategist Knowledge Import ===\n');

  const dbPath = resolveDbPath();
  console.log(`Target database: ${dbPath}`);

  const db = new DatabaseSync(dbPath);
  applyAllMigrations(db);
  const adapter = createNodeSqliteAdapter(db);
  const repo = new SqlKnowledgeRepository(adapter);

  // 1. Static CommunityDragon Knowledge
  console.log('\n[1/3] Importing CommunityDragon static knowledge...');
  const cdragonRaw = JSON.parse(await readFile('data/fixtures/cdragon-set18.json', 'utf8'));
  const provenance: Provenance = JSON.parse(
    await readFile('data/fixtures/cdragon-set18.provenance.json', 'utf8'),
  );
  const staticData = normalizeCommunityDragon(cdragonRaw, provenance);
  const staticAudit = auditStaticData(staticData);
  if (staticAudit.length) {
    throw new Error(`Static data audit issues: ${staticAudit.map((a) => a.message).join('; ')}`);
  }

  const staticResult = await importCommunityDragonKnowledge(adapter, staticData, {
    rawReference: 'data/fixtures/cdragon-set18.json',
  });
  console.log(`  Snapshot ID: ${staticResult.snapshotId}`);
  console.log(`  State: ${staticResult.created ? 'Newly created' : 'Already exists (idempotent)'}`);
  await activateKnowledgeSnapshot(adapter, 'static', staticResult.snapshotId);
  console.log('  ✓ Active static snapshot updated');

  // 2. Curated Playbooks
  console.log('\n[2/3] Importing Curated Playbooks...');
  const playbooks = loadPlaybooks(staticData);
  const seed = JSON.parse(await readFile('data/playbooks/set18.json', 'utf8'));
  const curatedResult = await importCuratedPlaybooks(adapter, playbooks, staticResult.snapshotId, {
    rawReference: 'data/playbooks/set18.json',
    reviewedAt: seed.reviewedAt,
    patch: seed.patch,
    set: seed.set,
  });
  console.log(`  Snapshot ID: ${curatedResult.snapshotId}`);
  console.log(
    `  State: ${curatedResult.created ? 'Newly created' : 'Already exists (idempotent)'}`,
  );
  await activateKnowledgeSnapshot(adapter, 'curated', curatedResult.snapshotId);
  console.log('  ✓ Active curated snapshot updated');

  // 3. MetaTFT External Data
  console.log('\n[3/3] Importing MetaTFT external meta...');
  try {
    const metaRaw = JSON.parse(await readFile('public/data/external/current.json', 'utf8'));
    const metaSnapshot = validateExternal(metaRaw, staticData);
    const metaResult = await importMetaTFTExternal(adapter, metaSnapshot, staticData, {
      rawReference: 'public/data/external/current.json',
    });
    console.log(`  Snapshot ID: ${metaResult.snapshotId}`);
    console.log(`  State: ${metaResult.created ? 'Newly created' : 'Already exists (idempotent)'}`);
    await activateKnowledgeSnapshot(adapter, 'external-meta', metaResult.snapshotId);
    console.log('  ✓ Active external-meta snapshot updated');
  } catch (err) {
    console.warn(
      `  ⚠ MetaTFT import skipped or warning: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Summary
  console.log('\n=== Knowledge Import Complete ===');
  const activeStatic = await repo.getActiveKnowledgeVersion('static');
  const activeCurated = await repo.getActiveKnowledgeVersion('curated');
  const activeMeta = await repo.getActiveKnowledgeVersion('external-meta');

  console.log(`Active static snapshot:        ${activeStatic?.snapshotId ?? 'none'}`);
  console.log(`Active curated snapshot:       ${activeCurated?.snapshotId ?? 'none'}`);
  console.log(`Active external-meta snapshot: ${activeMeta?.snapshotId ?? 'none'}`);

  const champCount = (await repo.listChampions()).length;
  const traitCount = (await repo.listTraits()).length;
  const itemCount = (await repo.listItems()).length;
  const augmentCount = (await repo.listAugments()).length;
  const compCount = (await repo.listComps()).length;

  console.log(`\nActive Knowledge Catalog:`);
  console.log(`  Champions: ${champCount}`);
  console.log(`  Traits:    ${traitCount}`);
  console.log(`  Items:     ${itemCount}`);
  console.log(`  Augments:  ${augmentCount}`);
  console.log(`  Comps:     ${compCount}`);
}

main().catch((err) => {
  console.error('Import failed unexpectedly:', err);
  process.exit(1);
});
