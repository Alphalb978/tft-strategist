import { invoke } from '@tauri-apps/api/core';
import type Database from '@tauri-apps/plugin-sql';
import type { SqlDatabase } from './knowledgeDatabase';
import { withSqliteRetry, withSqliteWriteLock } from './database';

export interface SqlStatement {
  query: string;
  params: unknown[];
}
export async function writeSqlBatch(db: Database, statements: SqlStatement[]) {
  await withSqliteWriteLock(() =>
    withSqliteRetry(async () => {
      // Real plugin handles have a path. Test adapters own a single SQLite connection.
      if (typeof db.path === 'string') {
        await invoke('sqlite_write_batch', { statements });
        return;
      }
      await db.execute('BEGIN TRANSACTION');
      try {
        for (const { query, params } of statements) await db.execute(query, params);
        await db.execute('COMMIT');
      } catch (error) {
        await db.execute('ROLLBACK');
        throw error;
      }
    }),
  );
}

/** Write-only import transactions are buffered then committed on one native connection. */
export function transactionalSqlAdapter(
  db: Database,
  execute: SqlDatabase['execute'],
): SqlDatabase {
  let pending: SqlStatement[] | null = null;
  return {
    select: async <T>(query: string, params?: unknown[]) => {
      if (pending) throw new Error('Reads inside a buffered write transaction are unsupported.');
      return db.select<T[]>(query, params);
    },
    execute: async (query, params = []) => {
      const command = query.trim().toUpperCase();
      if (command === 'BEGIN TRANSACTION') {
        if (pending) throw new Error('Nested write transaction is unsupported.');
        pending = [];
      } else if (command === 'ROLLBACK') {
        pending = null;
      } else if (command === 'COMMIT') {
        if (!pending) throw new Error('No active write transaction.');
        const statements = pending;
        pending = null;
        await writeSqlBatch(db, statements);
      } else if (pending) {
        pending.push({ query, params });
      } else return execute(query, params);
      return { rowsAffected: 0 };
    },
  };
}
