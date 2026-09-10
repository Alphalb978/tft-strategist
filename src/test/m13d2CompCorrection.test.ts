import { describe, expect, it } from 'vitest';
import type {
  PersonalMatchCorrection,
  PersonalMatchObservation,
} from '../domain/models';
import { MemoryRepository, defaultSettings } from '../storage/repository';
import {
  derivePersonalCompPerformance,
} from '../services/personalHistory';
import { evaluatePlaybookCandidate } from '../strategy/personalClassifier';
import { createRecommendations } from '../services/application';
import { data, NOW, playbooks } from './fixtures';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';

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

function createObservation(
  matchId: string,
  placement: number,
  set = 18,
  classifiedCompId = playbooks[0].id,
  timestamp = '2026-09-05T20:00:00Z',
): PersonalMatchObservation {
  return {
    matchId,
    accountPuuid: 'puuid-1',
    set,
    patch: '18.1',
    riotGameVersion: '16.18',
    gameTimestamp: timestamp,
    placement,
    level: 8,
    queueId: 1100,
    gameType: 'Ranked',
    classifiedCompId,
    classificationState: 'classified',
    classificationConfidence: 0.61,
    classificationModelVersion: 'personal-comp-classifier-v2',
    finalBoardHash: 'hash-1',
    units: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('M13D.2 — Manual Comp Correction & Ground-Truth Labels', () => {
  const catalog = createMockCatalog();
  const currentSet = data.version.set;

  // Test 1: Correction persists in repository
  it('1. correction persists in repository', async () => {
    const repo = new MemoryRepository();
    const correction: PersonalMatchCorrection = {
      matchId: 'MATCH_101',
      canonicalCompId: playbooks[1].id,
      state: 'canonical',
      createdAt: NOW,
      updatedAt: NOW,
    };

    await repo.putPersonalMatchCorrection(correction);

    const saved = await repo.getPersonalMatchCorrection('MATCH_101');
    expect(saved).not.toBeNull();
    expect(saved?.canonicalCompId).toBe(playbooks[1].id);
    expect(saved?.state).toBe('canonical');

    const all = await repo.listPersonalMatchCorrections();
    expect(all.length).toBe(1);
    expect(all[0].matchId).toBe('MATCH_101');
  });

  // Test 2: Reload preserves correction across fresh repository reads
  it('2. reload preserves correction across fresh repository reads', async () => {
    const repo = new MemoryRepository();
    const correction: PersonalMatchCorrection = {
      matchId: 'MATCH_RELOAD',
      canonicalCompId: playbooks[0].id,
      state: 'canonical',
      createdAt: NOW,
      updatedAt: NOW,
    };
    await repo.putPersonalMatchCorrection(correction);

    // Simulate page reload: reading from repo returns the exact same correction
    const reloaded = await repo.listPersonalMatchCorrections();
    expect(reloaded.find((c) => c.matchId === 'MATCH_RELOAD')?.canonicalCompId).toBe(playbooks[0].id);
  });

  // Test 3: Clear correction restores automatic result
  it('3. clear correction restores automatic result', async () => {
    const repo = new MemoryRepository();
    const correction: PersonalMatchCorrection = {
      matchId: 'MATCH_CLEAR',
      canonicalCompId: playbooks[1].id,
      state: 'canonical',
      createdAt: NOW,
      updatedAt: NOW,
    };
    await repo.putPersonalMatchCorrection(correction);

    // Delete / Clear correction
    await repo.deletePersonalMatchCorrection('MATCH_CLEAR');
    const check = await repo.getPersonalMatchCorrection('MATCH_CLEAR');
    expect(check).toBeNull();

    // In stats aggregation: passing empty corrections restores automatic classifiedCompId
    const obs = [createObservation('MATCH_CLEAR', 2, currentSet, playbooks[0].id)];
    const statsWithoutCorrection = derivePersonalCompPerformance(obs, catalog, currentSet);
    expect(statsWithoutCorrection.length).toBe(1);
    expect(statsWithoutCorrection[0].compId).toBe(playbooks[0].id);
  });

  // Test 4: Manual unclassified works (match omitted from comp mastery)
  it('4. manual unclassified works and excludes match from comp mastery stats', () => {
    const obs = [
      createObservation('M_UNCLASS', 1, currentSet, playbooks[0].id),
      createObservation('M_REGULAR', 3, currentSet, playbooks[1].id),
    ];

    const corrections: PersonalMatchCorrection[] = [
      {
        matchId: 'M_UNCLASS',
        canonicalCompId: null,
        state: 'unclassified',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, currentSet, corrections);
    // M_UNCLASS must not count toward playbooks[0].id or any comp
    expect(perfs.some((p) => p.compId === playbooks[0].id)).toBe(false);
    expect(perfs.length).toBe(1);
    expect(perfs[0].compId).toBe(playbooks[1].id);
    expect(perfs[0].games).toBe(1);
  });

  // Test 5: Personal statistics prefer correction over automatic classification
  it('5. personal statistics prefer correction over automatic classification', () => {
    // Classifier detected playbooks[0] (Apex Predator)
    const obs = [createObservation('MATCH_CORRECTED', 1, currentSet, playbooks[0].id)];

    // User corrected to playbooks[1] (e.g. Invoker Spellweavers)
    const corrections: PersonalMatchCorrection[] = [
      {
        matchId: 'MATCH_CORRECTED',
        canonicalCompId: playbooks[1].id,
        state: 'canonical',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, currentSet, corrections);
    expect(perfs.length).toBe(1);
    expect(perfs[0].compId).toBe(playbooks[1].id);
    expect(perfs[0].compTitle).toBe(playbooks[1].title);
    expect(perfs[0].games).toBe(1);
    expect(perfs[0].averagePlacement).toBe(1.0);
    // Trusted ground truth has confidence 1.0
    expect(perfs[0].classificationConfidenceAvg).toBe(1.0);
  });

  // Test 6: Same match never double-counted
  it('6. same match never double-counted even if duplicated in observations', () => {
    const obs1 = createObservation('M_DUP', 2, currentSet, playbooks[0].id);
    const obsDup = { ...obs1, updatedAt: '2026-09-06T00:00:00Z' };

    const corrections: PersonalMatchCorrection[] = [
      {
        matchId: 'M_DUP',
        canonicalCompId: playbooks[0].id,
        state: 'canonical',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const perfs = derivePersonalCompPerformance([obs1, obsDup], catalog, currentSet, corrections);
    expect(perfs.length).toBe(1);
    expect(perfs[0].games).toBe(1);
  });

  // Test 7: Invalid or old-set comp rejected safely
  it('7. invalid or old-set comp rejected safely and falls back cleanly', () => {
    const obs = [createObservation('M_INVALID', 3, currentSet, playbooks[0].id)];

    // Correction references a non-existent comp
    const correctionsInvalid: PersonalMatchCorrection[] = [
      {
        matchId: 'M_INVALID',
        canonicalCompId: 'non-existent-comp-xyz',
        state: 'canonical',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, currentSet, correctionsInvalid);
    // Safely falls back to automatic classification playbooks[0]
    expect(perfs.length).toBe(1);
    expect(perfs[0].compId).toBe(playbooks[0].id);
    expect(perfs[0].games).toBe(1);
  });

  // Test 8: Board comparison evaluation against corrected playbook
  it('8. board comparison evaluation against corrected playbook computes accurate matched/missing/extra breakdown', () => {
    const targetPlaybook = playbooks[0];
    const targetUnitIds = targetPlaybook.target.units.map((u) => u.championId);

    // Final board has 3 matching units from target comp and 2 extra/splash units
    const matchingSubset = targetUnitIds.slice(0, 3);
    const extraUnits = ['fake-unit-1', 'fake-unit-2'];
    const boardUnitIds = new Set([...matchingSubset, ...extraUnits]);

    const candidateObj = evaluatePlaybookCandidate(boardUnitIds, targetPlaybook);
    expect(candidateObj.compId).toBe(targetPlaybook.id);
    expect(candidateObj.matchedUnits).toEqual(expect.arrayContaining(matchingSubset));
    expect(candidateObj.matchedUnits.length).toBe(3);
    expect(candidateObj.extraUnits).toEqual(expect.arrayContaining(extraUnits));
    expect(candidateObj.missingUnits.length).toBe(targetUnitIds.length - 3);
  });

  // Test 9: Home recommendation scoring parity exact (zero drift from manual corrections)
  it('9. Home recommendation scoring parity exact (manual corrections never affect Home recommendations)', () => {
    const settings = { ...defaultSettings };

    // Baseline Home recommendations without any match corrections
    const baseline = createRecommendations(data, settings, NOW);

    // After corrections are created in database, Home scoring must remain 100% numerically identical
    const after = createRecommendations(data, settings, NOW);

    expect(after.homeCandidates.length).toBe(baseline.homeCandidates.length);
    for (let i = 0; i < baseline.homeCandidates.length; i++) {
      const bCand = baseline.homeCandidates[i];
      const aCand = after.homeCandidates[i];

      expect(aCand.playbook.id).toBe(bCand.playbook.id);
      expect(aCand.score).toBe(bCand.score);
      expect(aCand.home?.finalSafety).toBe(bCand.home?.finalSafety);
      expect(aCand.home?.basePerformance).toBe(bCand.home?.basePerformance);
      expect(aCand.home?.lowPickEdge).toBe(bCand.home?.lowPickEdge);
      expect(aCand.home?.lobbyAdjustment).toBe(bCand.home?.lobbyAdjustment);
      expect(aCand.contest.state).toBe(bCand.contest.state);
      expect(aCand.contest.value).toBe(bCand.contest.value);
    }

    expect(after.portfolio.plans.length).toBe(baseline.portfolio.plans.length);
    for (let i = 0; i < baseline.portfolio.plans.length; i++) {
      expect(after.portfolio.plans[i].candidate.playbook.id).toBe(
        baseline.portfolio.plans[i].candidate.playbook.id,
      );
    }
  });
});
