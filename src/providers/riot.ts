import { z } from 'zod';
import type {
  CompletedMatch,
  LadderPlayer,
  RiotIdentity,
  RiotTelemetry,
  Result,
} from '../domain/models';
import {
  accountRouteFor,
  parsePlatform,
  regionalRouteFor,
  spectatorTftSupported,
  type RiotPlatform,
  type RiotRegionalRoute,
} from './riotRouting';

export type RiotErrorCode =
  | 'missing-key'
  | 'invalid-route'
  | 'not-found'
  | 'auth'
  | 'rate-limited'
  | 'transient'
  | 'deadline'
  | 'cancelled'
  | 'malformed-response'
  | 'unavailable';

const SAFE_MESSAGES: Record<RiotErrorCode, string> = {
  'missing-key': 'Riot API access is unavailable in the native process.',
  'invalid-route': 'The selected Riot platform or regional route is unsupported.',
  'not-found': 'Riot could not find that account or completed match.',
  auth: 'Riot rejected the native API credential.',
  'rate-limited': 'Riot is rate limiting requests. Try again after the wait period.',
  transient: 'Riot is temporarily unavailable.',
  deadline: 'The scouting time budget was reached.',
  cancelled: 'The Riot request was cancelled.',
  'malformed-response': 'Riot returned an unexpected response shape.',
  unavailable: 'The Riot request is unavailable.',
};

export class RiotProviderError extends Error {
  constructor(
    readonly code: RiotErrorCode,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'RiotProviderError';
  }
  toJSON() {
    return {
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      message: this.message,
    };
  }
}

export function sanitizeNativeRiotError(value: unknown): RiotProviderError {
  type ErrorCandidate = { code?: unknown; status?: unknown; retryable?: unknown };
  let candidate: ErrorCandidate | null = null;
  if (value && typeof value === 'object') candidate = value as ErrorCandidate;
  else if (typeof value === 'string' && value.startsWith('{')) {
    try {
      candidate = JSON.parse(value) as ErrorCandidate;
    } catch {
      candidate = null;
    }
  }
  const code =
    candidate && typeof candidate.code === 'string' && candidate.code in SAFE_MESSAGES
      ? (candidate.code as RiotErrorCode)
      : 'unavailable';
  return new RiotProviderError(
    code,
    candidate && typeof candidate.status === 'number' ? candidate.status : null,
    Boolean(candidate?.retryable),
  );
}

export interface RiotRequestOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
}

export interface RiotConnectionStatus {
  keyDetected: boolean;
  source: 'native-environment' | 'unavailable';
}

export interface RiotProvider {
  connectionStatus(): Promise<RiotConnectionStatus>;
  resolveAccount(
    gameName: string,
    tagLine: string,
    options?: RiotRequestOptions,
  ): Promise<RiotIdentity>;
  accountByPuuid(puuid: string, options?: RiotRequestOptions): Promise<RiotIdentity>;
  lobby(
    identity: RiotIdentity,
    options?: RiotRequestOptions,
  ): Promise<Result<string[], 'unsupported' | 'not-in-game' | 'unavailable'>>;
  recentMatchIds(
    puuid: string,
    start: number,
    count: number,
    options?: RiotRequestOptions,
  ): Promise<string[]>;
  completedMatch(id: string, options?: RiotRequestOptions): Promise<CompletedMatch>;
  ladderPlayers(
    tier: LadderPlayer['tier'],
    limit: number,
    options?: RiotRequestOptions,
  ): Promise<LadderPlayer[]>;
  puuidBySummonerId(summonerId: string, options?: RiotRequestOptions): Promise<string>;
  metrics(): Promise<
    Omit<RiotTelemetry, 'cacheHits' | 'uniqueMatchDetailsFetched' | 'sharedMatchesDeduplicated'>
  >;
}

export interface RiotNormalizationCatalog {
  unitIds: ReadonlySet<string>;
  itemIds: ReadonlySet<string>;
  traitIds: ReadonlySet<string>;
  augmentIds: ReadonlySet<string>;
}

const accountSchema = z
  .object({
    puuid: z.string().min(1),
    gameName: z.string().optional(),
    tagLine: z.string().optional(),
  })
  .passthrough();
const ladderSchema = z
  .object({
    tier: z.enum(['CHALLENGER', 'GRANDMASTER', 'MASTER']),
    entries: z.array(
      z
        .object({
          puuid: z.string().min(1),
          summonerId: z.string().min(1).optional(),
          leaguePoints: z.number().int().default(0),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const summonerSchema = z.object({ puuid: z.string().min(1) }).passthrough();
const unitSchema = z
  .object({
    character_id: z.string().min(1),
    items: z.array(z.number().int()).default([]),
    itemNames: z.array(z.string()).optional(),
    name: z.string().optional(),
    rarity: z.number().int().optional(),
    tier: z.number().int().min(0),
  })
  .passthrough();
const traitSchema = z
  .object({
    name: z.string().min(1),
    num_units: z.number().int().min(0),
    style: z.number().int().optional(),
    tier_current: z.number().int().optional(),
    tier_total: z.number().int().optional(),
  })
  .passthrough();
const participantSchema = z
  .object({
    puuid: z.string().min(1),
    placement: z.number().int().min(1),
    level: z.number().int().min(0),
    units: z.array(unitSchema),
    traits: z.array(traitSchema),
    augments: z.array(z.string()).optional(),
    riotIdGameName: z.string().optional(),
    riotIdTagline: z.string().optional(),
  })
  .passthrough();
const matchSchema = z
  .object({
    metadata: z.object({
      data_version: z.string(),
      match_id: z.string().min(1),
      participants: z.array(z.string()),
    }),
    info: z
      .object({
        game_datetime: z.number().finite(),
        game_length: z.number().finite().nonnegative().optional(),
        game_version: z.string().min(1),
        participants: z.array(participantSchema).min(1),
        queue_id: z.number().int().optional(),
        queueId: z.number().int().optional(),
        tft_game_type: z.string().optional(),
        tft_set_core_name: z.string().optional(),
        tft_set_number: z.number().int(),
        mapId: z.number().int().optional(),
        endOfGameResult: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export function normalizeRiotMatch(
  payload: unknown,
  catalog: RiotNormalizationCatalog,
): CompletedMatch {
  const parsed = matchSchema.safeParse(payload);
  if (!parsed.success) throw new RiotProviderError('malformed-response');
  const { metadata, info } = parsed.data;
  const date = new Date(info.game_datetime);
  if (!Number.isFinite(date.valueOf())) throw new RiotProviderError('malformed-response');
  const timestamp = date.toISOString();
  return {
    id: metadata.match_id,
    set: info.tft_set_number,
    setCoreName: info.tft_set_core_name ?? null,
    riotGameVersion: info.game_version,
    tftContentPatch: null,
    tftContentPatchSource: 'unavailable',
    dataVersion: metadata.data_version,
    gameTimestamp: timestamp,
    gameTimestampSemantics: 'riot-game-datetime-unspecified',
    gameDurationSeconds: info.game_length ?? null,
    completedAt: timestamp,
    queueId: info.queue_id ?? info.queueId ?? null,
    gameType: info.tft_game_type ?? null,
    mapId: info.mapId ?? null,
    endOfGameResult: info.endOfGameResult ?? null,
    modeSupport: 'unverified',
    source: 'Riot tft-match-v1',
    participants: info.participants.map((participant) => {
      const augmentIds = participant.augments ?? [];
      return {
        puuid: participant.puuid,
        placement: participant.placement,
        level: participant.level,
        riotId:
          participant.riotIdGameName && participant.riotIdTagline
            ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
            : undefined,
        units: participant.units.map((unit) => {
          const items =
            unit.itemNames && unit.itemNames.length
              ? unit.itemNames
              : unit.items.map((id) => `riot-item:${id}`);
          return {
            championId: unit.character_id,
            items,
            stars: unit.tier,
            rarity: unit.rarity ?? null,
            rawName: unit.name ?? null,
            unresolvedUnit: !catalog.unitIds.has(unit.character_id),
            unresolvedItems: items.filter((id) => !catalog.itemIds.has(id)),
          };
        }),
        traits: participant.traits.map((trait) => ({
          id: trait.name,
          count: trait.num_units,
          style: trait.style ?? null,
          tierCurrent: trait.tier_current ?? null,
          tierTotal: trait.tier_total ?? null,
          unresolved: !catalog.traitIds.has(trait.name),
        })),
        augmentIds,
        unresolvedAugmentIds: augmentIds.filter((id) => !catalog.augmentIds.has(id)),
      };
    }),
  };
}

interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

async function defaultBridge(): Promise<NativeBridge> {
  const { invoke } = await import('@tauri-apps/api/core');
  return { invoke };
}

const emptyMetrics = () => ({
  requestsAttempted: 0,
  retries: 0,
  rateLimitWaits: 0,
  rateLimitWaitMs: 0,
});

export class NativeRiotProvider implements RiotProvider {
  readonly platform: RiotPlatform;
  readonly routing: RiotRegionalRoute;
  readonly accountRouting: Exclude<RiotRegionalRoute, 'SEA'>;
  constructor(
    platform: string,
    private readonly catalog: RiotNormalizationCatalog,
    private readonly bridgeFactory: () => Promise<NativeBridge> = defaultBridge,
  ) {
    this.platform = parsePlatform(platform);
    this.routing = regionalRouteFor(this.platform);
    this.accountRouting = accountRouteFor(this.platform);
  }

  private async invoke<T>(
    command: string,
    args: Record<string, unknown>,
    options: RiotRequestOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw new RiotProviderError('cancelled');
    const bridge = await this.bridgeFactory();
    const requestId = crypto.randomUUID();
    const deadlineEpochMs = options.deadlineAt ?? Date.now() + 8_000;
    const cancel = () => {
      void bridge.invoke('riot_cancel_request', { requestId }).catch(() => undefined);
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await bridge.invoke<T>(command, { ...args, requestId, deadlineEpochMs });
    } catch (error) {
      throw sanitizeNativeRiotError(error);
    } finally {
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  async connectionStatus(): Promise<RiotConnectionStatus> {
    try {
      const bridge = await this.bridgeFactory();
      return await bridge.invoke<RiotConnectionStatus>('riot_connection_status');
    } catch {
      return { keyDetected: false, source: 'unavailable' };
    }
  }

  async resolveAccount(
    gameName: string,
    tagLine: string,
    options?: RiotRequestOptions,
  ): Promise<RiotIdentity> {
    const parsed = accountSchema.safeParse(
      await this.invoke<unknown>(
        'riot_resolve_account',
        { gameName, tagLine, regionalRoute: this.accountRouting },
        options,
      ),
    );
    if (!parsed.success) throw new RiotProviderError('malformed-response');
    return {
      puuid: parsed.data.puuid,
      gameName: parsed.data.gameName ?? gameName,
      tagLine: parsed.data.tagLine ?? tagLine,
      platform: this.platform,
      routing: this.routing,
    };
  }

  async accountByPuuid(puuid: string, options?: RiotRequestOptions): Promise<RiotIdentity> {
    const parsed = accountSchema.safeParse(
      await this.invoke<unknown>(
        'riot_account_by_puuid',
        { puuid, regionalRoute: this.accountRouting },
        options,
      ),
    );
    if (!parsed.success || !parsed.data.gameName || !parsed.data.tagLine)
      throw new RiotProviderError('malformed-response');
    return {
      puuid: parsed.data.puuid,
      gameName: parsed.data.gameName,
      tagLine: parsed.data.tagLine,
      platform: this.platform,
      routing: this.routing,
    };
  }

  async lobby(
    identity: RiotIdentity,
    options?: RiotRequestOptions,
  ): Promise<Result<string[], 'unsupported' | 'not-in-game' | 'unavailable'>> {
    if (!spectatorTftSupported(this.platform)) return { ok: false, error: 'unsupported' };
    try {
      const parsed = z
        .object({ participants: z.array(z.object({ puuid: z.string().nullable() }).passthrough()) })
        .passthrough()
        .safeParse(
          await this.invoke<unknown>(
            'riot_current_game',
            { puuid: identity.puuid, platform: this.platform },
            options,
          ),
        );
      if (!parsed.success) throw new RiotProviderError('malformed-response');
      const participants = [
        ...new Set(
          parsed.data.participants
            .map((participant) => participant.puuid)
            .filter((puuid): puuid is string => Boolean(puuid) && puuid !== identity.puuid),
        ),
      ].slice(0, 7);
      return { ok: true, value: participants };
    } catch (error) {
      const safe = error instanceof RiotProviderError ? error : sanitizeNativeRiotError(error);
      if (safe.code === 'not-found') return { ok: false, error: 'not-in-game' };
      return { ok: false, error: 'unavailable' };
    }
  }

  async recentMatchIds(
    puuid: string,
    start: number,
    count: number,
    options?: RiotRequestOptions,
  ): Promise<string[]> {
    const payload = await this.invoke<unknown>(
      'riot_recent_match_ids',
      { puuid, regionalRoute: this.routing, start, count },
      options,
    );
    const parsed = z.array(z.string().min(1)).safeParse(payload);
    if (!parsed.success) throw new RiotProviderError('malformed-response');
    return parsed.data;
  }

  async completedMatch(id: string, options?: RiotRequestOptions): Promise<CompletedMatch> {
    const payload = await this.invoke<unknown>(
      'riot_completed_match',
      { matchId: id, regionalRoute: this.routing },
      options,
    );
    const match = normalizeRiotMatch(payload, this.catalog);
    if (match.id !== id) throw new RiotProviderError('malformed-response');
    return match;
  }

  async ladderPlayers(
    tier: LadderPlayer['tier'],
    limit: number,
    options?: RiotRequestOptions,
  ): Promise<LadderPlayer[]> {
    const parsed = ladderSchema.safeParse(
      await this.invoke<unknown>('riot_tft_ladder', { tier, platform: this.platform }, options),
    );
    if (!parsed.success) throw new RiotProviderError('malformed-response');
    return parsed.data.entries
      .sort((a, b) => b.leaguePoints - a.leaguePoints || a.puuid.localeCompare(b.puuid))
      .slice(0, Math.max(0, Math.min(50, limit)))
      .map((entry) => ({ ...entry, tier: parsed.data.tier }));
  }

  async puuidBySummonerId(summonerId: string, options?: RiotRequestOptions): Promise<string> {
    const parsed = summonerSchema.safeParse(
      await this.invoke<unknown>(
        'riot_tft_summoner_by_id',
        { summonerId, platform: this.platform },
        options,
      ),
    );
    if (!parsed.success) throw new RiotProviderError('malformed-response');
    return parsed.data.puuid;
  }

  async metrics() {
    try {
      const bridge = await this.bridgeFactory();
      return await bridge.invoke<ReturnType<typeof emptyMetrics>>('riot_metrics');
    } catch {
      return emptyMetrics();
    }
  }
}

export class FixtureRiotProvider implements RiotProvider {
  requestsAttempted = 0;
  constructor(
    private matches: CompletedMatch[],
    private participants: RiotIdentity[],
    private lobbyPuuids?: string[],
  ) {}
  async connectionStatus(): Promise<RiotConnectionStatus> {
    return { keyDetected: true, source: 'native-environment' };
  }
  async resolveAccount(gameName: string, tagLine: string): Promise<RiotIdentity> {
    this.requestsAttempted++;
    const identity = this.participants.find(
      (participant) => participant.gameName === gameName && participant.tagLine === tagLine,
    );
    if (!identity) throw new RiotProviderError('not-found', 404);
    return identity;
  }
  async accountByPuuid(puuid: string): Promise<RiotIdentity> {
    this.requestsAttempted++;
    const identity = this.participants.find((participant) => participant.puuid === puuid);
    if (!identity) throw new RiotProviderError('not-found', 404);
    return identity;
  }
  async lobby(): Promise<Result<string[], 'unsupported'>> {
    return this.lobbyPuuids
      ? { ok: true, value: [...this.lobbyPuuids] }
      : { ok: false, error: 'unsupported' };
  }
  async recentMatchIds(puuid: string, start: number, count: number): Promise<string[]> {
    this.requestsAttempted++;
    return this.matches
      .filter((match) => match.participants.some((participant) => participant.puuid === puuid))
      .slice(start, start + count)
      .map((match) => match.id);
  }
  async completedMatch(id: string): Promise<CompletedMatch> {
    this.requestsAttempted++;
    const match = this.matches.find((candidate) => candidate.id === id);
    if (!match) throw new RiotProviderError('not-found', 404);
    return structuredClone(match);
  }
  async ladderPlayers(tier: LadderPlayer['tier'], limit: number): Promise<LadderPlayer[]> {
    this.requestsAttempted++;
    return this.participants.slice(0, limit).map((participant, index) => ({
      puuid: participant.puuid,
      summonerId: `fixture-summoner-${participant.puuid}`,
      tier,
      leaguePoints: 1000 - index,
    }));
  }
  async puuidBySummonerId(summonerId: string): Promise<string> {
    this.requestsAttempted++;
    const puuid = summonerId.replace('fixture-summoner-', '');
    if (!this.participants.some((participant) => participant.puuid === puuid))
      throw new RiotProviderError('not-found', 404);
    return puuid;
  }
  async metrics() {
    return { ...emptyMetrics(), requestsAttempted: this.requestsAttempted };
  }
}
