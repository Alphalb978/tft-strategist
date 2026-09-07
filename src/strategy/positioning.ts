import type { ExternalComp, HexPosition } from '../domain/externalMeta';
import type { Playbook, StaticData } from '../domain/models';
export function validPositions(positions: HexPosition[], ids: string[], capacity: number) {
  return (
    positions.length <= capacity &&
    positions.length <= ids.length &&
    new Set(positions.map((p) => p.championId)).size === positions.length &&
    new Set(positions.map((p) => `${p.row}:${p.column}`)).size === positions.length &&
    positions.every(
      (p) =>
        ids.includes(p.championId) &&
        Number.isInteger(p.row) &&
        p.row >= 0 &&
        p.row < 4 &&
        Number.isInteger(p.column) &&
        p.column >= 0 &&
        p.column < 7,
    )
  );
}
export function positionBoard(
  plan: Playbook,
  data: StaticData,
  external?: { comp: ExternalComp; source: string },
) {
  const ids = plan.target.units.map((u) => u.championId);
  if (
    external?.comp.positions.length &&
    external.comp.units.length === ids.length &&
    external.comp.units.every((id) => ids.includes(id)) &&
    validPositions(external.comp.positions, ids, plan.target.capacity)
  )
    return {
      positions: external.comp.positions,
      label: 'External reference positioning · MetaTFT',
      confidence: 'Source reference',
      reasons: [external.source],
    };
  const exact = plan.strategy.positioning.exact;
  if (
    plan.strategy.positioning.precision === 'exact' &&
    exact.status === 'sourced' &&
    exact.value &&
    validPositions(exact.value, ids, plan.target.capacity)
  )
    return {
      positions: exact.value,
      label: 'Sourced positioning',
      confidence: 'Source reference',
      reasons: [plan.strategy.positioning.note],
    };
  const ranges = ids.map((id) => ({ id, range: data.knowledge?.entities[id]?.stats.range }));
  if (ranges.some((u) => !Number.isFinite(u.range) || u.range! <= 0))
    return {
      positions: [] as HexPosition[],
      label: 'Positioning unavailable',
      confidence: 'Unavailable',
      reasons: ['Verified attack ranges are missing; roster order is not positioning.'],
    };
  const used = new Set<string>();
  const positions = ranges
    .sort((a, b) => a.range! - b.range! || a.id.localeCompare(b.id))
    .map((u) => {
      const rows = u.range! <= 1 ? [0, 1, 2, 3] : u.range! >= 3 ? [3, 2, 1, 0] : [1, 2, 3, 0];
      for (const row of rows)
        for (const column of [3, 2, 4, 1, 5, 0, 6])
          if (!used.has(`${row}:${column}`)) {
            used.add(`${row}:${column}`);
            return { championId: u.id, row, column };
          }
      throw new Error('Board capacity exceeded');
    });
  if (!validPositions(positions, ids, plan.target.capacity))
    return {
      positions: [] as HexPosition[],
      label: 'Positioning unavailable',
      confidence: 'Unavailable',
      reasons: ['Board exceeds legal positioning capacity.'],
    };
  const frontline = positions.filter((p) => p.row <= 1).length,
    backline = positions.filter((p) => p.row >= 2).length;
  return {
    positions,
    label: 'Suggested positioning · mechanically derived',
    confidence: 'Low',
    reasons: [
      `Verified range only: ${frontline} forward / ${backline} rear units.`,
      backline && !frontline
        ? 'Backline has no forward coverage.'
        : 'Forward units provide geometric coverage; combat protection is not simulated.',
      'Adjacency, opponent targeting and matchup variants unavailable.',
    ],
  };
}
