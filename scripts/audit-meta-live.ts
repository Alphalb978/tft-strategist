// Read-only verification of the bounded native live run. Reports aggregate facts only.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import type { CompletedMatch, StaticData } from '../src/domain/models';
import type { MetaBundle } from '../src/services/discoveryRefresh';
import { loadPlaybooks } from '../src/providers/playbooks';
import { canonicalizeFinalBoard } from '../src/strategy/canonicalBoard';
const db = new DatabaseSync(`${process.env.APPDATA}/local.tft-strategist.desktop/strategist.db`, {
  readOnly: true,
});
const before = new DatabaseSync('artifacts/m10-validation/meta-before-live.db', { readOnly: true });
const get = <T>(key: string): T =>
  JSON.parse(
    (db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string }).value,
  );
const { meta: m, discovery: d } = get<MetaBundle>('meta-current:v1');
const data = get<StaticData>('static');
const matches = [...new Set(m.observations.map((o) => o.matchId))].map(
  (id) =>
    JSON.parse(
      (
        db.prepare('SELECT payload FROM riot_completed_matches WHERE match_id=?').get(id) as {
          payload: string;
        }
      ).payload,
    ) as CompletedMatch,
);
assert.equal(matches.length, m.uniqueMatches);
assert.equal(
  matches.reduce((sum, match) => sum + match.participants.length, 0),
  m.currentSetBoards,
);
assert.equal(
  new Set(m.observations.map((o) => `${o.matchId}:${o.puuid}`)).size,
  m.currentSetBoards,
);
const rejectionReasons: Record<string, number> = {};
let invalid = 0;
for (const match of matches) {
  assert.equal(match.set, 18);
  assert.equal(match.queueId, 1100);
  assert.match(match.id, /^EUN1_/);
  assert(Date.parse(match.completedAt) <= Date.parse(m.collectedAt));
  assert(Date.parse(match.completedAt) >= Date.parse(m.collectedAt) - 7 * 86400000);
  for (const participant of match.participants) {
    const canonical = canonicalizeFinalBoard(participant, match.set, data);
    if (canonical.state === 'invalid') {
      invalid++;
      for (const reason of canonical.reasons)
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }
  }
}
assert.equal(invalid, d.invalidBoards);
assert.equal(d.boardsAnalyzed + invalid, m.currentSetBoards);
assert.equal(m.classifiedBoards + m.ambiguousBoards + m.unclassifiedBoards, m.currentSetBoards);
assert.equal(
  m.familyStats.reduce((n, f) => n + f.games, 0),
  m.classifiedBoards,
);
for (const f of m.familyStats) {
  const rows = m.observations.filter(
    (o) => o.classification.state === 'classified' && o.classification.familyId === f.familyId,
  );
  assert.equal(rows.length, f.games);
  assert.equal(new Set(rows.map((o) => o.matchId)).size, f.uniqueMatches);
  assert.equal(rows.reduce((n, o) => n + o.placement, 0) / rows.length, f.averagePlacement);
  assert.equal(rows.filter((o) => o.placement <= 4).length / rows.length, f.topFour.raw);
  assert.equal(rows.filter((o) => o.placement === 1).length / rows.length, f.wins.raw);
}
let preservedRows = 0;
const tables = (
  before.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
).map((t) => t.name);
for (const table of tables) {
  const quoted = '"' + table.replaceAll('"', '""') + '"';
  const oldRows = before.prepare(`SELECT * FROM ${quoted}`).all();
  const newRows = new Set(
    db
      .prepare(`SELECT * FROM ${quoted}`)
      .all()
      .map((row) => JSON.stringify(row)),
  );
  for (const row of oldRows) {
    // The recent index is mutable; immutable matches and all other pre-existing rows must survive exactly.
    if (table === 'riot_match_indexes') continue;
    assert(newRows.has(JSON.stringify(row)), `Pre-existing row changed in ${table}`);
    preservedRows++;
  }
}
assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get()!)[0], 'ok');
const families = loadPlaybooks(data).map((p) => {
  const f = m.familyStats.find((f) => f.familyId === p.family.id);
  return {
    name: p.title,
    familyId: p.family.id,
    boards: f?.games ?? 0,
    uniqueMatches: f?.uniqueMatches ?? 0,
    quality: f?.quality ?? 'unavailable',
    playRate: f ? f.games / m.classifiedBoards : null,
    popularityShare: f ? f.games / m.currentSetBoards : null,
  };
});
const report = {
  checksPassed: true,
  preservedRows,
  tables: tables.length,
  immutableMatchesBefore: before.prepare('SELECT count(*) AS n FROM riot_completed_matches').get()!
    .n,
  immutableMatchesAfter: db.prepare('SELECT count(*) AS n FROM riot_completed_matches').get()!.n,
  integrity: 'ok',
  rankedSet18Matches: matches.length,
  boards: m.currentSetBoards,
  playRateDenominator: m.classifiedBoards,
  popularitySortDenominator: m.currentSetBoards,
  canonicalRejectionReasons: rejectionReasons,
  families,
  activeClusters: d.clusterCount,
  retainedStaleClusters: d.clusters.filter((c) => c.lifecycle === 'Stale').length,
};
fs.writeFileSync('artifacts/m10-validation/meta-live-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
before.close();
