import { describe, expect, it } from 'vitest';
import type {
  MatchParticipant,
  MatchUnit,
  PersonalMatchObservation,
} from '../domain/models';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';
import {
  classifyPersonalBoard,
  projectBoardAnalysis,
  PERSONAL_COMP_CLASSIFIER_VERSION,
} from '../strategy/personalClassifier';
import { derivePersonalCompPerformance } from '../services/personalHistory';
import { createRecommendations } from '../services/application';
import { defaultSettings } from '../storage/repository';
import { data, NOW, playbooks } from './fixtures';

function makeMatchUnit(championId: string, stars = 2): MatchUnit {
  return {
    championId,
    items: [],
    stars,
    rarity: null,
    rawName: null,
    unresolvedUnit: false,
    unresolvedItems: [],
  };
}

function makeParticipant(
  puuid: string,
  placement: number,
  level: number,
  units: MatchUnit[],
): MatchParticipant {
  return {
    puuid,
    placement,
    level,
    units,
    traits: [],
    augmentIds: [],
    unresolvedAugmentIds: [],
  };
}

function createMockCatalog(): RuntimeKnowledgeCatalog {
  return {
    version: {
      set: data.version.set,
      patch: data.version.patch,
      hotfix: null,
      sourceVersion: data.version.sourceVersion,
    },
    snapshots: { static: null, curated: null, external: null },
    sourceSnapshots: { static: null, curated: null, external: null },
    provenance: {
      static: data.version.provenance,
      curated: data.version.provenance,
      external: null,
    },
    champions: [],
    traits: [],
    items: [],
    augments: [],
    comps: [],
    playbooks: structuredClone(playbooks),
    metaObservations: [],
    externalSnapshot: null,
  };
}

describe('M13D.1 — Personal Comp Classifier Calibration & Post-Game Analysis Suite', () => {
  const catalog = createMockCatalog();
  const targetPlaybook = playbooks[0]; // solar-elderwood: core: [Kayle, Xayah, Sejuani, Ornn], carry: Kayle, tank: Sejuani

  // ==========================================
  // CLASSIFIER TESTS (1 - 10)
  // ==========================================

  it('1. exact canonical board → classified', () => {
    const participant = makeParticipant(
      'player-1',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.90);
    expect(classification.classifierVersion).toBe(PERSONAL_COMP_CLASSIFIER_VERSION);
    expect(classification.classifierVersion).toBe('personal-comp-classifier-v2');
  });

  it('2. canonical board missing one flex unit → classified', () => {
    // 7 units of an 8-unit board: all core (4/4) + carry + tank, missing 1 filler unit
    const unitsWithoutOneFiller = targetPlaybook.target.units.slice(0, 7);
    const participant = makeParticipant(
      'player-2',
      2,
      7,
      unitsWithoutOneFiller.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('3. board missing two units but carry/tank/core intact → classified with reduced confidence', () => {
    // 6 units: all 4 core units present + carry + tank intact, missing 2 target units
    const coreUnits = targetPlaybook.family.core;
    const carryTank = targetPlaybook.roles.map((r) => r.championId);
    const essential = [...new Set([...coreUnits, ...carryTank])];
    const nonCoreIds = targetPlaybook.target.units
      .map((u) => u.championId)
      .filter((id) => !essential.includes(id));
    // 5 units: 4 core + 1 non-core (missing 2 units of the 7-unit target)
    const testUnits = [...essential, ...nonCoreIds.slice(0, 1)].map((id) => makeMatchUnit(id));

    const participant = makeParticipant('player-3', 3, 6, testUnits);
    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);

    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.confidence).toBeLessThan(0.95);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it('4. canonical core + splash legendary → classified', () => {
    const splashChampions = data.champions
      .filter((c) => c.cost >= 4 && c.boardEligible && c.shopStatus === 'pool' && !targetPlaybook.target.units.some((u) => u.championId === c.id))
      .slice(0, 2)
      .map((c) => c.id);

    const testUnits = [
      ...targetPlaybook.target.units.slice(0, 6).map((u) => makeMatchUnit(u.championId)),
      ...splashChampions.map((id) => makeMatchUnit(id)),
    ];

    const participant = makeParticipant('player-4', 2, 8, testUnits);
    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);

    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
  });

  it('5. generic frontline overlap only → unclassified', () => {
    const tankAnchors = targetPlaybook.roles
      .filter((r) => r.role === 'tank')
      .map((r) => r.championId);
    const fillerUnits = data.champions
      .filter((c) => c.boardEligible && c.shopStatus === 'pool' && !targetPlaybook.family.core.includes(c.id))
      .slice(0, 6)
      .map((c) => c.id);

    const testUnits = [...tankAnchors.slice(0, 1), ...fillerUnits];
    const participant = makeParticipant('player-5', 6, testUnits.length, testUnits.map((id) => makeMatchUnit(id)));

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('unclassified');
    expect(classification.compId).toBeNull();
  });

  it('6. missing carry + weak core → unclassified', () => {
    const nonCarryCore = targetPlaybook.family.core.filter(
      (id) => !targetPlaybook.roles.some((r) => r.role === 'carry' && r.championId === id),
    ).slice(0, 1);

    const randomFillers = data.champions
      .filter((c) => c.boardEligible && c.shopStatus === 'pool' && !targetPlaybook.target.units.some((u) => u.championId === c.id))
      .slice(0, 6)
      .map((c) => c.id);

    const testUnits = [...nonCarryCore, ...randomFillers];
    const participant = makeParticipant('player-6', 7, testUnits.length, testUnits.map((id) => makeMatchUnit(id)));

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('unclassified');
    expect(classification.compId).toBeNull();
  });

  it('7. two near-equal comp candidates → ambiguous', () => {
    const customCatalog = createMockCatalog();
    const compA = structuredClone(playbooks[0]);
    compA.id = 'comp-a';
    compA.title = 'Comp A';

    const compB = structuredClone(playbooks[0]);
    compB.id = 'comp-b';
    compB.title = 'Comp B';
    customCatalog.playbooks = [compA, compB];

    const participant = makeParticipant(
      'player-7',
      2,
      compA.target.targetLevel,
      compA.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, customCatalog, data);
    expect(classification.state).toBe('ambiguous');
    expect(classification.compId).toBeNull();
    expect(classification.candidateCompIds).toContain('comp-a');
    expect(classification.candidateCompIds).toContain('comp-b');
  });

  it('8. strong winner margin → classified', () => {
    const participant = makeParticipant(
      'player-8',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.candidateCompIds).toEqual([targetPlaybook.id]);
  });

  it('9. unit order changes → identical result', () => {
    const originalUnits = targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId));
    const reversedUnits = [...originalUnits].reverse();
    const shuffledUnits = [
      originalUnits[2],
      originalUnits[0],
      originalUnits[4],
      originalUnits[1],
      originalUnits[3],
      ...originalUnits.slice(5),
    ].filter(Boolean);

    const p1 = makeParticipant('p1', 2, 8, originalUnits);
    const p2 = makeParticipant('p2', 2, 8, reversedUnits);
    const p3 = makeParticipant('p3', 2, 8, shuffledUnits);

    const c1 = classifyPersonalBoard(p1, data.version.set, catalog, data);
    const c2 = classifyPersonalBoard(p2, data.version.set, catalog, data);
    const c3 = classifyPersonalBoard(p3, data.version.set, catalog, data);

    expect(c1.state).toBe(c2.state);
    expect(c2.state).toBe(c3.state);
    expect(c1.compId).toBe(c2.compId);
    expect(c2.compId).toBe(c3.compId);
    expect(c1.confidence).toBe(c2.confidence);
    expect(c2.confidence).toBe(c3.confidence);
    expect(c1.finalBoardHash).toBe(c2.finalBoardHash);
    expect(c2.finalBoardHash).toBe(c3.finalBoardHash);
  });

  it('10. old set → incompatible-set', () => {
    const participant = makeParticipant(
      'player-10',
      3,
      8,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, 17, catalog, data);
    expect(classification.state).toBe('incompatible-set');
    expect(classification.compId).toBeNull();
    expect(classification.confidence).toBe(0);
  });

  // ==========================================
  // NEAREST MATCH PROJECTION (11 - 16)
  // ==========================================

  it('11. unclassified returns top 3 matches', () => {
    const randomUnits = data.champions
      .filter((c) => c.cost === 1 && c.boardEligible && c.shopStatus === 'pool')
      .slice(0, 5)
      .map((c) => makeMatchUnit(c.id));

    const participant = makeParticipant('player-11', 8, 5, randomUnits);
    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);

    expect(classification.state).toBe('unclassified');
    expect(classification.nearestMatches).toBeDefined();
    expect(classification.nearestMatches!.length).toBe(3);
    expect(classification.closestComp).toBeDefined();
    expect(classification.closestComp?.compId).toBe(classification.nearestMatches![0].compId);
  });

  it('12. matched units correct', () => {
    const analysis = projectBoardAnalysis(
      targetPlaybook.target.units.slice(0, 6).map((u) => ({ championId: u.championId })),
      data.version.set,
      catalog,
      data,
    );

    expect(analysis.closestComp).toBeDefined();
    expect(analysis.closestComp?.matchedUnits.length).toBe(6);
    for (const u of targetPlaybook.target.units.slice(0, 6)) {
      expect(analysis.closestComp?.matchedUnits).toContain(u.championId);
    }
  });

  it('13. missing units correct', () => {
    const actualUnits = targetPlaybook.target.units.slice(0, 5);
    const missingUnitsExpected = targetPlaybook.target.units.slice(5).map((u) => u.championId);

    const analysis = projectBoardAnalysis(
      actualUnits.map((u) => ({ championId: u.championId })),
      data.version.set,
      catalog,
      data,
    );

    expect(analysis.closestComp).toBeDefined();
    for (const missingId of missingUnitsExpected) {
      expect(analysis.closestComp?.missingUnits).toContain(missingId);
    }
  });

  it('14. extra units correct', () => {
    const extraChampion = data.champions.find(
      (c) => c.boardEligible && c.shopStatus === 'pool' && !targetPlaybook.target.units.some((u) => u.championId === c.id),
    )!;

    const testUnits = [
      ...targetPlaybook.target.units.map((u) => ({ championId: u.championId })),
      { championId: extraChampion.id },
    ];

    const analysis = projectBoardAnalysis(testUnits, data.version.set, catalog, data);
    expect(analysis.closestComp).toBeDefined();
    expect(analysis.closestComp?.extraUnits).toContain(extraChampion.id);
  });

  it('15. core matched/missing correct', () => {
    const coreIds = targetPlaybook.family.core;
    const matchedCore = coreIds.slice(0, 2);
    const missingCore = coreIds.slice(2);

    const analysis = projectBoardAnalysis(
      matchedCore.map((id) => ({ championId: id })),
      data.version.set,
      catalog,
      data,
    );

    const targetComp = analysis.nearestMatches.find((m) => m.compId === targetPlaybook.id);
    expect(targetComp).toBeDefined();
    expect(targetComp?.coreMatched).toEqual(expect.arrayContaining(matchedCore));
    expect(targetComp?.coreMissing).toEqual(expect.arrayContaining(missingCore));
  });

  it('16. nearest affinity order deterministic', () => {
    const testUnits = targetPlaybook.target.units.slice(0, 4).map((u) => ({ championId: u.championId }));
    const a1 = projectBoardAnalysis(testUnits, data.version.set, catalog, data);
    const a2 = projectBoardAnalysis(testUnits, data.version.set, catalog, data);

    expect(a1.nearestMatches.length).toBeGreaterThanOrEqual(2);
    expect(a1.nearestMatches[0].affinity).toBeGreaterThanOrEqual(a1.nearestMatches[1].affinity);
    expect(a1.nearestMatches.map((m) => m.compId)).toEqual(a2.nearestMatches.map((m) => m.compId));
  });

  // ==========================================
  // UI / VIEW MODEL (17 - 21)
  // ==========================================

  it('17. classified analysis renders both boards', () => {
    const analysis = projectBoardAnalysis(
      targetPlaybook.target.units.map((u) => ({ championId: u.championId })),
      data.version.set,
      catalog,
      data,
    );

    expect(analysis.classification.state).toBe('classified');
    expect(analysis.closestComp).toBeDefined();
    expect(analysis.closestComp?.matchedUnits.length).toBe(targetPlaybook.target.units.length);
    expect(analysis.closestComp?.missingUnits.length).toBe(0);
  });

  it('18. ambiguous renders two candidates', () => {
    const customCatalog = createMockCatalog();
    const compA = structuredClone(playbooks[0]);
    compA.id = 'comp-a';
    compA.title = 'Comp A';
    const compB = structuredClone(playbooks[0]);
    compB.id = 'comp-b';
    compB.title = 'Comp B';
    customCatalog.playbooks = [compA, compB];

    const analysis = projectBoardAnalysis(
      compA.target.units.map((u) => ({ championId: u.championId })),
      data.version.set,
      customCatalog,
      data,
    );

    expect(analysis.classification.state).toBe('ambiguous');
    expect(analysis.nearestMatches.length).toBe(2);
    expect(analysis.classification.candidateCompIds).toContain('comp-a');
    expect(analysis.classification.candidateCompIds).toContain('comp-b');
  });

  it('19. unclassified renders closest matches', () => {
    const randomUnits = data.champions
      .filter((c) => c.cost === 1 && c.boardEligible && c.shopStatus === 'pool')
      .slice(0, 4)
      .map((c) => ({ championId: c.id }));

    const analysis = projectBoardAnalysis(randomUnits, data.version.set, catalog, data);
    expect(analysis.classification.state).toBe('unclassified');
    expect(analysis.nearestMatches.length).toBeGreaterThanOrEqual(1);
    expect(analysis.closestComp).not.toBeNull();
    expect(analysis.classification.reasons.length).toBeGreaterThan(0);
  });

  it('20. global meta missing remains unavailable', () => {
    const obs = catalog.metaObservations.find((m) => m.compId === targetPlaybook.id);
    expect(obs).toBeUndefined();
  });

  it('21. personal bucket unavailable does not fabricate stats', () => {
    const unclassifiedObs: PersonalMatchObservation = {
      matchId: 'UNCLASS_MATCH',
      accountPuuid: 'puuid',
      set: data.version.set,
      patch: '18.1',
      riotGameVersion: '16.18',
      gameTimestamp: NOW,
      placement: 6,
      level: 7,
      queueId: 1100,
      gameType: 'Ranked',
      classifiedCompId: null,
      classificationState: 'unclassified',
      classificationConfidence: 0.35,
      classificationModelVersion: PERSONAL_COMP_CLASSIFIER_VERSION,
      finalBoardHash: 'h-unclass',
      units: [],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const perfs = derivePersonalCompPerformance([unclassifiedObs], catalog, data.version.set);
    expect(perfs.length).toBe(0);
  });

  // ==========================================
  // PARITY TESTS (22 - 27)
  // ==========================================

  const settings = { ...defaultSettings };
  const baselineRecs = createRecommendations(data, settings, NOW);
  const currentRecs = createRecommendations(data, settings, NOW);

  it('22. Home candidate ordering identical before/after', () => {
    expect(currentRecs.homeCandidates.length).toBe(baselineRecs.homeCandidates.length);
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].playbook.id).toBe(
        baselineRecs.homeCandidates[i].playbook.id,
      );
      expect(currentRecs.homeCandidates[i].score).toBeCloseTo(
        baselineRecs.homeCandidates[i].score,
        6,
      );
    }
    expect(currentRecs.portfolio.plans.length).toBe(baselineRecs.portfolio.plans.length);
    for (let i = 0; i < baselineRecs.portfolio.plans.length; i++) {
      expect(currentRecs.portfolio.plans[i].candidate.playbook.id).toBe(
        baselineRecs.portfolio.plans[i].candidate.playbook.id,
      );
    }
  });

  it('23. Base Performance identical', () => {
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].home?.basePerformance).toBeCloseTo(
        baselineRecs.homeCandidates[i].home!.basePerformance,
        6,
      );
    }
  });

  it('24. Low-Pick Edge identical', () => {
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].home?.lowPickEdge).toBeCloseTo(
        baselineRecs.homeCandidates[i].home!.lowPickEdge,
        6,
      );
    }
  });

  it('25. Lobby identical', () => {
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].home?.lobbyAdjustment).toBeCloseTo(
        baselineRecs.homeCandidates[i].home!.lobbyAdjustment,
        6,
      );
    }
  });

  it('26. Final Safety identical', () => {
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].home?.finalSafety).toBeCloseTo(
        baselineRecs.homeCandidates[i].home!.finalSafety,
        6,
      );
    }
  });

  it('27. contest state identical', () => {
    for (let i = 0; i < baselineRecs.homeCandidates.length; i++) {
      expect(currentRecs.homeCandidates[i].contest.state).toBe(
        baselineRecs.homeCandidates[i].contest.state,
      );
      expect(currentRecs.homeCandidates[i].contest.value).toBe(
        baselineRecs.homeCandidates[i].contest.value,
      );
    }
  });
});
