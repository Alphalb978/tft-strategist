import rules from '../../data/rules/set18.json';
import type { Board, Playbook, StaticData } from '../domain/models';
export interface ValidationIssue {
  code: string;
  severity: 'error' | 'unverified';
  message: string;
  path: string;
}
export function boardTraitCounts(board: Board, data: StaticData) {
  const units = [...new Set(board.units.map((u) => u.championId))];
  return data.traits
    .map((trait) => ({
      trait,
      count: units.filter((id) =>
        data.champions.find((c) => c.id === id)?.traitIds.includes(trait.id),
      ).length,
      status: 'unverified' as const,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.trait.name.localeCompare(b.trait.name));
}
export function validateBoard(board: Board, data: StaticData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, message: string, severity: ValidationIssue['severity'] = 'error') =>
    issues.push({ code, message, severity, path: board.id });
  if (board.set !== data.version.set || board.set !== rules.set)
    add('set', 'Board does not belong to the active ruleset.');
  if (
    !Number.isInteger(board.capacity) ||
    board.capacity < 1 ||
    !Number.isInteger(board.targetLevel) ||
    board.targetLevel < 1
  )
    add('target', 'Invalid declared target/capacity.');
  if (board.units.length > board.capacity)
    add('capacity', `${board.units.length} units exceed declared capacity ${board.capacity}.`);
  if (board.units.length === 0) add('empty', 'A board must include units.');
  const ids = board.units.map((u) => u.championId);
  const champions = new Map(data.champions.map((c) => [c.id, c]));
  for (const u of board.units) {
    if (!champions.has(u.championId)) add('membership', `Unknown active-set unit ${u.championId}.`);
    for (const item of u.items)
      if (!data.items.some((i) => i.id === item)) add('item', `Unknown active-set item ${item}.`);
    if (u.items.some((id) => data.items.find((i) => i.id === id)?.category === 'other'))
      add(
        'item-category',
        'Special item equipability and constraints are unverified.',
        'unverified',
      );
    if (u.stars !== undefined) {
      if (!Number.isInteger(u.stars) || u.stars < 1)
        add('stars', 'Star target must be a positive integer.');
      else
        add(
          'star-rule',
          'Star targets and upgrade requirements need a verified rule.',
          'unverified',
        );
    }
  }
  for (const id of board.requiredUnits)
    if (!ids.includes(id)) add('required', `Required unit ${id} is missing.`);
  for (const id of board.augmentIds)
    if (!data.augments.some((a) => a.id === id)) add('augment', `Unknown augment ${id}.`);
  if (board.augmentIds.length)
    add(
      'augment-live',
      'Live augment availability and requirements need verification.',
      'unverified',
    );
  if (new Set(ids).size !== ids.length)
    add('duplicates', 'Duplicate-unit counting/uniqueness is unverified.', 'unverified');
  for (const claim of board.traitClaims) {
    const t = data.traits.find((t) => t.id === claim.traitId);
    if (!t || !t.breakpoints.includes(claim.breakpoint)) {
      add('trait', 'Claimed trait threshold is absent from the source.');
      continue;
    }
    const count = new Set(
      board.units
        .filter((u) => champions.get(u.championId)?.traitIds.includes(t.id))
        .map((u) => u.championId),
    ).size;
    if (count < claim.breakpoint)
      add('trait-count', `Board does not reach the declared ${t.name} threshold.`);
    if (t.counting === 'unverified')
      add(
        'trait-rule',
        `${t.name} counting modifiers are unverified; claim is not certified.`,
        'unverified',
      );
  }
  if (board.units.some((u) => u.championId.includes('Lux')))
    add(
      'special-unit',
      'Avatar variants and doubled origin counts need a verified rule.',
      'unverified',
    );
  add(
    'level-capacity',
    'Declared capacity checked; level/capacity modifiers are unverified.',
    'unverified',
  );
  return issues;
}
export function validatePlaybook(p: Playbook, data: StaticData): ValidationIssue[] {
  const issues = validateBoard(p.target, data);
  for (const stage of p.stages)
    if (stage.board.value) issues.push(...validateBoard(stage.board.value, data));
  for (const variant of p.variants) {
    issues.push(...validateBoard(variant.board, data));
    if (p.family.core.some((id) => !variant.board.units.some((u) => u.championId === id)))
      issues.push({
        code: 'variant-core',
        message: 'Variant loses a required family core unit.',
        severity: 'error',
        path: variant.id,
      });
  }
  const add = (code: string, message: string) =>
    issues.push({ code, message, severity: 'error', path: p.id });
  if (p.set !== data.version.set || p.target.set !== p.set)
    add('playbook-set', 'Playbook and data set mismatch.');
  for (const core of p.family.core)
    if (!p.target.units.some((u) => u.championId === core))
      add('core', 'Family core is absent from target board.');
  for (const i of p.items) {
    if (!p.target.units.some((u) => u.championId === i.holder))
      add('holder', 'Item holder is absent from target board.');
    for (const id of [...i.priorities, ...(i.alternatives.value ?? [])])
      if (!data.items.some((item) => item.id === id)) add('item-reference', `Unknown item ${id}.`);
  }
  for (const id of p.components)
    if (!data.items.some((i) => i.id === id && i.category === 'component'))
      add('component-reference', `Invalid component ${id}.`);
  for (const role of p.roles)
    if (!p.target.units.some((u) => u.championId === role.championId))
      add('role-reference', 'Declared role is absent from target board.');
  for (const replacement of p.replacements.value ?? [])
    if (![replacement.from, replacement.to].every((id) => data.champions.some((c) => c.id === id)))
      add('replacement-reference', 'Replacement references an unknown unit.');
  for (const branch of p.augments)
    for (const id of branch.augmentIds)
      if (!data.augments.some((a) => a.id === id))
        add('augment-reference', `Unknown augment ${id}.`);
  const nodes = new Set(p.decisionMap.nodes.map((n) => n.id));
  for (const edge of p.decisionMap.edges)
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      add('decision-edge', 'Decision Map references a missing node.');
  if (
    p.planner.state === 'supported' &&
    !(p.planner.mappingVerified && p.planner.fixtureVerified && p.planner.manualPasteVerified)
  )
    add('planner', 'Team Planner cannot be supported before all verification gates pass.');
  if (p.planner.state !== 'supported')
    issues.push({
      code: 'planner-unverified',
      message: p.planner.reason,
      severity: 'unverified',
      path: p.id,
    });
  return issues;
}
