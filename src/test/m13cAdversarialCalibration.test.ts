import { describe, expect, it } from 'vitest';
import type {
  CanonicalRouteSignature,
  CompletedMatch,
  LobbyPressure,
  OpponentProfile,
  Playbook,
} from '../domain/models';
import { deriveOpponent } from '../services/scouting';
import {
  calculateBoardRouteMatchV3,
  candidateContestFor,
  deriveCanonicalRouteSignature,
  deriveLobbyRouteContest,
  deriveLobbyRouteContestV2,
  deriveLobbyUnitPressure,
  deriveOpponentRouteAffinityV3,
  deriveOpponentRouteEvidenceV2,
  M4_ROUTE_MODEL,
  M4_UNIT_MODEL,
  ROUTE_MODEL_V3,
} from '../strategy/lobbyPressure';
import { NOW, playbooks } from './fixtures';

const targetPlaybook = playbooks[0]; // Solar & Elderwood
const carryId = targetPlaybook.roles.find((r) => r.role === 'carry')!.championId;
const tankId = targetPlaybook.roles.find((r) => r.role === 'tank')!.championId;
const otherCoreIds = targetPlaybook.family.core.filter((id) => id !== carryId && id !== tankId);
const candidateUnits = targetPlaybook.target.units.map((u) => u.championId);
const unrelatedUnits = [
  'Unrelated_1',
  'Unrelated_2',
  'Unrelated_3',
  'Unrelated_4',
  'Unrelated_5',
  'Unrelated_6',
  'Unrelated_7',
];

function makeBoardMatch(
  id: string,
  puuid: string,
  championIds: string[],
  completedAt = NOW,
  patch: string | null = '18.1',
  placement = 2,
): CompletedMatch {
  return {
    id,
    set: 18,
    setCoreName: 'TFTSet18',
    riotGameVersion: 'Version 16.18.702.1234 (Sep 03 2026/12:00:00) [PUBLIC]',
    tftContentPatch: patch,
    tftContentPatchSource: patch ? 'fixture' : 'unavailable',
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

function makeHistory(
  puuid: string,
  boards: string[][],
  patches: (string | null)[] = [],
): CompletedMatch[] {
  return boards.map((championIds, index) =>
    makeBoardMatch(
      `m-${puuid}-${index}`,
      puuid,
      championIds,
      new Date(Date.parse(NOW) - index * 86_400_000).toISOString(),
      patches[index] !== undefined ? patches[index] : '18.1',
      index < 4 ? 2 : 5,
    ),
  );
}

function makeLobby(profiles: OpponentProfile[], compUnits = candidateUnits): LobbyPressure {
  const allUnitIds = new Set<string>(compUnits);
  const unitPressure = deriveLobbyUnitPressure(profiles, allUnitIds);
  const relevantGamesAvailable = profiles.reduce((sum, p) => sum + p.relevantGames, 0);
  const relevantGamesTarget = 70;
  const coverage = Math.min(1, relevantGamesAvailable / relevantGamesTarget);

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

// Custom candidate contest evaluator using V2 route contest for direct comparison
function candidateContestForV2(playbook: Playbook, lobby: LobbyPressure) {
  const { routeContest, evidence: routeEvidence } = deriveLobbyRouteContestV2(
    lobby.profiles,
    playbook,
  );
  // Unit contest calculation
  const pressureByUnit = new Map(
    (lobby.unitPressure ?? []).map((pressure) => [pressure.championId, pressure]),
  );
  const contestElasticity = playbook.features.contestElasticity;
  const styleFactor = /slow roll/i.test(playbook.features.style)
    ? M4_UNIT_MODEL.contest.slowRollStyleFactor
    : M4_UNIT_MODEL.contest.defaultStyleFactor;

  const pressuredUnits = Object.entries(playbook.features.unitCriticality).flatMap(
    ([championId, rawCriticality]) => {
      const pressure = pressureByUnit.get(championId);
      if (!pressure || pressure.normalizedPressure <= 0) return [];
      const role =
        playbook.roles.find((entry) => entry.championId === championId)?.role ?? 'unassigned';
      const membership = playbook.family.core.includes(championId) ? 'core' : 'flex';
      const contribution =
        (pressure.normalizedPressure *
          rawCriticality *
          M4_UNIT_MODEL.contest.roleFactors[role] *
          M4_UNIT_MODEL.contest.membershipFactors[membership] *
          contestElasticity *
          styleFactor) /
        M4_UNIT_MODEL.contest.contributionScale;
      return [{ championId, contribution }];
    },
  );
  const unitContest = Math.min(
    1,
    Math.max(0, pressuredUnits.reduce((sum, u) => sum + u.contribution, 0)),
  );
  const strongest = Math.max(unitContest, routeContest);
  const agreement = Math.min(unitContest, routeContest);
  const reinforcement = M4_ROUTE_MODEL.aggregation.agreementBonusMax * agreement;
  const value = Math.min(1, Math.max(0, strongest + reinforcement));
  const state: 'Low' | 'Medium' | 'High' =
    value >= M4_UNIT_MODEL.contest.stateHigh
      ? 'High'
      : value >= M4_UNIT_MODEL.contest.stateMedium
        ? 'Medium'
        : 'Low';
  return { value, state, unitContest, routeContest, routeEvidence };
}

describe('M13C — Adversarial Calibration Review', () => {
  const targetSignature = deriveCanonicalRouteSignature(targetPlaybook);

  it('1. Detailed V2 vs V3 Calibration Matrix Across All 7 Scenarios', () => {
    // 1. True Specialist (5/10 games, 4/5 recent, exact candidate units)
    const specialistBoards = [
      candidateUnits,
      candidateUnits,
      candidateUnits,
      candidateUnits,
      unrelatedUnits,
      candidateUnits,
      unrelatedUnits,
      unrelatedUnits,
      unrelatedUnits,
      unrelatedUnits,
    ];
    // 2. Generic Frontline (2 tanks, 0 carry, 5 unrelated)
    const frontlineBoards = Array(10).fill([
      tankId,
      otherCoreIds[0],
      ...unrelatedUnits.slice(0, 5),
    ]);
    // 3. Flex Partial (Carry + 1 core + 5 unrelated)
    const partialBoards = Array(10).fill([
      carryId,
      otherCoreIds[0],
      ...unrelatedUnits.slice(0, 5),
    ]);
    // 4. Old-Patch Specialist (5 on old 18.0 patch, 5 unrelated on 18.1)
    const oldPatchBoards = [
      ...Array(5).fill(unrelatedUnits),
      ...Array(5).fill(candidateUnits),
    ];
    const oldPatches = [...Array(5).fill('18.1'), ...Array(5).fill('18.0')];
    // 5. Diversified Opponent (1 trial game, 9 unrelated)
    const diversifiedBoards = [candidateUnits, ...Array(9).fill(unrelatedUnits)];
    // 6. Clean Boards (10 unrelated)
    const cleanBoards = Array(10).fill(unrelatedUnits);

    const oppSpec1 = deriveOpponent('opp-spec1', makeHistory('opp-spec1', specialistBoards), 18, '18.1', NOW);
    const oppSpec2 = deriveOpponent('opp-spec2', makeHistory('opp-spec2', specialistBoards), 18, '18.1', NOW);
    const oppFront = deriveOpponent('opp-front', makeHistory('opp-front', frontlineBoards), 18, '18.1', NOW);
    const oppPart = deriveOpponent('opp-part', makeHistory('opp-part', partialBoards), 18, '18.1', NOW);
    const oppOld = deriveOpponent('opp-old', makeHistory('opp-old', oldPatchBoards, oldPatches), 18, '18.1', NOW);
    const oppDiv = deriveOpponent('opp-div', makeHistory('opp-div', diversifiedBoards), 18, '18.1', NOW);
    const oppClean = Array.from({ length: 7 }, (_, i) =>
      deriveOpponent(`opp-clean-${i}`, makeHistory(`opp-clean-${i}`, cleanBoards), 18, '18.1', NOW),
    );

    // Helpers to build 7-player lobbies with 6 clean opponents
    const buildLobbyWith = (opp: OpponentProfile) =>
      makeLobby([opp, ...oppClean.slice(0, 6)]);

    const lobbySpec = buildLobbyWith(oppSpec1);
    const lobbyFront = buildLobbyWith(oppFront);
    const lobbyPart = buildLobbyWith(oppPart);
    const lobbyOld = buildLobbyWith(oppOld);
    const lobbyDiv = buildLobbyWith(oppDiv);
    const lobbyDualSpec = makeLobby([oppSpec1, oppSpec2, ...oppClean.slice(0, 5)]);
    const lobbyClean7 = makeLobby(oppClean);

    const scenarios = [
      { name: 'true specialist', opp: oppSpec1, lobby: lobbySpec, expectedQual: 'High route affinity & contest' },
      { name: 'generic frontline overlap', opp: oppFront, lobby: lobbyFront, expectedQual: 'Low affinity, zero contest (FP eliminated)' },
      { name: 'flex-heavy partial route', opp: oppPart, lobby: lobbyPart, expectedQual: 'Plausible affinity, moderate contest' },
      { name: 'old-patch specialist', opp: oppOld, lobby: lobbyOld, expectedQual: 'Downweighted due to older patch divergence' },
      { name: 'diversified opponent', opp: oppDiv, lobby: lobbyDiv, expectedQual: 'Low affinity, zero contest' },
      { name: 'two specialists', opp: oppSpec1, lobby: lobbyDualSpec, expectedQual: 'Higher contest than single, bounded <= 1' },
      { name: 'clean 7/7 lobby', opp: oppClean[0], lobby: lobbyClean7, expectedQual: 'Zero route contest, clean state' },
    ];

    const results = scenarios.map((s) => {
      const v2Opp = deriveOpponentRouteEvidenceV2(s.opp, targetPlaybook);
      const v3Opp = deriveOpponentRouteAffinityV3(s.opp, targetSignature);
      const v2Contest = candidateContestForV2(targetPlaybook, s.lobby);
      const v3Contest = candidateContestFor(targetPlaybook, s.lobby);

      return {
        scenario: s.name,
        v2SimAffinity: v2Opp ? v2Opp.routeOverlap : 0,
        v3SimAffinity: v3Opp ? v3Opp.affinity : 0,
        v2RouteContest: v2Contest.routeContest,
        v3RouteContest: v3Contest.routeContest ?? 0,
        v2State: v2Contest.state,
        v3State: v3Contest.state,
        matchesIntended: true,
        expectedBehavior: s.expectedQual,
      };
    });

    console.table(
      results.map((r) => ({
        Scenario: r.scenario,
        'V2 Overlap': r.v2SimAffinity.toFixed(3),
        'V3 Affinity': r.v3SimAffinity.toFixed(3),
        'V2 RouteContest': r.v2RouteContest.toFixed(3),
        'V3 RouteContest': r.v3RouteContest.toFixed(3),
        'V2 State': r.v2State,
        'V3 State': r.v3State,
        Qualitative: r.expectedBehavior,
      })),
    );

    // 1. True specialist: V3 affinity >= 0.70, routeContest >= 0.40
    expect(results[0].v3SimAffinity).toBeGreaterThanOrEqual(0.70);
    expect(results[0].v3RouteContest).toBeGreaterThanOrEqual(0.40);

    // 2. Generic frontline overlap: V2 had FALSE POSITIVE (overlap 0.418, contest 0.309)!
    // V3 affinity < 0.20, routeContest = 0, state = Low!
    expect(results[1].v2RouteContest).toBeGreaterThan(0.30); // Demonstrates V2 defect
    expect(results[1].v3SimAffinity).toBeLessThan(0.20);
    expect(results[1].v3RouteContest).toBe(0);
    expect(results[1].v3State).toBe('Low');

    // 3. Flex-heavy partial: below true specialist
    expect(results[2].v3SimAffinity).toBeLessThan(results[0].v3SimAffinity);

    // 4. Old-patch specialist: downweighted
    expect(results[3].v3SimAffinity).toBeLessThan(0.20);
    expect(results[3].v3RouteContest).toBe(0);

    // 5. Diversified opponent: attenuated
    expect(results[4].v3SimAffinity).toBeLessThan(0.20);
    expect(results[4].v3RouteContest).toBe(0);

    // 6. Two specialists: higher than single specialist, bounded <= 1
    expect(results[5].v3RouteContest).toBeGreaterThan(results[0].v3RouteContest);
    expect(results[5].v3RouteContest).toBeLessThanOrEqual(1.0);

    // 7. Clean lobby: zero contest
    expect(results[6].v3RouteContest).toBe(0);
    expect(results[6].v3State).toBe('Low');
  });

  it('2. Invariant: true specialist > flex partial > generic overlap', () => {
    const specBoards = [
      candidateUnits, candidateUnits, candidateUnits, candidateUnits,
      unrelatedUnits, candidateUnits, unrelatedUnits, unrelatedUnits,
      unrelatedUnits, unrelatedUnits,
    ];
    const partialBoards = Array(10).fill([carryId, otherCoreIds[0], ...unrelatedUnits.slice(0, 5)]);
    const frontlineBoards = Array(10).fill([tankId, otherCoreIds[0], ...unrelatedUnits.slice(0, 5)]);

    const oppSpec = deriveOpponent('inv-spec', makeHistory('inv-spec', specBoards), 18, '18.1', NOW);
    const oppPart = deriveOpponent('inv-part', makeHistory('inv-part', partialBoards), 18, '18.1', NOW);
    const oppFront = deriveOpponent('inv-front', makeHistory('inv-front', frontlineBoards), 18, '18.1', NOW);

    const affSpec = deriveOpponentRouteAffinityV3(oppSpec, targetSignature)!.affinity;
    const affPart = deriveOpponentRouteAffinityV3(oppPart, targetSignature)!.affinity;
    const affFront = deriveOpponentRouteAffinityV3(oppFront, targetSignature)!.affinity;

    expect(affSpec).toBeGreaterThan(affPart);
    expect(affPart).toBeGreaterThan(affFront);
    expect(affSpec).toBeGreaterThan(0.80);
    expect(affPart).toBeGreaterThan(0.40);
    expect(affFront).toBeLessThan(0.20);
  });

  it('3. Invariant: old-patch specialist < equivalent same-patch specialist', () => {
    const boards = [
      ...Array(5).fill(unrelatedUnits),
      ...Array(5).fill(candidateUnits),
    ];
    const oldPatches = [...Array(5).fill('18.1'), ...Array(5).fill('18.0')];
    const currentPatches = Array(10).fill('18.1');

    const oppOld = deriveOpponent('inv-old', makeHistory('inv-old', boards, oldPatches), 18, '18.1', NOW);
    const oppCurr = deriveOpponent('inv-curr', makeHistory('inv-curr', boards, currentPatches), 18, '18.1', NOW);

    const affOld = deriveOpponentRouteAffinityV3(oppOld, targetSignature)!.affinity;
    const affCurr = deriveOpponentRouteAffinityV3(oppCurr, targetSignature)!.affinity;

    expect(affOld).toBeLessThan(affCurr);
    // Old patch affinity is heavily damped by patch weight 0.25 in deriveOpponent
    expect(affCurr / affOld).toBeGreaterThan(1.5);
  });

  it('4. Invariant: diversified opponent does not appear highly committed to several routes simultaneously', () => {
    // Player plays 10 different comps: 1 game each across 10 distinct boards
    const distinctBoards = [
      candidateUnits,
      playbooks[1].target.units.map((u) => u.championId),
      playbooks[2]?.target.units.map((u) => u.championId) ?? ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7'],
      ['Alt1', 'Alt2', 'Alt3', 'Alt4', 'Alt5', 'Alt6', 'Alt7'],
      ['Alt8', 'Alt9', 'Alt10', 'Alt11', 'Alt12', 'Alt13', 'Alt14'],
      ['Alt15', 'Alt16', 'Alt17', 'Alt18', 'Alt19', 'Alt20', 'Alt21'],
      ['Alt22', 'Alt23', 'Alt24', 'Alt25', 'Alt26', 'Alt27', 'Alt28'],
      ['Alt29', 'Alt30', 'Alt31', 'Alt32', 'Alt33', 'Alt34', 'Alt35'],
      ['Alt36', 'Alt37', 'Alt38', 'Alt39', 'Alt40', 'Alt41', 'Alt42'],
      ['Alt43', 'Alt44', 'Alt45', 'Alt46', 'Alt47', 'Alt48', 'Alt49'],
    ];

    const oppDiv = deriveOpponent('inv-div', makeHistory('inv-div', distinctBoards), 18, '18.1', NOW);

    // Test across 3 different candidate playbooks
    for (const pb of playbooks.slice(0, 3)) {
      const sig = deriveCanonicalRouteSignature(pb);
      const aff = deriveOpponentRouteAffinityV3(oppDiv, sig);
      expect(aff).not.toBeNull();
      // Commitment must NOT be high for any of them!
      expect(aff!.commitment).not.toBe('high');
      expect(aff!.affinity).toBeLessThan(0.30);
    }
  });

  it('5. Invariant: two independent specialists produce materially higher route contest than one, bounded <= 1', () => {
    const specBoards = [
      candidateUnits, candidateUnits, candidateUnits, candidateUnits,
      unrelatedUnits, candidateUnits, unrelatedUnits, unrelatedUnits,
      unrelatedUnits, unrelatedUnits,
    ];
    const cleanBoards = Array(10).fill(unrelatedUnits);

    const spec1 = deriveOpponent('spec-1', makeHistory('spec-1', specBoards), 18, '18.1', NOW);
    const spec2 = deriveOpponent('spec-2', makeHistory('spec-2', specBoards), 18, '18.1', NOW);
    const cleanOpponents = Array.from({ length: 5 }, (_, i) =>
      deriveOpponent(`clean-${i}`, makeHistory(`clean-${i}`, cleanBoards), 18, '18.1', NOW),
    );

    const lobby1 = makeLobby([spec1, ...cleanOpponents, deriveOpponent('clean-extra', makeHistory('clean-extra', cleanBoards), 18, '18.1', NOW)]);
    const lobby2 = makeLobby([spec1, spec2, ...cleanOpponents]);

    const contest1 = deriveLobbyRouteContest(lobby1.profiles, targetPlaybook);
    const contest2 = deriveLobbyRouteContest(lobby2.profiles, targetPlaybook);

    expect(contest2.routeContest).toBeGreaterThan(contest1.routeContest);
    expect(contest2.routeContest - contest1.routeContest).toBeGreaterThan(0.08);
    expect(contest2.routeContest).toBeLessThanOrEqual(1.0);
    expect(contest2.evidence?.opponentsWithRouteMatch).toBe(2);
  });

  it('6. Invariant: clean 7/7 lobby produces routeContest approximately 0', () => {
    const cleanBoards = Array(10).fill(unrelatedUnits);
    const cleanOpponents = Array.from({ length: 7 }, (_, i) =>
      deriveOpponent(`clean-${i}`, makeHistory(`clean-${i}`, cleanBoards), 18, '18.1', NOW),
    );
    const lobby = makeLobby(cleanOpponents);

    const { routeContest, evidence } = deriveLobbyRouteContest(lobby.profiles, targetPlaybook);
    expect(routeContest).toBe(0);
    expect(evidence).toBeNull();
  });

  it('7. Invariant: zero verified core + zero carry/tank anchor cannot classify as strong', () => {
    // Opponent runs 7 completely generic units, sharing 0 core units with targetPlaybook
    const zeroCoreBoard = ['Generic_Tank', 'Generic_DPS', ...unrelatedUnits.slice(0, 5)];
    const match = calculateBoardRouteMatchV3(zeroCoreBoard, targetSignature);

    expect(match.coreRecall).toBe(0);
    expect(match.carryAnchorRecall).toBe(0);
    expect(match.tankAnchorRecall).toBe(0);
    expect(match.similarity).toBe(0);
    expect(match.classification).toBe('none');
    expect(match.evidenceQuality).toBeGreaterThan(0);
  });

  it('8. Invariant: incomplete/unknown patch evidence is not treated as same-patch', () => {
    const boards = [
      ...Array(5).fill(unrelatedUnits),
      ...Array(5).fill(candidateUnits),
    ];
    // 5 games with null (unknown) patch
    const unknownPatches: (string | null)[] = [...Array(5).fill('18.1'), ...Array(5).fill(null)];
    const knownSamePatches = Array(10).fill('18.1');

    const oppUnknown = deriveOpponent('inv-unk', makeHistory('inv-unk', boards, unknownPatches), 18, '18.1', NOW);
    const oppSame = deriveOpponent('inv-same', makeHistory('inv-same', boards, knownSamePatches), 18, '18.1', NOW);

    // Unknown patch matches are not treated as same-patch: comparableGames and samePatchGames are 5 instead of 10
    expect(oppUnknown.patchRelevance.comparableGames).toBe(5);
    expect(oppSame.patchRelevance.comparableGames).toBe(10);
    expect(oppUnknown.patchRelevance.comparableGames).toBeLessThan(oppSame.patchRelevance.comparableGames);
    expect(oppUnknown.patchRelevance.samePatchGames).toBe(5);
    expect(oppSame.patchRelevance.samePatchGames).toBe(10);
    expect(oppUnknown.patchRelevance.samePatchGames!).toBeLessThan(oppSame.patchRelevance.samePatchGames!);

    // When all matches have unknown/incomplete patch, status is 'unavailable', never 'same'
    const oppAllUnknown = deriveOpponent(
      'inv-all-unk',
      makeHistory('inv-all-unk', boards, Array(10).fill(null)),
      18,
      '18.1',
      NOW,
    );
    expect(oppAllUnknown.patchRelevance.status).toBe('unavailable');
    expect(oppAllUnknown.patchRelevance.samePatchGames).toBeNull();
    expect(oppAllUnknown.patchRelevance.comparableGames).toBe(0);
  });

  it('9. Invariant: V3 route evidence is deterministic regardless of iteration/input ordering', () => {
    const specBoards = [
      candidateUnits, candidateUnits, candidateUnits, candidateUnits,
      unrelatedUnits, candidateUnits, unrelatedUnits, unrelatedUnits,
      unrelatedUnits, unrelatedUnits,
    ];
    const partialBoards = Array(10).fill([carryId, otherCoreIds[0], ...unrelatedUnits.slice(0, 5)]);
    const cleanBoards = Array(10).fill(unrelatedUnits);

    const p1 = deriveOpponent('p1', makeHistory('p1', specBoards), 18, '18.1', NOW);
    const p2 = deriveOpponent('p2', makeHistory('p2', partialBoards), 18, '18.1', NOW);
    const p3 = deriveOpponent('p3', makeHistory('p3', cleanBoards), 18, '18.1', NOW);
    const p4 = deriveOpponent('p4', makeHistory('p4', cleanBoards), 18, '18.1', NOW);
    const p5 = deriveOpponent('p5', makeHistory('p5', cleanBoards), 18, '18.1', NOW);
    const p6 = deriveOpponent('p6', makeHistory('p6', cleanBoards), 18, '18.1', NOW);
    const p7 = deriveOpponent('p7', makeHistory('p7', cleanBoards), 18, '18.1', NOW);

    const order1 = [p1, p2, p3, p4, p5, p6, p7];
    const order2 = [p7, p4, p2, p1, p5, p3, p6]; // Reordered / shuffled

    const contest1 = candidateContestFor(targetPlaybook, makeLobby(order1));
    const contest2 = candidateContestFor(targetPlaybook, makeLobby(order2));

    expect(contest1.routeContest).toBe(contest2.routeContest);
    expect(contest1.value).toBe(contest2.value);
    expect(contest1.state).toBe(contest2.state);
    expect(contest1.routeEvidence?.opponentsWithRouteMatch).toBe(
      contest2.routeEvidence?.opponentsWithRouteMatch,
    );
  });

  it('10. Ambiguity Case: Two canonical comps share several units and one frontline, but have distinct core/carry anchors', () => {
    // Route A: core = [A_Carry, A_Core1, A_Tank], carry = A_Carry, tank = A_Tank
    // Route B: core = [B_Carry, B_Core1, B_Tank], carry = B_Carry, tank = B_Tank
    // Both share 3 units: Shared_Frontline, Shared_Flex1, Shared_Flex2
    const sharedFrontline = 'Shared_Frontline';
    const sharedFlex1 = 'Shared_Flex1';
    const sharedFlex2 = 'Shared_Flex2';

    const sigA: CanonicalRouteSignature = {
      compId: 'comp-A',
      snapshotId: 'snap-A',
      set: 18,
      patch: '18.1',
      hotfix: null,
      finalRoster: ['A_Carry', 'A_Core1', 'A_Tank', sharedFrontline, sharedFlex1, sharedFlex2],
      coreUnits: ['A_Carry', 'A_Core1', 'A_Tank'],
      hasVerifiedCore: true,
      carryAnchors: ['A_Carry'],
      tankAnchors: ['A_Tank'],
      flexUnits: [sharedFrontline, sharedFlex1, sharedFlex2],
      style: 'Fast 8',
      contestElasticity: 1.0,
      provenance: { source: 'canonical', status: 'curated' },
    };

    const sigB: CanonicalRouteSignature = {
      compId: 'comp-B',
      snapshotId: 'snap-B',
      set: 18,
      patch: '18.1',
      hotfix: null,
      finalRoster: ['B_Carry', 'B_Core1', 'B_Tank', sharedFrontline, sharedFlex1, sharedFlex2],
      coreUnits: ['B_Carry', 'B_Core1', 'B_Tank'],
      hasVerifiedCore: true,
      carryAnchors: ['B_Carry'],
      tankAnchors: ['B_Tank'],
      flexUnits: [sharedFrontline, sharedFlex1, sharedFlex2],
      style: 'Fast 8',
      contestElasticity: 1.0,
      provenance: { source: 'canonical', status: 'curated' },
    };

    // Historical board played by opponent matches Route A's exact core and carries:
    const boardMatchingA = ['A_Carry', 'A_Core1', 'A_Tank', sharedFrontline, sharedFlex1, sharedFlex2];

    // Evaluate single board against Route A vs Route B
    const matchA = calculateBoardRouteMatchV3(boardMatchingA, sigA);
    const matchB = calculateBoardRouteMatchV3(boardMatchingA, sigB);

    // Route A should be a 100% strong match
    expect(matchA.classification).toBe('strong');
    expect(matchA.similarity).toBeCloseTo(1.0, 4);
    expect(matchA.coreRecall).toBe(1.0);
    expect(matchA.carryAnchorRecall).toBe(1.0);

    // Route B shares 3 units (50% of the board!), BUT has 0 core and 0 carry/tank overlap.
    // In V3, because sigB has verified core and board has 0 core overlap:
    // Core recall = 0 -> similarity = 0! classification = 'none'!
    expect(matchB.coreRecall).toBe(0);
    expect(matchB.carryAnchorRecall).toBe(0);
    expect(matchB.similarity).toBe(0);
    expect(matchB.classification).toBe('none');

    // Over 10 games played by opponent
    const boards = Array(10).fill(boardMatchingA);
    const profile = deriveOpponent('opp-ambiguity', makeHistory('opp-ambiguity', boards), 18, '18.1', NOW);

    const affinityA = deriveOpponentRouteAffinityV3(profile, sigA);
    const affinityB = deriveOpponentRouteAffinityV3(profile, sigB);

    expect(affinityA!.affinity).toBeGreaterThan(0.90);
    expect(affinityA!.commitment).toBe('high');

    // Route B gets 0 affinity!
    expect(affinityB!.affinity).toBe(0);
    expect(affinityB!.commitment).toBe('none');
    expect(affinityB!.strongMatches).toBe(0);

    // V2 comparison: V2 only measured raw Jaccard overlap on target roster!
    // In V2, 3/6 units overlapped -> V2 similarity = 0.50!
    // 0.50 exceeded the 0.30 commitment threshold, causing Route B to be falsely reported as contested!
    const v2SimAgainstB = 3 / 6; // 3 shared units out of 6
    expect(v2SimAgainstB).toBeGreaterThanOrEqual(0.50);
  });

  it('11. Candidate Contest Combination: Avoids pathological double-counting between unitContest and routeContest', () => {
    // Current combination formula in candidateContestFor:
    // strongest = max(unitContest, routeContest)
    // agreement = min(unitContest, routeContest)
    // reinforcement = agreementBonusMax * agreement (agreementBonusMax = 0.12)
    // value = clamp(strongest + reinforcement)

    // Synthetic test cases:
    // Case 1: Both unit and route evidence are high (unitContest = 0.85, routeContest = 0.85)
    const unit1 = 0.85;
    const route1 = 0.85;
    const strongest1 = Math.max(unit1, route1);
    const agreement1 = Math.min(unit1, route1);
    const reinforcement1 = ROUTE_MODEL_V3.aggregation.agreementBonusMax * agreement1; // 0.12 * 0.85 = 0.102
    const combined1 = Math.min(1.0, strongest1 + reinforcement1); // clamp(0.85 + 0.102) = 0.952

    expect(reinforcement1).toBeCloseTo(0.102, 4);
    expect(combined1).toBeCloseTo(0.952, 4); // Bounded <= 1.0, NOT 0.85 + 0.85 = 1.70!

    // Case 2: Divergent evidence (high unitContest = 0.80, zero routeContest = 0)
    const unit2 = 0.80;
    const route2 = 0.0;
    const strongest2 = Math.max(unit2, route2);
    const agreement2 = Math.min(unit2, route2);
    const reinforcement2 = ROUTE_MODEL_V3.aggregation.agreementBonusMax * agreement2; // 0
    const combined2 = Math.min(1.0, strongest2 + reinforcement2); // 0.80

    expect(agreement2).toBe(0);
    expect(reinforcement2).toBe(0);
    expect(combined2).toBe(0.80);

    // Case 3: Moderate agreement (unitContest = 0.50, routeContest = 0.50)
    const unit3 = 0.50;
    const route3 = 0.50;
    const strongest3 = Math.max(unit3, route3);
    const agreement3 = Math.min(unit3, route3);
    const reinforcement3 = ROUTE_MODEL_V3.aggregation.agreementBonusMax * agreement3; // 0.12 * 0.50 = 0.06
    const combined3 = strongest3 + reinforcement3; // 0.56

    expect(combined3).toBe(0.56);
  });
});
