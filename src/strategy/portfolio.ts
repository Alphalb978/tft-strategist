import type { RecommendationCandidate, RecommendationPortfolio } from '../domain/models';
import { M4_UNIT_MODEL } from './lobbyPressure';
export function portfolioInteractions(candidates: RecommendationCandidate[]) {
  const items = new Set(candidates.flatMap((c) => c.playbook.features.itemCoverage));
  const openings = new Set(candidates.flatMap((c) => c.playbook.features.openingCoverage));
  const styles = new Set(candidates.map((c) => c.playbook.features.style));
  let shared = 0,
    pivots = 0;
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i].playbook,
        b = candidates[j].playbook;
      const aCore = a.family.core.length ? a.family.core : a.target.units.map((u) => u.championId);
      const bCore = b.family.core.length ? b.family.core : b.target.units.map((u) => u.championId);
      const union = new Set([...aCore, ...bCore]);
      shared += aCore.filter((id) => bCore.includes(id)).length / Math.max(1, union.size);
      pivots += [
        ...a.pivots.filter((p) => p.destination === b.id),
        ...b.pivots.filter((p) => p.destination === a.id),
      ].filter((p) => p.trigger.status === 'verified' || p.trigger.status === 'curated').length;
    }
  const pressureExposure = new Map<string, number[]>();
  for (const candidate of candidates)
    for (const unit of candidate.contest.pressuredUnits) {
      const values = pressureExposure.get(unit.championId) ?? [];
      values.push(unit.contribution);
      pressureExposure.set(unit.championId, values);
    }
  const redundantPressure = [...pressureExposure.values()].reduce((total, values) => {
    if (values.length < 2) return total;
    return total + values.reduce((sum, value) => sum + value, 0) - Math.max(...values);
  }, 0);
  return [
    {
      label: 'Shared scenario failure modes',
      value:
        -candidates.reduce(
          (sum, candidate, i) =>
            sum +
            candidates
              .slice(i + 1)
              .reduce(
                (pair, other) =>
                  pair +
                  (candidate.scenarios?.filter(
                    (s) =>
                      s.fit >= 0.75 && other.scenarios?.some((t) => t.id === s.id && t.fit >= 0.75),
                  ).length ?? 0),
                0,
              ),
          0,
        ) * 2,
    },
    {
      label: 'Evidence-backed scenario coverage',
      value: [...new Set(candidates.flatMap((c) => c.scenarios?.map((s) => s.id) ?? []))].reduce(
        (sum, id) =>
          sum +
          Math.max(...candidates.map((c) => c.scenarios?.find((s) => s.id === id)?.fit ?? 0)) * 8,
        0,
      ),
    },
    { label: 'Individual quality', value: candidates.reduce((s, c) => s + c.score, 0) },
    { label: 'Item opening coverage', value: items.size * 4 },
    { label: 'Distinct openings', value: openings.size * 3 },
    { label: 'Roll / level diversity', value: styles.size * 4 },
    { label: 'Verified pivot connections', value: pivots * 3 },
    { label: 'Shared core dependency', value: -shared * 18 },
    {
      label: 'Redundant pressured-unit exposure',
      value: -redundantPressure * M4_UNIT_MODEL.portfolio.redundantPressurePenalty,
    },
  ];
}
export function optimizePortfolio(
  input: RecommendationCandidate[],
  now: string,
): RecommendationPortfolio {
  const candidates = [...input].sort(
    (a, b) => b.score - a.score || a.playbook.id.localeCompare(b.playbook.id),
  );
  let chosen = candidates.slice(0, 3),
    best = -Infinity;
  const consider = (set: RecommendationCandidate[]) => {
    const objective = portfolioInteractions(set).reduce((s, c) => s + c.value, 0);
    if (objective > best) {
      best = objective;
      chosen = set;
    }
  };
  if (candidates.length < 3) consider(candidates);
  for (let i = 0; i < candidates.length - 2; i++)
    for (let j = i + 1; j < candidates.length - 1; j++)
      for (let k = j + 1; k < candidates.length; k++)
        consider([candidates[i], candidates[j], candidates[k]]);
  return {
    plans: chosen.map((candidate, i) => ({
      candidate,
      role:
        i === 0
          ? 'Best current fit'
          : (candidate.scenarios
              ?.slice()
              .sort((a, b) => b.fit - a.fit)
              .find(
                (s) =>
                  !chosen
                    .slice(0, i)
                    .some((c) =>
                      c.scenarios?.some((other) => other.id === s.id && other.fit >= s.fit),
                    ),
              )?.id ??
            (candidate.contest.state === 'Low' ? 'Low-contest fallback' : 'Complementary route')),
    })),
    objective: Number.isFinite(best) ? best : 0,
    interactions: portfolioInteractions(chosen),
    generatedAt: now,
    version: 'portfolio-v5-m11-scenarios',
  };
}
