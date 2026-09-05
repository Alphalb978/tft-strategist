import { describe, expect, it } from 'vitest';
import { validateBoard, validatePlaybook } from '../rules/validation';
import { teamPlanner } from '../rules/teamPlanner';
import { data, playbooks } from './fixtures';
const board = () => structuredClone(playbooks[0].target);
const errors = () => validateBoard(board(), data).filter((i) => i.severity === 'error');
describe('versioned board / playbook validation', () => {
  it('rejects a variant that removes its family core even if its own requirements are empty', () => {
    const p = structuredClone(playbooks[0]);
    p.variants[0].board.units = [];
    p.variants[0].board.requiredUnits = [];
    expect(validatePlaybook(p, data).some((i) => i.code === 'variant-core')).toBe(true);
  });
  it('accepts all curated structures while preserving verification warnings', () => {
    expect(errors()).toEqual([]);
    for (const p of playbooks) {
      expect(validatePlaybook(p, data).filter((i) => i.severity === 'error')).toEqual([]);
      expect(validatePlaybook(p, data).some((i) => i.code === 'level-capacity')).toBe(true);
    }
  });
  it('rejects wrong set and inactive units', () => {
    const b = board();
    b.set = 17;
    b.units[0].championId = 'TFT17_NotSet18';
    expect(validateBoard(b, data).map((i) => i.code)).toEqual(
      expect.arrayContaining(['set', 'membership', 'required']),
    );
  });
  it('rejects too many units and bad declared capacity', () => {
    const b = board();
    b.capacity = 6;
    expect(validateBoard(b, data).some((i) => i.code === 'capacity')).toBe(true);
    b.capacity = 2.5;
    expect(validateBoard(b, data).some((i) => i.code === 'target')).toBe(true);
  });
  it('rejects missing required units, items and augments', () => {
    const b = board();
    b.units.shift();
    b.units[0].items = ['made-up'];
    b.augmentIds = ['made-up'];
    expect(validateBoard(b, data).map((i) => i.code)).toEqual(
      expect.arrayContaining(['required', 'item', 'augment']),
    );
  });
  it('flags duplicates without inventing uniqueness rules', () => {
    const b = board();
    b.units[1].championId = b.units[0].championId;
    expect(validateBoard(b, data).find((i) => i.code === 'duplicates')?.severity).toBe(
      'unverified',
    );
  });
  it('rejects unreachable source thresholds but never certifies unknown counting', () => {
    const b = board();
    b.traitClaims = [{ traitId: 'DA_18_Elderwood', breakpoint: 11 }];
    expect(validateBoard(b, data).some((i) => i.code === 'trait-count')).toBe(true);
    b.traitClaims[0].breakpoint = 3;
    expect(validateBoard(b, data).some((i) => i.code === 'trait-rule')).toBe(true);
  });
  it('rejects a dangling Decision Map edge and item holder', () => {
    const p = structuredClone(playbooks[0]);
    p.decisionMap.edges[0].to = 'missing';
    p.items[0].holder = 'missing';
    expect(validatePlaybook(p, data).map((i) => i.code)).toEqual(
      expect.arrayContaining(['decision-edge', 'holder']),
    );
  });
  it('does not label source capacity as rolling level', () => {
    expect(playbooks[2].features.style).toBe('Fast 8');
    expect(playbooks[2].target.capacity).toBe(9);
    expect(playbooks[2].stages.find((s) => s.stage === 'stabilization')?.board.value).toBeNull();
  });
  it('fails safely for unverified and unsupported Team Planner formats', () => {
    expect(teamPlanner.supportStatus({ set: 18 }).state).toBe('unverified');
    expect(teamPlanner.supportStatus({ set: 17 }).state).toBe('unsupported');
    expect(teamPlanner.encode(board()).ok).toBe(false);
  });
  it('rejects supported=true before manual acceptance', () => {
    const p = structuredClone(playbooks[0]);
    p.planner.state = 'supported';
    expect(validatePlaybook(p, data).some((i) => i.code === 'planner')).toBe(true);
  });
});
