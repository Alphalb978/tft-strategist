import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { upgradeStoredCompletedMatch } from '../storage/history';
import { match } from './fixtures';
it('runs the real SQLite migration and enforces immutable match identity', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../storage/schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../storage/schema_m3.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../storage/schema_m8.sql', import.meta.url), 'utf8'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'settings',
      'static_cache',
      'completed_matches',
      'opponent_profiles',
      'selected_plans',
      'riot_accounts',
      'riot_match_indexes',
      'riot_completed_matches',
      'riot_opponent_profiles',
      'riot_scan_snapshots',
      'plan_sessions',
    ]),
  );
  db.prepare('INSERT INTO completed_matches VALUES (?,?,?,?)').run('same', '{}', 18, '18.1');
  expect(() =>
    db.prepare('INSERT INTO completed_matches VALUES (?,?,?,?)').run('same', '{}', 18, '18.1'),
  ).toThrow();
  db.prepare('INSERT INTO settings VALUES (?,?)').run(
    'quoted-key',
    JSON.stringify({ name: "test's setting" }),
  );
  expect(
    JSON.parse(
      db.prepare('SELECT value FROM settings WHERE key=?').get('quoted-key')!.value as string,
    ),
  ).toEqual({ name: "test's setting" });
  db.prepare('INSERT INTO riot_completed_matches VALUES (?,?,?,?,?,?)').run(
    'immutable',
    '{"id":"immutable"}',
    18,
    '18.1',
    '2026-09-05',
    '2026-09-05',
  );
  db.prepare('INSERT OR IGNORE INTO riot_completed_matches VALUES (?,?,?,?,?,?)').run(
    'immutable',
    '{"id":"changed"}',
    18,
    '18.1',
    '2026-09-05',
    '2026-09-06',
  );
  expect(
    db.prepare('SELECT payload FROM riot_completed_matches WHERE match_id=?').get('immutable')!
      .payload,
  ).toBe('{"id":"immutable"}');
  expect(tables.some((table) => String(table.name).toLocaleLowerCase().includes('api_key'))).toBe(
    false,
  );
  db.prepare('INSERT INTO plan_sessions VALUES (?,?,?,?,?,?)').run(
    'active-a',
    'active',
    '2026-09-06T10:00:00Z',
    null,
    '{}',
    null,
  );
  expect(() =>
    db
      .prepare('INSERT INTO plan_sessions VALUES (?,?,?,?,?,?)')
      .run('active-b', 'active', '2026-09-06T10:01:00Z', null, '{}', null),
  ).toThrow();
  db.prepare('INSERT INTO plan_sessions VALUES (?,?,?,?,?,?)').run(
    'active-c',
    'active',
    '2026-09-06T10:02:00Z',
    null,
    JSON.stringify({ replacesSessionId: 'active-a' }),
    null,
  );
  expect(db.prepare("SELECT id FROM plan_sessions WHERE state='active'").get()?.id).toBe(
    'active-c',
  );
  const replaced = db
    .prepare('SELECT state,ended_at,payload FROM plan_sessions WHERE id=?')
    .get('active-a') as { state: string; ended_at: string; payload: string };
  expect(replaced.state).toBe('ended');
  expect(replaced.ended_at).toBe('2026-09-06T10:02:00Z');
  expect(JSON.parse(replaced.payload)).toMatchObject({
    state: 'ended',
    endReason: 'replaced',
    replacedBySessionId: 'active-c',
  });
  db.prepare('INSERT INTO plan_sessions VALUES (?,?,?,?,?,?)').run(
    'immutable-session',
    'ended',
    '2026-09-06T09:00:00Z',
    '2026-09-06T09:30:00Z',
    JSON.stringify({ snapshotFingerprint: 'same', snapshot: { score: 1 } }),
    null,
  );
  expect(() =>
    db
      .prepare('UPDATE plan_sessions SET payload=? WHERE id=?')
      .run(
        JSON.stringify({ snapshotFingerprint: 'same', snapshot: { score: 2 } }),
        'immutable-session',
      ),
  ).toThrow('locked plan-session snapshot is immutable');
  expect(() =>
    db
      .prepare('UPDATE plan_sessions SET state=?,ended_at=? WHERE id=?')
      .run('active', null, 'immutable-session'),
  ).toThrow('ended plan session cannot be reactivated');
  db.close();
});

it('upgrades M3 immutable matches without preserving the invalid derived patch', () => {
  const current = match('legacy-cache');
  const legacy = { ...current } as Record<string, unknown>;
  legacy.gameVersion = current.riotGameVersion;
  legacy.patch = '16.18';
  delete legacy.riotGameVersion;
  delete legacy.tftContentPatch;
  delete legacy.tftContentPatchSource;
  expect(upgradeStoredCompletedMatch(legacy)).toMatchObject({
    id: 'legacy-cache',
    riotGameVersion: current.riotGameVersion,
    tftContentPatch: null,
    tftContentPatchSource: 'unavailable',
  });
});
