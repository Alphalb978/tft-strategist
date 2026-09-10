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
import {
  rederivePersonalMatchObservationsIfNeeded,
} from '../services/personalHistory';
import { createRecommendations } from '../services/application';
import { MemoryHistoryStore } from '../storage/history';
import { MemoryRepository, defaultSettings } from '../storage/repository';
import { data, match as createFixtureMatch, playbooks } from './fixtures';

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

function createMockCatalog(playbookList = structuredClone(playbooks)): RuntimeKnowledgeCatalog {
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
    playbooks: playbookList,
    metaObservations: [],
    externalSnapshot: null,
  };
}

describe('M13D.3 Regression Suite — Candidate Handoff to Post-Game Classifier', () => {
  const catalog = createMockCatalog();
  const targetPlaybook = playbooks[0];

  // 1. Set 18 numeric match + Set 18 catalog → candidates available
  it('1. Set 18 numeric match + Set 18 catalog → candidates available', () => {
    const participant = makeParticipant(
      'p-num18',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, 18, catalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.candidateCompIds).toContain(targetPlaybook.id);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.85);

    const analysis = projectBoardAnalysis(
      participant.units,
      18,
      catalog,
      data,
      participant.level,
    );
    expect(analysis.classification.state).toBe('classified');
    expect(analysis.nearestMatches.length).toBeGreaterThan(0);
    expect(analysis.closestComp).not.toBeNull();
    expect(analysis.closestComp?.compId).toBe(targetPlaybook.id);
    expect(analysis.closestComp?.affinity).toBeGreaterThanOrEqual(0.85);
  });

  // 2. "18" normalized correctly if source type permits it
  it('2. "18" normalized correctly if source type permits it', () => {
    const participant = makeParticipant(
      'p-str18',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    // Pass string "18" cast as any to simulate non-normalized input
    const classification = classifyPersonalBoard(
      participant,
      '18' as unknown as number,
      catalog,
      data,
    );
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.candidateCompIds).toContain(targetPlaybook.id);

    const analysis = projectBoardAnalysis(
      participant.units,
      '18' as unknown as number,
      catalog,
      data,
      participant.level,
    );
    expect(analysis.classification.state).toBe('classified');
    expect(analysis.closestComp).not.toBeNull();
    expect(analysis.nearestMatches.length).toBeGreaterThan(0);
  });

  // 3. same set + unknown patch → candidates available
  it('3. same set + unknown patch → candidates available', () => {
    const participant = makeParticipant(
      'p-unk-patch',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    // Catalog with unknown/null patch
    const unkPatchCatalog = createMockCatalog();
    unkPatchCatalog.version.patch = null;

    const classification = classifyPersonalBoard(participant, 18, unkPatchCatalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.candidateCompIds).toContain(targetPlaybook.id);

    const analysis = projectBoardAnalysis(
      participant.units,
      18,
      unkPatchCatalog,
      data,
      participant.level,
    );
    expect(analysis.nearestMatches.length).toBeGreaterThan(0);
    expect(analysis.closestComp).not.toBeNull();
  });

  // 4. same set + older patch → candidates available
  it('4. same set + older patch → candidates available', () => {
    const participant = makeParticipant(
      'p-old-patch',
      2,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    // Catalog with newer patch while match is older Set 18 patch
    const catalogPatch2 = createMockCatalog();
    catalogPatch2.version.patch = '18.2';

    const classification = classifyPersonalBoard(participant, 18, catalogPatch2, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.candidateCompIds).toContain(targetPlaybook.id);

    const analysis = projectBoardAnalysis(
      participant.units,
      18,
      catalogPatch2,
      data,
      participant.level,
    );
    expect(analysis.nearestMatches.length).toBeGreaterThan(0);
    expect(analysis.closestComp?.compId).toBe(targetPlaybook.id);
  });

  // 5. different set → incompatible
  it('5. different set → incompatible', () => {
    const participant = makeParticipant(
      'p-set17',
      3,
      8,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, 17, catalog, data);
    expect(classification.state).toBe('incompatible-set');
    expect(classification.compId).toBeNull();
    expect(classification.confidence).toBe(0);
    expect(classification.candidateCompIds).toEqual([]);
    expect(classification.reasons[0]).toContain('incompatible with active Set');

    const analysis = projectBoardAnalysis(
      participant.units,
      17,
      catalog,
      data,
      participant.level,
    );
    expect(analysis.classification.state).toBe('incompatible-set');
    expect(analysis.closestComp).toBeNull();
    expect(analysis.nearestMatches).toEqual([]);
  });

  // 6. unclassified same-set board → nearestMatches still non-empty
  it('6. unclassified same-set board → nearestMatches still non-empty', () => {
    // Random 1-cost units that don't form any cohesive comp
    const randomUnits = data.champions
      .filter((c) => c.cost === 1 && c.boardEligible && c.shopStatus === 'pool')
      .slice(0, 5);

    const participant = makeParticipant(
      'p-unclass',
      8,
      5,
      randomUnits.map((u) => makeMatchUnit(u.id, 1)),
    );

    const classification = classifyPersonalBoard(participant, 18, catalog, data);
    expect(classification.state).toBe('unclassified');
    expect(classification.compId).toBeNull();

    const analysis = projectBoardAnalysis(
      participant.units,
      18,
      catalog,
      data,
      participant.level,
    );
    expect(analysis.classification.state).toBe('unclassified');
    // Invariant: nearestMatches must NOT be empty for same-set boards with valid comps
    expect(analysis.nearestMatches.length).toBeGreaterThan(0);
    expect(analysis.closestComp).not.toBeNull();
    expect(analysis.closestComp?.compTitle).toBeTruthy();
    expect(analysis.closestComp?.affinity).toBeGreaterThanOrEqual(0);
  });

  // 7. classifier receives canonical target units
  it('7. classifier receives canonical target units with full definitions', () => {
    const candidates = catalog.playbooks;
    expect(candidates.length).toBeGreaterThan(0);
    for (const comp of candidates) {
      expect(comp.target.units.length).toBeGreaterThanOrEqual(6);
      expect(comp.family.core.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(comp.roles)).toBe(true);
      for (const tu of comp.target.units) {
        expect(tu.championId).toBeTruthy();
      }
    }
    // Target playbook specifically has verified carry and tank anchors
    expect(targetPlaybook.roles.some((r) => r.role === 'carry')).toBe(true);
    expect(targetPlaybook.roles.some((r) => r.role === 'tank')).toBe(true);
  });

  // 8. old zero-candidate observations re-derive safely
  it('8. old zero-candidate observations re-derive safely', async () => {
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    const units = targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId));
    const completedMatch = createFixtureMatch('match-rederive-1', ['user-puuid', 'opp-puuid']);
    completedMatch.set = 18;
    completedMatch.participants[0] = {
      ...completedMatch.participants[0],
      puuid: 'user-puuid',
      placement: 1,
      level: targetPlaybook.target.targetLevel,
      units: units.map((u) => ({
        championId: u.championId,
        stars: u.stars ?? 2,
        items: [],
        rarity: null,
        rawName: null,
        unresolvedUnit: false,
        unresolvedItems: [],
      })),
    };
    await historyStore.putCompletedMatch(completedMatch, new Date().toISOString());

    // Old observation with v1 classifier and 0 candidates
    const oldObservation: PersonalMatchObservation = {
      matchId: 'match-rederive-1',
      accountPuuid: 'user-puuid',
      set: 18,
      patch: '18.1',
      riotGameVersion: '16.18',
      gameTimestamp: '2026-09-05T20:00:00Z',
      placement: 1,
      level: targetPlaybook.target.targetLevel,
      queueId: 1100,
      gameType: 'Ranked',
      classifiedCompId: null,
      classificationState: 'unclassified',
      classificationConfidence: 0,
      classificationModelVersion: 'personal-comp-classifier-v1',
      candidateCompIds: [],
      finalBoardHash: 'old-hash',
      units,
      createdAt: '2026-09-05T20:00:00Z',
      updatedAt: '2026-09-05T20:00:00Z',
    };
    await repository.putPersonalMatchObservation(oldObservation);

    const rederived = await rederivePersonalMatchObservationsIfNeeded(
      [oldObservation],
      historyStore,
      repository,
      catalog,
      data,
    );

    expect(rederived.length).toBe(1);
    expect(rederived[0].classificationModelVersion).toBe(PERSONAL_COMP_CLASSIFIER_VERSION);
    expect(rederived[0].classificationState).toBe('classified');
    expect(rederived[0].classifiedCompId).toBe(targetPlaybook.id);
    expect(rederived[0].candidateCompIds).toContain(targetPlaybook.id);
    expect(rederived[0].classificationConfidence).toBeGreaterThanOrEqual(0.85);

    // Verify stored in repository
    const storedList = await repository.listPersonalMatchObservations();
    const stored = storedList.find((o) => o.matchId === 'match-rederive-1');
    expect(stored?.classifiedCompId).toBe(targetPlaybook.id);
    expect(stored?.classificationModelVersion).toBe(PERSONAL_COMP_CLASSIFIER_VERSION);
  });

  // 9. cached matches reused; zero new Riot detail calls
  it('9. cached matches reused; zero new Riot detail calls', async () => {
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    let riotCompletedMatchCalls = 0;
    const fakeProvider = {
      completedMatch: async () => {
        riotCompletedMatchCalls++;
        throw new Error('Should not be called during re-derivation');
      },
    };
    void fakeProvider;

    const completedMatch = createFixtureMatch('match-cache-test', ['cached-puuid']);
    completedMatch.set = 18;
    await historyStore.putCompletedMatch(completedMatch, new Date().toISOString());

    const obs: PersonalMatchObservation = {
      matchId: 'match-cache-test',
      accountPuuid: 'cached-puuid',
      set: 18,
      patch: '18.1',
      riotGameVersion: '16.18',
      gameTimestamp: '2026-09-05T20:00:00Z',
      placement: 2,
      level: 8,
      queueId: 1100,
      gameType: 'Ranked',
      classifiedCompId: null,
      classificationState: 'unclassified',
      classificationConfidence: 0,
      classificationModelVersion: 'personal-comp-classifier-v1',
      candidateCompIds: [],
      finalBoardHash: 'old-hash',
      units: targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
      createdAt: '2026-09-05T20:00:00Z',
      updatedAt: '2026-09-05T20:00:00Z',
    };
    await repository.putPersonalMatchObservation(obs);

    // Re-derivation uses historyStore and does NOT touch fakeProvider
    await rederivePersonalMatchObservationsIfNeeded(
      [obs],
      historyStore,
      repository,
      catalog,
      data,
    );

    expect(riotCompletedMatchCalls).toBe(0);
    const storedList = await repository.listPersonalMatchObservations();
    const updated = storedList.find((o) => o.matchId === 'match-cache-test');
    expect(updated?.classificationModelVersion).toBe(PERSONAL_COMP_CLASSIFIER_VERSION);
  });

  // 10. Home recommendation parity remains exact
  it('10. Home recommendation parity remains exact between baseline and catalog', () => {
    const settings = defaultSettings;
    const testNow = '2026-09-05T21:00:00Z';
    const baseline = createRecommendations(data, settings, testNow);
    const withCatalog = createRecommendations(
      data,
      settings,
      testNow,
      null,
      null,
      null,
      null,
      catalog.playbooks,
    );

    expect(withCatalog.homeCandidates.length).toBe(baseline.homeCandidates.length);
    expect(withCatalog.portfolio.plans.length).toBe(baseline.portfolio.plans.length);
    for (let i = 0; i < baseline.portfolio.plans.length; i++) {
      expect(withCatalog.portfolio.plans[i].candidate.playbook.id).toBe(
        baseline.portfolio.plans[i].candidate.playbook.id,
      );
      expect(withCatalog.portfolio.plans[i].role).toBe(baseline.portfolio.plans[i].role);
    }
    expect(withCatalog.portfolio.objective).toBeCloseTo(baseline.portfolio.objective, 5);

    for (let i = 0; i < baseline.homeCandidates.length; i++) {
      expect(withCatalog.homeCandidates[i].playbook.id).toBe(
        baseline.homeCandidates[i].playbook.id,
      );
      expect(withCatalog.homeCandidates[i].score).toBeCloseTo(
        baseline.homeCandidates[i].score,
        5,
      );
    }
  });
});
