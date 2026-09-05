import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('runs the real SQLite migration and enforces immutable match identity', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../storage/schema.sql', import.meta.url), 'utf8'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'settings',
      'static_cache',
      'completed_matches',
      'opponent_profiles',
      'selected_plans',
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
  db.close();
});
