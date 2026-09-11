import type Database from '@tauri-apps/plugin-sql';

let sharedDbPromise: Promise<Database> | null = null;

class AsyncMutex {
  private queue: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentQueue = this.queue;
    this.queue = currentQueue.then(
      () => lockPromise,
      () => lockPromise,
    );
    await currentQueue.catch(() => {});
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

const writeMutex = new AsyncMutex();

/**
 * Serializes SQLite write operations so that concurrent async tasks
 * do not collide on the SQLite writer lock.
 */
export async function withSqliteWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return writeMutex.runExclusive(fn);
}

/**
 * Bounded retry policy for transient SQLite locking/busy errors (code: 5).
 */
export async function withSqliteRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 150,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const message = error instanceof Error ? error.message : String(error);
      const isBusy =
        message.includes('code: 5') ||
        message.toLowerCase().includes('database is locked') ||
        message.toLowerCase().includes('busy');
      if (isBusy && attempt <= retries) {
        console.warn(
          `SQLite busy/locked (attempt ${attempt}/${retries}). Retrying in ${delayMs * attempt}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Configures critical SQLite concurrency pragmas:
 * - WAL mode (readers don't block writers, writers don't block readers)
 * - busy_timeout = 5000 (wait up to 5 seconds before failing on lock)
 * - foreign_keys = ON
 */
export async function configureSqlite(db: {
  execute(query: string, bindParams?: unknown[]): Promise<unknown>;
}): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON;');
  await db.execute('PRAGMA journal_mode = WAL;');
  await db.execute('PRAGMA busy_timeout = 5000;');
}

/**
 * Returns the singleton shared SQLite database connection in desktop Tauri mode.
 * Ensures the connection is only loaded once and configured with WAL & busy timeout.
 */
export async function getSharedSqlDatabase(): Promise<Database> {
  if (!sharedDbPromise) {
    sharedDbPromise = (async () => {
      try {
        const { default: Database } = await import('@tauri-apps/plugin-sql');
        const db = await Database.load('sqlite:strategist.db');
        await configureSqlite(db);
        return db;
      } catch (err) {
        sharedDbPromise = null;
        throw err;
      }
    })();
  }
  return sharedDbPromise;
}

/**
 * Allows setting or mocking the shared database handle for testing.
 */
export function setSharedSqlDatabaseForTesting(db: Database | null): void {
  sharedDbPromise = db ? Promise.resolve(db) : null;
}

/**
 * Resets the memoized shared database handle for isolated automated tests.
 */
export function resetSharedSqlDatabaseForTesting(): void {
  sharedDbPromise = null;
}

