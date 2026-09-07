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
  spectator:
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
) {
  let lcuSummonerResolutionFailures = 0;
  let publicIdentityResolutionFailures = 0;
  const localRecords = await Promise.all(
    participants.map(async (participant) => {
      if (!participant.summonerId || !provider.leagueClientSummoner) {
        lcuSummonerResolutionFailures++;
        return null;
      }
      const result = await provider.leagueClientSummoner(participant.summonerId, { deadlineAt });
      if (!result.ok) {
        lcuSummonerResolutionFailures++;
        return null;
      }
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
          await store.putIdentity(identity, new Date().toISOString());
        } catch {
          publicIdentityResolutionFailures++;
          return null;
        }
      }
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
export async function discoverCurrentLobby(
  provider: RiotProvider,
  store: HistoryStore,
  riotId: string,
  platform: string,
): Promise<CurrentLobbyDiscovery> {
  const diagnostics = { ...EMPTY_DIAGNOSTICS };
  const configured = parseRiotId(riotId);
  const deadlineAt = Date.now() + 8_000;
  const cached = await store.getIdentity(configured.gameName, configured.tagLine, platform);
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

  if (spectatorTftSupported(platform) && keyDetected && own) {
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
      diagnostics.spectator = spectatorDiagnostic(spectator.error);
    }
  } else if (!spectatorTftSupported(platform)) {
    diagnostics.spectator = 'unsupported';
  } else if (!keyDetected || !own) {
    diagnostics.spectator = 'unavailable';
  }

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
  const bridged = await resolveLeagueClientParticipants(
    local.value.participants,
    configured,
    own,
    provider,
    store,
    platform,
    deadlineAt,
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
  return runScan(discovery.opponents, 7);
}
