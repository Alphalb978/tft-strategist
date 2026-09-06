import type { Playbook, StaticData } from '../domain/models';
export interface ObservedStyle {
  version: 'style-v1';
  label: string;
  kind: 'sourced' | 'observed' | 'unavailable';
  confidence: number;
  reasons: string[];
}
/** Final-level shape is a cap estimate, never proof of the round a player rolled. */
export function classifyObservedStyle(plan: Playbook, data: StaticData): ObservedStyle {
  const source = plan.strategy.rollPlan;
  const result = (
    label: string,
    kind: ObservedStyle['kind'],
    confidence: number,
    reasons: string[],
  ): ObservedStyle => ({ version: 'style-v1', label, kind, confidence, reasons });
  if (source.status === 'sourced' && source.value?.length) {
    const slow = source.value.find((m) => m.kind === 'slow-roll');
    const roll = source.value.find((m) => m.kind === 'roll');
    if (slow)
      return result(
        slow.targetLevel ? `Level ${slow.targetLevel} Slow Roll` : 'Slow Roll',
        'sourced',
        1,
        [slow.label, source.note],
      );
    if (roll?.targetLevel)
      return result(`Level ${roll.targetLevel} Reroll`, 'sourced', 1, [roll.label, source.note]);
    const fast = source.value.find((m) => /fast\s*[89]/i.test(m.label));
    if (fast) return result(fast.label, 'sourced', 1, [source.note]);
  }
  const p = plan.observed;
  if (!p?.estimate.eligible)
    return result('Style not established', 'unavailable', p?.estimate.confidence ?? 0, [
      'Insufficient compatible match evidence and no verified roll identity.',
    ]);
  const total = Object.values(p.levels).reduce((a, b) => a + b, 0);
  const core = p.units.filter((u) => u.role === 'core');
  const cost = (id: string) => data.champions.find((c) => c.id === id)?.cost ?? 0;
  const threeStar = core.filter(
    (u) => (u.stars['3'] ?? 0) / Math.max(1, u.estimate.sample) >= 0.5 && cost(u.id) <= 3,
  );
  const modal = Object.entries(p.levels).sort((a, b) => b[1] - a[1])[0];
  const share = modal ? modal[1] / Math.max(1, total) : 0;
  const reasons = [
    `${Math.round(share * 100)}% ended at level ${modal?.[0] ?? '?'}`,
    `${threeStar.length} low-cost core units were 3★ in at least half their boards`,
    `${p.estimate.uniqueMatches} compatible matches`,
  ];
  if (threeStar.length && Number(modal?.[0]) <= 7 && share >= 0.6)
    return result(`Level ${modal[0]} reroll-like`, 'observed', p.estimate.confidence, reasons);
  if (modal?.[0] === '9' && share >= 0.65 && core.filter((u) => cost(u.id) >= 5).length >= 2)
    return result('Fast-9-like / Level 9 cap', 'observed', p.estimate.confidence, reasons);
  if (
    modal?.[0] === '8' &&
    share >= 0.65 &&
    core.some(
      (u) => cost(u.id) === 4 && (u.stars['2'] ?? 0) / Math.max(1, u.estimate.sample) >= 0.6,
    )
  )
    return result('Fast-8-like / Level 8 cap', 'observed', p.estimate.confidence, reasons);
  return result('Flexible / Mixed', 'observed', p.estimate.confidence, reasons);
}
