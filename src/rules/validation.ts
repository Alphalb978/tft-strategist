import type { Board, Playbook, StaticData } from '../domain/models';
import {
  activeBreakpoint,
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
