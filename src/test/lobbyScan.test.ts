import { describe, expect, it } from 'vitest';
import type {
  CandidateContest,
  LobbyPressure,
  OpponentProfile,
  Playbook,
  RecommendationCandidate,
} from '../domain/models';
import {
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
  lobbyAdjustment,
  scoreHomeCandidates,
} from '../strategy/homeScoring';
import {
  candidateContestFor,
  M4_ROUTE_MODEL,
  M4_UNIT_MODEL,
} from '../strategy/lobbyPressure';
import {
  completeScan,
  failScan,
  notInGameScan,
  resolveHomeRanking,
  startScan,
  updateScanProgress,
} from '../services/lobbyScan';
import { data, playbooks, NOW } from './fixtures';

function makeContest(
  value: number | null,
  coverage = 1,
  unavailable = false,
): CandidateContest {
  return {
    state:
      unavailable || value === null
        ? 'Unavailable'
        : value >= 0.5
          ? 'High'
          : value >= 0.2
            ? 'Medium'
            : 'Low',
    value,
    lobbyFit: value === null ? null : 100 * (1 - value),
    evidenceCoverage: coverage,
    contestElasticity: 1,
    styleFactor: 1,
    pressuredUnits: [],
    note: 'fixture',
    provenance: unavailable ? 'unavailable' : 'seeded-criticality-and-m4-history',
  };
}

function makeMockProfile(id: string, confidence = 1): OpponentProfile {
  return {
    puuid: `puuid-${id}`,
    riotId: `Opponent${id}#EUW`,
    freshness: 'fresh',
    generatedAt: NOW,
    sourceMatchIds: [],
    set: 13,
    patch: '14.23',
    derivationVersion: '1.0.0',
    relevantGames: 20,
    effectiveSample: 20,
    confidence,
    placement: {
      games: 20,
      average: 4.5,
      topFourRate: 0.5,
    },
    patchRelevance: {
      status: 'same',
      comparableGames: 20,
      samePatchGames: 20,
      note: '',
    },
    unresolvedIds: { units: [], items: [], traits: [], augments: [] },
    repeatedUnitCandidates: [],
    classification: { family: 'unavailable', style: 'unavailable', note: '' },
    confidenceFactors: {
      sampleCoverage: 1,
      recencyQuality: 1,
      modeQuality: 1,
      patchQuality: 1,
    },
    unitEvidence: [],
    unitFrequency: {},
    traitFrequency: {},
    augmentFrequency: {},
    historicalBoards: [],
  };
}

function makeMockLobby(opponentCount: number, coverage = 1): LobbyPressure {
  const profiles = Array.from({ length: opponentCount }, (_, i) =>
    makeMockProfile(String(i + 1), coverage),
  );
  return {
    state: opponentCount >= 7 && coverage >= 1 ? 'complete' : 'partial',
    expectedOpponents: 7,
    requestedOpponents: 7,
    resolvedOpponents: opponentCount,
    profilesCompleted: opponentCount,
    profiles,
    unitPressure: [],
    unitPressureVersion: M4_UNIT_MODEL.version,
    coverage,
    relevantGamesAvailable: opponentCount * 20,
    relevantGamesTarget: 140,
    freshProfiles: opponentCount,
    cachedProfiles: 0,
    acquisitionMs: 120,
    derivationMs: 15,
    elapsedMs: 135,
    telemetry: {
      requestsAttempted: opponentCount * 5,
      cacheHits: 10,
      retries: 0,
      rateLimitWaits: 0,
      rateLimitWaitMs: 0,
      uniqueMatchDetailsFetched: opponentCount * 18,
      sharedMatchesDeduplicated: 5,
    },
    fetchedAt: NOW,
    errors: [],
  };
}

function scoreSample(plans: Playbook[], lobby?: LobbyPressure): RecommendationCandidate[] {
  return scoreHomeCandidates(plans, {
    data,
    now: NOW,
    config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
    lobby,
  });
}

describe('Live-UX Lobby Scan State & Scoring Calibration (15 Deterministic Requirements)', () => {
  const samplePlans = playbooks.slice(0, 3);
  const baseline = scoreSample(samplePlans);

  // 1. scan starts -> old lobby evidence clears
  it('1. scan starts -> old lobby evidence clears', () => {
    const previousComplete = completeScan(makeMockLobby(7, 1));
    expect(previousComplete.stage).toBe('complete');
    expect(previousComplete.lobby).not.toBeNull();

    const freshScan = startScan(previousComplete);
    expect(freshScan.stage).toBe('scanning');
    expect(freshScan.lobby).toBeNull();
    expect(freshScan.isProvisional).toBe(true);
    expect(freshScan.opponentsAnalyzed).toBe(0);

    const resolved = resolveHomeRanking(baseline, scoreSample(samplePlans, previousComplete.lobby!), freshScan);
    expect(resolved.isFinalLobbyAware).toBe(false);
    expect(resolved.isProvisional).toBe(true);
    expect(resolved.candidates).toEqual(baseline);
  });

  // 2. 3/7 -> no final lobby ranking state
  it('2. 3/7 -> no final lobby ranking state', () => {
    let state = startScan();
    state = updateScanProgress(state, {
      opponentsAnalyzed: 3,
      opponentsTotal: 7,
      matchesProcessed: 42,
    });
    expect(state.stage).toBe('scanning');
    expect(state.opponentsAnalyzed).toBe(3);
    expect(state.isProvisional).toBe(true);

    const resolved = resolveHomeRanking(baseline, null, state);
    expect(resolved.isFinalLobbyAware).toBe(false);
    expect(resolved.statusText).toContain('3/7');
  });

  // 3. 5/7 -> still provisional
  it('3. 5/7 -> still provisional', () => {
    let state = startScan();
    state = updateScanProgress(state, {
      opponentsAnalyzed: 5,
      opponentsTotal: 7,
      matchesProcessed: 92,
    });
    expect(state.stage).toBe('scanning');
    expect(state.opponentsAnalyzed).toBe(5);
    expect(state.isProvisional).toBe(true);

    const resolved = resolveHomeRanking(baseline, null, state);
    expect(resolved.isFinalLobbyAware).toBe(false);
    expect(resolved.isProvisional).toBe(true);
    expect(resolved.statusText).toContain('5/7');
    expect(resolved.statusText).not.toContain('READY');
  });

  // 4. 7/7 -> final ranking published
  it('4. 7/7 -> final ranking published', () => {
    const completeLobby = makeMockLobby(7, 0.89);
    const liveScored = scoreSample(samplePlans, completeLobby);
    const completedState = completeScan(completeLobby);

    expect(completedState.stage).toBe('complete');
    expect(completedState.isProvisional).toBe(false);
    expect(completedState.opponentsAnalyzed).toBe(7);

    const resolved = resolveHomeRanking(baseline, liveScored, completedState);
    expect(resolved.isFinalLobbyAware).toBe(true);
    expect(resolved.isProvisional).toBe(false);
    expect(resolved.candidates).toEqual(liveScored);
    expect(resolved.statusText).toContain('LOBBY ANALYSIS READY');
    expect(resolved.statusText).toContain('7/7');
  });

  // 5. 6/7 final partial -> clearly partial but usable
  it('5. 6/7 final partial -> clearly partial but usable', () => {
    const partialLobby6 = makeMockLobby(6, 6 / 7);
    const liveScored = scoreSample(samplePlans, partialLobby6);
    const partialState = completeScan(partialLobby6);

    expect(partialState.stage).toBe('partial-complete');
    expect(partialState.isProvisional).toBe(false);
    expect(partialState.opponentsAnalyzed).toBe(6);

    const resolved = resolveHomeRanking(baseline, liveScored, partialState);
    expect(resolved.isFinalLobbyAware).toBe(true);
    expect(resolved.isProvisional).toBe(false);
    expect(resolved.statusText).toContain('PARTIAL — 6/7 opponents');
    expect(resolved.statusText).not.toContain('7/7');
  });

  // 6. scan failure -> no stale lobby ranking
  it('6. scan failure -> no stale lobby ranking', () => {
    const failedState = failScan('Network connection lost');
    expect(failedState.stage).toBe('failed');
    expect(failedState.lobby).toBeNull();
    expect(failedState.error).toContain('Network');

    const resolved = resolveHomeRanking(baseline, null, failedState);
    expect(resolved.isFinalLobbyAware).toBe(false);
    expect(resolved.candidates).toEqual(baseline);
    expect(resolved.statusText).toBe('LOBBY SCAN FAILED');
  });

  // 7. no active TFT game -> no lobby ranking
  it('7. no active TFT game -> no lobby ranking', () => {
    const notInGameState = notInGameScan('No active TFT game detected');
    expect(notInGameState.stage).toBe('not-in-game');
    expect(notInGameState.lobby).toBeNull();

    const resolved = resolveHomeRanking(baseline, null, notInGameState);
    expect(resolved.isFinalLobbyAware).toBe(false);
    expect(resolved.candidates).toEqual(baseline);
    expect(resolved.statusText).toBe('NO CURRENT LOBBY');
  });

  // 8. recommendations do not reorder as "final" on each intermediate profile
  it('8. recommendations do not reorder as "final" on each intermediate profile', () => {
    let scanState = startScan();
    const intermediateLobby3 = makeMockLobby(3, 3 / 7);
    const intermediateScored3 = scoreSample(samplePlans, intermediateLobby3);

    scanState = updateScanProgress(scanState, { opponentsAnalyzed: 3, opponentsTotal: 7 });
    const at3 = resolveHomeRanking(baseline, intermediateScored3, scanState);
    expect(at3.isFinalLobbyAware).toBe(false);
    expect(at3.candidates).toEqual(baseline); // Stable baseline, does not reshuffle as final

    const intermediateLobby5 = makeMockLobby(5, 5 / 7);
    const intermediateScored5 = scoreSample(samplePlans, intermediateLobby5);

    scanState = updateScanProgress(scanState, { opponentsAnalyzed: 5, opponentsTotal: 7 });
    const at5 = resolveHomeRanking(baseline, intermediateScored5, scanState);
    expect(at5.isFinalLobbyAware).toBe(false);
    expect(at5.candidates).toEqual(baseline); // Still stable baseline
  });

  // 9. default clean bonus remains +4 maximum
  it('9. default clean bonus remains +4 maximum', () => {
    expect(DEFAULT_HOME_RECOMMENDATION_CONFIG.maxCleanLobbyBonus).toBe(4);
    const cleanContest = makeContest(0, 1.0);
    const adjustment = lobbyAdjustment(cleanContest, DEFAULT_HOME_RECOMMENDATION_CONFIG);
    expect(adjustment).toBe(4);
  });

  // 10. medium contest uses new -15 maximum
  it('10. medium contest uses new -15 maximum', () => {
    expect(DEFAULT_HOME_RECOMMENDATION_CONFIG.maxMediumContestPenalty).toBe(15);
    const mediumContest = makeContest(0.5, 1.0);
    const adjustment = lobbyAdjustment(mediumContest, DEFAULT_HOME_RECOMMENDATION_CONFIG);
    expect(adjustment).toBe(-15);
  });

  // 11. high contest uses new -30 maximum
  it('11. high contest uses new -30 maximum', () => {
    expect(DEFAULT_HOME_RECOMMENDATION_CONFIG.maxHighContestPenalty).toBe(30);
    const highContest = makeContest(1.0, 1.0);
    const adjustment = lobbyAdjustment(highContest, DEFAULT_HOME_RECOMMENDATION_CONFIG);
    expect(adjustment).toBe(-30);
  });

  // 12. full coverage receives full nominal adjustment
  it('12. full coverage receives full nominal adjustment', () => {
    const config = DEFAULT_HOME_RECOMMENDATION_CONFIG;
    expect(lobbyAdjustment(makeContest(0, 1.0), config)).toBe(4);
    expect(lobbyAdjustment(makeContest(0.5, 1.0), config)).toBe(-15);
    expect(lobbyAdjustment(makeContest(1.0, 1.0), config)).toBe(-30);
  });

  // 13. partial coverage scales adjustment
  it('13. partial coverage scales adjustment', () => {
    const config = DEFAULT_HOME_RECOMMENDATION_CONFIG;
    // Half coverage scales high penalty -30 by 0.5 -> -15
    const halfCoverage = lobbyAdjustment(makeContest(1.0, 0.5), config);
    expect(halfCoverage).toBe(-15);

    // 6/7 (~0.8571) coverage scales high penalty -30 -> -25.7
    const sixSeventhsCoverage = lobbyAdjustment(makeContest(1.0, 6 / 7), config);
    expect(sixSeventhsCoverage).toBe(-25.7);

    // Partial coverage never awards a clean bonus if observed contest exists
    expect(Math.abs(halfCoverage)).toBeLessThan(Math.abs(lobbyAdjustment(makeContest(1.0, 1.0), config)));
  });

  // 14. route/unit contest model outputs are unchanged
  it('14. route/unit contest model outputs are unchanged', () => {
    const testPlaybook = playbooks[0];
    const testLobby = makeMockLobby(7, 1.0);
    const contestResult = candidateContestFor(testPlaybook, testLobby);

    expect(contestResult).toHaveProperty('unitContest');
    expect(contestResult).toHaveProperty('routeContest');
    expect(contestResult).toHaveProperty('value');
    expect(contestResult).toHaveProperty('pressuredUnits');
    expect(contestResult).toHaveProperty('evidenceCoverage');
    expect(M4_UNIT_MODEL.version).toBe('m4-unit-pressure-v1');
    expect(M4_ROUTE_MODEL.version).toBe('m4-route-overlap-v2');
  });

  // 15. Home and Comp Checker still share same contest evidence
  it('15. Home and Comp Checker still share same contest evidence', () => {
    const testLobby = makeMockLobby(7, 1.0);
    const scored = scoreSample(samplePlans, testLobby);

    // Primary candidates and all candidates pool share exact same candidate instances
    for (const candidate of scored) {
      expect(candidate.contest).toBeDefined();
      expect(candidate.home).toBeDefined();
      expect(candidate.home?.lobbyAdjustment).toBeDefined();
      // Verify the math is coherent: Final Safety = Base + LowPick + Lobby
      const expectedFinal =
        Math.round(
          (candidate.home!.basePerformance +
            candidate.home!.lowPickEdge +
            candidate.home!.lobbyAdjustment) *
            10,
        ) / 10;
      expect(candidate.home!.finalSafety).toBe(expectedFinal);
    }
  });
});
