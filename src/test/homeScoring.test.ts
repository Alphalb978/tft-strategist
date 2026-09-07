import { describe, expect, it } from 'vitest';
import type { ExternalSnapshot } from '../domain/externalMeta';
import type {
  CandidateContest,
  HomeRecommendationModelConfig,
  LobbyPressure,
  Playbook,
} from '../domain/models';
import { createRecommendations, rescoreHomeRecommendations } from '../services/application';
import { MemoryRepository, defaultSettings, normalizeSettings } from '../storage/repository';
import { emptyCurrentGame } from '../strategy/currentGame';
import {
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
  HOME_DIVERSITY_PENALTY_CAP,
  HOME_RECOMMENDATION_MODEL_VERSION,
  basePerformancePercentiles,
  homeConfigFingerprint,
  homeRecommendations,
  lobbyAdjustment,
  lowPickEdge,
  normalizeHomeRecommendationConfig,
  optimizeHomePortfolio,
  scoreHomeCandidates,
} from '../strategy/homeScoring';
import { scoreCandidate } from '../strategy/scoring';
import { createPlanSession } from '../services/planSession';
import { data, NOW, playbooks } from './fixtures';

function externalFor(
  plans: Playbook[],
  options: {
    sample?: number;
    average?: number;
    top4?: number;
    win?: number;
    picks?: number[];
  } = {},
): ExternalSnapshot {
  return {
    manifest: {
      schemaVersion: 1,
      provider: 'MetaTFT',
      retrievedAt: NOW,
      sourceUrls: ['https://www.metatft.com/comps'],
      scope: {
        set: data.version.set,
        patch: data.knowledge?.balancePatch ?? data.version.patch,
        hotfix: data.knowledge?.balanceHotfix ?? null,
        queue: 1100,
        rank: 'Platinum+',
        window: '3 days',
        region: null,
      },
      providerUpdated: NOW,
      collectorVersion: 'fixture',
      normalizerVersion: 'fixture',
      contentHash: 'fixture',
      warnings: [],
      population: 100_000,
    },
    comps: plans.map((plan, index) => ({
      id: `external-${plan.id}`,
      name: plan.title,
      stats: {
        sampleMethod: 'provider-histogram',
        playRateMethod: 'participant-board-share',
        sample: options.sample ?? 100_000,
        average: options.average ?? 3.8,
        top4: options.top4 ?? 0.62,
        win: options.win ?? 0.16,
        playRate: 0.02,
      },
      pickRate: {
        value: options.picks?.[index] ?? index + 1,
        unit: 'provider-display',
        source: 'public-page',
      },
      tier: null,
      conditions: [],
      units: plan.target.units.map((unit) => unit.championId),
      core: plan.family.core,
      style: plan.features.style,
      positions: [],
      packages: [],
    })),
    units: [],
    items: [],
    traits: [],
    augments: [],
  };
}

function contest(value: number | null, coverage = 1, unavailable = false): CandidateContest {
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

function lobbyFor(plan: Playbook, pressure: number, coverage = 1): LobbyPressure {
  return {
    state: coverage === 1 ? 'complete' : 'partial',
    expectedOpponents: 7,
    requestedOpponents: 7,
    resolvedOpponents: 7,
    profilesCompleted: 7,
    profiles: [{ confidence: coverage } as LobbyPressure['profiles'][number]],
    unitPressure: [
      {
        championId: plan.family.core[0],
        opponentsWithEvidence: 7,
        equivalentHistoricalUsers: pressure * 7,
        recentSpikeEquivalentUsers: 0,
        historicalCopyEquivalentUsers: 0,
        totalEquivalentUsers: pressure * 7,
        normalizedPressure: pressure,
        evidenceCoverage: coverage,
        sourceOpponents: [],
      },
    ],
    unitPressureVersion: 'fixture',
    coverage,
    relevantGamesAvailable: 70,
    relevantGamesTarget: 140,
    freshProfiles: 7,
    cachedProfiles: 0,
    acquisitionMs: 1,
    derivationMs: 1,
    elapsedMs: 2,
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

function portfolioCandidate(
  index: number,
  score: number,
  core: string[],
  style = `style-${index}`,
  itemCoverage: string[] = [],
) {
  const plan = structuredClone(playbooks[index % playbooks.length]);
  plan.id = `home-portfolio-${index}`;
  plan.title = `Home portfolio ${index}`;
  plan.family.id = `home-family-${index}`;
  plan.family.core = core;
  plan.features.style = style;
  plan.features.itemCoverage = itemCoverage;
  return {
    ...scoreCandidate(plan, { data, version: data.version, now: NOW }),
    score,
  };
}

describe('Contest Edge v1 base performance and rarity', () => {
  it('uses deterministic 70/20/10 Top4, average placement, and win inputs', () => {
    const [candidate] = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external: externalFor([playbooks[0]], { average: 4, top4: 0.6, win: 0.15 }),
    });
    const score = candidate.home!;
    expect(score.modelVersion).toBe(HOME_RECOMMENDATION_MODEL_VERSION);
    expect(score.basePerformance).toBe(
      Math.round(
        (0.7 * score.top4.shrunk +
          0.2 * score.averagePlacement.shrunk +
          0.1 * score.winRate.shrunk) *
          10,
      ) / 10,
    );
    expect(score.finalSafety).toBe(
      Math.round((score.basePerformance + score.lowPickEdge + score.lobbyAdjustment) * 10) / 10,
    );
  });

  it('shrinks a tiny uncertain outcome sample further toward neutral', () => {
    const strong = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external: externalFor([playbooks[0]], {
        sample: 100_000,
        top4: 0.8,
        average: 2.5,
        win: 0.25,
      }),
    })[0].home!;
    const tiny = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external: externalFor([playbooks[0]], { sample: 20, top4: 0.8, average: 2.5, win: 0.25 }),
    })[0].home!;
    expect(Math.abs(tiny.basePerformance - 50)).toBeLessThan(Math.abs(strong.basePerformance - 50));
    expect(tiny.reliability).toBeLessThan(strong.reliability);
  });

  it('gates weak and unreliable rarity while rewarding strong reliable low pick', () => {
    const config = DEFAULT_HOME_RECOMMENDATION_CONFIG;
    expect(lowPickEdge(0.49, 1, 0, config)).toBe(0);
    expect(lowPickEdge(0.675, 1, 0, config)).toBe(3);
    expect(lowPickEdge(0.85, 1, 0, config)).toBe(6);
    expect(lowPickEdge(0.85, 1, 1, config)).toBe(-3);
    expect(lowPickEdge(0.85, 0.2, 0, config)).toBe(0);
    expect(lowPickEdge(0.85, 0.5, 0, config)).toBeLessThan(3);
    expect(lowPickEdge(0.85, 1, null, config)).toBe(0);
    expect(lowPickEdge(null, 1, 0, config)).toBe(0);
  });

  it('ranks Base Performance within a sufficient compatible population', () => {
    expect([
      ...basePerformancePercentiles([
        { id: 'a', value: 40 },
        { id: 'b', value: 50 },
        { id: 'c', value: 60 },
        { id: 'd', value: 70 },
        { id: 'e', value: 80 },
      ]),
    ]).toEqual([
      ['a', 0],
      ['b', 0.25],
      ['c', 0.5],
      ['d', 0.75],
      ['e', 1],
    ]);
    expect([
      ...basePerformancePercentiles([
        { id: 'a', value: 40 },
        { id: 'b', value: 50 },
        { id: 'c', value: 60 },
        { id: 'd', value: 70 },
      ]).values(),
    ]).toEqual([null, null, null, null]);
  });

  it('lets an above-average compatible low-pick route earn a meaningful edge', () => {
    const plans = Array.from({ length: 5 }, (_, index) => {
      const plan = structuredClone(playbooks[0]);
      const championId = data.champions[index].id;
      plan.id = `quality-population-${index}`;
      plan.title = `Quality population ${index}`;
      plan.family.id = `quality-family-${index}`;
      plan.family.core = [championId];
      plan.target.units = [{ championId, slot: 'core' as const, items: [] }];
      return plan;
    });
    const external = externalFor(plans, { picks: [4, 3, 2, 1, 0] });
    const outcomes = [
      { top4: 0.4, average: 5.2, win: 0.05 },
      { top4: 0.5, average: 4.7, win: 0.08 },
      { top4: 0.58, average: 4.2, win: 0.11 },
      { top4: 0.62, average: 3.9, win: 0.13 },
      { top4: 0.7, average: 3.4, win: 0.18 },
    ];
    external.comps.forEach((comp, index) => Object.assign(comp.stats, outcomes[index]));
    const scored = scoreHomeCandidates(plans, {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external,
    });
    const weak = scored.find((entry) => entry.playbook.id === 'quality-population-0')!;
    const strong = scored.find((entry) => entry.playbook.id === 'quality-population-3')!;
    expect(weak.home?.basePerformancePercentile).toBe(0);
    expect(weak.home?.lowPickEdge).toBe(0);
    expect(strong.home?.basePerformancePercentile).toBe(0.8);
    expect(strong.home?.lowPickEdge).toBeGreaterThan(1);
  });
});

describe('Contest Edge v1 lobby adjustment', () => {
  const config = DEFAULT_HOME_RECOMMENDATION_CONFIG;

  it('is asymmetric, neutral without evidence, and bounded by partial coverage', () => {
    expect(lobbyAdjustment(contest(null, 0, true), config)).toBe(0);
    expect(lobbyAdjustment(contest(0, 1), config)).toBe(4);
    expect(lobbyAdjustment(contest(0.5, 1), config)).toBe(-15);
    expect(lobbyAdjustment(contest(0.9, 1), config)).toBe(-27);
    expect(lobbyAdjustment(contest(0.9, 0.69), config)).toBe(-18.6);
    expect(Math.abs(lobbyAdjustment(contest(0.9, 0.69), config))).toBeLessThan(
      Math.abs(lobbyAdjustment(contest(0.9, 1), config)),
    );
  });

  it('ranks a similarly strong clean comp above a pressured comp', () => {
    const a = structuredClone(playbooks[0]);
    const b = structuredClone(playbooks[1]);
    a.features.unitCriticality = { [a.family.core[0]]: 1 };
    a.features.contestElasticity = 1;
    a.roles = [{ championId: a.family.core[0], role: 'carry' }];
    b.features.unitCriticality = { [b.family.core[0]]: 1 };
    b.features.contestElasticity = 1;
    b.roles = [{ championId: b.family.core[0], role: 'carry' }];
    const ranked = scoreHomeCandidates([a, b], {
      data,
      now: NOW,
      config,
      external: externalFor([a, b], { picks: [1, 1] }),
      lobby: lobbyFor(a, 1),
    });
    expect(ranked[0].playbook.id).toBe(b.id);
    expect(ranked.find((entry) => entry.playbook.id === a.id)!.home!.lobbyAdjustment).toBeLessThan(
      0,
    );
    expect(ranked.find((entry) => entry.playbook.id === b.id)!.home!.lobbyAdjustment).toBe(4);
  });

  it('cannot promote a clearly weak route to first from cleanliness alone', () => {
    const strong = structuredClone(playbooks[0]);
    const weak = structuredClone(playbooks[1]);
    const external = externalFor([strong, weak], { picks: [1, 1] });
    Object.assign(external.comps[0].stats, { top4: 0.9, average: 2, win: 0.3 });
    Object.assign(external.comps[1].stats, { top4: 0.3, average: 6, win: 0.03 });
    const ranked = scoreHomeCandidates([strong, weak], {
      data,
      now: NOW,
      config,
      external,
      lobby: lobbyFor(strong, 1),
    });
    expect(ranked[0].playbook.id).toBe(strong.id);
    expect(ranked.find((entry) => entry.playbook.id === weak.id)!.home!.lobbyAdjustment).toBe(4);
  });

  it('keeps unknown criticality, including external-reference boards, neutral', () => {
    const unknown = structuredClone(playbooks[0]);
    unknown.features.unitCriticality = {};
    const [candidate] = scoreHomeCandidates([unknown], {
      data,
      now: NOW,
      config,
      external: externalFor([unknown]),
      lobby: lobbyFor(playbooks[1], 0),
    });
    expect(candidate.contest.state).toBe('Unavailable');
    expect(candidate.home?.lobbyAdjustment).toBe(0);
  });
});

describe('Contest Edge v1 Home portfolio boundary', () => {
  const ids = data.champions.slice(0, 5).map((unit) => unit.id);

  it('always pins the global highest Final Safety candidate at primary #1', () => {
    const candidates = [
      portfolioCandidate(0, 81, [ids[0]]),
      portfolioCandidate(1, 95, [ids[1]]),
      portfolioCandidate(2, 84, [ids[2]]),
      portfolioCandidate(3, 83, [ids[3]]),
    ];
    expect(optimizeHomePortfolio(candidates, NOW).plans[0].candidate.score).toBe(95);
  });

  it('does not let item-opening coverage exclude the global #1', () => {
    const candidates = [
      portfolioCandidate(0, 95, [ids[0]], 'shared', []),
      portfolioCandidate(1, 90, [ids[1]], 'one', ['Bow', 'Sword', 'Vest']),
      portfolioCandidate(2, 89, [ids[2]], 'two', ['Rod', 'Tear', 'Belt']),
      portfolioCandidate(3, 88, [ids[3]], 'three', ['Glove', 'Cloak']),
    ];
    const result = optimizeHomePortfolio(candidates, NOW);
    expect(result.plans[0].candidate.playbook.id).toBe('home-portfolio-0');
    expect(result.interactions.some((entry) => /item|opening/i.test(entry.label))).toBe(false);
  });

  it('uses bounded shared-core redundancy to diversify close #2/#3 scores', () => {
    const candidates = [
      portfolioCandidate(0, 100, [ids[0]], 'shared'),
      portfolioCandidate(1, 99, [ids[0]], 'shared'),
      portfolioCandidate(2, 98.5, [ids[2]], 'distinct-a'),
      portfolioCandidate(3, 98, [ids[3]], 'distinct-b'),
    ];
    const result = optimizeHomePortfolio(candidates, NOW);
    expect(result.plans.map((entry) => entry.candidate.playbook.id)).toEqual([
      'home-portfolio-0',
      'home-portfolio-2',
      'home-portfolio-3',
    ]);
  });

  it('cannot discard a materially stronger route for portfolio diversity', () => {
    const candidates = [
      portfolioCandidate(0, 100, [ids[0]], 'shared'),
      portfolioCandidate(1, 95, [ids[0]], 'shared'),
      portfolioCandidate(2, 92.5, [ids[2]], 'distinct-a'),
      portfolioCandidate(3, 92, [ids[3]], 'distinct-b'),
    ];
    const result = optimizeHomePortfolio(candidates, NOW);
    expect(HOME_DIVERSITY_PENALTY_CAP).toBe(2);
    expect(result.plans.map((entry) => entry.candidate.playbook.id)).toContain('home-portfolio-1');
  });
});

describe('Home boundary, portfolio, checker source, and settings', () => {
  it('Home ignores CurrentGameState while explicit contextual scoring still reacts', () => {
    const result = createRecommendations(data, defaultSettings, NOW);
    const state = {
      data,
      ...result,
      source: 'Bundled snapshot' as const,
      settings: defaultSettings,
      activeSession: null,
      notices: [],
      assets: {},
      personal: null,
      currentGame: emptyCurrentGame(data.version.set, NOW),
    };
    const before = rescoreHomeRecommendations(state, undefined, NOW);
    state.currentGame = {
      ...state.currentGame,
      copies: { [playbooks[0].family.core[0]]: 5 },
      board: [playbooks[0].family.core[0]],
    };
    const after = rescoreHomeRecommendations(state, undefined, NOW);
    expect(after.candidates.map((entry) => [entry.playbook.id, entry.score])).toEqual(
      before.candidates.map((entry) => [entry.playbook.id, entry.score]),
    );
    const contextual = scoreCandidate(playbooks[0], {
      data,
      version: data.version,
      now: NOW,
      currentGame: state.currentGame,
    });
    const neutral = scoreCandidate(playbooks[0], { data, version: data.version, now: NOW });
    expect(contextual.score).not.toBe(neutral.score);
  });

  it('considers every eligible candidate, keeps primary and alternative ids unique, and reuses exact candidate scores', () => {
    const plans = playbooks.slice(0, 10);
    const result = homeRecommendations(plans, {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external: externalFor(plans),
    });
    expect(result.candidates).toHaveLength(plans.length);
    expect(result.portfolio.plans).toHaveLength(3);
    expect(result.alternatives).toHaveLength(5);
    const ids = [
      ...result.portfolio.plans.map((entry) => entry.candidate.playbook.id),
      ...result.alternatives.map((entry) => entry.playbook.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const checked = result.candidates.find(
      (entry) => entry.playbook.id === result.alternatives[0].playbook.id,
    );
    expect(checked).toBe(result.alternatives[0]);
    expect(checked?.home?.finalSafety).toBe(result.alternatives[0].score);
  });

  it('normalizes/persists editable settings and reproduces snapshots by fingerprint', async () => {
    const repo = new MemoryRepository();
    const changed: HomeRecommendationModelConfig = {
      ...DEFAULT_HOME_RECOMMENDATION_CONFIG,
      top4Weight: 0.5,
      averagePlacementWeight: 0.3,
      winRateWeight: 0.2,
      maxHighContestPenalty: 24,
    };
    await repo.set('settings', { ...defaultSettings, homeRecommendation: changed });
    const stored = normalizeSettings(await repo.get('settings'));
    expect(stored.homeRecommendation).toEqual(changed);
    expect(homeConfigFingerprint(stored.homeRecommendation)).toBe(homeConfigFingerprint(changed));
    const external = externalFor([playbooks[0]], { top4: 0.7, average: 4.2, win: 0.12 });
    const defaultScore = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: DEFAULT_HOME_RECOMMENDATION_CONFIG,
      external,
    })[0].score;
    const changedScore = scoreHomeCandidates([playbooks[0]], {
      data,
      now: NOW,
      config: changed,
      external,
    })[0].score;
    expect(changedScore).not.toBe(defaultScore);
    expect(normalizeHomeRecommendationConfig({ top4Weight: Number.NaN })).toEqual(
      DEFAULT_HOME_RECOMMENDATION_CONFIG,
    );
    expect(normalizeHomeRecommendationConfig(null)).toEqual(DEFAULT_HOME_RECOMMENDATION_CONFIG);
  });

  it('records the full Home model identity in immutable plan snapshots', () => {
    const result = createRecommendations(
      data,
      defaultSettings,
      NOW,
      null,
      null,
      null,
      externalFor(playbooks.slice(0, 3)),
    );
    const state = {
      data,
      ...result,
      source: 'Bundled snapshot' as const,
      settings: defaultSettings,
      activeSession: null,
      notices: [],
      assets: {},
      personal: null,
    };
    const session = createPlanSession(
      result.portfolio.plans[0].candidate.playbook.id,
      state,
      result.portfolio,
      null,
      NOW,
      'fixture-session',
    );
    expect(session.snapshot.calibration?.homeModel).toEqual({
      version: HOME_RECOMMENDATION_MODEL_VERSION,
      config: defaultSettings.homeRecommendation,
      configFingerprint: homeConfigFingerprint(defaultSettings.homeRecommendation),
    });
  });

  it('clearing the lobby returns neutral Home pressure without deleting cached history', async () => {
    const repo = new MemoryRepository();
    await repo.set('opponent-profile:fixture', { games: 20 });
    const result = createRecommendations(
      data,
      defaultSettings,
      NOW,
      null,
      null,
      null,
      externalFor(playbooks.slice(0, 3)),
    );
    const state = {
      data,
      ...result,
      source: 'Bundled snapshot' as const,
      settings: defaultSettings,
      activeSession: null,
      notices: [],
      assets: {},
      personal: null,
    };
    const pressured = rescoreHomeRecommendations(state, lobbyFor(playbooks[0], 1), NOW);
    const cleared = rescoreHomeRecommendations(state, undefined, NOW);
    expect(pressured.candidates.some((entry) => entry.home?.lobbyAdjustment !== 0)).toBe(true);
    expect(cleared.candidates.every((entry) => entry.home?.lobbyAdjustment === 0)).toBe(true);
    expect(await repo.get('opponent-profile:fixture')).toEqual({ games: 20 });
  });
});
