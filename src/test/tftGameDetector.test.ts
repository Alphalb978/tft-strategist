import { describe, expect, it, vi } from 'vitest';
import type { LeagueClientLobby, LeagueClientParticipant, RiotProvider } from '../providers/riot';
import { RiotProviderError } from '../providers/riot';
import {
  createSessionFingerprint,
  TftGameDetector,
  type DetectedGameSession,
} from '../services/tftGameDetector';
import {
  createIdleScanState,
  detectedScan,
  startScan,
  completeScan,
  failScan,
  resolveHomeRanking,
} from '../services/lobbyScan';
import type { LobbyPressure } from '../domain/models';
import { data, playbooks, NOW } from './fixtures';
import { DEFAULT_HOME_RECOMMENDATION_CONFIG, scoreHomeCandidates } from '../strategy/homeScoring';

function makeMockLobby(
  overrides: Partial<LeagueClientLobby> = {},
): LeagueClientLobby {
  const defaultParticipants: LeagueClientParticipant[] = Array.from(
    { length: 8 },
    (_, i) => ({
      localPuuid: `puuid-${i}`,
      summonerId: `summoner-${i}`,
    }),
  );

  return {
    participants: defaultParticipants,
    participantCount: defaultParticipants.length,
    participantsWithPuuid: defaultParticipants.length,
    tftDetected: true,
    rankedTftDetected: true,
    activeForScouting: true,
    phase: 'InProgress',
    queueId: 1100,
    queueType: 'RANKED_TFT',
    ...overrides,
  };
}

function makeMockProvider(
  lobbyResponse?: { ok: true; value: LeagueClientLobby } | { ok: false; error: unknown },
) {
  let response = lobbyResponse ?? { ok: true, value: makeMockLobby() };

  return {
    setResponse(newResponse: typeof response) {
      response = newResponse;
    },
    provider: {
      leagueClientLobby: vi.fn().mockImplementation(async () => response),
      resolveAccount: vi.fn().mockRejectedValue(new RiotProviderError('unavailable')),
      matchDetails: vi.fn().mockRejectedValue(new RiotProviderError('unavailable')),
      recentMatchIds: vi.fn().mockRejectedValue(new RiotProviderError('unavailable')),
      lobby: vi.fn().mockRejectedValue(new RiotProviderError('unavailable')),
      connectionStatus: vi.fn().mockResolvedValue({ keyDetected: true, source: 'env' }),
      account: vi.fn().mockRejectedValue(new RiotProviderError('unavailable')),
    } as unknown as RiotProvider & {
      leagueClientLobby: ReturnType<typeof vi.fn>;
      resolveAccount: ReturnType<typeof vi.fn>;
      matchDetails: ReturnType<typeof vi.fn>;
      recentMatchIds: ReturnType<typeof vi.fn>;
      lobby: ReturnType<typeof vi.fn>;
    },
  };
}

describe('M13C.2 — Automatic TFT Game Detection & Lobby Scan', () => {
  // 1. no League Client -> no auto scan
  it('1. no League Client -> no auto scan', async () => {
    const { provider } = makeMockProvider({ ok: false, error: 'client-unavailable' });
    const onDetected = vi.fn();
    const onScan = vi.fn();
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();
    await detector.checkNow();

    expect(detector.getState()).toBe('NO_GAME');
    expect(onDetected).not.toHaveBeenCalled();
    expect(onScan).not.toHaveBeenCalled();
    expect(onGameEnded).not.toHaveBeenCalled();
  });

  // 2. League Client open but no game -> no auto scan
  it('2. League Client open but no game -> no auto scan', async () => {
    const { provider, setResponse } = makeMockProvider({ ok: false, error: 'no-session' });
    const onDetected = vi.fn();
    const onScan = vi.fn();
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();

    // Now client is in pre-game lobby (phase: 'Lobby', activeForScouting: false)
    setResponse({
      ok: true,
      value: makeMockLobby({
        phase: 'Lobby',
        activeForScouting: false,
      }),
    });
    await detector.checkNow();

    expect(detector.getState()).toBe('NO_GAME');
    expect(onDetected).not.toHaveBeenCalled();
    expect(onScan).not.toHaveBeenCalled();
  });

  // 3. non-TFT InProgress -> no auto scan
  it('3. non-TFT InProgress -> no auto scan', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby({
        phase: 'InProgress',
        tftDetected: false,
        rankedTftDetected: false,
        activeForScouting: false,
        queueId: 420,
        queueType: 'RANKED_SOLO_5x5',
      }),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn();
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();
    await detector.checkNow();

    expect(detector.getState()).toBe('NO_GAME');
    expect(onDetected).not.toHaveBeenCalled();
    expect(onScan).not.toHaveBeenCalled();
  });

  // 4. Ranked TFT InProgress -> one auto scan
  it('4. Ranked TFT InProgress -> one auto scan', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby({
        phase: 'InProgress',
        tftDetected: true,
        rankedTftDetected: true,
        activeForScouting: true,
        queueId: 1100,
        queueType: 'RANKED_TFT',
      }),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        ranked: true,
        queueId: 1100,
        participantCount: 8,
      }),
    );
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 5. Normal/non-ranked TFT InProgress -> one auto scan
  it('5. Normal/non-ranked TFT InProgress -> one auto scan', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby({
        phase: 'InProgress',
        tftDetected: true,
        rankedTftDetected: false,
        activeForScouting: true,
        queueId: 1090,
        queueType: 'NORMAL_TFT',
      }),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        ranked: false,
        queueId: 1090,
        participantCount: 8,
      }),
    );
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 6. same TFT session observed repeatedly -> exactly one auto scan
  it('6. same TFT session observed repeatedly -> exactly one auto scan', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });

    // Poll 10 consecutive ticks while the same game remains InProgress
    for (let i = 0; i < 10; i++) {
      await detector.checkNow();
    }

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 7. game ends -> lobby clears and latch resets
  it('7. game ends -> lobby clears and latch resets', async () => {
    const { provider, setResponse } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();
    expect(detector.getState()).toBe('SCANNED');

    // Game finishes -> phase transitions to 'EndOfGame'
    setResponse({
      ok: true,
      value: makeMockLobby({
        phase: 'EndOfGame',
        activeForScouting: false,
      }),
    });
    await detector.checkNow();

    expect(onGameEnded).toHaveBeenCalledTimes(1);
    expect(detector.getState()).toBe('NO_GAME');
    expect(detector.getCurrentFingerprint()).toBeNull();
  });

  // 8. next TFT game -> new auto scan
  it('8. next TFT game -> new auto scan', async () => {
    const { provider, setResponse } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });

    // Game 1
    await detector.checkNow();
    expect(onScan).toHaveBeenCalledTimes(1);

    // Game 1 ends
    setResponse({ ok: false, error: 'no-session' });
    await detector.checkNow();
    expect(detector.getState()).toBe('NO_GAME');

    // Game 2 begins (with new participants)
    const newParticipants: LeagueClientParticipant[] = Array.from(
      { length: 8 },
      (_, i) => ({
        localPuuid: `new-puuid-${i}`,
        summonerId: `new-summoner-${i}`,
      }),
    );
    setResponse({
      ok: true,
      value: makeMockLobby({ participants: newParticipants }),
    });
    await detector.checkNow();

    expect(onScan).toHaveBeenCalledTimes(2);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 9. manual clear during active game -> does not instantly auto-repopulate
  it('9. manual clear during active game -> does not instantly auto-repopulate', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();
    expect(onScan).toHaveBeenCalledTimes(1);

    // User clicks "Clear Lobby" during active game
    detector.onManualClear();
    expect(detector.getState()).toBe('CLEARED');

    // Polling ticks continue while in the same game
    await detector.checkNow();
    await detector.checkNow();
    await detector.checkNow();

    // onScan must NOT have been called again
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(detector.getState()).toBe('CLEARED');
  });

  // 10. manual retry -> works
  it('10. manual retry -> works', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    const onDetected = vi.fn();
    const onScan = vi.fn().mockResolvedValue(undefined);
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });
    await detector.checkNow();
    expect(onScan).toHaveBeenCalledTimes(1);

    // User manually cleared
    detector.onManualClear();
    expect(detector.getState()).toBe('CLEARED');

    // User explicitly presses "Scan current lobby" to retry/override
    await detector.onManualScan();

    expect(onScan).toHaveBeenCalledTimes(2);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 11. expired API key -> TFT still detected, no retry storm
  it('11. expired API key -> TFT still detected, no retry storm', async () => {
    const { provider } = makeMockProvider({
      ok: true,
      value: makeMockLobby(),
    });
    let detectedInfo: DetectedGameSession | null = null;
    const onDetected = vi.fn((info: DetectedGameSession) => {
      detectedInfo = info;
    });

    // onScan fails due to expired key, simulating App error latching
    let scanCalls = 0;
    const onScan = vi.fn().mockImplementation(async () => {
      scanCalls++;
      // Scan fails with expired key; error is handled by caller without crashing
      throw new RiotProviderError('auth');
    });
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, {
      onDetected,
      onScan: async (session) => {
        try {
          await onScan(session);
        } catch {
          // Failure handled: session remains latched in SCANNED
        }
      },
      onGameEnded,
    });

    // Initial poll detects TFT game
    await detector.checkNow();
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(detectedInfo).not.toBeNull();
    expect(scanCalls).toBe(1);
    expect(detector.getState()).toBe('SCANNED');

    // Subsequent 10 poll ticks while key remains expired
    for (let i = 0; i < 10; i++) {
      await detector.checkNow();
    }

    // No retry storm! Exactly 1 scan attempt was made
    expect(scanCalls).toBe(1);
    expect(detector.getState()).toBe('SCANNED');
  });

  // 12. polling while idle -> zero Riot public API requests
  it('12. polling while idle -> zero Riot public API requests', async () => {
    const { provider, setResponse } = makeMockProvider({
      ok: false,
      error: 'no-session',
    });
    const onDetected = vi.fn();
    const onScan = vi.fn();
    const onGameEnded = vi.fn();

    const detector = new TftGameDetector(provider, { onDetected, onScan, onGameEnded });

    // Poll 10 times in idle/no-session state
    for (let i = 0; i < 5; i++) {
      await detector.checkNow();
    }

    // Client moves to non-TFT game (ARAM)
    setResponse({
      ok: true,
      value: makeMockLobby({
        phase: 'InProgress',
        tftDetected: false,
        activeForScouting: false,
        queueId: 450,
      }),
    });
    for (let i = 0; i < 5; i++) {
      await detector.checkNow();
    }

    // Zero Riot public API calls made
    expect(provider.resolveAccount).not.toHaveBeenCalled();
    expect(provider.matchDetails).not.toHaveBeenCalled();
    expect(provider.recentMatchIds).not.toHaveBeenCalled();
    expect(provider.lobby).not.toHaveBeenCalled();

    // Only local loopback LCU was queried
    expect(provider.leagueClientLobby).toHaveBeenCalledTimes(10);
  });

  // 13. existing recommendation/scoring parity remains unchanged
  it('13. existing recommendation/scoring parity remains unchanged', () => {
    const sampleCandidates = scoreHomeCandidates(playbooks.slice(0, 1), {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
    });

    // Idle state: baseline candidates returned, not final lobby aware, not provisional
    const idleRanking = resolveHomeRanking(sampleCandidates, null, createIdleScanState());
    expect(idleRanking.candidates).toEqual(sampleCandidates);
    expect(idleRanking.isFinalLobbyAware).toBe(false);
    expect(idleRanking.isProvisional).toBe(false);
    expect(idleRanking.statusText).toBe('NO CURRENT LOBBY');

    // Detected state: baseline candidates returned, provisional tag active
    const detectedRanking = resolveHomeRanking(sampleCandidates, null, detectedScan());
    expect(detectedRanking.candidates).toEqual(sampleCandidates);
    expect(detectedRanking.isFinalLobbyAware).toBe(false);
    expect(detectedRanking.isProvisional).toBe(true);
    expect(detectedRanking.statusText).toBe('TFT GAME DETECTED');

    // Scanning state: baseline candidates returned, provisional tag active
    const scanningRanking = resolveHomeRanking(sampleCandidates, null, startScan());
    expect(scanningRanking.candidates).toEqual(sampleCandidates);
    expect(scanningRanking.isFinalLobbyAware).toBe(false);
    expect(scanningRanking.isProvisional).toBe(true);
    expect(scanningRanking.statusText).toBe('ANALYZING LOBBY · 0/7 opponents');

    // Failed with TFT detected state (e.g. expired key)
    const failedRanking = resolveHomeRanking(sampleCandidates, null, {
      ...failScan('Riot API key expired'),
      tftDetected: true,
    });
    expect(failedRanking.candidates).toEqual(sampleCandidates);
    expect(failedRanking.isFinalLobbyAware).toBe(false);
    expect(failedRanking.isProvisional).toBe(false);
    expect(failedRanking.statusText).toBe('TFT GAME DETECTED');

    // Complete state with mock lobby
    const mockLobbyPressure: LobbyPressure = {
      expectedOpponents: 7,
      profilesCompleted: 7,
      relevantGamesAvailable: 70,
      relevantGamesTarget: 70,
      coverage: 1,
      telemetry: { uniqueMatchDetailsFetched: 70, cacheHits: 0 },
    } as unknown as LobbyPressure;
    const completeRanking = resolveHomeRanking(
      sampleCandidates,
      sampleCandidates,
      completeScan(mockLobbyPressure),
    );
    expect(completeRanking.isFinalLobbyAware).toBe(true);
    expect(completeRanking.isProvisional).toBe(false);
    expect(completeRanking.statusText).toBe('LOBBY ANALYSIS READY · 7/7 opponents');
  });

  // Session fingerprint uniqueness helper test
  it('derives a deterministic session fingerprint from queue and participant PUUIDs', () => {
    const lobby1 = makeMockLobby();
    const fp1 = createSessionFingerprint(lobby1);

    const lobby2 = makeMockLobby();
    const fp2 = createSessionFingerprint(lobby2);

    expect(fp1).toBe(fp2);

    // Changing participant PUUIDs changes fingerprint
    const lobby3 = makeMockLobby({
      participants: [{ localPuuid: 'diff-puuid', summonerId: 's1' }],
    });
    const fp3 = createSessionFingerprint(lobby3);
    expect(fp3).not.toBe(fp1);

    // Changing queue changes fingerprint
    const lobby4 = makeMockLobby({ queueId: 1090 });
    const fp4 = createSessionFingerprint(lobby4);
    expect(fp4).not.toBe(fp1);
  });
});
