import type {
  ActiveSetVersion,
  Board,
  Result,
  StaticData,
  TeamPlannerSupport,
} from '../domain/models';
import mapping from '../../data/rules/set18.teamplanner.json';
import humanFixture from '../../data/fixtures/set18-teamplanner-human.json';
import externalFixture from '../../data/fixtures/set18-teamplanner-blitz.json';
import { staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import { usedBoardSlots } from './ruleSet';

export const TEAM_PLANNER_CONTRACT_VERSION = 'team-planner-support-v3';
export const PLANNER_STATIC_FINGERPRINT = 'fnv1a-9b3bc81f';
const byChampion = new Map(mapping.entries.map((entry) => [entry.championId, entry]));
const byCode = new Map(mapping.entries.map((entry) => [entry.plannerId, entry]));
export interface PlannerWireSlot {
  plannerId: number;
  championId: string | null;
  name: string | null;
  state: 'mapped' | 'empty' | 'unresolved' | 'ambiguous';
}
/** Wire decoding retains unresolved IDs and exact order. It never invents a roster. */
export function decodePlannerCode(code: string): Result<PlannerWireSlot[], string> {
  if (!/^02[0-9a-f]{30}TFTSet18$/.test(code))
    return {
      ok: false,
      error: 'Expected Set 18 format 02 with ten lowercase 3-digit hexadecimal slots.',
    };
  return {
    ok: true,
    value: code
      .slice(2, 32)
      .match(/.{3}/g)!
      .map((hex) => {
        const plannerId = Number.parseInt(hex, 16),
          entry = byCode.get(plannerId);
        return {
          plannerId,
          championId: entry?.championId ?? null,
          name: entry?.name ?? null,
          state:
            plannerId === 0
              ? 'empty'
              : !entry
                ? 'unresolved'
                : entry.boardEligible
                  ? 'mapped'
                  : 'ambiguous',
        };
      }),
  };
}
/** Exact wire serializer; unlike the board encoder this makes no eligibility assertion. */
export function encodePlannerSlots(slots: number[]): Result<string, string> {
  if (slots.length !== 10 || slots.some((id) => !Number.isInteger(id) || id < 0 || id > 4095))
    return { ok: false, error: 'Ten 12-bit planner IDs are required.' };
  return {
    ok: true,
    value: `02${slots.map((id) => id.toString(16).padStart(3, '0')).join('')}TFTSet18`,
  };
}
function encodeMappedBoard(board: Board): Result<string, string> {
  if (board.set !== 18)
    return { ok: false, error: 'Only the audited Set 18 mapping is available.' };
  if (!board.units.length || board.units.length > 10 || usedBoardSlots(board) > board.capacity)
    return {
      ok: false,
      error: 'Roster does not fit the audited board capacity or ten planner slots.',
    };
  const ids = board.units.map((unit) => unit.championId);
  if (new Set(ids).size !== ids.length)
    return { ok: false, error: 'Duplicate units are not supported.' };
  const slots: number[] = [];
  for (const id of ids) {
    const entry = byChampion.get(id);
    if (!entry?.boardEligible)
      return {
        ok: false,
        error: /Lux/i.test(id)
          ? 'Lux origin cannot be preserved by the public base planner ID. This roster cannot be exported.'
          : `No eligible audited planner mapping for ${id}.`,
      };
    slots.push(entry.plannerId);
  }
  return encodePlannerSlots([...slots, ...Array<number>(10 - slots.length).fill(0)]);
}
/** Candidate generation is separate from verified copying and from gameplay static truth. */
export function candidatePlannerCode(board: Board, data: StaticData): Result<string, string> {
  if (
    data.version.set !== 18 ||
    staticSetCompatibilityFingerprint(data) !== PLANNER_STATIC_FINGERPRINT
  )
    return { ok: false, error: 'Planner mapping needs review for the active static data.' };
  if (
    board.units.some(
      (unit) =>
        !data.champions.some(
          (champion) =>
            champion.id === unit.championId && champion.set === 18 && champion.boardEligible,
        ),
    )
  )
    return { ok: false, error: 'A unit is unavailable in the active set.' };
  return encodeMappedBoard(board);
}
export interface TeamPlannerCodec {
  supportStatus(set: Pick<ActiveSetVersion, 'set'>): TeamPlannerSupport;
  encode(board: Board): Result<string, string>;
}
export const teamPlanner: TeamPlannerCodec = {
  supportStatus: ({ set }) => ({
    state: set !== 18 ? 'unsupported' : mapping.manualPasteVerified ? 'supported' : 'unverified',
    contractVersion: TEAM_PLANNER_CONTRACT_VERSION,
    formatVersion: set === 18 ? '02-ten-12bit-roster-slots' : null,
    reason:
      set !== 18
        ? 'This set has no verified codec.'
        : 'Client paste verified on 6 September 2026. Audited Set 18 roster codes are supported. Codes contain roster order, not positioning. Lux origins are not exportable.',
    mappingVerified: set === 18,
    fixtureVerified: set === 18,
    manualPasteVerified: set === 18 && mapping.manualPasteVerified,
    knownGoodFixtureIds: set === 18 ? [externalFixture.id, humanFixture.id] : [],
  }),
  encode: (board) =>
    mapping.manualPasteVerified
      ? encodeMappedBoard(board)
      : { ok: false, error: teamPlanner.supportStatus({ set: board.set }).reason },
};
