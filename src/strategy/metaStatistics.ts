import type {
  AggregateMetaDataset,
  FamilyMetaStats,
  MetaObservation,
  Playbook,
} from '../domain/models';
const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

export const META_STATISTICS = {
  version: 'set18-meta-statistics-v1',
  halfLifeDays: 14,
  binomialPriorStrength: 16,
  placementPriorStrength: 12,
  quality: { minimumGames: 20, minimumConfidence: 0.45, maximumAgeDays: 21 },
} as const;

const DAY = 86_400_000;
const wilson = (successes: number, games: number, z = 1.96) => {
  if (!games) return { lower: 0, upper: 1 };
  const p = successes / games;
  const denominator = 1 + (z * z) / games;
  const centre = p + (z * z) / (2 * games);
  const spread = z * Math.sqrt((p * (1 - p)) / games + (z * z) / (4 * games * games));
  return { lower: (centre - spread) / denominator, upper: (centre + spread) / denominator };
};
const estimate = (successes: number, games: number, baseline: number) => ({
  raw: games ? successes / games : 0,
  shrunk:
    (successes + baseline * META_STATISTICS.binomialPriorStrength) /
    (games + META_STATISTICS.binomialPriorStrength),
  ...wilson(successes, games),
});
const weightAt = (completedAt: string, nowMs: number) =>
  Math.exp(
    (-Math.log(2) * Math.max(0, nowMs - Date.parse(completedAt))) /
      (META_STATISTICS.halfLifeDays * DAY),
  );

export function deriveFamilyStatistics(
  observations: MetaObservation[],
  families: Playbook[],
  now: string,
): FamilyMetaStats[] {
  const nowMs = Date.parse(now);
  const placed = observations.filter((item) => item.placement >= 1 && item.placement <= 8);
  const globalGames = Math.max(1, placed.length);
  const globalTop4 = placed.filter((item) => item.placement <= 4).length / globalGames;
  const globalWins = placed.filter((item) => item.placement === 1).length / globalGames;
  const globalBot4 = placed.filter((item) => item.placement >= 5).length / globalGames;
  const globalPlacement = placed.reduce((sum, item) => sum + item.placement, 0) / globalGames;
  const totalWeight = Math.max(
    Number.EPSILON,
    placed.reduce((sum, item) => sum + weightAt(item.completedAt, nowMs), 0),
  );
  return families
    .map((family) => {
      const rows = placed.filter(
        (item) =>
          item.classification.state === 'classified' &&
          item.classification.familyId === family.family.id,
      );
      if (!rows.length) return null;
      const weights = rows.map((row) => weightAt(row.completedAt, nowMs));
      const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
      const squareWeightSum = weights.reduce((sum, weight) => sum + weight * weight, 0);
      const effectiveSample = (weightSum * weightSum) / Math.max(Number.EPSILON, squareWeightSum);
      const games = rows.length;
      const averagePlacement = rows.reduce((sum, row) => sum + row.placement, 0) / games;
      const weightedAveragePlacement =
        rows.reduce((sum, row, index) => sum + row.placement * weights[index], 0) / weightSum;
      const shrunkAveragePlacement =
        (weightedAveragePlacement * effectiveSample +
          globalPlacement * META_STATISTICS.placementPriorStrength) /
        (effectiveSample + META_STATISTICS.placementPriorStrength);
      const variance =
        rows.reduce(
          (sum, row, index) =>
            sum + weights[index] * (row.placement - weightedAveragePlacement) ** 2,
          0,
        ) / weightSum;
      const topFour = estimate(rows.filter((row) => row.placement <= 4).length, games, globalTop4);
      const wins = estimate(rows.filter((row) => row.placement === 1).length, games, globalWins);
      const botFour = estimate(rows.filter((row) => row.placement >= 5).length, games, globalBot4);
      const freshestGameAt = rows
        .map((row) => row.completedAt)
        .sort()
        .at(-1)!;
      const ageDays = Math.max(0, nowMs - Date.parse(freshestGameAt)) / DAY;
      const averageClassifierScore =
        rows.reduce((sum, row) => sum + row.classification.score, 0) / games;
      const averageClassifierMargin =
        rows.reduce((sum, row) => sum + row.classification.margin, 0) / games;
      const sampleQuality = games / (games + 30);
      const freshness = Math.exp(-ageDays / 21);
      const classificationQuality = clamp(
        0.65 * averageClassifierScore + 0.35 * clamp(averageClassifierMargin / 0.25),
      );
      const confidence = clamp(
        sampleQuality * 0.5 + freshness * 0.25 + classificationQuality * 0.25,
      );
      const placementStrength = clamp((8.5 - shrunkAveragePlacement) / 7.5);
      const measuredStrength =
        100 *
        clamp(
          0.5 * placementStrength +
            0.35 * topFour.shrunk +
            0.15 * wins.shrunk -
            0.2 * (1 - confidence),
        );
      const quality =
        games >= META_STATISTICS.quality.minimumGames &&
        confidence >= META_STATISTICS.quality.minimumConfidence &&
        ageDays <= META_STATISTICS.quality.maximumAgeDays
          ? ('eligible' as const)
          : ('insufficient' as const);
      return {
        familyId: family.family.id,
        games,
        uniqueMatches: new Set(rows.map((row) => row.matchId)).size,
        rawFrequency: games / globalGames,
        weightedFrequency: weightSum / totalWeight,
        averagePlacement,
        weightedAveragePlacement,
        shrunkAveragePlacement,
        averagePlacementStandardError: Math.sqrt(variance / Math.max(1, effectiveSample)),
        topFour,
        wins,
        botFour,
        placementCounts: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [
            String(index + 1),
            rows.filter((row) => row.placement === index + 1).length,
          ]),
        ),
        effectiveSample,
        averageClassifierScore,
        averageClassifierMargin,
        freshestGameAt,
        ageDays,
        confidence,
        measuredStrength,
        measuredFloor: 100 * clamp(0.7 * topFour.shrunk + 0.3 * (1 - botFour.shrunk)),
        measuredCeiling: 100 * clamp(wins.shrunk / Math.max(0.25, globalWins * 2)),
        quality,
      } satisfies FamilyMetaStats;
    })
    .filter((value): value is FamilyMetaStats => value !== null)
    .sort(
      (a, b) => b.measuredStrength - a.measuredStrength || a.familyId.localeCompare(b.familyId),
    );
}

export function compatibleMetaDataset(
  dataset: AggregateMetaDataset | null | undefined,
  expected: Pick<
    AggregateMetaDataset,
    | 'classifierVersion'
    | 'statisticsVersion'
    | 'familyDefinitionsFingerprint'
    | 'staticSourceVersion'
  >,
) {
  return Boolean(
    dataset &&
      dataset.schemaVersion === 1 &&
      Array.isArray(dataset.observations) &&
      Array.isArray(dataset.familyStats) &&
      dataset.set === 18 &&
      dataset.classifierVersion === expected.classifierVersion &&
      dataset.statisticsVersion === expected.statisticsVersion &&
      dataset.familyDefinitionsFingerprint === expected.familyDefinitionsFingerprint &&
      dataset.staticSourceVersion === expected.staticSourceVersion &&
      dataset.derivationFingerprint,
  );
}
