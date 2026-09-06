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
      const union = new Set([...a.family.core, ...b.family.core]);
      shared +=
        a.family.core.filter((id) => b.family.core.includes(id)).length / Math.max(1, union.size);
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
          ? 'Primary route'
          : candidate.playbook.features.itemCoverage.includes('Tear')
            ? 'AP coverage'
            : 'Alternate opening',
    })),
    objective: Number.isFinite(best) ? best : 0,
    interactions: portfolioInteractions(chosen),
    generatedAt: now,
    version: 'portfolio-v4-m6-discovery',
  };
}
