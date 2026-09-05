import { describe, expect, it } from 'vitest';
import { validateBoard, validatePlaybook } from '../rules/validation';
import { teamPlanner } from '../rules/teamPlanner';
import {
  auditStaticData,
  capacityForBoard,
  set18Rules,
  traitCount,
  usedBoardSlots,
} from '../rules/ruleSet';
import { data, playbooks } from './fixtures';

const board = () => structuredClone(playbooks[0].target);
const errorCodes = (value = board()) =>
  validateBoard(value, data)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code);

describe('audited Set 18 rules and validation', () => {
  it('reconciles the normalized export with the versioned rule fixture', () => {
    expect(auditStaticData(data)).toEqual([]);
    expect(data.version.parityStatus).toBe('known-stale');
    expect(set18Rules.hotfixOverlay.changes).toContainEqual([
      'DA_Riftbeast18',
      '7-piece team stats',
      '6%',
      '5%',
    ]);
  });

  it('locks current shop odds, pool sizes, XP, interest, and star copy math', () => {
    expect(set18Rules.shop.oddsByLevel['7']).toEqual([0.19, 0.3, 0.4, 0.1, 0.01]);
    expect(set18Rules.shop.oddsByLevel['10']).toEqual([0.05, 0.1, 0.2, 0.4, 0.25]);
    expect(set18Rules.shop.poolCopiesByCost).toEqual({
      1: 30,
      2: 25,
      3: 18,
      4: 10,
      5: 9,
    });
    expect(set18Rules.experience.xpToNextLevel).toEqual({
      2: 2,
      3: 6,
      4: 10,
      5: 20,
      6: 36,
      7: 60,
      8: 68,
      9: 68,
    });
    expect(set18Rules.shop.starCopies).toEqual({ 1: 1, 2: 3, 3: 9 });
    expect(set18Rules.economy).toMatchObject({
      interestGoldPerTenHeld: 1,
      interestCap: 5,
      interestCapGold: 50,
    });
  });

  it('accepts every re-audited playbook and computes only reachable trait claims', () => {
    for (const playbook of playbooks) {
      expect(
        validatePlaybook(playbook, data).filter((issue) => issue.severity === 'error'),
      ).toEqual([]);
      for (const claim of playbook.target.traitClaims)
        expect(traitCount(playbook.target, data, claim.traitId)).toBeGreaterThanOrEqual(
          claim.breakpoint,
        );
    }
  });

  it('matches the four source-board active trait summaries', () => {
    const names = (index: number) =>
      playbooks[index].target.traitClaims
        .map((claim) => data.traits.find((trait) => trait.id === claim.traitId)?.name)
        .sort();
    expect(names(0)).toEqual(
      ['Defender', 'Elderwood', 'Fae', 'Juggernaut', 'Rapidfire', 'Solar', 'Vanguard'].sort(),
    );
    expect(names(1)).toEqual(
      ['Adaptor', 'Blossom', 'Brawler', 'Caustic', 'Juggernaut', 'Primal', 'Rival'].sort(),
    );
    expect(names(2)).toEqual(
      [
        'Attuned',
        'Blackthorn',
        'Executioner',
        'Flora Fatalis',
        'Inferno',
        'Juggernaut',
        'Monolith',
        'Spellweaver',
        'Summoner',
        'Thornmaiden',
      ].sort(),
    );
    expect(names(3)).toEqual(
      [
        'Bounty Seeker',
        'Brawler',
        'Elderwood',
        'Emerald Aspect',
        'Executioner',
        'Greenfather',
        'Inferno',
        'Juggernaut',
        'Old Growth',
      ].sort(),
    );
  });

  it('counts duplicate ordinary units once for traits', () => {
    const value = board();
    value.units = [value.units[0], structuredClone(value.units[0])];
    value.requiredUnits = [];
    value.targetLevel = 2;
    value.capacity = 2;
    value.traitClaims = [];
    const traitId = data.champions.find((champion) => champion.id === value.units[0].championId)!
      .traitIds[0];
    expect(traitCount(value, data, traitId)).toBe(1);
    expect(errorCodes(value)).not.toContain('duplicates');
  });

  it('implements Lux double-origin counting and rejects the base placeholder or two forms', () => {
    const value = board();
    const lux = data.champions.find((champion) => champion.id === 'DA_18_Lux_Elderwood')!;
    value.units = [{ championId: lux.id, items: [], slot: 'core' }];
    value.requiredUnits = [];
    value.targetLevel = 1;
    value.capacity = 1;
    value.traitClaims = [];
    expect(traitCount(value, data, 'DA_18_Elderwood')).toBe(2);
    expect(errorCodes(value)).toEqual([]);
    value.units[0].championId = 'DA_Lux18_Base';
    expect(errorCodes(value)).toContain('special-unit');
    value.units[0].championId = lux.id;
    value.units.push({ championId: 'DA_18_Lux_Fae', items: [], slot: 'flex' });
    value.targetLevel = 2;
    value.capacity = 2;
    expect(errorCodes(value)).toContain('exclusive-unit');
  });

  it('applies Elder Dragon two-slot and doubled Riftbeast rules plus the 10-piece capacity modifier', () => {
    const riftbeasts = data.champions.filter((champion) =>
      champion.traitIds.includes('DA_Riftbeast18'),
    );
    const elder = riftbeasts.find((champion) => champion.id === 'DA_18_ElderDragon')!;
    const value = board();
    value.units = [elder, ...riftbeasts.filter((champion) => champion !== elder).slice(0, 8)].map(
      (champion) => ({ championId: champion.id, items: [], slot: 'flex' as const }),
    );
    value.requiredUnits = [];
    value.targetLevel = 8;
    value.traitClaims = [{ traitId: 'DA_Riftbeast18', breakpoint: 10 }];
    value.capacity = 10;
    expect(traitCount(value, data, 'DA_Riftbeast18')).toBe(10);
    expect(usedBoardSlots(value)).toBe(10);
    expect(capacityForBoard(value, data)).toBe(10);
    expect(errorCodes(value)).toEqual([]);
  });

  it('rejects wrong set, unknown units, invalid capacities, and missing references', () => {
    const value = board();
    value.set = 17;
    value.capacity = 6;
    value.units[0].championId = 'TFT17_NotSet18';
    value.units[1].items = ['made-up'];
    value.augmentIds = ['made-up'];
    expect(errorCodes(value)).toEqual(
      expect.arrayContaining([
        'set',
        'capacity-declaration',
        'membership',
        'required',
        'item',
        'augment',
      ]),
    );
  });

  it('rejects impossible or unavailable trait threshold claims', () => {
    const value = board();
    value.traitClaims = [{ traitId: 'DA_18_Elderwood', breakpoint: 11 }];
    expect(errorCodes(value)).toContain('trait-count');
    value.traitClaims = [{ traitId: 'DA_18_Eclipse', breakpoint: 1 }];
    expect(errorCodes(value)).toContain('trait');
    expect(data.traits.find((trait) => trait.id === 'DA_18_Eclipse')?.availability).toBe(
      'unavailable',
    );
  });

  it('distinguishes export presence from live augment availability', () => {
    const forge = data.augments.find((augment) => augment.id === 'DA_ForgeAFriend')!;
    expect(forge).toMatchObject({ presentInExport: true, liveStatus: 'disabled' });
    const value = board();
    value.augmentIds = [forge.id];
    expect(errorCodes(value)).toContain('augment-disabled');
    expect(data.augments.some((augment) => augment.liveStatus === 'unverified')).toBe(true);
  });

  it('rejects invalid variants, Decision Map edges, holders, and recipes', () => {
    const playbook = structuredClone(playbooks[0]);
    playbook.variants[0].board.units = [];
    playbook.variants[0].board.requiredUnits = [];
    playbook.decisionMap.edges[0].to = 'missing';
    playbook.items[0].holder = 'missing';
    playbook.items[0].priorities = ['DA_Component_RecurveBow'];
    expect(validatePlaybook(playbook, data).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['variant-core', 'decision-edge', 'holder', 'item-reference']),
    );
  });

  it('preserves the Fast 8 guide contradiction without inventing a level-8 cut', () => {
    expect(playbooks[2].features.style).toBe('Fast 8');
    expect(playbooks[2].target.capacity).toBe(9);
    expect(
      playbooks[2].stages.find((stage) => stage.stage === 'stabilization')?.board.value,
    ).toBeNull();
  });

  it('keeps Team Planner fail-safe until every acceptance gate is verified', () => {
    expect(teamPlanner.supportStatus({ set: 18 }).state).toBe('unverified');
    expect(teamPlanner.supportStatus({ set: 17 }).state).toBe('unsupported');
    expect(teamPlanner.encode(board()).ok).toBe(false);
    const playbook = structuredClone(playbooks[0]);
    playbook.planner.state = 'supported';
    expect(validatePlaybook(playbook, data).some((issue) => issue.code === 'planner')).toBe(true);
  });
});
