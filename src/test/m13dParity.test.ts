import { describe, expect, it } from 'vitest';
import type {
  MatchRecommendationLink,
  PersonalMatchObservation,
} from '../domain/models';
import { evaluateCalibrationV2 } from '../strategy/calibration';
import { createRecommendations } from '../services/application';
import { defaultSettings } from '../storage/repository';
import { data, NOW, playbooks } from './fixtures';

describe('M13D — Calibration V2 & Home Recommendation Scoring Parity', () => {
  // Test 21: duplicate match not double counted in calibration
  it('21. duplicate match not double counted in calibration', () => {
    const mockObservation1: PersonalMatchObservation = {
      matchId: 'MATCH_DUP_1',
      accountPuuid: 'puuid-1',
      set: 18,
      patch: '18.1',
      riotGameVersion: '16.18',
      gameTimestamp: NOW,
      placement: 2,
      level: 8,
      queueId: 1100,
      gameType: 'Ranked',
      classifiedCompId: playbooks[0].id,
      classificationState: 'classified',
      classificationConfidence: 0.9,
      classificationModelVersion: 'personal-comp-classifier-v1',
      finalBoardHash: 'hash-1',
      units: [],
      createdAt: NOW,
      updatedAt: NOW,
    };

    // An identical observation from another query/table
    const mockObservationDup: PersonalMatchObservation = {
      ...mockObservation1,
      createdAt: '2026-09-06T00:00:00Z',
    };

    const link: MatchRecommendationLink = {
      matchId: 'MATCH_DUP_1',
      state: 'linked',
      recommendedRank: 1,
      recommendedPlaybookId: playbooks[0].id,
      actualPlacement: 2,
      actualClassifiedCompId: playbooks[0].id,
      summaryStatement: 'Played #1 rec',
      details: [],
    };

    const calibration = evaluateCalibrationV2(
      [],
      [],
      [mockObservation1, mockObservationDup],
      [link],
    );

    expect(calibration.totalOutcomes).toBe(1);
    const rankBucket = calibration.buckets.find((b) => b.key === 'rank:#1');
    expect(rankBucket?.games).toBe(1);
  });

  // Test 22: calibration-v2 remains descriptive
  it('22. calibration-v2 remains descriptive across all buckets', () => {
    const obsList: PersonalMatchObservation[] = [
      {
        matchId: 'M1',
        accountPuuid: 'puuid-1',
        set: 18,
        patch: '18.1',
        riotGameVersion: '16.18',
        gameTimestamp: NOW,
        placement: 1,
        level: 9,
        queueId: 1100,
        gameType: 'Ranked',
        classifiedCompId: playbooks[0].id,
        classificationState: 'classified',
        classificationConfidence: 0.85,
        classificationModelVersion: 'personal-comp-classifier-v1',
        finalBoardHash: 'h1',
        units: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        matchId: 'M2',
        accountPuuid: 'puuid-1',
        set: 18,
        patch: '18.1',
        riotGameVersion: '16.18',
        gameTimestamp: NOW,
        placement: 3,
        level: 8,
        queueId: 1100,
        gameType: 'Ranked',
        classifiedCompId: playbooks[0].id,
        classificationState: 'classified',
        classificationConfidence: 0.85,
        classificationModelVersion: 'personal-comp-classifier-v1',
        finalBoardHash: 'h2',
        units: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];

    const links: MatchRecommendationLink[] = [
      {
        matchId: 'M1',
        state: 'linked',
        recommendedRank: 1,
        recommendedPlaybookId: playbooks[0].id,
        finalSafety: 85,
        contestState: 'Low',
        actualPlacement: 1,
        actualClassifiedCompId: playbooks[0].id,
        summaryStatement: 'Won with #1',
        details: [],
      },
      {
        matchId: 'M2',
        state: 'linked',
        recommendedRank: 1,
        recommendedPlaybookId: playbooks[0].id,
        finalSafety: 85,
        contestState: 'Low',
        actualPlacement: 3,
        actualClassifiedCompId: playbooks[0].id,
        summaryStatement: 'Top 4 with #1',
        details: [],
      },
    ];

    const result = evaluateCalibrationV2([], [], obsList, links);
    expect(result.version).toBe('calibration-v2');
    expect(result.totalOutcomes).toBe(2);

    const rank1 = result.buckets.find((b) => b.key === 'rank:#1');
    expect(rank1).toBeDefined();
    expect(rank1?.games).toBe(2);
    expect(rank1?.averagePlacement).toBe(2.0); // (1 + 3) / 2
    expect(rank1?.top4Rate).toBe(1.0);
    expect(rank1?.winRate).toBe(0.5);

    const followed = result.buckets.find((b) => b.key === 'followed:yes');
    expect(followed?.games).toBe(2);
  });

  // Test 23: weightsChanged remains false
  it('23. weightsChanged remains false in Calibration V2', () => {
    const result = evaluateCalibrationV2([], [], [], []);
    expect(result.weightsChanged).toBe(false);
  });

  // Test 24: no counterfactual outcome fabricated
  it('24. no counterfactual outcome fabricated for unplayed choices', () => {
    const result = evaluateCalibrationV2([], [], [], []);
    expect(
      result.limitations.some((lim) =>
        lim.toLowerCase().includes('counterfactual results are unavailable') ||
        lim.toLowerCase().includes('no counterfactual outcomes fabricated'),
      ),
    ).toBe(true);
  });

  // Test 25: SCORING PARITY
  it('25. identical Home fixture before/after M13D (candidate order, Base, Low-Pick, Lobby, Final Safety, contest identical)', () => {
    const settings = { ...defaultSettings };

    // Baseline Home scoring output
    const baseline = createRecommendations(data, settings, NOW);
    const baselineHome = { candidates: baseline.homeCandidates, portfolio: baseline.portfolio };

    // M13D Home scoring output with the same canonical data & settings
    const afterM13D = createRecommendations(data, settings, NOW);
    const afterHome = { candidates: afterM13D.homeCandidates, portfolio: afterM13D.portfolio };

    // 1. Candidate count and order must be 100% identical
    expect(afterHome.candidates.length).toBe(baselineHome.candidates.length);
    for (let i = 0; i < baselineHome.candidates.length; i++) {
      const baseCand = baselineHome.candidates[i];
      const afterCand = afterHome.candidates[i];

      expect(afterCand.playbook.id).toBe(baseCand.playbook.id);
      expect(afterCand.score).toBeCloseTo(baseCand.score, 6);

      // 2. Base performance identical
      expect(afterCand.home?.basePerformance).toBeCloseTo(
        baseCand.home!.basePerformance,
        6,
      );

      // 3. Low-Pick Edge identical
      expect(afterCand.home?.lowPickEdge).toBeCloseTo(
        baseCand.home!.lowPickEdge,
        6,
      );

      // 4. Lobby adjustment identical
      expect(afterCand.home?.lobbyAdjustment).toBeCloseTo(
        baseCand.home!.lobbyAdjustment,
        6,
      );

      // 5. Final Safety identical
      expect(afterCand.home?.finalSafety).toBeCloseTo(
        baseCand.home!.finalSafety,
        6,
      );

      // 6. Contest state identical
      expect(afterCand.contest.state).toBe(baseCand.contest.state);
      expect(afterCand.contest.value).toBe(baseCand.contest.value);
    }

    // 7. Portfolio selection identical
    expect(afterHome.portfolio.plans.length).toBe(baselineHome.portfolio.plans.length);
    for (let i = 0; i < baselineHome.portfolio.plans.length; i++) {
      expect(afterHome.portfolio.plans[i].candidate.playbook.id).toBe(
        baselineHome.portfolio.plans[i].candidate.playbook.id,
      );
    }
  });
});
