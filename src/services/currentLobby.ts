import type { RiotIdentity } from '../domain/models';
import type {
  DiscoveredParticipant,
  LeagueClientParticipant,
  LeagueClientLobbyError,
  RiotProvider,
  LobbyParticipant,
  SpectatorLobbyError,
} from '../providers/riot';
import { RiotProviderError } from '../providers/riot';
import { parseRiotId } from '../providers/riotId';
import { regionalRouteFor, spectatorTftSupported } from '../providers/riotRouting';
import type { HistoryStore } from '../storage/history';

export type LobbyDiscoverySource = 'riot-spectator' | 'league-client';

export interface LobbyDiscoveryDiagnostics {
  stage?: DiscoveryStage;
  budgetExhaustedAt?: DiscoveryStage;
  timingsMs?: Partial<Record<DiscoveryStage, number>>;
  spectatorAttempted?: boolean;
  leagueClientAttempted?: boolean;
  spectator:
    | 'timed-out'
    | 'success'
    | '403'
    | '404'
    | 'rate-limited'
    | 'malformed-response'
    | 'unavailable'
    | 'unsupported'
    | 'not-attempted';
  leagueClient: 'connected' | 'unavailable' | 'lockfile-unavailable' | 'not-attempted';
  lcuHttps: 'connected' | 'tls-failure' | 'unavailable' | 'not-checked';
  gameflow:
    | 'ranked-tft-detected'
    | 'tft-detected'
    | 'no-active-tft-session'
    | 'no-tft-session'
    | 'malformed-response'
    | 'not-checked';
  participantsDiscovered: number;
  participantsWithPuuid: number;
  lcuSummonersResolved: number;
  lcuSummonerResolutionFailures: number;
  publicRiotIdentitiesResolved: number;
  publicIdentityResolutionFailures: number;
  opponentsUsable: number;
  riotIdsResolved: number;
}

export interface CurrentLobbyDiscoveryValue {
  own: RiotIdentity;
  opponents: RiotIdentity[];
  source: LobbyDiscoverySource;
  partialIdentities: boolean;
  diagnostics: LobbyDiscoveryDiagnostics;
}

export type CurrentLobbyDiscovery =
  | { ok: true; value: CurrentLobbyDiscoveryValue }
  | { ok: false; error: string; diagnostics: LobbyDiscoveryDiagnostics };

export const CURRENT_LOBBY_DISCOVERY_TIMEOUT_MS = 15_000;
export const DISCOVERY_WATCHDOG_GRACE_MS = 250;
type DiscoveryStage = 'account' | 'spectator' | 'lcu-gameflow' | 'identity-bridge';

// Every awaited provider/store call is bounded, even if its implementation ignores deadlines.
// The watchdog is only a final guard, after the inner deadline has had time to settle.
class DiscoveryBudget {
  stage: DiscoveryStage = 'account';
  stageDeadline: number;
  stageStarted = Date.now();
  constructor(
    readonly deadline: number,
    readonly diagnostics: LobbyDiscoveryDiagnostics,
  ) {
    this.stageDeadline = Math.min(deadline, Date.now() + 2_000);
  }
  enter(stage: DiscoveryStage, allowance: number) {
    this.stage = stage;
    this.stageStarted = Date.now();
    this.diagnostics.stage = stage;
    this.stageDeadline = Math.min(this.deadline, Date.now() + allowance);
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const stage = this.stage;
    const started = Date.now();
    const stageStarted = this.stageStarted;
    const remaining = this.stageDeadline - started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (remaining <= 0) throw new LobbyDiscoveryTimeoutError(0);
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LobbyDiscoveryTimeoutError(remaining)), remaining);
        }),
      ]);
    } catch (error) {
      if (
        error instanceof LobbyDiscoveryTimeoutError ||
        (error instanceof RiotProviderError && error.code === 'deadline')
      )
        this.diagnostics.budgetExhaustedAt = stage;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      const timings = (this.diagnostics.timingsMs ??= {});
      // Parallel identity operations overlap; report wall time, not their sum.
      timings[stage] = Math.max(timings[stage] ?? 0, Date.now() - stageStarted);
    }
  }
  wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (object, property) => {
        const value = Reflect.get(object, property);
        return typeof value === 'function'
          ? (...args: unknown[]) => this.run(() => value.apply(object, args))
          : value;
      },
    });
  }
}

function timeoutFailure(diagnostics: LobbyDiscoveryDiagnostics): CurrentLobbyDiscovery {
  return manualFailure(
    `Lobby discovery timed out during ${diagnostics.budgetExhaustedAt ?? diagnostics.stage ?? 'account'}. ` +
      `League Client: ${diagnostics.leagueClient}; ${diagnostics.participantsDiscovered} participants visible, ` +
      `${diagnostics.publicRiotIdentitiesResolved} identities resolved.`,
    structuredClone(diagnostics),
  );
}

export class LobbyDiscoveryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Current-lobby discovery timed out after ${timeoutMs} ms.`);
    this.name = 'LobbyDiscoveryTimeoutError';
  }
}

const EMPTY_DIAGNOSTICS: LobbyDiscoveryDiagnostics = {
  spectator: 'not-attempted',
  leagueClient: 'not-attempted',
  lcuHttps: 'not-checked',
  gameflow: 'not-checked',
  participantsDiscovered: 0,
  participantsWithPuuid: 0,
  lcuSummonersResolved: 0,
  lcuSummonerResolutionFailures: 0,
  publicRiotIdentitiesResolved: 0,
  publicIdentityResolutionFailures: 0,
  opponentsUsable: 0,
  riotIdsResolved: 0,
};

function spectatorDiagnostic(error: SpectatorLobbyError): LobbyDiscoveryDiagnostics['spectator'] {
  switch (error) {
    case 'not-in-game':
      return '404';
    case 'forbidden':
      return '403';
    default:
      return error;
  }
}

function validRiotId(value?: string) {
  if (!value) return null;
  try {
    return parseRiotId(value);
  } catch {
    return null;
  }
}

function sameRiotId(a: ReturnType<typeof parseRiotId>, b: ReturnType<typeof parseRiotId>) {
  return (
    a.gameName.localeCompare(b.gameName, undefined, { sensitivity: 'accent' }) === 0 &&
    a.tagLine.localeCompare(b.tagLine, undefined, { sensitivity: 'accent' }) === 0
  );
}

async function resolveParticipants(
  participants: LobbyParticipant[],
  own: RiotIdentity,
  provider: RiotProvider,
  store: HistoryStore,
  platform: string,
  deadlineAt: number,
) {
  const opponents: RiotIdentity[] = [];
  const seen = new Set<string>([own.puuid]);
  let riotIdsResolved = 0;
  const normalized = participants.map(
    (candidate): DiscoveredParticipant =>
      typeof candidate === 'string' ? { puuid: candidate } : candidate,
  );
  const byPuuid = new Map<string, DiscoveredParticipant>();
  const withoutPuuid: DiscoveredParticipant[] = [];
  for (const participant of normalized) {
    const puuid = participant.puuid?.trim();
    if (!puuid) {
      withoutPuuid.push(participant);
      continue;
    }
    const existing = byPuuid.get(puuid);
    byPuuid.set(puuid, {
      ...existing,
      ...participant,
      puuid,
      riotId: participant.riotId ?? existing?.riotId,
      summonerId: participant.summonerId ?? existing?.summonerId,
    });
  }

  for (const participant of [...byPuuid.values(), ...withoutPuuid]) {
    if (opponents.length >= 7) break;
    const direct = validRiotId(participant.riotId);
    let puuid = participant.puuid?.trim() || '';
    let resolvedByRiotId: RiotIdentity | null = null;

    if (!puuid && direct) {
      try {
        resolvedByRiotId = await provider.resolveAccount(direct.gameName, direct.tagLine, {
          deadlineAt,
        });
        puuid = resolvedByRiotId.puuid;
      } catch {
        // A display name without a usable PUUID cannot drive the history scanner.
      }
    }
    if (!puuid && participant.summonerId) {
      try {
        puuid = await provider.puuidBySummonerId(participant.summonerId, { deadlineAt });
      } catch {
        // summonerId is only a bridge; hidden/unresolvable identities are ignored.
      }
    }
    if (!puuid || seen.has(puuid)) continue;
    seen.add(puuid);

    let identity: RiotIdentity | null = resolvedByRiotId;
    if (!identity && direct) {
      identity = {
        puuid,
        gameName: direct.gameName,
        tagLine: direct.tagLine,
        platform,
        routing: regionalRouteFor(platform),
      };
    }
    if (!identity) identity = await store.getIdentityByPuuid(puuid, platform);
    if (!identity) {
      try {
        identity = await provider.accountByPuuid(puuid, { deadlineAt });
      } catch {
        // Names are optional: preserve the official/local PUUID for history scanning.
        identity = {
          puuid,
          gameName: '',
          tagLine: '',
          platform,
          routing: regionalRouteFor(platform),
        };
      }
    }
    if (identity.gameName && identity.tagLine) {
      riotIdsResolved++;
      await store.putIdentity(identity, new Date().toISOString());
    }
    opponents.push(identity);
  }
  return { opponents, riotIdsResolved };
}

async function resolveLeagueClientParticipants(
  participants: LeagueClientParticipant[],
  configured: ReturnType<typeof parseRiotId>,
  knownOwn: RiotIdentity | null,
  provider: RiotProvider,
  store: HistoryStore,
  platform: string,
  deadlineAt: number,
  diagnostics: LobbyDiscoveryDiagnostics,
) {
  let lcuSummonerResolutionFailures = 0;
  let publicIdentityResolutionFailures = 0;
  const localRecords = await Promise.all(
    participants.map(async (participant) => {
      if (!participant.summonerId || !provider.leagueClientSummoner) {
        lcuSummonerResolutionFailures++;
        return null;
      }
      const result = await provider
        .leagueClientSummoner(participant.summonerId, { deadlineAt })
        .catch(() => ({ ok: false as const, error: 'unavailable' as const }));
      if (!result.ok) {
        lcuSummonerResolutionFailures++;
        return null;
      }
      diagnostics.lcuSummonersResolved++;
      return { participant, riotId: result.value };
    }),
  );
  const resolvedLocalRecords = localRecords.filter((record) => record !== null);
  const publicRecords = await Promise.all(
    resolvedLocalRecords.map(async (record) => {
      const parsed = parseRiotId(`${record.riotId.gameName}#${record.riotId.tagLine}`);
      let identity: RiotIdentity | null = await store.getIdentity(
        parsed.gameName,
        parsed.tagLine,
        platform,
      );
      // Older uncommitted fallback builds may have cached the LCU-local identifier under this
      // Riot ID. Never treat that exact local value as a canonical public Account-v1 identity.
      if (!identity || identity.puuid === record.participant.localPuuid) {
        try {
          identity = await provider.resolveAccount(parsed.gameName, parsed.tagLine, { deadlineAt });
        } catch {
          publicIdentityResolutionFailures++;
          return null;
        }
      }
      diagnostics.publicRiotIdentitiesResolved++;
      // Cache persistence must not turn a verified public identity into a failed lookup.
      await store.putIdentity(identity, new Date().toISOString()).catch(() => {});
      return { identity, localPuuid: record.participant.localPuuid, riotId: parsed };
    }),
  );

  let own = knownOwn;
  const opponents: RiotIdentity[] = [];
  const publicSeen = new Set<string>(own ? [own.puuid] : []);
  for (const record of publicRecords) {
    if (!record) continue;
    const isConfiguredSelf = sameRiotId(record.riotId, configured);
    if (isConfiguredSelf) {
      own = record.identity;
      publicSeen.add(record.identity.puuid);
      continue;
    }
    if (own && record.identity.puuid === own.puuid) continue;
    if (publicSeen.has(record.identity.puuid)) continue;
    publicSeen.add(record.identity.puuid);
    if (opponents.length < 7) opponents.push(record.identity);
  }
  return {
    own,
    opponents,
    lcuSummonersResolved: resolvedLocalRecords.length,
    lcuSummonerResolutionFailures,
    publicRiotIdentitiesResolved: publicRecords.filter((record) => record !== null).length,
    publicIdentityResolutionFailures,
  };
}

function manualFailure(
  error: string,
  diagnostics: LobbyDiscoveryDiagnostics,
): CurrentLobbyDiscovery {
  return { ok: false, error: `${error} Use manual opponents.`, diagnostics };
}

/**
 * Bounded read-only identity discovery. The existing scouting service remains the sole history
 * acquisition path after this function returns.
 */
async function discoverCurrentLobbyWithinDeadline(
  provider: RiotProvider,
  store: HistoryStore,
  riotId: string,
  platform: string,
  budget: DiscoveryBudget,
): Promise<CurrentLobbyDiscovery> {
  const diagnostics = budget.diagnostics;
  const configured = parseRiotId(riotId);
  let deadlineAt = budget.stageDeadline;
  const cached = await store
    .getIdentity(configured.gameName, configured.tagLine, platform)
    .catch(() => null);
  let own: RiotIdentity | null = cached;
  let keyDetected = false;
  try {
    keyDetected = (await provider.connectionStatus()).keyDetected;
  } catch {
    keyDetected = false;
  }
  if (keyDetected && (!cached || Date.now() - Date.parse(cached.fetchedAt) >= 86_400_000)) {
    try {
      own = await provider.resolveAccount(configured.gameName, configured.tagLine, { deadlineAt });
      await store.putIdentity(own, new Date().toISOString());
    } catch {
      // A stale cached PUUID can still safely exclude self and drive the local fallback.
    }
  }

  budget.enter('spectator', 2_500);
  deadlineAt = budget.stageDeadline;
  if (spectatorTftSupported(platform) && keyDetected && own) {
    diagnostics.spectatorAttempted = true;
    let spectator: Awaited<ReturnType<RiotProvider['lobby']>>;
    try {
      spectator = await provider.lobby(own, { deadlineAt });
    } catch (error) {
      const safe = error instanceof RiotProviderError ? error : null;
      diagnostics.spectator =
        safe?.status === 403
          ? '403'
          : safe?.status === 404 || safe?.code === 'not-found'
            ? '404'
            : safe?.code === 'rate-limited'
              ? 'rate-limited'
              : safe?.code === 'malformed-response'
                ? 'malformed-response'
                : 'unavailable';
      spectator = {
        ok: false,
        error:
          diagnostics.spectator === '403'
            ? 'forbidden'
            : diagnostics.spectator === '404'
              ? 'not-in-game'
              : diagnostics.spectator === 'rate-limited' ||
                  diagnostics.spectator === 'malformed-response'
                ? diagnostics.spectator
                : 'unavailable',
      };
    }
    if (spectator.ok) {
      diagnostics.spectator = 'success';
      diagnostics.participantsDiscovered = spectator.value.length;
      diagnostics.participantsWithPuuid = spectator.value.filter((participant) =>
        typeof participant === 'string' ? Boolean(participant.trim()) : Boolean(participant.puuid),
      ).length;
      const resolved = await resolveParticipants(
        spectator.value,
        own,
        provider,
        store,
        platform,
        deadlineAt,
      );
      diagnostics.opponentsUsable = resolved.opponents.length;
      diagnostics.riotIdsResolved = resolved.riotIdsResolved;
      diagnostics.publicRiotIdentitiesResolved = resolved.riotIdsResolved;
      if (resolved.opponents.length) {
        return {
          ok: true,
          value: {
            own,
            opponents: resolved.opponents,
            source: 'riot-spectator',
            partialIdentities:
              resolved.opponents.length < 7 || resolved.riotIdsResolved < resolved.opponents.length,
            diagnostics,
          },
        };
      }
    } else {
      if (spectator.error === 'timed-out') diagnostics.budgetExhaustedAt = 'spectator';
      diagnostics.spectator =
        diagnostics.budgetExhaustedAt === 'spectator'
          ? 'timed-out'
          : spectatorDiagnostic(spectator.error);
    }
  } else if (!spectatorTftSupported(platform)) {
    diagnostics.spectator = 'unsupported';
  } else if (!keyDetected || !own) {
    diagnostics.spectator = 'unavailable';
  }

  budget.enter('lcu-gameflow', 3_250);
  deadlineAt = budget.stageDeadline;
  diagnostics.leagueClientAttempted = Boolean(provider.leagueClientLobby);
  const local = provider.leagueClientLobby
    ? await provider.leagueClientLobby({ deadlineAt })
    : ({ ok: false, error: 'client-unavailable' } as const);
  if (!local.ok) {
    diagnostics.leagueClient =
      local.error === 'lockfile-unavailable'
        ? 'lockfile-unavailable'
        : local.error === 'client-unavailable'
          ? 'unavailable'
          : 'connected';
    diagnostics.lcuHttps =
      local.error === 'tls-failure'
        ? 'tls-failure'
        : local.error === 'no-session' || local.error === 'malformed-response'
          ? 'connected'
          : local.error === 'client-unavailable'
            ? 'unavailable'
            : 'not-checked';
    diagnostics.gameflow =
      local.error === 'malformed-response'
        ? 'malformed-response'
        : local.error === 'no-session'
          ? 'no-tft-session'
          : 'not-checked';
    return manualFailure(localFailureMessage(local.error, diagnostics.spectator), diagnostics);
  }

  diagnostics.leagueClient = 'connected';
  diagnostics.lcuHttps = 'connected';
  diagnostics.participantsDiscovered = local.value.participantCount;
  diagnostics.participantsWithPuuid = local.value.participantsWithPuuid;
  if (!local.value.tftDetected) {
    diagnostics.gameflow = 'no-tft-session';
    return manualFailure(
      'League Client is connected, but no TFT gameflow session was detected.',
      diagnostics,
    );
  }
  if (!local.value.activeForScouting) {
    diagnostics.gameflow = 'no-active-tft-session';
    return manualFailure('No active TFT game detected.', diagnostics);
  }
  diagnostics.gameflow = local.value.rankedTftDetected ? 'ranked-tft-detected' : 'tft-detected';
  budget.enter('identity-bridge', budget.deadline - Date.now());
  deadlineAt = budget.stageDeadline;
  const bridged = await resolveLeagueClientParticipants(
    local.value.participants,
    configured,
    own,
    provider,
    store,
    platform,
    deadlineAt,
    diagnostics,
  );
  diagnostics.lcuSummonersResolved = bridged.lcuSummonersResolved;
  diagnostics.lcuSummonerResolutionFailures = bridged.lcuSummonerResolutionFailures;
  diagnostics.publicRiotIdentitiesResolved = bridged.publicRiotIdentitiesResolved;
  diagnostics.publicIdentityResolutionFailures = bridged.publicIdentityResolutionFailures;
  diagnostics.opponentsUsable = bridged.opponents.length;
  diagnostics.riotIdsResolved = bridged.publicRiotIdentitiesResolved;
  if (!bridged.own) {
    return manualFailure(
      'LCU summoners were visible, but the configured account could not be identified safely.',
      diagnostics,
    );
  }
  own = bridged.own;
  if (!bridged.opponents.length) {
    return manualFailure(
      bridged.lcuSummonersResolved === 0
        ? 'LCU summoner resolution failed for the visible participants.'
        : 'Account-v1 Riot-ID resolution failed for the visible opponents.',
      diagnostics,
    );
  }
  return {
    ok: true,
    value: {
      own,
      opponents: bridged.opponents,
      source: 'league-client',
      partialIdentities:
        bridged.opponents.length < 7 ||
        bridged.lcuSummonerResolutionFailures > 0 ||
        bridged.publicIdentityResolutionFailures > 0,
      diagnostics,
    },
  };
}

export async function discoverCurrentLobby(
  provider: RiotProvider,
  store: HistoryStore,
  riotId: string,
  platform: string,
  options?: { timeoutMs?: number },
): Promise<CurrentLobbyDiscovery> {
  const timeoutMs = Math.max(1, options?.timeoutMs ?? CURRENT_LOBBY_DISCOVERY_TIMEOUT_MS);
  const diagnostics: LobbyDiscoveryDiagnostics = {
    ...EMPTY_DIAGNOSTICS,
    stage: 'account',
    timingsMs: {},
  };
  const budget = new DiscoveryBudget(
    Date.now() + Math.max(1, timeoutMs - DISCOVERY_WATCHDOG_GRACE_MS),
    diagnostics,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      discoverCurrentLobbyWithinDeadline(
        budget.wrap(provider),
        budget.wrap(store),
        riotId,
        platform,
        budget,
      ).catch((error: unknown) =>
        error instanceof LobbyDiscoveryTimeoutError
          ? timeoutFailure(diagnostics)
          : manualFailure(
              `Lobby discovery unavailable during ${diagnostics.stage}.`,
              structuredClone(diagnostics),
            ),
      ),
      new Promise<CurrentLobbyDiscovery>((resolve) => {
        timer = setTimeout(() => resolve(timeoutFailure(diagnostics)), timeoutMs);
      }),
    ]);
    if (!result.ok && diagnostics.budgetExhaustedAt === 'identity-bridge')
      return timeoutFailure(diagnostics);
    return structuredClone(result);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function localFailureMessage(
  error: LeagueClientLobbyError,
  spectator: LobbyDiscoveryDiagnostics['spectator'],
) {
  if (error === 'no-session') return 'No active TFT game detected.';
  if (error === 'lockfile-unavailable') return 'League Client lockfile is unavailable.';
  if (error === 'tls-failure')
    return 'League Client is connected, but LCU HTTPS failed during TLS.';
  if (error === 'malformed-response')
    return 'League Client gameflow changed or returned an unexpected response.';
  if (spectator === '404')
    return 'No active TFT game was found by Riot or the local League Client.';
  if (spectator === '403')
    return 'Riot Spectator returned HTTP 403 and the local League Client was unavailable.';
  if (spectator === 'rate-limited')
    return 'Riot Spectator was rate limited and the local League Client was unavailable.';
  return 'Automatic current-lobby discovery is unavailable.';
}

/** Keeps the UI wired to its existing runScan callback without duplicating scouting logic. */
export async function scanDiscoveredLobby<T>(
  discovery: CurrentLobbyDiscoveryValue,
  runScan: (opponents: RiotIdentity[], requested: number) => Promise<T>,
) {
  if (!discovery.opponents.length)
    throw new Error('Discovered lobby has no usable opponent identities.');
  return runScan(discovery.opponents, 7);
}
