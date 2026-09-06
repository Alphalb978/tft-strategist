import type {
  Board,
  ID,
  Playbook,
  RecommendationPortfolio,
  StrategyDecisionMap,
  StrategyDecisionNode,
  StrategyFact,
  StrategyFactStatus,
  StaticData,
  TraitDelta,
} from '../domain/models';
import { validateBoard } from '../rules/validation';
import { activeBreakpoint, traitCount, usedBoardSlots } from '../rules/ruleSet';

export const DECISION_MAP_VERSION = 'decision-map-v1';
export const PIVOT_GRAPH_VERSION = 'portfolio-pivot-v1';

export interface DecisionMapIssue {
  code: 'missing-root' | 'missing-node' | 'cycle' | 'unsupported-condition';
  message: string;
}

const allowedConditions = new Set([
  'manual-core-signal',
  'manual-item-direction',
  'manual-augment-category',
  'manual-economy-tempo',
  'lobby-contest',
  'manual-level-roll',
  'manual-missing-unit',
  'navigation',
]);

export function validateDecisionMap(map: StrategyDecisionMap): DecisionMapIssue[] {
  if (map.status === 'unavailable') return [];
  const issues: DecisionMapIssue[] = [];
  const nodes = new Set(map.nodes.map((node) => node.id));
  if (!map.rootNodeId || !nodes.has(map.rootNodeId))
    issues.push({ code: 'missing-root', message: 'Decision Map root is missing.' });
  for (const edge of map.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      issues.push({ code: 'missing-node', message: `Decision edge ${edge.id} is disconnected.` });
    if (!allowedConditions.has(edge.conditionKind))
      issues.push({
        code: 'unsupported-condition',
        message: `Decision edge ${edge.id} requests unsupported live state.`,
      });
  }
  const outgoing = new Map<ID, ID[]>();
  for (const edge of map.edges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const visiting = new Set<ID>();
  const visited = new Set<ID>();
  const visit = (id: ID) => {
    if (visiting.has(id)) {
      issues.push({ code: 'cycle', message: `Decision Map cycle reaches ${id}.` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of outgoing.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  if (map.rootNodeId) visit(map.rootNodeId);
  return issues;
}

export function traverseDecisionMap(
  map: StrategyDecisionMap,
  currentNodeId: ID,
  edgeId: ID,
): StrategyDecisionNode | null {
  if (validateDecisionMap(map).length) return null;
  const edge = map.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || edge.from !== currentNodeId) return null;
  return map.nodes.find((node) => node.id === edge.to) ?? null;
}

export interface ReplacementDerivation {
  board: Board;
  traitDelta: TraitDelta[];
  capacityDelta: number;
  legal: boolean;
  warning: string;
}

export function deriveReplacement(
  board: Board,
  targetUnitId: ID,
  substituteUnitId: ID,
  data: StaticData,
): ReplacementDerivation {
  const index = board.units.findIndex((unit) => unit.championId === targetUnitId);
  const substitute = data.champions.find((unit) => unit.id === substituteUnitId);
  if (index < 0 || !substitute?.boardEligible)
    return {
      board,
      traitDelta: [],
      capacityDelta: 0,
      legal: false,
      warning: 'Replacement cannot be derived from the audited active-set board.',
    };
  const units = board.units.map((unit, unitIndex) =>
    unitIndex === index ? { ...unit, championId: substituteUnitId } : unit,
  );
  const replaced: Board = {
    ...board,
    id: `${board.id}-replace-${targetUnitId}-with-${substituteUnitId}`,
    units,
    requiredUnits: board.requiredUnits.filter((id) => id !== targetUnitId),
  };
  replaced.traitClaims = data.traits.flatMap((trait) => {
    if (trait.availability !== 'verified') return [];
    const breakpoint = activeBreakpoint(trait.breakpoints, traitCount(replaced, data, trait.id));
    return breakpoint === null ? [] : [{ traitId: trait.id, breakpoint }];
  });
  const traitDelta = data.traits.flatMap((trait) => {
    if (trait.availability !== 'verified') return [];
    const before = traitCount(board, data, trait.id);
    const after = traitCount(replaced, data, trait.id);
    return before === after ? [] : [{ traitId: trait.id, before, after, delta: after - before }];
  });
  return {
    board: replaced,
    traitDelta,
    capacityDelta: usedBoardSlots(replaced) - usedBoardSlots(board),
    legal: validateBoard(replaced, data).every((issue) => issue.severity !== 'error'),
    warning: 'Mechanically legal does not mean equal strategic strength.',
  };
}

export interface PivotEdge {
  id: ID;
  from: ID;
  to: ID;
  status: 'sourced' | 'derived';
  transitionCost: number;
  sharedEarlyUnits: ID[];
  sharedComponents: ID[];
  sharedHolders: ID[];
  structuralOverlap: number;
  levelStyleCompatible: boolean;
  contestDifference: number | null;
  reasons: string[];
}

export interface PivotGraph {
  version: string;
  nodes: { id: ID; title: string; role: string }[];
  edges: PivotEdge[];
}

const intersection = (a: ID[], b: ID[]) => [...new Set(a.filter((id) => b.includes(id)))].sort();

const sourcedEarlyUnits = (playbook: Playbook) =>
  playbook.strategy.stages
    .filter(
      (stage) =>
        stage.id !== 'target' &&
        stage.id !== 'observed-target' &&
        stage.roster.status === 'sourced',
    )
    .flatMap((stage) => stage.roster.value?.map((unit) => unit.championId) ?? []);

const components = (playbook: Playbook) =>
  playbook.strategy.itemHolders.flatMap((holder) => holder.componentIds);

const holders = (playbook: Playbook) =>
  playbook.strategy.itemHolders
    .filter((holder) => holder.fact.status === 'sourced' || holder.fact.status === 'inherited')
    .flatMap((holder) => [holder.holderId, ...holder.temporaryHolderIds]);

const primaryRoll = (playbook: Playbook) =>
  playbook.strategy.rollPlan.value?.find((milestone) => milestone.nextObjective) ?? null;

export function buildPivotGraph(portfolio: RecommendationPortfolio): PivotGraph {
  const nodes = portfolio.plans.map((plan) => ({
    id: plan.candidate.playbook.id,
    title: plan.candidate.playbook.title,
    role: plan.role,
  }));
  const edges: PivotEdge[] = [];
  for (const source of portfolio.plans) {
    for (const destination of portfolio.plans) {
      if (source === destination) continue;
      const from = source.candidate.playbook;
      const to = destination.candidate.playbook;
      const sharedEarlyUnits = intersection(sourcedEarlyUnits(from), sourcedEarlyUnits(to));
      const sharedComponents = intersection(components(from), components(to));
      const sharedHolders = intersection(holders(from), holders(to));
      const explicit = from.pivots.find(
        (pivot) =>
          pivot.destination === to.id &&
          (pivot.trigger.status === 'verified' || pivot.trigger.status === 'curated'),
      );
      // Final-board overlap alone never creates a pivot edge.
      if (
        !explicit &&
        !sharedEarlyUnits.length &&
        !sharedComponents.length &&
        !sharedHolders.length
      )
        continue;
      const fromIds = from.target.units.map((unit) => unit.championId);
      const toIds = to.target.units.map((unit) => unit.championId);
      const union = new Set([...fromIds, ...toIds]);
      const structuralOverlap = intersection(fromIds, toIds).length / Math.max(1, union.size);
      const fromRoll = primaryRoll(from);
      const toRoll = primaryRoll(to);
      const levelStyleCompatible = Boolean(
        fromRoll &&
          toRoll &&
          fromRoll.kind === toRoll.kind &&
          (fromRoll.targetLevel === null ||
            toRoll.targetLevel === null ||
            Math.abs(fromRoll.targetLevel - toRoll.targetLevel) <= 1),
      );
      const fromContest = source.candidate.contest.value;
      const toContest = destination.candidate.contest.value;
      const contestDifference =
        fromContest === null || toContest === null ? null : toContest - fromContest;
      const itemCost = sharedComponents.length ? 0 : 28;
      const unitCost = (1 - structuralOverlap) * 45;
      const routeCost = levelStyleCompatible ? 0 : 18;
      const contestAdjustment =
        contestDifference === null ? 0 : Math.max(-8, Math.min(8, contestDifference * 8));
      const transitionCost = Math.round(
        Math.max(0, Math.min(100, itemCost + unitCost + routeCost + contestAdjustment)),
      );
      const reasons = [
        ...(sharedEarlyUnits.length ? [`${sharedEarlyUnits.length} sourced early unit(s)`] : []),
        ...(sharedComponents.length
          ? [`${sharedComponents.length} shared sourced component direction(s)`]
          : []),
        ...(sharedHolders.length ? [`${sharedHolders.length} shared sourced holder(s)`] : []),
        ...(levelStyleCompatible ? ['Compatible sourced roll/level objective'] : []),
        ...(contestDifference !== null
          ? [
              contestDifference < 0
                ? 'Destination has lower current M4 pressure'
                : 'Destination does not reduce current M4 pressure',
            ]
          : []),
      ];
      edges.push({
        id: `${from.id}->${to.id}`,
        from: from.id,
        to: to.id,
        status: explicit ? 'sourced' : 'derived',
        transitionCost,
        sharedEarlyUnits,
        sharedComponents,
        sharedHolders,
        structuralOverlap,
        levelStyleCompatible,
        contestDifference,
        reasons,
      });
    }
  }
  return {
    version: PIVOT_GRAPH_VERSION,
    nodes,
    edges: edges.sort((a, b) => a.transitionCost - b.transitionCost || a.id.localeCompare(b.id)),
  };
}

export interface QuickStripItem {
  key: 'copies' | 'items' | 'augment' | 'objective' | 'fallback' | 'warning';
  label: string;
  value: string;
  status: StrategyFactStatus;
}

const factStatus = <T>(fact: StrategyFact<T>): StrategyFactStatus => fact.status;

export function buildQuickStrip(
  playbook: Playbook,
  portfolio: RecommendationPortfolio,
  championName: (id: ID) => string,
  itemName: (id: ID) => string,
): QuickStripItem[] {
  const pivot = buildPivotGraph(portfolio).edges.find((edge) => edge.from === playbook.id);
  const fallback = pivot
    ? portfolio.plans.find((plan) => plan.candidate.playbook.id === pivot.to)?.candidate.playbook
    : null;
  const watch = playbook.strategy.watchUnits;
  const componentIds = [...new Set(components(playbook))];
  const augment = playbook.strategy.augmentBranches[0];
  const objective = primaryRoll(playbook);
  const warning = playbook.strategy.warnings.value?.[0] ?? null;
  return [
    {
      key: 'copies',
      label: 'LOOK FOR',
      value: watch.value?.map(championName).join(' + ') || 'Unavailable',
      status: factStatus(watch),
    },
    {
      key: 'items',
      label: 'ITEM DIRECTION',
      value: componentIds.length ? componentIds.map(itemName).join(' · ') : 'Unavailable',
      status: playbook.strategy.itemHolders[0]?.fact.status ?? 'unavailable',
    },
    {
      key: 'augment',
      label: 'AUGMENT BRANCH',
      value: augment?.signal.value ?? 'Unavailable',
      status: augment?.signal.status ?? 'unavailable',
    },
    {
      key: 'objective',
      label: 'NEXT OBJECTIVE',
      value: objective?.label ?? 'Unavailable',
      status: factStatus(playbook.strategy.rollPlan),
    },
    {
      key: 'fallback',
      label: 'FALLBACK',
      value: fallback ? `${fallback.title} · ${pivot!.transitionCost} cost` : 'No supported edge',
      status: pivot?.status ?? 'unavailable',
    },
    {
      key: 'warning',
      label: 'WATCH OUT',
      value: warning ?? 'No sourced warning',
      status: warning ? factStatus(playbook.strategy.warnings) : 'unavailable',
    },
  ];
}
