import type { ExternalSnapshot } from '../domain/externalMeta';
import { matchExternal, relatedExternal } from './evidenceFusion';
import { externalStatus } from '../providers/externalMeta';
import type { Board, Playbook, StaticData, LobbyPressure } from '../domain/models';
import type { BoardAlternative, CurrentGameState, IntelligenceModel } from '../domain/intelligence';
import { validateBoard, boardTraitCounts } from '../rules/validation';
import { baseCapacityForLevel, usedBoardSlots } from '../rules/ruleSet';
import { stableFingerprint } from '../domain/fingerprint';
export const BOARD_OPTIMIZER = {
  version: 'board-optimizer-v2',
  pool: 22,
  beam: 10,
  steps: 3,
} as const;
export function optimizeBoards(input: {
  external?: ExternalSnapshot | null;
  data: StaticData;
  plan: Playbook;
  intelligence?: IntelligenceModel;
  game?: CurrentGameState;
  lobby?: LobbyPressure;
  desired?: string[];
  desiredTrait?: string;
  targetLevel?: number;
}): BoardAlternative[] {
  const { data, plan, intelligence, game, lobby } = input;
  const external = externalStatus(input.external, data).startsWith('Compatible')
    ? input.external
    : null;
  const level = input.targetLevel ?? plan.target.targetLevel;
  const capacity = baseCapacityForLevel(level);
  if (capacity === null) return [];
  if (
    input.desiredTrait &&
    !data.traits.some(
      (t) => t.id === input.desiredTrait && t.availability === 'verified' && t.breakpoints.length,
    )
  )
    return [];
  const required = [...new Set(input.desired ?? plan.family.core)];
  if (
    required.some(
      (id) =>
        !data.champions.some((c) => c.id === id && c.boardEligible && c.shopStatus === 'pool'),
    )
  )
    return [];
  const observed = plan.observed;
  const coreTraits = new Set(
    data.champions.filter((c) => required.includes(c.id)).flatMap((c) => c.traitIds),
  );
  const pressure = (id: string) =>
    lobby?.unitPressure.find((u) => u.championId === id)?.normalizedPressure ?? 0;
  const reference = relatedExternal(plan, external)?.comp;
  // A public roster is a soft reference, never invented hard core.
  const anchors = new Set(reference?.units ?? []);
  const affinity = (id: string) =>
    (reference?.units.includes(id) ? 4 : 0) +
    (observed?.units.find((u) => u.id === id)?.estimate.frequency ?? 0) * 4 +
    (intelligence?.graph
      .filter(
        (e) => e.estimate.eligible && e.ids.includes(id) && e.ids.some((i) => required.includes(i)),
      )
      .reduce((s, e) => s + Math.max(...e.conditional), 0) ?? 0) +
    data.champions
      .find((c) => c.id === id)!
      .traitIds.filter((t) => coreTraits.has(t) || t === input.desiredTrait).length +
    (game?.copies[id] ? 2 : 0);
  const pool = data.champions
    .filter((c) => c.boardEligible && c.shopStatus === 'pool')
    .sort((a, b) => affinity(b.id) - affinity(a.id) || a.id.localeCompare(b.id))
    .slice(0, BOARD_OPTIMIZER.pool)
    .map((c) => c.id);
  const make = (ids: string[]): Board => ({
    ...plan.target,
    id: `builder-${stableFingerprint(ids.slice().sort())}`,
    targetLevel: level,
    capacity,
    requiredUnits: required,
    units: [...new Set(ids)].sort().map((championId) => ({
      championId,
      items: [],
      slot: required.includes(championId) ? 'core' : 'flex',
    })),
    augmentIds: [],
    traitClaims: [],
    provenance: {
      ...plan.provenance,
      status: 'unverified',
      note: 'Bounded evidence-guided search; no combat simulation or meta proof.',
    },
  });
  const legal = (board: Board) =>
    new Set(board.units.map((u) => u.championId)).size === board.units.length &&
    validateBoard(board, data).length === 0;
  const quality = (board: Board, mode: string): BoardAlternative => {
    const ids = board.units.map((u) => u.championId);
    const prevalence =
      ids.reduce(
        (s, id) => s + (observed?.units.find((u) => u.id === id)?.estimate.frequency ?? 0),
        0,
      ) / Math.max(1, ids.length);
    const pairs =
      intelligence?.graph.filter(
        (e) => e.estimate.eligible && e.ids.every((id) => ids.includes(id)),
      ) ?? [];
    const ranges = ids.map((id) => data.knowledge?.entities[id]?.stats.range);
    const retained = ids.filter((id) => game?.board.includes(id) || game?.copies[id]).length;
    const itemFit =
      observed?.items.filter(
        (i) =>
          i.estimate.eligible &&
          ids.includes(i.holder) &&
          (i.ids.some((id) => game?.items.includes(id)) ||
            i.components.some((id) => game?.components.includes(id))),
      ).length ?? 0;
    const components = [
      {
        label: 'Reference roster retention (soft anchor)',
        value: ids.filter((id) => anchors.has(id)).length * 6,
      },
      {
        label: 'Conditional structure and pairs (shared 35-point budget)',
        value: Math.min(
          35,
          25 * prevalence +
            (10 * pairs.reduce((s, p) => s + Math.max(...p.conditional), 0)) /
              Math.max(1, pairs.length),
        ),
      },
      {
        label: 'Verified active trait structure',
        value: Math.min(
          12,
          boardTraitCounts(board, data).filter(
            (t) => t.status === 'verified' && (t.activeBreakpoint ?? 0) > 0,
          ).length * 3,
        ),
      },
      {
        label: 'Range complementarity',
        value:
          ranges.some((r) => r !== undefined && r <= 1) &&
          ranges.some((r) => r !== undefined && r >= 3)
            ? 4
            : 0,
      },
      { label: 'Owned-unit retention', value: retained * (mode === 'Current-board pivot' ? 3 : 1) },
      {
        label: 'Conditional item-holder fit',
        value: Math.min(8, itemFit * (mode === 'Item-compatible' ? 3 : 1)),
      },
      {
        label: 'Supported observed augment association',
        value: Math.min(
          4,
          observed?.augments.filter(
            (a) => a.estimate.eligible && (a.association ?? 0) > 1 && game?.augments.includes(a.id),
          ).length ?? 0,
        ),
      },
      {
        label: 'Historical unit pressure',
        value: -ids.reduce((s, id) => s + pressure(id), 0) * (mode === 'Low-contest' ? 12 : 3),
      },
      {
        label: 'Rarity and uncertainty burden',
        value:
          -ids.reduce(
            (s, id) => s + Math.max(0, (data.champions.find((c) => c.id === id)?.cost ?? 0) - 3),
            0,
          ) - (observed?.estimate.eligible ? 0 : 8),
      },
      {
        label: 'Related external board support (association)',
        value: Math.min(
          5,
          Math.max(
            0,
            ...(external?.comps ?? [])
              .filter((c) => (c.stats.sample ?? 0) >= 500)
              .map((c) => {
                const match = matchExternal(ids, required, c);
                return match.relation === 'strong' || match.relation === 'variant'
                  ? 5 * match.score
                  : 0;
              }),
          ),
        ),
      },
      { label: 'Unfilled capacity', value: -Math.max(0, capacity - usedBoardSlots(board)) * 8 },
    ];
    const exact = observed?.variants.some(
      (v) =>
        v.estimate.eligible && v.ids.length === ids.length && v.ids.every((id) => ids.includes(id)),
    );
    return {
      label: mode,
      board,
      evidence: exact ? 'Observed' : 'Experimental',
      score: components.reduce((s, c) => s + c.value, 0),
      components,
      version: BOARD_OPTIMIZER.version,
    };
  };
  const modes = [
    'Standard',
    ...(lobby?.coverage ? ['Low-contest'] : []),
    ...(game?.items.length || game?.components.length ? ['Item-compatible'] : []),
    ...(game?.board.length ? ['Current-board pivot'] : []),
  ];
  const output: BoardAlternative[] = [];
  for (const mode of modes) {
    let seed = make([...required, ...plan.target.units.map((u) => u.championId)]);
    while (!legal(seed) && seed.units.some((u) => !required.includes(u.championId)))
      seed = make(
        seed.units
          .filter(
            (u) =>
              u.championId !==
              seed.units
                .slice()
                .reverse()
                .find((x) => !required.includes(x.championId))?.championId,
          )
          .map((u) => u.championId),
      );
    if (!legal(seed)) continue;
    let beam = [quality(seed, mode)];
    const seen = new Set<string>();
    for (let step = 0; step < BOARD_OPTIMIZER.steps; step++) {
      const candidates = [...beam];
      for (const candidate of beam)
        for (const incoming of pool) {
          const ids = candidate.board.units.map((u) => u.championId);
          if (ids.includes(incoming)) continue;
          for (const outgoing of [null, ...ids.filter((id) => !required.includes(id))]) {
            const board = make([...ids.filter((id) => id !== outgoing), incoming]);
            if (seen.has(board.id)) continue;
            seen.add(board.id);
            if (legal(board)) candidates.push(quality(board, mode));
          }
        }
      beam = candidates
        .sort((a, b) => b.score - a.score || a.board.id.localeCompare(b.board.id))
        .slice(0, BOARD_OPTIMIZER.beam);
    }
    const best = beam.find(
      (candidate) =>
        !input.desiredTrait ||
        boardTraitCounts(candidate.board, data).some(
          (t) => t.trait.id === input.desiredTrait && (t.activeBreakpoint ?? 0) > 0,
        ),
    );
    if (best && !output.some((o) => o.board.id === best.board.id)) output.push(best);
  }
  return output;
}
