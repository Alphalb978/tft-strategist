import { describe, expect, it } from 'vitest';
import type {
  MatchReconciliation,
  PersonalMatchObservation,
  PlanSession,
} from '../domain/models';
import {
  derivePersonalCompPerformance,
  derivePersonalHistorySummary,
  sampleConfidenceFor,
} from '../services/personalHistory';
import {
  linkMatchToRecommendation,
  type StoredRecommendationSnapshot,
} from '../services/matchRecommendationLink';
import { data, playbooks } from './fixtures';
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
    classificationConfidence: 0.88,
    classificationModelVersion: 'personal-comp-classifier-v1',
    finalBoardHash: 'hash-1',
    units: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('M13D — Personal Stats, Comp Performance & Recommendation Links', () => {
  const catalog = createMockCatalog();

  // Test 12: raw average placement correct
  it('12. raw average placement correct', () => {
    // 4 matches: placements 1, 3, 4, 8 -> sum 16 / 4 = 4.00
    const obs = [
      createObservation('m1', 1),
      createObservation('m2', 3),
      createObservation('m3', 4),
      createObservation('m4', 8),
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, 18);
    expect(perfs.length).toBe(1);
    expect(perfs[0].averagePlacement).toBe(4.0);
  });

  // Test 13: Top 4 correct
  it('13. Top 4 rate correct', () => {
    // 4 matches: placements 1, 3, 4, 8 -> 3 out of 4 are <= 4 (75%)
    const obs = [
      createObservation('m1', 1),
      createObservation('m2', 3),
      createObservation('m3', 4),
      createObservation('m4', 8),
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, 18);
    expect(perfs[0].top4Count).toBe(3);
    expect(perfs[0].top4Rate).toBe(0.75);
  });

  // Test 14: win rate correct
  it('14. win rate correct', () => {
    // 4 matches: one 1st place -> 1 out of 4 (25%)
    const obs = [
      createObservation('m1', 1),
      createObservation('m2', 3),
      createObservation('m3', 4),
      createObservation('m4', 8),
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, 18);
    expect(perfs[0].winCount).toBe(1);
    expect(perfs[0].winRate).toBe(0.25);
  });

  // Test 15: small sample labeled limited & shrinkage toward 4.5
  it('15. small sample labeled limited and shrunk toward neutral 4.5 baseline', () => {
    // 2 games with extreme placement: 1 and 1 -> raw avg 1.00
    const obs = [createObservation('m1', 1), createObservation('m2', 1)];

    const perfs = derivePersonalCompPerformance(obs, catalog, 18);
    expect(perfs[0].sampleConfidence).toBe('VERY LIMITED');
    expect(perfs[0].averagePlacement).toBe(1.0);
    // Shrunk estimate: (1.0 * 2 + 4.5 * 4) / 6 = (2 + 18) / 6 = 3.33
    expect(perfs[0].evidenceAdjustedEstimate).toBeGreaterThan(1.0);
    expect(perfs[0].evidenceAdjustedEstimate).toBe(3.33);

    expect(sampleConfidenceFor(1)).toBe('VERY LIMITED');
    expect(sampleConfidenceFor(2)).toBe('VERY LIMITED');
    expect(sampleConfidenceFor(3)).toBe('LIMITED');
    expect(sampleConfidenceFor(4)).toBe('LIMITED');
    expect(sampleConfidenceFor(5)).toBe('DEVELOPING');
    expect(sampleConfidenceFor(9)).toBe('DEVELOPING');
    expect(sampleConfidenceFor(10)).toBe('MEANINGFUL');
  });

  // Test 16: current-set stats exclude old sets
  it('16. current-set stats exclude old sets', () => {
    const obs = [
      createObservation('m1', 1, 18),
      createObservation('m2', 2, 18),
      createObservation('m_old_1', 8, 17), // Old set game
      createObservation('m_old_2', 7, 17), // Old set game
    ];

    const perfs = derivePersonalCompPerformance(obs, catalog, 18);
    expect(perfs[0].games).toBe(2);
    expect(perfs[0].averagePlacement).toBe(1.5);

    const summary = derivePersonalHistorySummary(obs, perfs, 18);
    expect(summary.currentSetGames).toBe(2);
    expect(summary.archivedOldSetGames).toBe(2);
    expect(summary.currentSetAveragePlacement).toBe(1.5);
  });

  // Test 17: explicit plan link preferred
  it('17. explicit plan link preferred over ambiguous snapshots', () => {
    const obs = createObservation('m1', 2, 18, playbooks[0].id, '2026-09-05T20:00:00Z');

    const mockSession = {
      id: 'session-explicit-1',
      snapshot: {
        selectedRank: 1,
        candidate: {
          playbook: playbooks[0],
          contest: { state: 'Low' },
          score: 85,
          home: { finalSafety: 88 },
        },
        portfolio: { plans: [{ candidate: { playbook: playbooks[0] } }] },
      },
      reconciliation: { matchId: 'm1' },
    } as unknown as PlanSession;

    const mockReconciliation: MatchReconciliation = {
      schemaVersion: 1,
      modelVersion: 'postgame-reconciliation-v1',
      chainId: 'chain-1',
      sessionIds: ['session-explicit-1'],
      terminalSessionId: 'session-explicit-1',
      state: 'matched',
      matchId: 'm1',
      candidates: [],
      accountPuuid: 'puuid-1',
      platform: 'EUW1',
      checkedAt: '2026-09-05T20:45:00Z',
      decidedAt: '2026-09-05T20:45:00Z',
      decision: 'manual',
      audit: [],
    };

    const link = linkMatchToRecommendation(obs, [mockSession], [mockReconciliation]);
    expect(link.state).toBe('linked');
    expect(link.sessionId).toBe('session-explicit-1');
    expect(link.recommendedPlaybookId).toBe(playbooks[0].id);
    expect(link.summaryStatement).toContain('Played the #1 recommended route');
  });

  // Test 18: plausible snapshot candidate handled safely
  it('18. plausible snapshot candidate handled safely when no locked plan existed', () => {
    const obs = createObservation('m2', 3, 18, playbooks[0].id, '2026-09-05T20:00:00Z');

    const snapshotPayload = JSON.stringify({
      portfolio: {
        plans: [
          {
            candidate: {
              playbook: playbooks[0],
              contest: { state: 'Low' },
              score: 82,
              home: { finalSafety: 85 },
            },
          },
        ],
      },
    });

    const snapshots: StoredRecommendationSnapshot[] = [
      {
        id: 'snap-1',
        payload: snapshotPayload,
        generated_at: '2026-09-05T19:40:00Z', // 20 minutes prior to game
      },
    ];

    const link = linkMatchToRecommendation(obs, [], [], snapshots);
    expect(link.state).toBe('candidate');
    expect(link.recommendedPlaybookId).toBe(playbooks[0].id);
    expect(link.summaryStatement).toContain('Played the #1 recommended route');
  });

  // Test 19: ambiguous association not forced
  it('19. ambiguous association not forced when multiple conflicting snapshots exist', () => {
    const obs = createObservation('m3', 4, 18, playbooks[0].id, '2026-09-05T20:00:00Z');

    const snapshots: StoredRecommendationSnapshot[] = [
      {
        id: 'snap-1',
        payload: JSON.stringify({ portfolio: { plans: [] } }),
        generated_at: '2026-09-05T19:50:00Z',
      },
      {
        id: 'snap-2',
        payload: JSON.stringify({ portfolio: { plans: [] } }),
        generated_at: '2026-09-05T19:35:00Z',
      },
    ];

    const link = linkMatchToRecommendation(obs, [], [], snapshots);
    expect(link.state).toBe('ambiguous');
    expect(link.recommendedPlaybookId).toBeUndefined();
    expect(link.summaryStatement).toContain('Multiple plausible recommendation snapshots');
  });

  // Test 20: no recommendation evidence remains none
  it('20. no recommendation evidence remains none', () => {
    const obs = createObservation('m4', 6, 18, playbooks[0].id, '2026-09-05T20:00:00Z');

    const link = linkMatchToRecommendation(obs, [], [], []);
    expect(link.state).toBe('none');
    expect(link.summaryStatement).toBe('No recommendation snapshot attached to this game.');
  });
});
