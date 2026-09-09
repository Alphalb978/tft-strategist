import { describe, expect, it } from 'vitest';
import type { MatchParticipant, MatchUnit } from '../domain/models';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';
import {
  classifyPersonalBoard,
  PERSONAL_COMP_CLASSIFIER_VERSION,
} from '../strategy/personalClassifier';
import { data, playbooks } from './fixtures';

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

function makeParticipant(puuid: string, placement: number, level: number, units: MatchUnit[]): MatchParticipant {
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

describe('M13D — Canonical Final-Board → Comp Classifier', () => {
  const catalog = createMockCatalog();
  const targetPlaybook = playbooks[0];

  // Test 6: exact/strong canonical comp classified
  it('6. exact/strong canonical comp classified', () => {
    const participant = makeParticipant(
      'test-puuid',
      1,
      targetPlaybook.target.targetLevel,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('classified');
    expect(classification.compId).toBe(targetPlaybook.id);
    expect(classification.confidence).toBeGreaterThanOrEqual(0.85);
    expect(classification.classifierVersion).toBe(PERSONAL_COMP_CLASSIFIER_VERSION);
    expect(classification.finalBoardHash).toBeTruthy();
  });

  // Test 7: generic shared tanks do not falsely classify
  it('7. generic shared tanks do not falsely classify when carry anchors are missing', () => {
    // Pick only the tank anchor and no carry anchors from targetPlaybook, plus filler units
    const tankAnchors = targetPlaybook.roles
      .filter((r) => r.role === 'tank')
      .map((r) => r.championId);
    const fillerUnits = data.champions
      .filter((c) => c.boardEligible && c.shopStatus === 'pool' && !targetPlaybook.family.core.includes(c.id))
      .slice(0, 6)
      .map((c) => c.id);

    const testUnits = [...tankAnchors.slice(0, 1), ...fillerUnits];

    const participant = makeParticipant(
      'test-puuid',
      5,
      testUnits.length,
      testUnits.map((id) => makeMatchUnit(id)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    // Generic tanks alone should NOT falsely classify into targetPlaybook
    expect(classification.compId).not.toBe(targetPlaybook.id);
    expect(['unclassified', 'ambiguous']).toContain(classification.state);
  });

  // Test 8: ambiguous board stays ambiguous
  it('8. ambiguous board stays ambiguous when candidates are within ambiguity margin', () => {
    // Construct a catalog with two nearly identical competing comps
    const customCatalog = createMockCatalog();
    const compA = structuredClone(playbooks[0]);
    compA.id = 'comp-a';
    compA.title = 'Comp A';

    const compB = structuredClone(playbooks[0]);
    compB.id = 'comp-b';
    compB.title = 'Comp B';
    // Slightly change only 1 non-core unit so both score nearly identically
    customCatalog.playbooks = [compA, compB];

    const participant = makeParticipant(
      'test-puuid',
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

  // Test 9: unrelated board unclassified
  it('9. unrelated board unclassified', () => {
    // Create a board of random 1-cost units that don't match any playbook core
    const randomUnits = data.champions
      .filter((c) => c.cost === 1 && c.boardEligible && c.shopStatus === 'pool')
      .slice(0, 5);

    const participant = makeParticipant(
      'test-puuid',
      8,
      5,
      randomUnits.map((u) => makeMatchUnit(u.id, 1)),
    );

    const classification = classifyPersonalBoard(participant, data.version.set, catalog, data);
    expect(classification.state).toBe('unclassified');
    expect(classification.compId).toBeNull();
    expect(classification.confidence).toBeLessThan(0.58);
  });

  // Test 10: old set marked incompatible/archived
  it('10. old set marked incompatible/archived', () => {
    const participant = makeParticipant(
      'test-puuid',
      3,
      8,
      targetPlaybook.target.units.map((u) => makeMatchUnit(u.championId)),
    );

    // Old set match: Set 17 while active set is Set 18
    const classification = classifyPersonalBoard(participant, 17, catalog, data);
    expect(classification.state).toBe('incompatible-set');
    expect(classification.compId).toBeNull();
    expect(classification.confidence).toBe(0);
    expect(classification.reasons[0]).toContain('incompatible with active Set');
  });

  // Test 11: deterministic regardless unit order
  it('11. deterministic regardless unit order', () => {
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
});
