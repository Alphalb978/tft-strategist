import type { AggregateMetaDataset, FamilyMetaStats } from '../domain/models';
export const META_CATALOG_VERSION = 'meta-catalog-v1';
/** Representation is conditional on a uniquely classified eligible board, never all players. */
export function familyRepresentation(stat: FamilyMetaStats, meta: AggregateMetaDataset) {
  const denominator =
    meta.statisticsPopulation === 'verified-rank'
      ? (meta.verifiedRank?.observations.filter((o) => o.classification.state === 'classified')
          .length ?? 0)
      : meta.classifiedBoards;
  return {
    rate: denominator ? stat.games / denominator : 0,
    denominator,
    coverage: meta.coverage,
    confidence: Math.min(stat.confidence, meta.coverage),
  };
}
export function familyTrend(familyId: string, meta: AggregateMetaDataset) {
  if (!meta.scope || !meta.observations.length || meta.state !== 'complete') return null;
  const end = Date.parse(meta.collectedAt),
    start = end - meta.scope.windowDays * 86400000;
  const middle = (start + end) / 2;
  const rows = meta.observations.filter(
    (o) => o.classification.state === 'classified' && Date.parse(o.completedAt) >= start,
  );
  const recent = rows.filter((o) => Date.parse(o.completedAt) >= middle);
  const prior = rows.filter((o) => Date.parse(o.completedAt) < middle);
  const a = recent.filter((o) => o.classification.familyId === familyId).length;
  const b = prior.filter((o) => o.classification.familyId === familyId).length;
  if (
    recent.length < 100 ||
    prior.length < 100 ||
    a < 20 ||
    b < 20 ||
    [recent, prior].some(
      (window) =>
        new Set(window.filter((o) => o.classification.familyId === familyId).map((o) => o.matchId))
          .size < 20,
    )
  )
    return null;
  const delta = a / recent.length - b / prior.length;
  const uncertainty =
    1.96 *
    Math.sqrt(
      ((a / recent.length) * (1 - a / recent.length)) / recent.length +
        ((b / prior.length) * (1 - b / prior.length)) / prior.length,
    );
  return {
    delta,
    direction: Math.abs(delta) <= uncertainty ? 'Stable' : delta > 0 ? 'Rising' : 'Falling',
  };
}

export function metaCohortLabel(tiers: string[]) {
  return tiers.includes('MASTER') && tiers.includes('GRANDMASTER') && tiers.includes('CHALLENGER')
    ? 'Master+'
    : tiers.includes('GRANDMASTER') && tiers.includes('CHALLENGER')
      ? 'Grandmaster+'
      : tiers.join(' / ').replace('CHALLENGER', 'Challenger');
}
