import type { Board, Playbook, StaticData } from '../domain/models';
import { staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import {
  STRATEGY_GUIDANCE_VERSION,
  STRATEGY_SCHEMA_VERSION,
  strategyRegistryFingerprint,
  strategyTargetFingerprint,
} from '../providers/strategyGuidance';
import { validateDecisionMap } from '../strategy/playbookIntelligence';
import {
  activeBreakpoint,
  baseCapacityForLevel,
  capacityForBoard,
  set18Rules,
  traitCount,
  usedBoardSlots,
} from './ruleSet';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'unverified';
  message: string;
  path: string;
}

export function boardTraitCounts(board: Board, data: StaticData) {
  return data.traits
    .map((trait) => {
      const count = traitCount(board, data, trait.id);
      return {
        trait,
        count,
        activeBreakpoint: activeBreakpoint(trait.breakpoints, count),
        status:
          trait.availability === 'verified' ? ('verified' as const) : ('unavailable' as const),
      };
    })
    .filter((result) => result.count > 0)
    .sort((a, b) => b.count - a.count || a.trait.name.localeCompare(b.trait.name));
}

export function validateBoard(board: Board, data: StaticData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, severity: ValidationIssue['severity'] = 'error') =>
    issues.push({ code, message, severity, path: board.id });
  if (board.set !== data.version.set || board.set !== set18Rules.scope.setNumber)
    add('set', 'Board does not belong to the active ruleset.');
  const expectedCapacity = capacityForBoard(board, data);
  if (expectedCapacity === null)
    add('target', `Level ${board.targetLevel} is outside audited levels.`);
  else if (board.capacity !== expectedCapacity)
    add(
      'capacity-declaration',
      `Declared capacity ${board.capacity} does not match audited capacity ${expectedCapacity}.`,
    );
  const usedSlots = usedBoardSlots(board);
  if (expectedCapacity !== null && usedSlots > expectedCapacity)
    add('capacity', `${usedSlots} occupied slots exceed audited capacity ${expectedCapacity}.`);
  if (board.units.length === 0) add('empty', 'A board must include units.');

  const ids = board.units.map((unit) => unit.championId);
  const champions = new Map(data.champions.map((champion) => [champion.id, champion]));
  const items = new Map(data.items.map((item) => [item.id, item]));
  for (const unit of board.units) {
    const champion = champions.get(unit.championId);
    if (!champion) add('membership', `Unknown active-set unit ${unit.championId}.`);
    else if (!champion.boardEligible)
      add('special-unit', `${champion.name} is an export placeholder, not a fieldable unit.`);
    for (const itemId of unit.items) {
      const item = items.get(itemId);
      if (!item) add('item', `Unknown active-set item ${itemId}.`);
      else if (item.category === 'other')
        add('item-category', `${item.name} equipability is not audited.`, 'unverified');
    }
    if (
      unit.stars !== undefined &&
      (!Number.isInteger(unit.stars) || unit.stars < 1 || unit.stars > 3)
    )
      add('stars', 'Star target must be an integer from 1 to 3.');
  }
  for (const group of set18Rules.board.exclusiveUnitGroups) {
    const present = new Set(ids.filter((id) => group.unitApiNames.includes(id)));
    if (present.size > group.maximumDistinct)
      add('exclusive-unit', `Board exceeds ${group.id} limit of ${group.maximumDistinct}.`);
  }
  for (const id of board.requiredUnits) {
    if (!champions.has(id)) add('required-reference', `Required unit ${id} is unknown.`);
    else if (!ids.includes(id)) add('required', `Required unit ${id} is missing.`);
  }
  for (const id of board.augmentIds) {
    const augment = data.augments.find((entry) => entry.id === id);
    if (!augment) add('augment', `Unknown augment ${id}.`);
    else if (augment.liveStatus === 'disabled')
      add('augment-disabled', `${augment.name} is disabled.`);
    else if (augment.liveStatus === 'unverified')
      add('augment-live', `${augment.name} live availability is unverified.`, 'unverified');
  }
  for (const claim of board.traitClaims) {
    const trait = data.traits.find((entry) => entry.id === claim.traitId);
    if (!trait || !trait.breakpoints.includes(claim.breakpoint)) {
      add('trait', 'Claimed trait threshold is absent from the audited source.');
      continue;
    }
    if (trait.availability !== 'verified') {
      add('trait-rule', `${trait.name} threshold data is unavailable.`, 'unverified');
      continue;
    }
    if (traitCount(board, data, trait.id) < claim.breakpoint)
      add('trait-count', `Board does not reach the declared ${trait.name} threshold.`);
  }
  return issues;
}

export function validatePlaybook(playbook: Playbook, data: StaticData): ValidationIssue[] {
  const issues = validateBoard(playbook.target, data);
  for (const stage of playbook.stages)
    if (stage.board.value) issues.push(...validateBoard(stage.board.value, data));
  for (const variant of playbook.variants) {
    issues.push(...validateBoard(variant.board, data));
    if (
      playbook.family.core.some((id) => !variant.board.units.some((unit) => unit.championId === id))
    )
      issues.push({
        code: 'variant-core',
        message: 'Variant loses a required family core unit.',
        severity: 'error',
        path: variant.id,
      });
  }
  const add = (code: string, message: string) =>
    issues.push({ code, message, severity: 'error', path: playbook.id });
  if (playbook.set !== data.version.set || playbook.target.set !== playbook.set)
    add('playbook-set', 'Playbook and data set mismatch.');
  for (const core of playbook.family.core)
    if (!playbook.target.units.some((unit) => unit.championId === core))
      add('core', 'Family core is absent from target board.');

  const items = new Map(data.items.map((item) => [item.id, item]));
  for (const itemPlan of playbook.items) {
    if (!playbook.target.units.some((unit) => unit.championId === itemPlan.holder))
      add('holder', 'Item holder is absent from target board.');
    for (const id of [...itemPlan.priorities, ...(itemPlan.alternatives.value ?? [])]) {
      const item = items.get(id);
      if (!item) add('item-reference', `Unknown item ${id}.`);
      else if (item.category !== 'combined')
        add('item-reference', `${item.name} is not an audited combined item.`);
      else if (
        item.components.length !== 2 ||
        item.components.some((componentId) => items.get(componentId)?.category !== 'component')
      )
        add('item-recipe', `${item.name} has an invalid component recipe.`);
    }
  }
  for (const id of playbook.components)
    if (items.get(id)?.category !== 'component')
      add('component-reference', `Invalid component ${id}.`);
  for (const role of playbook.roles)
    if (!playbook.target.units.some((unit) => unit.championId === role.championId))
      add('role-reference', 'Declared role is absent from target board.');
  for (const replacement of playbook.replacements.value ?? [])
    if (
      ![replacement.from, replacement.to].every((id) =>
        data.champions.some((champion) => champion.id === id),
      )
    )
      add('replacement-reference', 'Replacement references an unknown unit.');
  for (const branch of playbook.augments)
    for (const id of branch.augmentIds) {
      const augment = data.augments.find((entry) => entry.id === id);
      if (!augment) add('augment-reference', `Unknown augment ${id}.`);
      else if (augment.liveStatus === 'disabled')
        add('augment-disabled', `${augment.name} is disabled.`);
    }
  const nodes = new Set(playbook.decisionMap.nodes.map((node) => node.id));
  for (const edge of playbook.decisionMap.edges)
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      add('decision-edge', 'Decision Map references a missing node.');
  const strategy = playbook.strategy;
  const sourceIds = new Set(strategy.sources.map((source) => source.id));
  const strategyIssue = (
    code: string,
    message: string,
    severity: ValidationIssue['severity'] = 'error',
  ) => issues.push({ code, message, severity, path: playbook.id });
  if (strategy.schemaVersion !== STRATEGY_SCHEMA_VERSION)
    strategyIssue('strategy-schema', 'Strategy schema version is unsupported.');
  if (!strategy.guidanceVersion.startsWith(STRATEGY_GUIDANCE_VERSION))
    strategyIssue('strategy-version', 'Strategy guidance version is unsupported.');
  if (strategy.set !== playbook.set)
    strategyIssue('strategy-set', 'Strategy guidance and playbook set differ.');
  const targetFingerprint = strategyTargetFingerprint(
    playbook.set,
    playbook.target.capacity,
    playbook.target.units.map((unit) => unit.championId),
  );
  const registryFingerprint = strategyRegistryFingerprint(
    playbook.family.id,
    playbook.family.core,
    targetFingerprint,
  );
  if (
    strategy.freshness.state === 'stale' ||
    strategy.staticSourceFingerprint !== staticSetCompatibilityFingerprint(data) ||
    strategy.targetBoardFingerprint !== targetFingerprint ||
    strategy.registryFingerprint !== registryFingerprint
  )
    strategyIssue(
      'strategy-stale',
      strategy.freshness.reasons.join(' ') || 'Strategy fingerprints are incompatible.',
      'unverified',
    );
  if (new Set(strategy.sources.map((source) => source.id)).size !== strategy.sources.length)
    strategyIssue('strategy-source', 'Strategy source IDs must be unique.');
  const checkFactSources = (status: string, ids: string[], path: string) => {
    if ((status === 'sourced' || status === 'inherited') && !ids.length)
      strategyIssue('strategy-provenance', `${path} has no source reference.`);
    for (const id of ids)
      if (id !== 'derived:aggregate-completed-boards' && !sourceIds.has(id))
        strategyIssue('strategy-provenance', `${path} references unknown source ${id}.`);
  };
  checkFactSources(
    strategy.watchUnits.status,
    strategy.watchUnits.sourceIds,
    'Watch-unit guidance',
  );
  const championIds = new Set(data.champions.map((champion) => champion.id));
  const allStageIds = new Set(strategy.stages.map((stage) => stage.id));
  for (const stage of strategy.stages) {
    for (const next of stage.nextStateIds)
      if (!allStageIds.has(next))
        strategyIssue('strategy-stage-edge', `Stage ${stage.id} references missing state ${next}.`);
    for (const fact of [
      stage.timing,
      stage.targetLevel,
      stage.roster,
      stage.instruction,
      stage.entryCondition,
      stage.exitCondition,
    ])
      checkFactSources(fact.status, fact.sourceIds, `Stage ${stage.id}`);
    for (const unit of stage.roster.value ?? [])
      if (!championIds.has(unit.championId))
        strategyIssue('strategy-stage-unit', `Stage ${stage.id} references an unknown unit.`);
    if (stage.roster.value?.length && stage.targetLevel.value) {
      const stageBoard: Board = {
        id: `${playbook.id}-strategy-${stage.id}`,
        set: playbook.set,
        targetLevel: stage.targetLevel.value,
        capacity: baseCapacityForLevel(stage.targetLevel.value) ?? stage.targetLevel.value,
        units: stage.roster.value.map((unit) => ({
          championId: unit.championId,
          items: [],
          slot: unit.slot,
        })),
        requiredUnits: [],
        augmentIds: [],
        traitClaims: [],
        provenance: playbook.provenance,
      };
      stageBoard.capacity = capacityForBoard(stageBoard, data) ?? stageBoard.capacity;
      for (const stageValidation of validateBoard(stageBoard, data).filter(
        (issue) => issue.severity === 'error',
      ))
        strategyIssue('strategy-stage-board', stageValidation.message);
    }
  }
  checkFactSources(strategy.rollPlan.status, strategy.rollPlan.sourceIds, 'Roll plan');
  for (const holder of strategy.itemHolders) {
    checkFactSources(holder.fact.status, holder.fact.sourceIds, `Item holder ${holder.holderId}`);
    if (!championIds.has(holder.holderId))
      strategyIssue('strategy-holder', `Unknown strategy item holder ${holder.holderId}.`);
    for (const temporary of holder.temporaryHolderIds)
      if (!championIds.has(temporary))
        strategyIssue('strategy-holder', `Unknown temporary holder ${temporary}.`);
    for (const componentId of holder.componentIds)
      if (items.get(componentId)?.category !== 'component')
        strategyIssue('strategy-component', `Invalid strategy component ${componentId}.`);
    for (const group of holder.groups) {
      checkFactSources(group.fact.status, group.fact.sourceIds, `Item group ${holder.holderId}`);
      for (const itemId of group.itemIds)
        if (items.get(itemId)?.category !== 'combined')
          strategyIssue('strategy-item', `Invalid strategy item ${itemId}.`);
    }
  }
  for (const branch of strategy.augmentBranches) {
    checkFactSources(branch.signal.status, branch.signal.sourceIds, `Augment ${branch.id}`);
    checkFactSources(
      branch.consequence.status,
      branch.consequence.sourceIds,
      `Augment ${branch.id}`,
    );
    for (const augmentId of branch.augmentIds)
      if (!data.augments.some((augment) => augment.id === augmentId))
        strategyIssue('strategy-augment', `Unknown strategy augment ${augmentId}.`);
  }
  for (const replacement of strategy.replacements) {
    if (
      ![replacement.targetUnitId, replacement.substituteUnitId].every((id) => championIds.has(id))
    )
      strategyIssue(
        'strategy-replacement',
        `Replacement ${replacement.id} references unknown units.`,
      );
    checkFactSources(
      replacement.role.status,
      replacement.role.sourceIds,
      `Replacement ${replacement.id}`,
    );
    checkFactSources(
      replacement.strength.status,
      replacement.strength.sourceIds,
      `Replacement ${replacement.id}`,
    );
  }
  checkFactSources(strategy.warnings.status, strategy.warnings.sourceIds, 'Strategy warnings');
  for (const issue of validateDecisionMap(strategy.decisionMap))
    strategyIssue(`strategy-decision-${issue.code}`, issue.message);
  for (const node of strategy.decisionMap.nodes)
    checkFactSources(node.fact.status, node.fact.sourceIds, `Decision node ${node.id}`);
  for (const edge of strategy.decisionMap.edges)
    checkFactSources(edge.fact.status, edge.fact.sourceIds, `Decision edge ${edge.id}`);
  if (strategy.positioning.precision === 'exact' && !strategy.positioning.exact.value?.length)
    strategyIssue('strategy-position', 'Exact positioning requires directly sourced hexes.');
  if (strategy.positioning.precision === 'coarse' && !strategy.positioning.coarse.value?.length)
    strategyIssue('strategy-position', 'Coarse positioning requires sourced formation bands.');
  if (strategy.positioning.precision === 'unverified') {
    if (strategy.positioning.exact.value?.length || strategy.positioning.coarse.value?.length)
      strategyIssue('strategy-position', 'Unverified positioning cannot assign units.');
  }
  const occupiedHexes = new Set<string>();
  for (const position of strategy.positioning.exact.value ?? []) {
    const key = `${position.row}:${position.column}`;
    if (occupiedHexes.has(key)) strategyIssue('strategy-position', `Duplicate exact hex ${key}.`);
    occupiedHexes.add(key);
    if (!playbook.target.units.some((unit) => unit.championId === position.championId))
      strategyIssue(
        'strategy-position',
        'Exact position references a unit outside the target board.',
      );
  }
  for (const position of strategy.positioning.coarse.value ?? [])
    if (!playbook.target.units.some((unit) => unit.championId === position.championId))
      strategyIssue(
        'strategy-position',
        'Coarse position references a unit outside the target board.',
      );
  if (
    playbook.planner.state === 'supported' &&
    !(
      playbook.planner.mappingVerified &&
      playbook.planner.fixtureVerified &&
      playbook.planner.manualPasteVerified
    )
  )
    add('planner', 'Team Planner cannot be supported before all verification gates pass.');
  if (playbook.planner.state !== 'supported')
    issues.push({
      code: 'planner-unverified',
      message: playbook.planner.reason,
      severity: 'unverified',
      path: playbook.id,
    });
  return issues;
}
