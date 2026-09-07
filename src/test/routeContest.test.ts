import { describe, expect, it } from 'vitest';
import type { CompletedMatch, LobbyPressure, OpponentProfile, Playbook } from '../domain/models';
import { deriveOpponent } from '../services/scouting';
import {
  calculateBoardRouteSimilarity,
  candidateContestFor,
  deriveLobbyUnitPressure,
  deriveOpponentRouteEvidence,
  M4_ROUTE_MODEL,
  M4_UNIT_MODEL,
} from '../strategy/lobbyPressure';
import { DEFAULT_HOME_RECOMMENDATION_CONFIG, scoreHomeCandidates } from '../strategy/homeScoring';
import { data, NOW, playbooks } from './fixtures';

const targetPlaybook = playbooks[0]; // Solar & Elderwood: core [Kayle, Xayah, Sejuani, Ornn]
const candidateUnits = targetPlaybook.target.units.map((u) => u.championId);
const unrelatedUnits = ['Unrelated_1', 'Unrelated_2', 'Unrelated_3', 'Unrelated_4', 'Unrelated_5', 'Unrelated_6', 'Unrelated_7'];

function makeBoardMatch(
  id: string,
  puuid: string,
  championIds: string[],
  completedAt = NOW,
  placement = 2,
): CompletedMatch {
  return {
    id,
    set: 18,
    setCoreName: 'TFTSet18',
    riotGameVersion: 'Version 16.18.702.1234 (Sep 03 2026/12:00:00) [PUBLIC]',
    tftContentPatch: '18.1',
    tftContentPatchSource: 'fixture',
    dataVersion: 'fixture-v2',
    gameTimestamp: completedAt,
    gameTimestampSemantics: 'fixture-completed-at',
    gameDurationSeconds: 2100,
    completedAt,
    queueId: null,
    gameType: 'fixture-standard',
    mapId: null,
    endOfGameResult: 'fixture-complete',
    modeSupport: 'supported',
    source: 'fixture:synthetic-matches',
    participants: [
      {
        puuid,
        placement,
        level: championIds.length,
        units: championIds.map((championId) => ({
          championId,
          items: [],
          stars: 2,
          rarity: null,
          rawName: null,
          unresolvedUnit: false,
          unresolvedItems: [],
        })),
        traits: [],
        augmentIds: [],
        unresolvedAugmentIds: [],
        familyId: 'fixture',
        style: 'reroll',
      },
    ],
  };
}

function makeHistory(puuid: string, boards: string[][]): CompletedMatch[] {
  return boards.map((championIds, index) =>
    makeBoardMatch(
      `m-${puuid}-${index}`,
      puuid,
      championIds,
      new Date(Date.parse(NOW) - index * 86_400_000).toISOString(),
      index < 4 ? 2 : 5,
    ),
  );
}

function makeLobby(profiles: OpponentProfile[], explicitCoverage?: number): LobbyPressure {
  const allUnitIds = new Set<string>();
  targetPlaybook.target.units.forEach((u) => allUnitIds.add(u.championId));
  const unitPressure = deriveLobbyUnitPressure(profiles, allUnitIds);
  const relevantGamesAvailable = profiles.reduce((sum, profile) => sum + profile.relevantGames, 0);
  const relevantGamesTarget = 140;
  const coverage =
    explicitCoverage ?? (relevantGamesTarget ? Math.min(1, relevantGamesAvailable / relevantGamesTarget) : 0);
  return {
    state: profiles.length >= 7 && coverage >= 1 ? 'complete' : 'partial',
    expectedOpponents: 7,
    requestedOpponents: 7,
    resolvedOpponents: profiles.length,
    profilesCompleted: profiles.length,
    profiles,
    unitPressure,
    unitPressureVersion: M4_UNIT_MODEL.version,
    coverage,
    relevantGamesAvailable,
    relevantGamesTarget,
    freshProfiles: profiles.length,
    cachedProfiles: 0,
    acquisitionMs: 0,
    derivationMs: 0,
    elapsedMs: 0,
    telemetry: {
      requestsAttempted: 0,
      cacheHits: 0,
      retries: 0,
      rateLimitWaits: 0,
      rateLimitWaitMs: 0,
      uniqueMatchDetailsFetched: 0,
      sharedMatchesDeduplicated: 0,
    },
    fetchedAt: NOW,
    errors: [],
  };
}

describe('M4 Route Contest & Whole-Route Lobby Overlap', () => {
  it('1. One-tricking: single 20/20 opponent forcing candidate route produces High route contest', () => {
    // Opponent 0 one-tricks candidate units in all 20 games
    const forcerMatches = makeHistory('opp-forcer', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-forcer', forcerMatches, 18, '18.1', NOW);

    // Opponents 1..6 play unrelated boards
    const otherProfiles = Array.from({ length: 6 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      const matches = makeHistory(oppPuuid, Array(20).fill(unrelatedUnits));
      return deriveOpponent(oppPuuid, matches, 18, '18.1', NOW);
    });

    const lobby = makeLobby([forcerProfile, ...otherProfiles]);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeEvidence).not.toBeNull();
    expect(contest.routeEvidence?.opponentsWithRouteMatch).toBe(1);
    // In saturating-union model: q = 1.0, raw = 1.0, elasticity 0.8 => routeContest = 0.80 (High)
    expect(contest.routeContest).toBeCloseTo(0.8, 2);
    expect(contest.state).toBe('High');
    expect(contest.value).toBeGreaterThanOrEqual(0.8);
  });

  it('2. Two-opponent route overlap: produces strong High contest pressure with saturating union', () => {
    const forcer1Matches = makeHistory('opp-forcer-1', Array(20).fill(candidateUnits));
    const forcer1Profile = deriveOpponent('opp-forcer-1', forcer1Matches, 18, '18.1', NOW);

    const forcer2Matches = makeHistory('opp-forcer-2', Array(20).fill(candidateUnits));
    const forcer2Profile = deriveOpponent('opp-forcer-2', forcer2Matches, 18, '18.1', NOW);

    const otherProfiles = Array.from({ length: 5 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      const matches = makeHistory(oppPuuid, Array(20).fill(unrelatedUnits));
      return deriveOpponent(oppPuuid, matches, 18, '18.1', NOW);
    });

    const lobby = makeLobby([forcer1Profile, forcer2Profile, ...otherProfiles]);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeEvidence?.opponentsWithRouteMatch).toBe(2);
    expect(contest.state).toBe('High');
    expect(contest.value).toBeGreaterThanOrEqual(0.8);
  });

  it('3. Unrelated boards: 7 opponents playing unrelated compositions produce zero route contest', () => {
    const profiles = Array.from({ length: 7 }, (_, i) => {
      const oppPuuid = `opp-unrelated-${i}`;
      const matches = makeHistory(oppPuuid, Array(20).fill(unrelatedUnits));
      return deriveOpponent(oppPuuid, matches, 18, '18.1', NOW);
    });

    const lobby = makeLobby(profiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeContest).toBe(0);
    expect(contest.routeEvidence).toBeNull();
    expect(contest.state).toBe('Low');
    expect(contest.value).toBe(0);
  });

  it('4. Shared support / splash overlap avoidance: single shared unit does not trigger route contest', () => {
    // Board shares 1 tank unit (e.g. Ornn) but 0 other core units
    const sharedUnit = targetPlaybook.family.core[0];
    const splashBoard = [sharedUnit, ...unrelatedUnits.slice(0, 6)];

    const sim = calculateBoardRouteSimilarity(splashBoard, targetPlaybook);
    // Core recall is 1/4 = 0.25 < 0.5 coreDampingThreshold -> heavily damped
    expect(sim).toBeLessThan(0.15);

    const profiles = Array.from({ length: 7 }, (_, i) => {
      const oppPuuid = `opp-splash-${i}`;
      const matches = makeHistory(oppPuuid, Array(20).fill(splashBoard));
      return deriveOpponent(oppPuuid, matches, 18, '18.1', NOW);
    });

    const lobby = makeLobby(profiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeEvidence).toBeNull();
    expect(contest.routeContest).toBe(0);
  });

  it('5. Slow-roll sensitivity: slow roll comp experiences higher contest penalty than fast-8', () => {
    const forcerMatches = makeHistory('opp-forcer', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-forcer', forcerMatches, 18, '18.1', NOW);
    const otherProfiles = Array.from({ length: 6 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      const matches = makeHistory(oppPuuid, Array(20).fill(unrelatedUnits));
      return deriveOpponent(oppPuuid, matches, 18, '18.1', NOW);
    });
    const lobby = makeLobby([forcerProfile, ...otherProfiles]);

    const slowRollPlaybook: Playbook = structuredClone(targetPlaybook);
    slowRollPlaybook.features.style = 'Level 6 slow roll';

    const fast8Playbook: Playbook = structuredClone(targetPlaybook);
    fast8Playbook.features.style = 'Fast 8';

    const contestSlowRoll = candidateContestFor(slowRollPlaybook, lobby);
    const contestFast8 = candidateContestFor(fast8Playbook, lobby);

    expect(contestSlowRoll.routeContest!).toBeGreaterThan(contestFast8.routeContest!);
  });

  it('6. Recency weighting: recent 5 games produce higher route contest than older games', () => {
    // Player 1 played route in recent 5 games (ordinals 0..4) and unrelated in 5..19
    const recentBoards = [
      ...Array(5).fill(candidateUnits),
      ...Array(15).fill(unrelatedUnits),
    ];
    const recentProfile = deriveOpponent(
      'opp-recent',
      makeHistory('opp-recent', recentBoards),
      18,
      '18.1',
      NOW,
    );

    // Player 2 played route in oldest 5 games (ordinals 15..19) and unrelated in 0..14
    const olderBoards = [
      ...Array(15).fill(unrelatedUnits),
      ...Array(5).fill(candidateUnits),
    ];
    const olderProfile = deriveOpponent(
      'opp-older',
      makeHistory('opp-older', olderBoards),
      18,
      '18.1',
      NOW,
    );

    const evidenceRecent = deriveOpponentRouteEvidence(recentProfile, targetPlaybook);
    const evidenceOlder = deriveOpponentRouteEvidence(olderProfile, targetPlaybook);

    expect(evidenceRecent).not.toBeNull();
    expect(evidenceOlder).not.toBeNull();
    expect(evidenceRecent!.routeOverlap).toBeGreaterThan(evidenceOlder!.routeOverlap);
    expect(evidenceRecent!.recentFiveStrongMatches).toBe(5);
    expect(evidenceOlder!.recentFiveStrongMatches).toBe(0);
  });

  it('7. Low confidence damping: low confidence opponent produces proportionally lower route contest', () => {
    // Full 20 matches -> high confidence
    const highConfProfile = deriveOpponent(
      'opp-high',
      makeHistory('opp-high', Array(20).fill(candidateUnits)),
      18,
      '18.1',
      NOW,
    );

    // Only 3 matches -> low confidence
    const lowConfProfile = deriveOpponent(
      'opp-low',
      makeHistory('opp-low', Array(3).fill(candidateUnits)),
      18,
      '18.1',
      NOW,
    );

    const lobbyHigh = makeLobby([
      highConfProfile,
      ...Array.from({ length: 6 }, (_, i) =>
        deriveOpponent(`opp-unr-${i}`, makeHistory(`opp-unr-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
      ),
    ]);

    const lobbyLow = makeLobby([
      lowConfProfile,
      ...Array.from({ length: 6 }, (_, i) =>
        deriveOpponent(`opp-unr-${i}`, makeHistory(`opp-unr-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
      ),
    ]);

    const contestHigh = candidateContestFor(targetPlaybook, lobbyHigh);
    const contestLow = candidateContestFor(targetPlaybook, lobbyLow);

    expect(contestHigh.routeContest!).toBeGreaterThan(contestLow.routeContest!);
  });

  it('8. External / incomplete candidate: calculates factual route overlap without fabricating core', () => {
    const externalPlaybook: Playbook = structuredClone(targetPlaybook);
    // Strip curated core and unitCriticality
    externalPlaybook.family.core = [];
    externalPlaybook.features.unitCriticality = {};

    const forcerMatches = makeHistory('opp-forcer', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-forcer', forcerMatches, 18, '18.1', NOW);
    const otherProfiles = Array.from({ length: 6 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      return deriveOpponent(oppPuuid, makeHistory(oppPuuid, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW);
    });

    const lobby = makeLobby([forcerProfile, ...otherProfiles]);
    const contest = candidateContestFor(externalPlaybook, lobby);

    expect(contest.routeEvidence).not.toBeNull();
    expect(contest.routeEvidence?.opponentsWithRouteMatch).toBe(1);
    expect(contest.routeContest).toBeGreaterThanOrEqual(0.3);
    // Does not crash, and correctly surfaces route contest
    expect(contest.state).not.toBe('Unavailable');
  });

  it('9. Dual-channel combination: unit and route contest reinforce each other within bounds', () => {
    const forcerMatches = makeHistory('opp-forcer', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-forcer', forcerMatches, 18, '18.1', NOW);
    const otherProfiles = Array.from({ length: 6 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      return deriveOpponent(oppPuuid, makeHistory(oppPuuid, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW);
    });

    const lobby = makeLobby([forcerProfile, ...otherProfiles]);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.unitContest).toBeDefined();
    expect(contest.routeContest).toBeDefined();
    expect(contest.unitContest).toBeGreaterThan(0);
    expect(contest.routeContest).toBeGreaterThan(0);

    const strongest = Math.max(contest.unitContest!, contest.routeContest!);
    const agreement = Math.min(contest.unitContest!, contest.routeContest!);
    const expectedValue = Math.min(1, strongest + M4_ROUTE_MODEL.aggregation.agreementBonusMax * agreement);

    expect(contest.value).toBeCloseTo(expectedValue, 4);
    expect(contest.value).toBeLessThanOrEqual(1.0);
  });

  it('10. Live Miss Acceptance Fixture: forcer causes elevated contest and eliminates false lobby bonus', () => {
    // Reproduce live failure scenario:
    // Apex Predator (Solar & Elderwood) was falsely scored with Low contest and +0.9 lobby bonus.
    const forcerMatches = makeHistory('opp-live-forcer', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-live-forcer', forcerMatches, 18, '18.1', NOW);
    const otherProfiles = Array.from({ length: 6 }, (_, i) => {
      const oppPuuid = `opp-other-${i}`;
      return deriveOpponent(oppPuuid, makeHistory(oppPuuid, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW);
    });

    const lobby = makeLobby([forcerProfile, ...otherProfiles]);
    const scoredCandidates = scoreHomeCandidates(playbooks, {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      lobby,
    });
    const candidate = scoredCandidates.find((c) => c.playbook.id === targetPlaybook.id)!;

    // Under the new model:
    // 1. Contest state must NOT be Low (it was previously Low)
    expect(candidate.contest.state).not.toBe('Low');
    expect(['Medium', 'High']).toContain(candidate.contest.state);

    // 2. Route evidence must be present
    expect(candidate.contest.routeEvidence).not.toBeNull();
    expect(candidate.contest.routeEvidence?.opponentsWithRouteMatch).toBe(1);

    // 3. Lobby adjustment should not give a large positive bonus (it was +0.9)
    // The elevated contest now drives a penalty (<= 0)
    expect(candidate.home?.lobbyAdjustment).toBeLessThanOrEqual(0);
  });

  it('11. Safe-fallback: empty/missing historical boards cleanly falls back to unit contest', () => {
    const legacyProfile: OpponentProfile = {
      puuid: 'legacy-opp',
      generatedAt: NOW,
      sourceMatchIds: [],
      set: 18,
      patch: '18.1',
      derivationVersion: 'legacy',
      relevantGames: 0,
      effectiveSample: 0,
      unitEvidence: [],
      unitFrequency: {},
      traitFrequency: {},
      augmentFrequency: {},
      placement: { games: 0, average: null, topFourRate: null },
      patchRelevance: { status: 'unavailable', comparableGames: 0, samePatchGames: null, note: '' },
      unresolvedIds: { units: [], items: [], traits: [], augments: [] },
      repeatedUnitCandidates: [],
      freshness: 'fresh',
      classification: { family: 'unavailable', style: 'unavailable', note: '' },
      confidenceFactors: { sampleCoverage: 0, recencyQuality: 0, modeQuality: 0, patchQuality: null },
      confidence: 0,
    };

    const lobby = makeLobby([legacyProfile]);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeContest).toBe(0);
    expect(contest.routeEvidence).toBeNull();
  });

  it('12. Evidence structure correctness: CandidateRouteEvidence meets exact schema', () => {
    const forcerMatches = makeHistory('opp-schema', Array(20).fill(candidateUnits));
    const forcerProfile = deriveOpponent('opp-schema', forcerMatches, 18, '18.1', NOW);
    const lobby = makeLobby([forcerProfile]);

    const contest = candidateContestFor(targetPlaybook, lobby);
    const evidence = contest.routeEvidence;

    expect(evidence).toBeDefined();
    expect(evidence).not.toBeNull();
    expect(typeof evidence!.routeContest).toBe('number');
    expect(typeof evidence!.opponentsWithRouteMatch).toBe('number');
    expect(Array.isArray(evidence!.matchingOpponents)).toBe(true);
    expect(typeof evidence!.summary).toBe('string');

    const firstOpp = evidence!.matchingOpponents[0];
    expect(firstOpp.puuid).toBe('opp-schema');
    expect(typeof firstOpp.confidence).toBe('number');
    expect(typeof firstOpp.routeOverlap).toBe('number');
    expect(typeof firstOpp.stronglyMatchingBoards).toBe('number');
    expect(typeof firstOpp.recentFiveStrongMatches).toBe('number');
    expect(typeof firstOpp.recentWindowGames).toBe('number');
    expect(typeof firstOpp.totalBoards).toBe('number');
    expect(firstOpp.totalBoards).toBe(20);
    expect(firstOpp.stronglyMatchingBoards).toBe(20);
  });

  it('13. 4/5 + 3/5 recent specialists: saturating union produces High route contest', () => {
    const opp1 = deriveOpponent(
      'opp-4of5',
      makeHistory('opp-4of5', [
        ...Array(4).fill(candidateUnits),
        unrelatedUnits,
        ...Array(15).fill(unrelatedUnits),
      ]),
      18,
      '18.1',
      NOW,
    );
    const opp2 = deriveOpponent(
      'opp-3of5',
      makeHistory('opp-3of5', [
        ...Array(3).fill(candidateUnits),
        ...Array(2).fill(unrelatedUnits),
        ...Array(15).fill(unrelatedUnits),
      ]),
      18,
      '18.1',
      NOW,
    );
    const others = Array.from({ length: 5 }, (_, i) =>
      deriveOpponent(`opp-unr-${i}`, makeHistory(`opp-unr-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );

    const lobby = makeLobby([opp1, opp2, ...others]);
    const contest = candidateContestFor(targetPlaybook, lobby);

    // Saturating union: raw ~ 0.6936, with elasticity 0.8 => routeContest ~ 0.5549 (High)
    expect(contest.routeContest).toBeGreaterThanOrEqual(0.5);
    expect(contest.state).toBe('High');
    expect(contest.value).toBeGreaterThanOrEqual(0.55);
  });

  it('14. Monotonicity: two route specialists produce strictly higher route contest than one specialist', () => {
    const opp1 = deriveOpponent(
      'opp-4of5',
      makeHistory('opp-4of5', [
        ...Array(4).fill(candidateUnits),
        unrelatedUnits,
        ...Array(15).fill(unrelatedUnits),
      ]),
      18,
      '18.1',
      NOW,
    );
    const opp2 = deriveOpponent(
      'opp-3of5',
      makeHistory('opp-3of5', [
        ...Array(3).fill(candidateUnits),
        ...Array(2).fill(unrelatedUnits),
        ...Array(15).fill(unrelatedUnits),
      ]),
      18,
      '18.1',
      NOW,
    );
    const others = Array.from({ length: 5 }, (_, i) =>
      deriveOpponent(`opp-unr-${i}`, makeHistory(`opp-unr-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );

    const lobbySingle = makeLobby([opp1, ...others, deriveOpponent('opp-unr-5', makeHistory('opp-unr-5', Array(20).fill(unrelatedUnits)), 18, '18.1', NOW)]);
    const lobbyDual = makeLobby([opp1, opp2, ...others]);

    const contestSingle = candidateContestFor(targetPlaybook, lobbySingle);
    const contestDual = candidateContestFor(targetPlaybook, lobbyDual);

    expect(contestDual.routeContest!).toBeGreaterThan(contestSingle.routeContest!);
    expect(contestDual.value!).toBeGreaterThan(contestSingle.value!);
  });

  it('15. Unit-only pressure works independently when route overlap is zero', () => {
    // 6 opponents each play 1 distinct candidate core unit across unrelated comps (0 route overlap)
    const unitOnlyProfiles = targetPlaybook.family.core.map((coreUnit, idx) =>
      deriveOpponent(`opp-core-${idx}`, makeHistory(`opp-core-${idx}`, Array(20).fill([coreUnit, ...unrelatedUnits.slice(0, 6)])), 18, '18.1', NOW),
    );
    while (unitOnlyProfiles.length < 7) {
      const idx = unitOnlyProfiles.length;
      unitOnlyProfiles.push(deriveOpponent(`opp-unr-${idx}`, makeHistory(`opp-unr-${idx}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW));
    }

    const lobby = makeLobby(unitOnlyProfiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.routeContest).toBe(0);
    expect(contest.routeEvidence).toBeNull();
    expect(contest.unitContest).toBeGreaterThan(0.1);
    expect(contest.value).toBe(contest.unitContest);
  });

  it('16. Low-sample 4/5 strong overlap never produces a positive clean bonus', () => {
    // Opponent has 4/5 matching boards with only 5 games total (low sample)
    const lowSampleForcer = deriveOpponent(
      'opp-5g',
      makeHistory('opp-5g', [
        ...Array(4).fill(candidateUnits),
        unrelatedUnits,
      ]),
      18,
      '18.1',
      NOW,
    );
    const others = Array.from({ length: 6 }, (_, i) =>
      deriveOpponent(`opp-unr-${i}`, makeHistory(`opp-unr-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );

    const lobby = makeLobby([lowSampleForcer, ...others]);
    const scoredCandidates = scoreHomeCandidates(playbooks, {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      lobby,
    });
    const candidate = scoredCandidates.find((c) => c.playbook.id === targetPlaybook.id)!;

    // Must NEVER invert into a positive clean-lobby bonus
    expect(candidate.home?.lobbyAdjustment).toBeLessThanOrEqual(0);
  });

  it('17. 7/7 complete lobby evidence produces near-full (1.0) Home coverage', () => {
    const fullProfiles = Array.from({ length: 7 }, (_, i) =>
      deriveOpponent(`opp-${i}`, makeHistory(`opp-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );
    const lobby = makeLobby(fullProfiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    // 7/7 full 20-game sample coverage produces 1.0 (not decayed to 0.5962)
    expect(contest.evidenceCoverage).toBeCloseTo(1.0, 4);
  });

  it('18. Partial lobby coverage scales proportionally and remains strictly bounded', () => {
    // 5 opponents with full 20 games, 2 missing
    const partialProfiles = Array.from({ length: 5 }, (_, i) =>
      deriveOpponent(`opp-${i}`, makeHistory(`opp-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );
    const lobby = makeLobby(partialProfiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    expect(contest.evidenceCoverage).toBeCloseTo(5 / 7, 2);
    expect(contest.evidenceCoverage).toBeGreaterThan(0);
    expect(contest.evidenceCoverage).toBeLessThan(1.0);
  });

  it('19. No double confidence attenuation: sample completeness separates from recency decay', () => {
    const fullProfiles = Array.from({ length: 7 }, (_, i) =>
      deriveOpponent(`opp-${i}`, makeHistory(`opp-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );
    // Profile confidence incorporates recencyQuality (< 0.60)
    expect(fullProfiles[0].confidence).toBeLessThan(0.65);

    const lobby = makeLobby(fullProfiles);
    const contest = candidateContestFor(targetPlaybook, lobby);

    // But Home evidenceCoverage reflects full 1.00 sample completeness
    expect(contest.evidenceCoverage).toBe(1.0);
  });

  it('20. Deterministic output: repeatedly evaluates to exact identical values', () => {
    const forcer = deriveOpponent('opp-forcer', makeHistory('opp-forcer', Array(20).fill(candidateUnits)), 18, '18.1', NOW);
    const others = Array.from({ length: 6 }, (_, i) =>
      deriveOpponent(`opp-${i}`, makeHistory(`opp-${i}`, Array(20).fill(unrelatedUnits)), 18, '18.1', NOW),
    );
    const lobby = makeLobby([forcer, ...others]);

    const run1 = candidateContestFor(targetPlaybook, lobby);
    const run2 = candidateContestFor(targetPlaybook, lobby);

    expect(run1.routeContest).toBe(run2.routeContest);
    expect(run1.unitContest).toBe(run2.unitContest);
    expect(run1.value).toBe(run2.value);
    expect(run1.evidenceCoverage).toBe(run2.evidenceCoverage);
  });
});
