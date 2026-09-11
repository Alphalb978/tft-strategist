import type Database from '@tauri-apps/plugin-sql';
import {
  getSharedSqlDatabase,
  withSqliteWriteLock,
  withSqliteRetry,
} from './database';
import type {
  CompletedMatch,
  LobbyPressure,
  OpponentProfile,
  RiotIdentity,
} from '../domain/models';

export interface StoredIdentity extends RiotIdentity {
  fetchedAt: string;
}
export interface RecentMatchIndex {
  puuid: string;
  routing: string;
  targetCount: number;
  requestedCount: number;
  ids: string[];
  exhausted: boolean;
  fetchedAt: string;
}
export interface StoredProfile {
  profile: OpponentProfile;
  sourceFingerprint: string;
}

export interface HistoryStore {
  mode: 'SQLite' | 'Memory';
  getIdentity(gameName: string, tagLine: string, platform: string): Promise<StoredIdentity | null>;
  getIdentityByPuuid(puuid: string, platform: string): Promise<StoredIdentity | null>;
  putIdentity(identity: RiotIdentity, fetchedAt: string): Promise<void>;
  getRecentIndex(puuid: string, routing: string): Promise<RecentMatchIndex | null>;
  putRecentIndex(index: RecentMatchIndex): Promise<void>;
  getCompletedMatch(id: string): Promise<CompletedMatch | null>;
  putCompletedMatch(match: CompletedMatch, fetchedAt: string): Promise<void>;
  getProfile(
    puuid: string,
    set: number,
    patch: string,
    derivationVersion: string,
  ): Promise<StoredProfile | null>;
  putProfile(profile: OpponentProfile, sourceFingerprint: string): Promise<void>;
  putScanSnapshot(scan: LobbyPressure): Promise<void>;
}

const identityKey = (gameName: string, tagLine: string, platform: string) =>
  `${gameName.normalize('NFC')}#${tagLine.normalize('NFC')}@${platform}`.toLocaleLowerCase('en-US');
const profileKey = (puuid: string, set: number, patch: string, version: string) =>
  `${puuid}:${set}:${patch}:${version}`;

/**
 * M3 cached a client-build prefix as `patch`. M3.1 deliberately discards that
 * derived value while retaining the raw Riot build from the immutable payload.
 */
export function upgradeStoredCompletedMatch(value: unknown): CompletedMatch | null {
  if (!value || typeof value !== 'object') return null;
  const stored = { ...(value as Record<string, unknown>) };
  const riotGameVersion =
    typeof stored.riotGameVersion === 'string'
      ? stored.riotGameVersion
      : typeof stored.gameVersion === 'string'
        ? stored.gameVersion
        : null;
  if (
    typeof stored.id !== 'string' ||
    typeof stored.set !== 'number' ||
    typeof stored.completedAt !== 'string' ||
    !Array.isArray(stored.participants) ||
    !riotGameVersion
  )
    return null;
  delete stored.patch;
  delete stored.gameVersion;
  stored.riotGameVersion = riotGameVersion;
  const patchSource =
    stored.tftContentPatchSource === 'verified-mapping' ||
    stored.tftContentPatchSource === 'fixture'
      ? stored.tftContentPatchSource
      : 'unavailable';
  const contentPatch =
    patchSource !== 'unavailable' && typeof stored.tftContentPatch === 'string'
      ? stored.tftContentPatch
      : null;
  stored.tftContentPatch = contentPatch;
  stored.tftContentPatchSource = contentPatch ? patchSource : 'unavailable';
  stored.gameTimestamp =
    typeof stored.gameTimestamp === 'string' ? stored.gameTimestamp : stored.completedAt;
  stored.gameTimestampSemantics =
    stored.gameTimestampSemantics === 'fixture-completed-at'
      ? 'fixture-completed-at'
      : 'riot-game-datetime-unspecified';
  stored.gameDurationSeconds =
    typeof stored.gameDurationSeconds === 'number' && stored.gameDurationSeconds >= 0
      ? stored.gameDurationSeconds
      : null;
  return stored as unknown as CompletedMatch;
}

export class MemoryHistoryStore implements HistoryStore {
  mode = 'Memory' as const;
  private identities = new Map<string, StoredIdentity>();
  private indexes = new Map<string, RecentMatchIndex>();
  private matches = new Map<string, CompletedMatch>();
  private profiles = new Map<string, StoredProfile>();
  readonly snapshots: LobbyPressure[] = [];
  async getIdentity(gameName: string, tagLine: string, platform: string) {
    return structuredClone(this.identities.get(identityKey(gameName, tagLine, platform)) ?? null);
  }
  async getIdentityByPuuid(puuid: string, platform: string) {
    const identity = [...this.identities.values()].find(
      (entry) => entry.puuid === puuid && entry.platform === platform,
    );
    return structuredClone(identity ?? null);
  }
  async putIdentity(identity: RiotIdentity, fetchedAt: string) {
    this.identities.set(identityKey(identity.gameName, identity.tagLine, identity.platform), {
      ...structuredClone(identity),
      fetchedAt,
    });
  }
  async getRecentIndex(puuid: string, routing: string) {
    return structuredClone(this.indexes.get(`${puuid}:${routing}`) ?? null);
  }
  async putRecentIndex(index: RecentMatchIndex) {
    this.indexes.set(`${index.puuid}:${index.routing}`, structuredClone(index));
  }
  async getCompletedMatch(id: string) {
    return structuredClone(this.matches.get(id) ?? null);
  }
  async putCompletedMatch(match: CompletedMatch, fetchedAt?: string) {
    void fetchedAt;
    if (!this.matches.has(match.id)) this.matches.set(match.id, structuredClone(match));
  }
  async getProfile(puuid: string, set: number, patch: string, derivationVersion: string) {
    return structuredClone(
      this.profiles.get(profileKey(puuid, set, patch, derivationVersion)) ?? null,
    );
  }
  async putProfile(profile: OpponentProfile, sourceFingerprint: string) {
    this.profiles.set(
      profileKey(profile.puuid, profile.set, profile.patch, profile.derivationVersion),
      {
        profile: structuredClone(profile),
        sourceFingerprint,
      },
    );
  }
  async putScanSnapshot(scan: LobbyPressure) {
    this.snapshots.push(structuredClone(scan));
  }
}

export class SqlHistoryStore implements HistoryStore {
  mode = 'SQLite' as const;
  constructor(private readonly db: Database) {}

  private async executeWrite(
    query: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    return withSqliteWriteLock(() =>
      withSqliteRetry(async () => {
        return (await this.db.execute(query, params)) as {
          rowsAffected: number;
          lastInsertId?: number;
        };
      }),
    );
  }

  async getIdentity(gameName: string, tagLine: string, platform: string) {
    const rows = await this.db.select<
      {
        puuid: string;
        game_name: string;
        tag_line: string;
        platform: string;
        regional_route: string;
        fetched_at: string;
      }[]
    >(
      'SELECT * FROM riot_accounts WHERE game_name = $1 COLLATE NOCASE AND tag_line = $2 COLLATE NOCASE AND platform = $3 LIMIT 1',
      [gameName, tagLine, platform],
    );
    const row = rows[0];
    return row
      ? {
          puuid: row.puuid,
          gameName: row.game_name,
          tagLine: row.tag_line,
          platform: row.platform,
          routing: row.regional_route,
          fetchedAt: row.fetched_at,
        }
      : null;
  }
  async getIdentityByPuuid(puuid: string, platform: string) {
    const rows = await this.db.select<
      {
        puuid: string;
        game_name: string;
        tag_line: string;
        platform: string;
        regional_route: string;
        fetched_at: string;
      }[]
    >('SELECT * FROM riot_accounts WHERE puuid = $1 AND platform = $2 LIMIT 1', [puuid, platform]);
    const row = rows[0];
    return row
      ? {
          puuid: row.puuid,
          gameName: row.game_name,
          tagLine: row.tag_line,
          platform: row.platform,
          routing: row.regional_route,
          fetchedAt: row.fetched_at,
        }
      : null;
  }
  async putIdentity(identity: RiotIdentity, fetchedAt: string) {
    await this.executeWrite(
      'INSERT INTO riot_accounts (puuid,game_name,tag_line,platform,regional_route,fetched_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(puuid) DO UPDATE SET game_name=excluded.game_name,tag_line=excluded.tag_line,platform=excluded.platform,regional_route=excluded.regional_route,fetched_at=excluded.fetched_at',
      [
        identity.puuid,
        identity.gameName,
        identity.tagLine,
        identity.platform,
        identity.routing,
        fetchedAt,
      ],
    );
  }
  async getRecentIndex(puuid: string, routing: string) {
    const rows = await this.db.select<
      {
        puuid: string;
        regional_route: string;
        target_count: number;
        requested_count: number;
        match_ids: string;
        exhausted: number;
        fetched_at: string;
      }[]
    >('SELECT * FROM riot_match_indexes WHERE puuid=$1 AND regional_route=$2', [puuid, routing]);
    const row = rows[0];
    if (!row) return null;
    try {
      const ids = JSON.parse(row.match_ids) as unknown;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
      return {
        puuid: row.puuid,
        routing: row.regional_route,
        targetCount: row.target_count,
        requestedCount: row.requested_count,
        ids,
        exhausted: Boolean(row.exhausted),
        fetchedAt: row.fetched_at,
      };
    } catch {
      return null;
    }
  }
  async putRecentIndex(index: RecentMatchIndex) {
    await this.executeWrite(
      'INSERT INTO riot_match_indexes (puuid,regional_route,target_count,requested_count,match_ids,exhausted,fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(puuid,regional_route) DO UPDATE SET target_count=excluded.target_count,requested_count=excluded.requested_count,match_ids=excluded.match_ids,exhausted=excluded.exhausted,fetched_at=excluded.fetched_at',
      [
        index.puuid,
        index.routing,
        index.targetCount,
        index.requestedCount,
        JSON.stringify(index.ids),
        index.exhausted ? 1 : 0,
        index.fetchedAt,
      ],
    );
  }
  async getCompletedMatch(id: string) {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM riot_completed_matches WHERE match_id=$1',
      [id],
    );
    try {
      return rows[0] ? upgradeStoredCompletedMatch(JSON.parse(rows[0].payload)) : null;
    } catch {
      return null;
    }
  }
  async putCompletedMatch(match: CompletedMatch, fetchedAt: string) {
    await this.executeWrite(
      'INSERT OR IGNORE INTO riot_completed_matches (match_id,payload,set_number,patch,game_timestamp,fetched_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        match.id,
        JSON.stringify(match),
        match.set,
        match.tftContentPatch ?? 'unavailable',
        match.gameTimestamp,
        fetchedAt,
      ],
    );
  }
  async getProfile(puuid: string, set: number, patch: string, derivationVersion: string) {
    const rows = await this.db.select<{ payload: string; source_fingerprint: string }[]>(
      'SELECT payload,source_fingerprint FROM riot_opponent_profiles WHERE puuid=$1 AND set_number=$2 AND patch=$3 AND derivation_version=$4',
      [puuid, set, patch, derivationVersion],
    );
    try {
      return rows[0]
        ? {
            profile: JSON.parse(rows[0].payload) as OpponentProfile,
            sourceFingerprint: rows[0].source_fingerprint,
          }
        : null;
    } catch {
      return null;
    }
  }
  async putProfile(profile: OpponentProfile, sourceFingerprint: string) {
    await this.executeWrite(
      'INSERT INTO riot_opponent_profiles (puuid,set_number,patch,derivation_version,source_fingerprint,payload,generated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(puuid,set_number,patch,derivation_version) DO UPDATE SET source_fingerprint=excluded.source_fingerprint,payload=excluded.payload,generated_at=excluded.generated_at',
      [
        profile.puuid,
        profile.set,
        profile.patch,
        profile.derivationVersion,
        sourceFingerprint,
        JSON.stringify(profile),
        profile.generatedAt,
      ],
    );
  }
  async putScanSnapshot(scan: LobbyPressure) {
    await this.executeWrite(
      'INSERT INTO riot_scan_snapshots (id,state,requested_opponents,target_games,elapsed_ms,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        crypto.randomUUID(),
        scan.state,
        scan.requestedOpponents,
        scan.relevantGamesTarget,
        scan.elapsedMs,
        JSON.stringify(scan),
        scan.fetchedAt,
      ],
    );
  }
}

export async function openHistoryStore(existingDb?: Database): Promise<HistoryStore> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const db = existingDb ?? (await getSharedSqlDatabase());
    return new SqlHistoryStore(db);
  }
  return new MemoryHistoryStore();
}

