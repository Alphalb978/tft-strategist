import { describe, expect, it } from 'vitest';
import type {
  AggregateMetaDataset,
  CompletedMatch,
  FamilyMetaStats,
  MatchParticipant,
  PlanSession,
  PostGameReview,
} from '../domain/models';
import { planSessionSnapshotFingerprint } from '../domain/fingerprint';
import { FixtureRiotProvider } from '../providers/riot';
import { createRecommendations, type ApplicationState } from '../services/application';
import { checkCompletedMatch } from '../services/postGame';
import { createPlanSession, snapshotIsIntact } from '../services/planSession';
import { MemoryHistoryStore } from '../storage/history';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import { buildPersonalProfile, PERSONAL_MODEL } from '../strategy/personalLearning';
import {
  decideReconciliation,
  derivePostGameReview,
  rankReconciliationCandidates,
  reconcileCandidateCheck,
  reconstructSessionChains,
} from '../strategy/postGame';
import { personalAdjustment, scoreCandidate } from '../strategy/scoring';
import { data, NOW } from './fixtures';

const account = {
  puuid: 'personal-puuid',
  gameName: 'Strategist',
  tagLine: 'M9',
  platform: 'EUW1',
  routing: 'EUROPE',
};

function appState(): ApplicationState {
  const settings = { ...defaultSettings, riotId: 'Strategist#M9' };
  return {
    data: structuredClone(data),
    ...createRecommendations(data, settings, NOW),
    settings,
    activeSession: null,
    source: 'Bundled snapshot',
    assets: {},
  };
}

function sessionAt(
  id: string,
  playbookIndex = 0,
  lockedAt = '2026-09-05T20:20:00.000Z',
  replacesSessionId: string | null = null,
) {
  const state = appState();
  return createPlanSession(
    state.portfolio.plans[playbookIndex].candidate.playbook.id,
    state,
    state.portfolio,
    null,
    lockedAt,
    id,
    replacesSessionId,
  );
}

function participantFor(session: PlanSession, placement = 3): MatchParticipant {
  return {
    puuid: account.puuid,
    placement,
    level: session.snapshot.playbook.target.capacity,
    units: session.snapshot.playbook.target.units.map((unit) => ({
      championId: unit.championId,
      items: [],
      stars: unit.stars ?? 1,
      rarity: null,
      rawName: null,
      unresolvedUnit: false,
      unresolvedItems: [],
    })),
    traits: [],
    augmentIds: [],
    unresolvedAugmentIds: [],
  };
}

function completedFor(
  session: PlanSession,
  id: string,
  completedAt = '2026-09-05T21:00:00.000Z',
  placement = 3,
): CompletedMatch {
  return {
    id,
    set: session.snapshot.playbook.set,
    setCoreName: 'TFTSet18',
    riotGameVersion: 'fixture-build',
    tftContentPatch: '18.1',
    tftContentPatchSource: 'fixture',
    dataVersion: 'fixture-v2',
    gameTimestamp: completedAt,
    gameTimestampSemantics: 'fixture-completed-at',
    gameDurationSeconds: 2100,
    completedAt,
    queueId: 1100,
    gameType: 'standard',
    mapId: null,
    endOfGameResult: 'complete',
    modeSupport: 'supported',
    participants: [participantFor(session, placement)],
    source: 'fixture:m9',
  };
}

function eligibleStat(familyId: string): FamilyMetaStats {
  const binomial = { raw: 0.55, shrunk: 0.54, lower: 0.45, upper: 0.63 };
  return {
    familyId,
    games: 80,
    uniqueMatches: 20,
    rawFrequency: 0.1,
    weightedFrequency: 0.1,
    averagePlacement: 4.2,
    weightedAveragePlacement: 4.2,
    shrunkAveragePlacement: 4.3,
    averagePlacementStandardError: 0.2,
    topFour: binomial,
    wins: { ...binomial, raw: 0.13, shrunk: 0.12 },
    botFour: { ...binomial, raw: 0.45, shrunk: 0.46 },
    placementCounts: {},
    effectiveSample: 60,
    averageClassifierScore: 0.9,
    averageClassifierMargin: 0.2,
    freshestGameAt: NOW,
    ageDays: 0,
    confidence: 0.85,
    measuredStrength: 65,
    measuredFloor: 60,
    measuredCeiling: 55,
    quality: 'eligible',
  };
}

function withBaseline(session: PlanSession) {
  const next = structuredClone(session);
  next.snapshot.evidence.aggregateMeta = {
    datasetId: 'm5-compatible',
    derivationFingerprint: 'm5-derivation',
    sampleDefinitionFingerprint: 'm5-sample',
    collectedAt: NOW,
  };
  next.snapshot.evidence.metaFamilyStats = [eligibleStat(next.selectedFamilyId)];
  next.snapshotFingerprint = planSessionSnapshotFingerprint(next.snapshot);
  return next;
}

describe('M9 session reconciliation', () => {
  it('reconstructs a switch chain and keeps the successor terminal', () => {
    const first = sessionAt('first');
    const second = sessionAt('second', 1, '2026-09-05T20:35:00.000Z', first.id);
    first.state = 'ended';
    first.endedAt = second.lockedAt;
    first.endReason = 'replaced';
    first.replacedBySessionId = second.id;
    const chain = reconstructSessionChains([second, first])[0];
    expect(chain.sessions.map((entry) => entry.id)).toEqual(['first', 'second']);
    expect(chain.terminal.id).toBe('second');
  });

  it('requires account, set, supported mode and compatible timing, without family matching', () => {
    const session = sessionAt('timing');
    const chain = reconstructSessionChains([session])[0];
    const good = completedFor(session, 'EUW1_GOOD');
    const wrongAccount = { ...good, id: 'EUW1_ACCOUNT', participants: [] };
    const wrongSet = { ...good, id: 'EUW1_SET', set: 17 };
    const wrongMode = { ...good, id: 'EUW1_MODE', modeSupport: 'unsupported' as const };
    const old = { ...good, id: 'EUW1_OLD', gameTimestamp: '2026-08-01T00:00:00Z' };
    expect(
      rankReconciliationCandidates(
        chain,
        [good, wrongAccount, wrongSet, wrongMode, old],
        account.puuid,
        'EUW1',
      ).map((entry) => entry.matchId),
    ).toEqual(['EUW1_GOOD']);
  });

  it('surfaces ambiguity and requires an explicit candidate confirmation', () => {
    const session = sessionAt('ambiguous');
    const chain = reconstructSessionChains([session])[0];
    const first = completedFor(session, 'EUW1_A', '2026-09-05T21:00:00Z');
    const second = completedFor(session, 'EUW1_B', '2026-09-05T21:02:00Z');
    const reconciliation = reconcileCandidateCheck(
      chain,
      [first, second],
      account.puuid,
      'EUW1',
      NOW,
    );
    expect(reconciliation.state).toBe('ambiguous');
    expect(reconciliation.matchId).toBeNull();
    const confirmed = decideReconciliation(reconciliation, 'confirm', 'EUW1_B', NOW);
    expect(confirmed).toMatchObject({ state: 'matched', matchId: 'EUW1_B', decision: 'manual' });
    expect(() => decideReconciliation(reconciliation, 'confirm', 'EUW1_UNKNOWN', NOW)).toThrow();
  });

  it('enforces one match per chain in the repository', async () => {
    const repo = new MemoryRepository();
    const first = sessionAt('chain-a');
    const second = sessionAt('chain-b');
    await repo.putReconciliation({
      ...reconcileCandidateCheck(
        reconstructSessionChains([first])[0],
        [completedFor(first, 'EUW1_UNIQUE')],
        account.puuid,
        'EUW1',
        NOW,
      ),
      state: 'matched',
      matchId: 'EUW1_UNIQUE',
    });
    const duplicate = {
      ...reconcileCandidateCheck(
        reconstructSessionChains([second])[0],
        [completedFor(second, 'EUW1_UNIQUE')],
        account.puuid,
        'EUW1',
        NOW,
      ),
      state: 'matched' as const,
      matchId: 'EUW1_UNIQUE',
    };
    await expect(repo.putReconciliation(duplicate)).rejects.toThrow('already reconciled');
  });

  it('reuses the immutable match cache and completes an active terminal without touching its snapshot', async () => {
    const state = appState();
    const session = sessionAt('service');
    const before = structuredClone(session.snapshot);
    const repo = new MemoryRepository();
    const history = new MemoryHistoryStore();
    const completed = completedFor(session, 'EUW1_SERVICE');
    const provider = new FixtureRiotProvider([completed], [account]);
    await repo.createPlanSession(session);
    const result = await checkCompletedMatch(
      session.id,
      repo,
      provider,
      history,
      state.playbooks,
      data.version.set,
      data.version.patch,
      NOW,
    );
    expect(result.reconciliation.state).toBe('matched');
    const stored = (await repo.listPlanSessions())[0];
    expect(stored.state).toBe('ended');
    expect(stored.endReason).toBe('completed');
    expect(stored.snapshot).toEqual(before);
    expect(snapshotIsIntact(stored)).toBe(true);
    const requestsAfterCold = provider.requestsAttempted;
    await history.putRecentIndex({
      puuid: account.puuid,
      routing: account.routing,
      targetCount: 5,
      requestedCount: 5,
      ids: [completed.id],
      exhausted: true,
      fetchedAt: NOW,
    });
    expect((await history.getCompletedMatch(completed.id))?.id).toBe(completed.id);
    expect(provider.requestsAttempted).toBe(requestsAfterCold);
  });
});

describe('M9 evidence-bounded review and attribution', () => {
  it('uses M5/M6 primitives, validates direct fields, and emits no causal loss diagnosis', () => {
    const state = appState();
    const session = withBaseline(sessionAt('review'));
    const chain = reconstructSessionChains([session])[0];
    const completed = completedFor(session, 'EUW1_REVIEW', undefined, 2);
    const reconciliation = {
      ...reconcileCandidateCheck(chain, [completed], account.puuid, 'EUW1', NOW),
      state: 'matched' as const,
      matchId: completed.id,
      accountPuuid: account.puuid,
    };
    const review = derivePostGameReview(chain, reconciliation, completed, state.playbooks, NOW);
    expect(review.relation.state).toBe('same-family');
    expect(review.relation.similarity?.modelVersion).toBe('board-similarity-v1');
    expect(review.relation.canonicalFinal?.modelVersion).toBe('canonical-board-v1');
    expect(review.baseline.state).toBe('available');
    expect(review.participant.itemEvidence).toBe('validated');
    expect(review.participant.augmentEvidence).toBe('validated');
    expect(review.attribution.eligible).toBe(true);
    expect(JSON.stringify(review).toLocaleLowerCase()).not.toMatch(
      /lost because|rolled too late|should have positioned|item caused/,
    );
  });

  it('attributes a switched result only to the terminal destination', () => {
    const state = appState();
    const first = sessionAt('route-a', 1);
    const second = withBaseline(sessionAt('route-b', 0, '2026-09-05T20:35:00.000Z', first.id));
    first.state = 'ended';
    first.endedAt = second.lockedAt;
    first.endReason = 'replaced';
    first.replacedBySessionId = second.id;
    const chain = reconstructSessionChains([first, second])[0];
    const completed = completedFor(second, 'EUW1_SWITCH');
    const reconciliation = {
      ...reconcileCandidateCheck(chain, [completed], account.puuid, 'EUW1', NOW),
      state: 'matched' as const,
      matchId: completed.id,
      accountPuuid: account.puuid,
    };
    const review = derivePostGameReview(chain, reconciliation, completed, state.playbooks, NOW);
    expect(review.attribution.familyId).toBe(second.selectedFamilyId);
    expect(review.attribution.familyId).not.toBe(first.selectedFamilyId);
    expect(review.summary.join(' ')).toContain('Result attribution uses only the terminal route');
  });

  it('withholds attribution for an ambiguous or incompatible final board and baseline', () => {
    const state = appState();
    const session = sessionAt('unknown');
    const completed = completedFor(session, 'EUW1_UNKNOWN_BOARD');
    completed.participants[0].units = [completed.participants[0].units[0]];
    completed.participants[0].unresolvedAugmentIds = ['unknown-augment'];
    const chain = reconstructSessionChains([session])[0];
    const reconciliation = {
      ...reconcileCandidateCheck(chain, [completed], account.puuid, 'EUW1', NOW),
      state: 'matched' as const,
      matchId: completed.id,
      accountPuuid: account.puuid,
    };
    const review = derivePostGameReview(chain, reconciliation, completed, state.playbooks, NOW);
    expect(review.relation.classification.state).not.toBe('classified');
    expect(review.baseline.state).toBe('unavailable');
    expect(review.attribution.eligible).toBe(false);
    expect(review.participant.augmentEvidence).toBe('unavailable');
  });
});

describe('M9 weak personal model and recommendation bounds', () => {
  function reviews(count: number, residual: number, set = 18): PostGameReview[] {
    const state = appState();
    const session = withBaseline(sessionAt(`personal-${set}`));
    const chain = reconstructSessionChains([session])[0];
    return Array.from({ length: count }, (_, index) => {
      const completed = completedFor(session, `EUW1_PERSONAL_${set}_${index}`, undefined, 4);
      completed.set = set;
      const reconciliation = {
        ...reconcileCandidateCheck(chain, [completed], account.puuid, 'EUW1', NOW),
        state: 'matched' as const,
        matchId: completed.id,
        accountPuuid: account.puuid,
      };
      const review = derivePostGameReview(chain, reconciliation, completed, state.playbooks, NOW);
      return {
        ...review,
        set,
        id: `${review.id}:${index}`,
        matchId: completed.id,
        createdAt: new Date(Date.parse(NOW) - index * 86_400_000).toISOString(),
        baseline: { ...review.baseline, placementResidual: residual },
        attribution: {
          eligible: set === 18,
          familyId: session.selectedFamilyId,
          confidence: 0.9,
          reasons: [],
        },
      };
    });
  }

  it('keeps one lucky or poor game neutral and shrinks small samples aggressively', () => {
    const lucky = buildPersonalProfile(reviews(1, 3.3), 18, '18.1', NOW);
    const poor = buildPersonalProfile(reviews(1, -4), 18, '18.1', NOW);
    expect(Object.values(lucky.familyAffinity)).toEqual([0]);
    expect(Object.values(poor.familyAffinity)).toEqual([0]);
    expect(lucky.confidence).toBe(0);
  });

  it('isolates the active set and excludes wrong-family/unattributed reviews', () => {
    const valid = reviews(8, 1);
    const wrong = {
      ...valid[0],
      id: 'wrong',
      matchId: 'wrong',
      attribution: { ...valid[0].attribution, eligible: false, familyId: null },
    };
    const profile = buildPersonalProfile([...valid, wrong, ...reviews(10, 2, 17)], 18, '18.1', NOW);
    expect(profile.sourceReviewIds).toHaveLength(8);
    expect(profile.families?.[0].games).toBe(8);
  });

  it('allows a mature residual signal to nudge close scores but never exceed configured bounds', () => {
    const state = appState();
    const profile = buildPersonalProfile(reviews(40, 2), 18, state.data.version.patch, NOW);
    const family = profile.families![0];
    expect(family.games).toBe(40);
    expect(family.affinity).toBeGreaterThan(0);
    const playbook = state.playbooks.find((entry) => entry.family.id === family.familyId)!;
    expect(personalAdjustment(playbook, profile, 0.05)).toBeGreaterThan(0);
    expect(Math.abs(personalAdjustment(playbook, profile, 0.05))).toBeLessThanOrEqual(0.875);
    expect(Math.abs(personalAdjustment(playbook, profile, 0.1))).toBeLessThanOrEqual(1.75);
    const without = scoreCandidate(playbook, { version: data.version, now: NOW });
    const withPersonal = scoreCandidate(playbook, {
      version: data.version,
      now: NOW,
      personal: profile,
      personalWeight: 0.05,
    });
    expect(withPersonal.score).toBeGreaterThan(without.score);
    for (const key of ['meta', 'lobby'])
      expect(withPersonal.components.find((item) => item.key === key)?.input).toBe(
        without.components.find((item) => item.key === key)?.input,
      );
    expect(withPersonal.components.find((item) => item.key === 'personal')?.label).toContain(
      'games',
    );
    expect(PERSONAL_MODEL.minimumGames).toBe(5);
  });

  it('slightly reorders tied candidates but cannot overcome materially stronger measured meta', () => {
    const state = appState();
    const first = structuredClone(state.playbooks[0]);
    const second = structuredClone(state.playbooks[1]);
    second.features = structuredClone(first.features);
    const profile = buildPersonalProfile(reviews(40, 2), 18, data.version.patch, NOW);
    const firstFamily = first.family.id;
    const secondFamily = second.family.id;
    profile.familyAffinity = { [firstFamily]: 0.12, [secondFamily]: -0.12 };
    profile.families = [
      {
        familyId: firstFamily,
        games: 40,
        effectiveGames: 25,
        averageResidual: 0.3,
        shrunkResidual: 0.12,
        affinity: 0.12,
        confidence: 0.5,
        matchIds: [],
      },
      {
        familyId: secondFamily,
        games: 40,
        effectiveGames: 25,
        averageResidual: -0.3,
        shrunkResidual: -0.12,
        affinity: -0.12,
        confidence: 0.5,
        matchIds: [],
      },
    ];
    const tiedFirst = scoreCandidate(first, {
      version: data.version,
      now: NOW,
      personal: profile,
    });
    const tiedSecond = scoreCandidate(second, {
      version: data.version,
      now: NOW,
      personal: profile,
    });
    expect(tiedFirst.score).toBeGreaterThan(tiedSecond.score);
    expect(tiedFirst.score - tiedSecond.score).toBeLessThanOrEqual(0.7);

    const meta = {
      familyStats: [
        {
          ...eligibleStat(firstFamily),
          measuredStrength: 90,
          measuredFloor: 88,
          measuredCeiling: 85,
        },
        {
          ...eligibleStat(secondFamily),
          measuredStrength: 45,
          measuredFloor: 45,
          measuredCeiling: 45,
        },
      ],
    } as AggregateMetaDataset;
    profile.familyAffinity = { [firstFamily]: -0.35, [secondFamily]: 0.35 };
    profile.families[0].affinity = -0.35;
    profile.families[1].affinity = 0.35;
    const materiallyStrong = scoreCandidate(first, {
      version: data.version,
      now: NOW,
      personal: profile,
      personalWeight: 0.1,
      meta,
    });
    const materiallyWeak = scoreCandidate(second, {
      version: data.version,
      now: NOW,
      personal: profile,
      personalWeight: 0.1,
      meta,
    });
    expect(materiallyStrong.score).toBeGreaterThan(materiallyWeak.score);
    expect(
      Math.abs(materiallyStrong.components.find((item) => item.key === 'personal')!.contribution),
    ).toBeLessThanOrEqual(1.75);
  });
});
