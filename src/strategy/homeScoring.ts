import type { ExternalSnapshot } from '../domain/externalMeta';
import { stableFingerprint } from '../domain/fingerprint';
import type {
  AggregateMetaDataset,
  DiscoveryDataset,
  HomeRecommendationModelConfig,
  HomeScoreBreakdown,
  HomeScoreMetric,
  LobbyPressure,
  Playbook,
  RecommendationCandidate,
  RecommendationPortfolio,
  StaticData,
} from '../domain/models';
import { fusedForPlan, relatedExternal } from './evidenceFusion';
import { clamp, scoreCandidate } from './scoring';

export const HOME_RECOMMENDATION_MODEL_VERSION = 'contest-edge-v1';
export const HOME_BASE_PERCENTILE_MINIMUM_POPULATION = 5;
export const HOME_DIVERSITY_PENALTY_CAP = 2;

export const DEFAULT_HOME_RECOMMENDATION_CONFIG: HomeRecommendationModelConfig = {
  top4Weight: 0.7,
  averagePlacementWeight: 0.2,
  winRateWeight: 0.1,
  lowPickQualityGate: 50,
  lowPickQualityRamp: 35,
  lowPickMinimumReliability: 0.35,
  lowPickCurve: 1,
  maxLowPickBonus: 6,
  maxPopularityPenalty: 3,
  maxCleanLobbyBonus: 4,
  maxMediumContestPenalty: 15,
  maxHighContestPenalty: 30,
  lobbyCoverageExponent: 1,
};

const round = (value: number) => Math.round(value * 10) / 10;

function finite(value: unknown, fallback: number, low: number, high: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback;
}

/**
 * Persisted settings are fail-safe: invalid fields return to their documented defaults and
 * distribution weights are normalized. The editor separately reports invalid user input.
 */
export function normalizeHomeRecommendationConfig(
  value?: Partial<HomeRecommendationModelConfig> | null,
): HomeRecommendationModelConfig {
  const defaults = DEFAULT_HOME_RECOMMENDATION_CONFIG;
  const rawWeights = [
    finite(value?.top4Weight, defaults.top4Weight, 0, 1),
    finite(value?.averagePlacementWeight, defaults.averagePlacementWeight, 0, 1),
    finite(value?.winRateWeight, defaults.winRateWeight, 0, 1),
  ];
  const total = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const weights = (total > 0 ? rawWeights.map((weight) => weight / total) : [0.7, 0.2, 0.1]).map(
    (weight) => Math.round(weight * 1_000_000) / 1_000_000,
  );
  weights[0] =
    Math.round((weights[0] + 1 - weights.reduce((sum, weight) => sum + weight, 0)) * 1_000_000) /
    1_000_000;
  const mediumContestPenalty = finite(
    value?.maxMediumContestPenalty,
    defaults.maxMediumContestPenalty,
    0,
    30,
  );
  const highContestPenalty = Math.max(
    mediumContestPenalty,
    finite(value?.maxHighContestPenalty, defaults.maxHighContestPenalty, 0, 50),
  );
  return {
    top4Weight: weights[0],
    averagePlacementWeight: weights[1],
    winRateWeight: weights[2],
    lowPickQualityGate: finite(value?.lowPickQualityGate, defaults.lowPickQualityGate, 0, 100),
    lowPickQualityRamp: finite(value?.lowPickQualityRamp, defaults.lowPickQualityRamp, 1, 50),
    lowPickMinimumReliability: finite(
      value?.lowPickMinimumReliability,
      defaults.lowPickMinimumReliability,
      0,
      0.95,
    ),
    lowPickCurve: finite(value?.lowPickCurve, defaults.lowPickCurve, 0.25, 4),
    maxLowPickBonus: finite(value?.maxLowPickBonus, defaults.maxLowPickBonus, 0, 15),
    maxPopularityPenalty: finite(value?.maxPopularityPenalty, defaults.maxPopularityPenalty, 0, 10),
    maxCleanLobbyBonus: finite(value?.maxCleanLobbyBonus, defaults.maxCleanLobbyBonus, 0, 10),
    maxMediumContestPenalty: mediumContestPenalty,
    maxHighContestPenalty: highContestPenalty,
    lobbyCoverageExponent: finite(
      value?.lobbyCoverageExponent,
      defaults.lobbyCoverageExponent,
      0.25,
      3,
    ),
  };
}

export function homeRecommendationConfigErrors(value: HomeRecommendationModelConfig): string[] {
  const errors: string[] = [];
  for (const [key, entry] of Object.entries(value))
    if (!Number.isFinite(entry)) errors.push(`${key} must be a finite number.`);
  const weightTotal = value.top4Weight + value.averagePlacementWeight + value.winRateWeight;
  if (weightTotal <= 0) errors.push('At least one Base Performance weight must be positive.');
  if (
    [value.top4Weight, value.averagePlacementWeight, value.winRateWeight].some(
      (weight) => weight < 0 || weight > 1,
    )
  )
    errors.push('Base Performance weights must be between 0% and 100%.');
  if (
    value.maxHighContestPenalty < value.maxMediumContestPenalty ||
    value.maxMediumContestPenalty < 0
  )
    errors.push('High-contest penalty must be at least the medium-contest penalty.');
  const normalized = normalizeHomeRecommendationConfig(value);
  for (const key of Object.keys(value) as (keyof HomeRecommendationModelConfig)[])
    if (value[key] !== normalized[key] && !key.endsWith('Weight'))
      errors.push(`${key} is outside its supported range.`);
  return [...new Set(errors)];
}

export function homeConfigFingerprint(config: HomeRecommendationModelConfig) {
  return stableFingerprint({ version: HOME_RECOMMENDATION_MODEL_VERSION, config });
}

function normalizeTop4(value: number) {
  return 100 * clamp(value);
}

function normalizeAverage(value: number) {
  return 100 * clamp((8 - value) / 7);
}

function normalizeWin(value: number) {
  // A 12.5% win rate is neutral (50); 25% reaches the model ceiling.
  return 100 * clamp(value / 0.25);
}

function metric(raw: number | null, normalize: (value: number) => number, reliability: number) {
  const normalized = raw === null ? 50 : normalize(raw);
  return {
    raw,
    normalized: round(normalized),
    shrunk: round(50 + clamp(reliability) * (normalized - 50)),
  } satisfies HomeScoreMetric;
}

interface OutcomeEvidence {
  average: number | null;
  top4: number | null;
  win: number | null;
  reliability: number;
  sample: number | null;
  source: string;
}

function outcomeEvidence(
  plan: Playbook,
  data: StaticData,
  now: string,
  external: ExternalSnapshot | null | undefined,
  meta: AggregateMetaDataset | null | undefined,
  discovery: DiscoveryDataset | null | undefined,
): OutcomeEvidence {
  const fused = fusedForPlan(plan, external, data, now);
  if (fused.externalWeight + fused.internalWeight > 0)
    return {
      average: fused.average,
      top4: fused.top4,
      win: fused.win,
      reliability: fused.confidence,
      sample: round(fused.externalWeight + fused.internalWeight),
      source: 'Compatible fused external/direct evidence',
    };
  const cluster = plan.discovery
    ? discovery?.clusters.find((entry) => entry.id === plan.discovery?.clusterId)
    : undefined;
  if (cluster?.recommendationEligible)
    return {
      average: cluster.stats.averagePlacement,
      top4: cluster.stats.topFour.shrunk,
      win: cluster.stats.wins.shrunk,
      reliability: cluster.stats.confidence,
      sample: cluster.stats.effectiveSample,
      source: 'Compatible discovery evidence',
    };
  const measured = meta?.familyStats.find((entry) => entry.familyId === plan.family.id);
  if (measured?.quality === 'eligible')
    return {
      average: measured.shrunkAveragePlacement,
      top4: measured.topFour.shrunk,
      win: measured.wins.shrunk,
      reliability: measured.confidence,
      sample: measured.effectiveSample,
      source: 'Compatible direct aggregate evidence',
    };
  return {
    average: null,
    top4: null,
    win: null,
    reliability: 0,
    sample: measured?.effectiveSample ?? null,
    source: 'Outcome evidence unavailable',
  };
}

function explicitPickRate(plan: Playbook, external?: ExternalSnapshot | null) {
  if (!external?.manifest.scope.rank || !external.manifest.scope.window) return null;
  const pickRate = relatedExternal(plan, external)?.comp.pickRate;
  return pickRate && Number.isFinite(pickRate.value)
    ? { value: pickRate.value, unit: pickRate.unit }
    : null;
}

function populationPercentiles(
  values: { id: string; value: number | null }[],
  minimumPopulation: number,
) {
  const available = values.filter(
    (entry): entry is { id: string; value: number } => entry.value !== null,
  );
  return new Map(
    values.map((entry) => {
      if (entry.value === null || available.length < minimumPopulation)
        return [entry.id, null] as const;
      const less = available.filter((other) => other.value < entry.value!).length;
      const equal = available.filter((other) => other.value === entry.value).length;
      return [entry.id, (less + (equal - 1) / 2) / (available.length - 1)] as const;
    }),
  );
}

export function popularityPercentiles(values: { id: string; value: number | null }[]) {
  return populationPercentiles(values, 2);
}

export function basePerformancePercentiles(values: { id: string; value: number | null }[]) {
  return populationPercentiles(values, HOME_BASE_PERCENTILE_MINIMUM_POPULATION);
}

export function lowPickEdge(
  basePerformancePercentile: number | null,
  reliability: number,
  popularityPercentile: number | null,
  config: HomeRecommendationModelConfig,
) {
  if (popularityPercentile === null || basePerformancePercentile === null) return 0;
  const quality = clamp(
    (basePerformancePercentile * 100 - config.lowPickQualityGate) / config.lowPickQualityRamp,
  );
  const evidence = clamp(
    (reliability - config.lowPickMinimumReliability) / (1 - config.lowPickMinimumReliability),
  );
  if (quality <= 0 || evidence <= 0) return 0;
  const rarity = clamp((0.5 - popularityPercentile) / 0.5);
  const popularity = clamp((popularityPercentile - 0.5) / 0.5);
  const shape = (signal: number) => signal ** config.lowPickCurve;
  return round(
    quality *
      evidence *
      (config.maxLowPickBonus * shape(rarity) - config.maxPopularityPenalty * shape(popularity)),
  );
}

export function lobbyAdjustment(
  contest: RecommendationCandidate['contest'],
  config: HomeRecommendationModelConfig,
) {
  if (contest.value === null || contest.provenance === 'unavailable') return 0;
  const value = clamp(contest.value);
  const hasObservedRouteContest =
    (contest.routeEvidence?.opponentsWithRouteMatch ?? 0) > 0 ||
    (contest.routeContest !== null && contest.routeContest !== undefined && contest.routeContest > 0);
  const hasObservedUnitContest =
    (contest.unitContest !== null && contest.unitContest !== undefined && contest.unitContest >= 0.15) ||
    (contest.pressuredUnits ?? []).some((u) => u.membership === 'core' && u.lobbyPressure >= 0.15);

  let nominal = 0;
  if (value < 0.2) {
    if (hasObservedRouteContest || hasObservedUnitContest) {
      // Meaningful observed contest exists, but low confidence or elasticity reduced it.
      // Uncertainty reduces the penalty toward neutral (0), but never awards a clean-lobby bonus.
      nominal = 0;
    } else {
      nominal = config.maxCleanLobbyBonus * (1 - value / 0.2);
    }
  } else if (value < 0.5) {
    nominal = -config.maxMediumContestPenalty * ((value - 0.2) / 0.3);
  } else {
    nominal =
      -config.maxMediumContestPenalty -
      (config.maxHighContestPenalty - config.maxMediumContestPenalty) * ((value - 0.5) / 0.5);
  }
  const coverage = clamp(contest.evidenceCoverage) ** config.lobbyCoverageExponent;
  return round(nominal * coverage);
}

export interface HomeScoringContext {
  data: StaticData;
  now: string;
  config: HomeRecommendationModelConfig;
  external?: ExternalSnapshot | null;
  meta?: AggregateMetaDataset | null;
  discovery?: DiscoveryDataset | null;
  lobby?: LobbyPressure;
}

export function scoreHomeCandidates(playbooks: Playbook[], context: HomeScoringContext) {
  const config = normalizeHomeRecommendationConfig(context.config);
  const prepared = playbooks.map((playbook) => {
    const evidence = outcomeEvidence(
      playbook,
      context.data,
      context.now,
      context.external,
      context.meta,
      context.discovery,
    );
    const top4 = metric(evidence.top4, normalizeTop4, evidence.reliability);
    const averagePlacement = metric(evidence.average, normalizeAverage, evidence.reliability);
    const winRate = metric(evidence.win, normalizeWin, evidence.reliability);
    const basePerformance = round(
      config.top4Weight * top4.shrunk +
        config.averagePlacementWeight * averagePlacement.shrunk +
        config.winRateWeight * winRate.shrunk,
    );
    return {
      playbook,
      evidence,
      top4,
      averagePlacement,
      winRate,
      basePerformance,
      pickRate: explicitPickRate(playbook, context.external),
    };
  });
  const percentiles = popularityPercentiles(
    prepared.map((entry) => ({ id: entry.playbook.id, value: entry.pickRate?.value ?? null })),
  );
  const performancePercentiles = basePerformancePercentiles(
    prepared.map((entry) => ({
      id: entry.playbook.id,
      value:
        entry.evidence.reliability > 0 &&
        [entry.evidence.top4, entry.evidence.average, entry.evidence.win].some(
          (metric) => metric !== null,
        )
          ? entry.basePerformance
          : null,
    })),
  );
  return prepared
    .map((entry): RecommendationCandidate => {
      const generic = scoreCandidate(entry.playbook, {
        data: context.data,
        version: context.data.version,
        now: context.now,
        lobby: context.lobby,
        meta: context.meta,
        discovery: context.discovery,
        external: context.external,
      });
      const percentile = percentiles.get(entry.playbook.id) ?? null;
      const performancePercentile = performancePercentiles.get(entry.playbook.id) ?? null;
      const rarity = lowPickEdge(
        performancePercentile,
        entry.evidence.reliability,
        percentile,
        config,
      );
      const lobby = lobbyAdjustment(generic.contest, config);
      const finalSafety = round(clamp(entry.basePerformance + rarity + lobby, 0, 100));
      const home: HomeScoreBreakdown = {
        modelVersion: HOME_RECOMMENDATION_MODEL_VERSION,
        config,
        configFingerprint: homeConfigFingerprint(config),
        basePerformance: entry.basePerformance,
        lowPickEdge: rarity,
        lobbyAdjustment: lobby,
        finalSafety,
        reliability: round(entry.evidence.reliability),
        evidenceSource: entry.evidence.source,
        evidenceSample: entry.evidence.sample,
        top4: entry.top4,
        averagePlacement: entry.averagePlacement,
        winRate: entry.winRate,
        pickRate: entry.pickRate,
        basePerformancePercentile:
          performancePercentile === null ? null : round(performancePercentile),
        popularityPercentile: percentile === null ? null : round(percentile),
      };
      return {
        ...generic,
        score: finalSafety,
        home,
        reasons: [
          `Base ${home.basePerformance.toFixed(1)} · low-pick ${home.lowPickEdge >= 0 ? '+' : ''}${home.lowPickEdge.toFixed(1)} · lobby ${home.lobbyAdjustment >= 0 ? '+' : ''}${home.lobbyAdjustment.toFixed(1)}.`,
          `${home.evidenceSource} · ${Math.round(home.reliability * 100)}% reliability.`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id));
}

function sharedCoreOverlap(a: RecommendationCandidate, b: RecommendationCandidate) {
  const left = a.playbook.family.core;
  const right = b.playbook.family.core;
  if (!left.length || !right.length) return 0;
  const shared = left.filter((id) => right.includes(id)).length;
  return shared / Math.min(left.length, right.length);
}

function redundantPressureOverlap(a: RecommendationCandidate, b: RecommendationCandidate) {
  const right = new Map(
    b.contest.pressuredUnits.map((unit) => [unit.championId, Math.max(0, unit.contribution)]),
  );
  return clamp(
    a.contest.pressuredUnits.reduce(
      (sum, unit) =>
        sum + Math.min(Math.max(0, unit.contribution), right.get(unit.championId) ?? 0),
      0,
    ),
  );
}

function homeRedundancyParts(a: RecommendationCandidate, b: RecommendationCandidate) {
  return {
    sharedCore: 1.2 * sharedCoreOverlap(a, b),
    pressure: 0.6 * redundantPressureOverlap(a, b),
    style: a.playbook.features.style === b.playbook.features.style ? 0.2 : 0,
  };
}

export function homeRedundancyPenalty(
  candidate: RecommendationCandidate,
  chosen: RecommendationCandidate[],
) {
  return Math.min(
    HOME_DIVERSITY_PENALTY_CAP,
    chosen.reduce((sum, other) => {
      const parts = homeRedundancyParts(candidate, other);
      return sum + parts.sharedCore + parts.pressure + parts.style;
    }, 0),
  );
}

export function optimizeHomePortfolio(
  input: RecommendationCandidate[],
  now: string,
): RecommendationPortfolio {
  const remaining = [...input].sort(
    (a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id),
  );
  const chosen: RecommendationCandidate[] = [];
  if (remaining.length) chosen.push(remaining.shift()!);
  while (chosen.length < 3 && remaining.length) {
    remaining.sort((a, b) => {
      const aUtility = a.score - homeRedundancyPenalty(a, chosen);
      const bUtility = b.score - homeRedundancyPenalty(b, chosen);
      return bUtility - aUtility || b.score - a.score || a.playbook.id.localeCompare(b.playbook.id);
    });
    chosen.push(remaining.shift()!);
  }
  const pairs = chosen.flatMap((candidate, index) =>
    chosen.slice(index + 1).map((other) => homeRedundancyParts(candidate, other)),
  );
  const interactions = [
    {
      label: 'Individual Final Safety',
      value: chosen.reduce((sum, entry) => sum + entry.score, 0),
    },
    {
      label: 'Shared core anti-redundancy',
      value: -pairs.reduce((sum, entry) => sum + entry.sharedCore, 0),
    },
    {
      label: 'Redundant pressured-unit exposure',
      value: -pairs.reduce((sum, entry) => sum + entry.pressure, 0),
    },
    {
      label: 'Supported style repetition',
      value: -pairs.reduce((sum, entry) => sum + entry.style, 0),
    },
  ].map((entry) => ({ ...entry, value: round(entry.value) }));
  return {
    plans: chosen.map((candidate, index) => ({
      candidate,
      role:
        index === 0
          ? 'Best Final Safety'
          : candidate.contest.state === 'Low'
            ? 'Low-contest alternative'
            : 'Complementary route',
    })),
    objective: round(interactions.reduce((sum, entry) => sum + entry.value, 0)),
    interactions,
    generatedAt: now,
    version: 'home-portfolio-contest-edge-v1',
  };
}

export function selectAlternativeCandidates(
  candidates: RecommendationCandidate[],
  portfolio: RecommendationPortfolio,
  limit = 5,
) {
  const primary = new Set(portfolio.plans.map((entry) => entry.candidate.playbook.id));
  return candidates.filter((entry) => !primary.has(entry.playbook.id)).slice(0, limit);
}

export function homeRecommendations(
  playbooks: Playbook[],
  context: HomeScoringContext,
): {
  portfolio: RecommendationPortfolio;
  candidates: RecommendationCandidate[];
  alternatives: RecommendationCandidate[];
} {
  const candidates = scoreHomeCandidates(playbooks, context);
  const portfolio = optimizeHomePortfolio(candidates, context.now);
  return {
    portfolio,
    candidates,
    alternatives: selectAlternativeCandidates(candidates, portfolio),
  };
}
