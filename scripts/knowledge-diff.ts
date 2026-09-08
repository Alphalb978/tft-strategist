import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeSqliteAdapter, applyAllMigrations } from '../src/storage/knowledgeDatabase';
import { SqlKnowledgeRepository } from '../src/storage/knowledgeRepository';
import { normalizeCommunityDragon } from '../src/providers/communityDragon';
import { knowledgeDelta } from '../src/providers/knowledge';
import type { Provenance } from '../src/domain/models';
import type { TFTKnowledgeSnapshot } from '../src/domain/intelligence';

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
  console.log('=== TFT Strategist Knowledge Diff ===\n');

  const dbPath = resolveDbPath();
  const dbExists = existsSync(dbPath);
  console.log(`Database: ${dbPath} (${dbExists ? 'exists' : 'new'})`);

  const db = new DatabaseSync(dbPath);
  applyAllMigrations(db);
  const adapter = createNodeSqliteAdapter(db);
  const repo = new SqlKnowledgeRepository(adapter);

  const prevSnapshotId = process.argv[2];
  const nextSnapshotId = process.argv[3];

  if (prevSnapshotId && nextSnapshotId) {
    console.log(`Comparing snapshot ${prevSnapshotId} -> ${nextSnapshotId}...`);
    const diff = await repo.getKnowledgeDiff(prevSnapshotId, nextSnapshotId);
    if (!diff) {
      console.error('One or both snapshot IDs were not found in the database.');
      process.exitCode = 1;
      return;
    }
    printDiffSummary(diff);
    return;
  }

  // If no explicit pair provided, diff the current fixture against the active snapshot
  const activeStatic = await repo.getActiveKnowledgeVersion('static');
  if (!activeStatic) {
    console.log('No active static snapshot in database. Cannot perform diff against active state.');
    console.log(
      'Hint: Run `npm.cmd run knowledge:import` first, or provide two snapshot IDs: `npm.cmd run knowledge:diff <prevId> <nextId>`.',
    );
    return;
  }

  console.log(
    `Active static snapshot: ${activeStatic.snapshotId} (Set ${activeStatic.setNumber}, Patch ${activeStatic.balancePatch ?? 'unknown'})`,
  );

  const cdragonRaw = JSON.parse(await readFile('data/fixtures/cdragon-set18.json', 'utf8'));
  const provenance: Provenance = JSON.parse(
    await readFile('data/fixtures/cdragon-set18.provenance.json', 'utf8'),
  );
  const candidateData = normalizeCommunityDragon(cdragonRaw, provenance);

  const candidateFp = candidateData.knowledge?.fingerprint;
  if (activeStatic.contentHash === candidateFp) {
    console.log('\n✓ Active snapshot matches current fixture exactly. 0 changes detected.');
    return;
  }

  console.log(`Candidate fixture fingerprint: ${candidateFp}`);
  if (candidateData.knowledge) {
    const prevSnap = await repo.getSourceSnapshot(activeStatic.snapshotId);
    console.log('\nDiff summary:');
    console.log(`  Set changed: ${candidateData.version.set !== activeStatic.setNumber}`);
    console.log(
      `  Patch: ${activeStatic.balancePatch ?? 'unknown'} -> ${candidateData.version.provenance.patch ?? 'unknown'}`,
    );
    console.log(
      `  Source version: ${activeStatic.sourceVersion} -> ${candidateData.version.sourceVersion}`,
    );
    if (prevSnap) {
      console.log(
        `  Retrieved: ${activeStatic.activatedAt} -> ${candidateData.version.provenance.fetchedAt}`,
      );
    }

    const champs = await repo.listChampions({ snapshotId: activeStatic.snapshotId });
    const traits = await repo.listTraits({ snapshotId: activeStatic.snapshotId });
    const items = await repo.listItems({ snapshotId: activeStatic.snapshotId });
    const augments = await repo.listAugments({ snapshotId: activeStatic.snapshotId });
    const prevFingerprints: Record<string, string> = {};
    for (const c of champs) prevFingerprints[c.id] = c.contentFingerprint;
    for (const t of traits) prevFingerprints[t.id] = t.contentFingerprint;
    for (const i of items) prevFingerprints[i.id] = i.contentFingerprint;
    for (const a of augments) prevFingerprints[a.id] = a.contentFingerprint;

    const prevSnapshot: TFTKnowledgeSnapshot = {
      version: 'knowledge-v1',
      semanticVersion: 'semantic-v1',
      set: activeStatic.setNumber,
      identity: 'TFTSet18',
      balancePatch: activeStatic.balancePatch,
      fingerprint: activeStatic.contentHash,
      fetchedAt: activeStatic.activatedAt,
      source: 'database',
      parity: 'unverified',
      officialEvidence: [],
      entities: {},
      entityFingerprints: prevFingerprints,
      coverage: [],
    };

    const delta = knowledgeDelta(prevSnapshot, candidateData.knowledge);
    console.log(`  Entity delta: ${delta.changed.length} entities altered`);
    if (delta.changed.length) {
      console.log(
        `  Changed IDs: ${delta.changed.slice(0, 10).join(', ')}${delta.changed.length > 10 ? '...' : ''}`,
      );
    }
  }
}

function printDiffSummary(diff: {
  previousSnapshotId: string;
  nextSnapshotId: string;
  setChanged: boolean;
  championsAdded: string[];
  championsRemoved: string[];
  championsChanged: string[];
  traitsAdded: string[];
  traitsRemoved: string[];
  traitsChanged: string[];
  itemsAdded: string[];
  itemsRemoved: string[];
  itemsChanged: string[];
  augmentsAdded: string[];
  augmentsRemoved: string[];
  augmentsChanged: string[];
  compsAdded: string[];
  compsRemoved: string[];
  compsChanged: string[];
}) {
  console.log('\n--- Diff Results ---');
  console.log(`Set changed: ${diff.setChanged ? 'YES' : 'No'}`);
  console.log(
    `Champions: +${diff.championsAdded.length} -${diff.championsRemoved.length} ~${diff.championsChanged.length}`,
  );
  if (diff.championsAdded.length) console.log(`  Added: ${diff.championsAdded.join(', ')}`);
  if (diff.championsRemoved.length) console.log(`  Removed: ${diff.championsRemoved.join(', ')}`);
  if (diff.championsChanged.length) console.log(`  Changed: ${diff.championsChanged.join(', ')}`);

  console.log(
    `Traits: +${diff.traitsAdded.length} -${diff.traitsRemoved.length} ~${diff.traitsChanged.length}`,
  );
  if (diff.traitsAdded.length) console.log(`  Added: ${diff.traitsAdded.join(', ')}`);
  if (diff.traitsRemoved.length) console.log(`  Removed: ${diff.traitsRemoved.join(', ')}`);
  if (diff.traitsChanged.length) console.log(`  Changed: ${diff.traitsChanged.join(', ')}`);

  console.log(
    `Items: +${diff.itemsAdded.length} -${diff.itemsRemoved.length} ~${diff.itemsChanged.length}`,
  );
  if (diff.itemsAdded.length) console.log(`  Added: ${diff.itemsAdded.join(', ')}`);
  if (diff.itemsRemoved.length) console.log(`  Removed: ${diff.itemsRemoved.join(', ')}`);
  if (diff.itemsChanged.length) console.log(`  Changed: ${diff.itemsChanged.join(', ')}`);

  console.log(
    `Augments: +${diff.augmentsAdded.length} -${diff.augmentsRemoved.length} ~${diff.augmentsChanged.length}`,
  );
  if (diff.augmentsAdded.length) console.log(`  Added: ${diff.augmentsAdded.join(', ')}`);
  if (diff.augmentsRemoved.length) console.log(`  Removed: ${diff.augmentsRemoved.join(', ')}`);
  if (diff.augmentsChanged.length) console.log(`  Changed: ${diff.augmentsChanged.join(', ')}`);

  console.log(
    `Comps: +${diff.compsAdded.length} -${diff.compsRemoved.length} ~${diff.compsChanged.length}`,
  );
  if (diff.compsAdded.length) console.log(`  Added: ${diff.compsAdded.join(', ')}`);
  if (diff.compsRemoved.length) console.log(`  Removed: ${diff.compsRemoved.join(', ')}`);
  if (diff.compsChanged.length) console.log(`  Changed: ${diff.compsChanged.join(', ')}`);
}

main().catch((err) => {
  console.error('Diff failed unexpectedly:', err);
  process.exit(1);
});
