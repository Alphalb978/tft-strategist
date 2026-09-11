import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export interface SqlDatabase {
  select<T = unknown>(query: string, bindParams?: unknown[]): Promise<T[]>;
  execute(
    query: string,
    bindParams?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}

function normalizeSql(query: string): string {
  // Convert PostgreSQL/Tauri-style $1, $2 to SQLite positional ?
  return query.replace(/\$\d+/g, '?');
}

/**
 * Creates a SqlDatabase adapter wrapping Node.js built-in DatabaseSync.
 */
export function createNodeSqliteAdapter(db: DatabaseSync): SqlDatabase {
  return {
    async select<T = unknown>(query: string, bindParams: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(normalizeSql(query));
      return stmt.all(...(bindParams as (string | number | bigint | null | Uint8Array)[])) as T[];
    },
    async execute(
      query: string,
      bindParams: unknown[] = [],
    ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
      const stmt = db.prepare(normalizeSql(query));
      const res = stmt.run(...(bindParams as (string | number | bigint | null | Uint8Array)[]));
      return {
        rowsAffected: Number(res.changes),
        lastInsertId: Number(res.lastInsertRowid),
      };
    },
  };
}

export const MIGRATION_SQL_FILES = [
  'schema.sql',
  'schema_m3.sql',
  'schema_m8.sql',
  'schema_m9.sql',
  'schema_m13.sql',
  'schema_m13d.sql',
  'schema_m13d2.sql',
] as const;

/**
 * Applies migrations sequentially to a DatabaseSync instance.
 * Safe to call on an existing database (DDL statements use CREATE TABLE IF NOT EXISTS).
 */
export function applyAllMigrations(db: DatabaseSync): void {
  for (const filename of MIGRATION_SQL_FILES) {
    const url = new URL(filename, import.meta.url);
    const sql = readFileSync(url, 'utf8');
    db.exec(sql);
  }
}

import { getSharedSqlDatabase } from './database';
import type Database from '@tauri-apps/plugin-sql';

export async function openKnowledgeDatabase(existingDb?: Database): Promise<SqlDatabase | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const db = existingDb ?? (await getSharedSqlDatabase());
    return db as unknown as SqlDatabase;
  }
  return null;
}
