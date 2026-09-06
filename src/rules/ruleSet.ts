import rulesJson from '../../data/rules/set18.json';
import type { Board, ID, StaticData } from '../domain/models';

export const set18Rules = rulesJson;

const numberRecord = (value: Record<string, number>, key: number): number | undefined =>
  value[String(key)];

export function baseCapacityForLevel(level: number): number | null {
  return numberRecord(set18Rules.board.capacityByLevel, level) ?? null;
}

export function unitSlotSize(championId: ID): number {
  return (
    set18Rules.board.slotSizeOverrides[
      championId as keyof typeof set18Rules.board.slotSizeOverrides
    ] ?? 1
  );
}

export function usedBoardSlots(board: Board): number {
  return board.units.reduce((total, unit) => total + unitSlotSize(unit.championId), 0);
}

export function traitContribution(championId: ID, traitId: ID): number {
  const override = set18Rules.traits.contributionOverrides.find(
    ([unitId, overriddenTraitId]) => unitId === championId && overriddenTraitId === traitId,
  );
  return override ? Number(override[2]) : 1;
}

export function traitCount(board: Board, data: StaticData, traitId: ID): number {
  const uniqueChampionIds = [...new Set(board.units.map((unit) => unit.championId))];
  const champions = new Map(data.champions.map((champion) => [champion.id, champion]));
  return uniqueChampionIds.reduce((count, championId) => {
    const champion = champions.get(championId);
    if (!champion?.traitIds.includes(traitId)) return count;
    return count + traitContribution(championId, traitId);
  }, 0);
}

export function activeBreakpoint(breakpoints: number[], count: number): number | null {
  return [...breakpoints].sort((a, b) => b - a).find((value) => value <= count) ?? null;
}

/** Verified ordinary TFT star-copy math. Special or out-of-range tiers fail closed. */
export function ordinaryCopiesForStar(stars: number): number | null {
  if (!Number.isInteger(stars) || stars < 1 || stars > 3) return null;
  const copies = set18Rules.shop.starCopies[String(stars) as '1' | '2' | '3'];
  return typeof copies === 'number' ? copies : null;
}

export function capacityForBoard(board: Board, data: StaticData): number | null {
  const base = baseCapacityForLevel(board.targetLevel);
  if (base === null) return null;
  return set18Rules.board.capacityModifiers.reduce((capacity, modifier) => {
    return traitCount(board, data, modifier.traitApiName) >= modifier.minimumCount
      ? capacity + modifier.additionalSlots
      : capacity;
  }, base);
}

export interface RuleAuditIssue {
  code: string;
  message: string;
}

export function auditStaticData(data: StaticData): RuleAuditIssue[] {
  const issues: RuleAuditIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (data.version.set !== set18Rules.scope.setNumber)
    add('set', 'Static set does not match rules.');
  // Structural identity is set-scoped. A newer balance label alone does not invalidate
  // unchanged rosters/recipes; combat and guidance parity remain separately unverified.
  const pool = data.champions.filter((champion) => champion.shopStatus !== 'runtime-variant');
  for (const [costText, expected] of Object.entries(set18Rules.shop.expectedUniqueUnitsByCost)) {
    const cost = Number(costText);
    const actual = pool.filter((champion) => champion.cost === cost).length;
    if (actual !== expected)
      add(
        'pool-roster',
        `Cost ${cost} pool has ${actual} units; audited fixture expects ${expected}.`,
      );
  }
  for (const [level, odds] of Object.entries(set18Rules.shop.oddsByLevel)) {
    if (odds.length !== set18Rules.shop.costBands.length)
      add('shop-odds', `Level ${level} odds do not cover every cost band.`);
    const sum = odds.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 0.000001) add('shop-odds', `Level ${level} odds total ${sum}, not 1.`);
  }
  const itemIds = new Set(data.items.map((item) => item.id));
  const components = new Set(
    data.items.filter((item) => item.category === 'component').map((item) => item.id),
  );
  for (const item of data.items) {
    for (const componentId of item.components) {
      if (!itemIds.has(componentId))
        add('item-recipe', `${item.id} references missing component ${componentId}.`);
      else if (!components.has(componentId))
        add('item-recipe', `${item.id} recipe reference ${componentId} is not a component.`);
    }
    if (item.category === 'combined' && item.components.length !== 2)
      add('item-recipe', `${item.id} is combined but does not have exactly two components.`);
  }
  for (const trait of data.traits) {
    if (!trait.breakpoints.length && trait.availability !== 'unavailable')
      add('trait-threshold', `${trait.id} has no threshold but was not marked unavailable.`);
    if (trait.breakpoints.length && trait.availability !== 'verified')
      add('trait-threshold', `${trait.id} has thresholds but was not marked verified.`);
  }
  for (const championId of set18Rules.board.disallowedUnitApiNames) {
    const champion = data.champions.find((entry) => entry.id === championId);
    if (!champion || champion.boardEligible || champion.shopStatus !== 'placeholder')
      add('special-unit', `${championId} placeholder classification is missing.`);
  }
  const disabled = data.augments.find((augment) => augment.id === 'DA_ForgeAFriend');
  if (!disabled || disabled.liveStatus !== 'disabled')
    add('augment-live', 'Forge A Friend official disabled override is missing.');
  return issues;
}
