import { describe, expect, it, vi } from 'vitest';
import type { RiotIdentity } from '../domain/models';
import { FixtureRiotProvider, type LeagueClientLobby, type RiotProvider } from '../providers/riot';
import {
  discoverCurrentLobby,
  scanDiscoveredLobby,
  type CurrentLobbyDiscoveryValue,
} from '../services/currentLobby';
import { MemoryHistoryStore } from '../storage/history';

const own: RiotIdentity = {
  puuid: 'self-puuid',
  gameName: 'Strategist',
  tagLine: 'TFT',
  platform: 'EUW1',
  routing: 'EUROPE',
};
const opponents = Array.from(
  { length: 7 },
  (_, index): RiotIdentity => ({
    puuid: `opponent-${index + 1}`,
    gameName: `Opponent ${index + 1}`,
    tagLine: 'TFT',
    platform: 'EUW1',
    routing: 'EUROPE',
  }),
);

function provider() {
  return new FixtureRiotProvider([], [own, ...opponents], []);
}

function tftLobby(participants: LeagueClientLobby['participants']): LeagueClientLobby {
  return {
    participants,
    participantCount: participants.length,
    participantsWithPuuid: participants.filter(({ localPuuid }) => Boolean(localPuuid)).length,
    tftDetected: true,
    rankedTftDetected: true,
    activeForScouting: true,
    phase: 'InProgress',
    queueId: 1100,
    queueType: 'RANKED_TFT',
  };
}

const localParticipants = [own, ...opponents].map((_, index) => ({
  localPuuid: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
  summonerId: `lcu-summoner-${index}`,
}));

function mockLcuSummoners(source: FixtureRiotProvider, failedIndexes: number[] = []) {
  return vi.spyOn(source, 'leagueClientSummoner').mockImplementation(async (summonerId) => {
    const index = Number(summonerId.replace('lcu-summoner-', ''));
    const identity = [own, ...opponents][index];
    return !identity || failedIndexes.includes(index)
      ? { ok: false, error: 'unavailable' as const }
      : { ok: true, value: { gameName: identity.gameName, tagLine: identity.tagLine } };
  });
}

describe('bounded automatic current-lobby discovery', () => {
  it('uses a valid direct spectator riotId without an Account-v1 lookup', async () => {
    const source = provider();
    vi.spyOn(source, 'lobby').mockResolvedValue({
      ok: true,
      value: [
        { puuid: own.puuid, riotId: 'Strategist#TFT' },
        { puuid: opponents[0].puuid, riotId: 'Direct Name#TFT' },
      ],
    });
    const byPuuid = vi.spyOn(source, 'accountByPuuid');
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('riot-spectator');
    expect(result.value.opponents[0]).toMatchObject({
      puuid: opponents[0].puuid,
      gameName: 'Direct Name',
      tagLine: 'TFT',
    });
    expect(byPuuid).not.toHaveBeenCalled();
    expect(result.value.diagnostics.spectator).toBe('success');
  });

  it('resolves PUUID-only spectator participants through Account-v1 and its identity cache', async () => {
    const source = provider();
    vi.spyOn(source, 'lobby').mockResolvedValue({
      ok: true,
      value: [{ puuid: own.puuid }, ...opponents.slice(0, 2).map(({ puuid }) => ({ puuid }))],
    });
    const byPuuid = vi.spyOn(source, 'accountByPuuid');
    const store = new MemoryHistoryStore();
    const first = await discoverCurrentLobby(source, store, 'Strategist#TFT', 'EUW1');
    const second = await discoverCurrentLobby(source, store, 'Strategist#TFT', 'EUW1');
    expect(first.ok && first.value.opponents).toHaveLength(2);
    expect(second.ok && second.value.opponents).toHaveLength(2);
    expect(byPuuid).toHaveBeenCalledTimes(2);
  });

  it('falls back from spectator 403 to an eight-player TFT teamOne lobby', async () => {
    const source = provider();
    vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({ ok: false, error: 'forbidden' });
    const byLocalPuuid = vi.spyOn(source, 'accountByPuuid');
    const publicSummonerLookup = vi.spyOn(source, 'puuidBySummonerId');
    mockLcuSummoners(source);
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: tftLobby(localParticipants),
    });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('league-client');
    expect(result.value.opponents).toHaveLength(7);
    expect(result.value.opponents.map(({ puuid }) => puuid)).toEqual(
      opponents.map(({ puuid }) => puuid),
    );
    expect(result.value.opponents.some((entry) => entry.puuid === own.puuid)).toBe(false);
    expect(result.value.opponents.some((entry) => entry.puuid.length === 36)).toBe(false);
    expect(byLocalPuuid).not.toHaveBeenCalled();
    expect(publicSummonerLookup).not.toHaveBeenCalled();
    expect(result.value.diagnostics).toMatchObject({
      spectator: '403',
      leagueClient: 'connected',
      lcuHttps: 'connected',
      gameflow: 'ranked-tft-detected',
      participantsDiscovered: 8,
      participantsWithPuuid: 8,
      lcuSummonersResolved: 8,
      lcuSummonerResolutionFailures: 0,
      publicRiotIdentitiesResolved: 8,
      publicIdentityResolutionFailures: 0,
      opponentsUsable: 7,
      riotIdsResolved: 8,
    });
    const matchIds = vi.spyOn(source, 'recentMatchIds').mockResolvedValue([]);
    await scanDiscoveredLobby(result.value, async (identities) => {
      await Promise.all(identities.map((identity) => source.recentMatchIds(identity.puuid, 0, 20)));
    });
    expect(matchIds).toHaveBeenCalledTimes(7);
    expect(matchIds.mock.calls.map(([puuid]) => puuid)).toEqual(
      opponents.map(({ puuid }) => puuid),
    );
    expect(
      matchIds.mock.calls.some(([puuid]) =>
        localParticipants.some(({ localPuuid }) => localPuuid === puuid),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.value)).not.toContain(localParticipants[0].localPuuid);
  });

  it('can establish self from the LCU summoner Riot ID bridge', async () => {
    const source = provider();
    vi.spyOn(source, 'connectionStatus').mockResolvedValue({
      keyDetected: false,
      source: 'unavailable',
    });
    const spectator = vi.spyOn(source, 'lobby');
    mockLcuSummoners(source);
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: tftLobby(localParticipants),
    });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok && result.value.opponents).toHaveLength(7);
    expect(spectator).not.toHaveBeenCalled();
  });

  it('removes self by normalized Riot ID and deduplicates again by public PUUID', async () => {
    const source = provider();
    vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({ ok: false, error: 'forbidden' });
    mockLcuSummoners(source);
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: tftLobby([
        localParticipants[0],
        localParticipants[1],
        { localPuuid: 'different-local-id', summonerId: 'lcu-summoner-1' },
        localParticipants[2],
      ]),
    });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.opponents.map(({ puuid }) => puuid)).toEqual([
      opponents[0].puuid,
      opponents[1].puuid,
    ]);
    expect(result.value.partialIdentities).toBe(true);
  });

  it('keeps six public opponents when one of seven local identity bridges fails', async () => {
    const source = provider();
    vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({
      ok: false,
      error: 'rate-limited',
    });
    mockLcuSummoners(source, [7]);
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: tftLobby(localParticipants),
    });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.opponents).toHaveLength(6);
    expect(result.value.partialIdentities).toBe(true);
    expect(result.value.diagnostics).toMatchObject({
      lcuSummonersResolved: 7,
      lcuSummonerResolutionFailures: 1,
      publicRiotIdentitiesResolved: 7,
      publicIdentityResolutionFailures: 0,
      opponentsUsable: 6,
    });
  });

  it('keeps six opponents when one Account-v1 Riot-ID resolution fails', async () => {
    const source = provider();
    vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({ ok: false, error: 'forbidden' });
    mockLcuSummoners(source);
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: tftLobby(localParticipants),
    });
    const resolveAccount = source.resolveAccount.bind(source);
    vi.spyOn(source, 'resolveAccount').mockImplementation(async (gameName, tagLine) => {
      if (gameName === opponents[6].gameName) throw new Error('Account-v1 unavailable');
      return resolveAccount(gameName, tagLine);
    });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.opponents).toHaveLength(6);
    expect(result.value.partialIdentities).toBe(true);
    expect(result.value.diagnostics).toMatchObject({
      lcuSummonersResolved: 8,
      lcuSummonerResolutionFailures: 0,
      publicRiotIdentitiesResolved: 7,
      publicIdentityResolutionFailures: 1,
      opponentsUsable: 6,
    });
  });

  it.each(['EndOfGame', 'WaitingForStats'])(
    'rejects stale %s participants as the current lobby',
    async (phase) => {
      const source = provider();
      vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({
        ok: false,
        error: 'forbidden',
      });
      const summoners = mockLcuSummoners(source);
      vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({
        ok: true,
        value: { ...tftLobby(localParticipants), phase, activeForScouting: false },
      });
      const result = await discoverCurrentLobby(
        source,
        new MemoryHistoryStore(),
        'Strategist#TFT',
        'EUW1',
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics).toMatchObject({
        gameflow: 'no-active-tft-session',
        opponentsUsable: 0,
      });
      expect(result.error).toContain('No active TFT game detected');
      expect(summoners).not.toHaveBeenCalled();
    },
  );

  it('reports no active game when LCU has no gameflow session', async () => {
    const source = provider();
    vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({
      ok: false,
      error: 'not-in-game',
    });
    vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({ ok: false, error: 'no-session' });
    const result = await discoverCurrentLobby(
      source,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toMatchObject({
      leagueClient: 'connected',
      gameflow: 'no-tft-session',
      opponentsUsable: 0,
    });
    expect(result.error).toContain('No active TFT game detected');
  });

  it('rejects non-TFT gameflow and preserves manual fallback when the client is unavailable', async () => {
    const nonTft = provider();
    vi.spyOn(nonTft as RiotProvider, 'lobby').mockResolvedValue({
      ok: false,
      error: 'not-in-game',
    });
    vi.spyOn(nonTft, 'leagueClientLobby').mockResolvedValue({
      ok: true,
      value: {
        participants: [localParticipants[0]],
        participantCount: 1,
        participantsWithPuuid: 1,
        tftDetected: false,
        rankedTftDetected: false,
        activeForScouting: false,
      },
    });
    const rejected = await discoverCurrentLobby(
      nonTft,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.diagnostics.gameflow).toBe('no-tft-session');
    expect(rejected.error).toContain('Use manual opponents');

    const unavailable = provider();
    vi.spyOn(unavailable as RiotProvider, 'lobby').mockResolvedValue({
      ok: false,
      error: 'forbidden',
    });
    vi.spyOn(unavailable, 'leagueClientLobby').mockResolvedValue({
      ok: false,
      error: 'client-unavailable',
    });
    const fallback = await discoverCurrentLobby(
      unavailable,
      new MemoryHistoryStore(),
      'Strategist#TFT',
      'EUW1',
    );
    expect(fallback.ok).toBe(false);
    if (fallback.ok) return;
    expect(fallback.diagnostics).toMatchObject({ spectator: '403', leagueClient: 'unavailable' });
    expect(fallback.error).toContain('Use manual opponents');
  });

  it('keeps TLS and lockfile failures distinct without exposing native details', async () => {
    for (const [error, expected] of [
      ['tls-failure', { leagueClient: 'connected', lcuHttps: 'tls-failure' }],
      ['lockfile-unavailable', { leagueClient: 'lockfile-unavailable', lcuHttps: 'not-checked' }],
    ] as const) {
      const source = provider();
      vi.spyOn(source as RiotProvider, 'lobby').mockResolvedValue({
        ok: false,
        error: 'forbidden',
      });
      vi.spyOn(source, 'leagueClientLobby').mockResolvedValue({ ok: false, error });
      const result = await discoverCurrentLobby(
        source,
        new MemoryHistoryStore(),
        'Strategist#TFT',
        'EUW1',
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics).toMatchObject({ spectator: '403', ...expected });
      expect(result.error).toContain('Use manual opponents');
      expect(result.error).not.toMatch(/password|authorization|basic/i);
    }
  });

  it('passes exactly the discovered opponents to the existing scanner callback', async () => {
    const discovery = {
      own,
      opponents: opponents.slice(0, 3),
      source: 'league-client',
      partialIdentities: true,
      diagnostics: {
        spectator: '403',
        leagueClient: 'connected',
        lcuHttps: 'connected',
        gameflow: 'tft-detected',
        participantsDiscovered: 4,
        participantsWithPuuid: 4,
        lcuSummonersResolved: 4,
        lcuSummonerResolutionFailures: 0,
        publicRiotIdentitiesResolved: 4,
        publicIdentityResolutionFailures: 0,
        opponentsUsable: 3,
        riotIdsResolved: 3,
      },
    } satisfies CurrentLobbyDiscoveryValue;
    const scan = vi.fn().mockResolvedValue('scanned');
    await expect(scanDiscoveredLobby(discovery, scan)).resolves.toBe('scanned');
    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith(discovery.opponents, 7);
  });
});
