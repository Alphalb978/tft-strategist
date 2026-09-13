import { DatabaseSync } from 'node:sqlite';
import type Database from '@tauri-apps/plugin-sql';
import { describe, it, expect, vi } from 'vitest';
import { SqlRepository } from '../storage/repository';
import { applyAllMigrations, createNodeSqliteAdapter } from '../storage/knowledgeDatabase';
import { loadApplication } from '../services/application';
import { data } from './fixtures';

describe('real SQLite static persistence', () => {
  it('replaces both obsolete rows, reopens with Local cache, and retains unrelated data', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const adapter = createNodeSqliteAdapter(db);
    const repo = new SqlRepository(adapter as unknown as Database);
    try {
      await repo.set('static', { ...data, version: { ...data.version, patch: '18.1' } });
      await repo.set('unrelated', { retained: true });
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation((url: string) =>
            Promise.resolve(
              new Response(JSON.stringify(url.includes('asset-manifest') ? {} : data)),
            ),
          ),
      );
      const first = await loadApplication(repo);
      expect(first.source).toBe('Bundled snapshot');
      expect(await repo.get('static')).toEqual(data);
      const row = db
        .prepare("SELECT payload,source_version,fetched_at FROM static_cache WHERE key='static'")
        .get()!;
      expect(row.source_version).toBe(data.version.sourceVersion);
      expect(row.fetched_at).toBe(data.version.provenance.fetchedAt);
      expect(JSON.parse(row.payload as string)).toEqual(data);
      const next = await loadApplication(new SqlRepository(adapter as unknown as Database));
      expect(next.source).toBe('Local cache');
      expect(next.notices.join()).not.toContain('cache ignored');
      expect(await repo.get('unrelated')).toEqual({ retained: true });
    } finally {
      vi.unstubAllGlobals();
      db.close();
    }
  });
  it('rolls back settings too when the duplicate cache write fails', async () => {
    const db = new DatabaseSync(':memory:');
    applyAllMigrations(db);
    const repo = new SqlRepository(createNodeSqliteAdapter(db) as unknown as Database);
    try {
      const old = { ...data, version: { ...data.version, patch: '18.1' } };
      await repo.set('static', old);
      db.exec(
        "CREATE TRIGGER reject_cache BEFORE UPDATE ON static_cache BEGIN SELECT RAISE(ABORT, 'test'); END",
      );
      await expect(repo.set('static', data)).rejects.toThrow();
      expect(
        JSON.parse(
          db.prepare("SELECT value FROM settings WHERE key='static'").get()!.value as string,
        ),
      ).toEqual(old);
      expect(await repo.get('static')).toEqual(old);
    } finally {
      db.close();
    }
  });
});
