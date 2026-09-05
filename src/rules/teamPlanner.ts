import type { ActiveSetVersion, Board, Result, TeamPlannerSupport } from '../domain/models';
export interface TeamPlannerCodec {
  supportStatus(set: Pick<ActiveSetVersion, 'set'>): TeamPlannerSupport;
  encode(board: Board): Result<string, string>;
}
export const teamPlanner: TeamPlannerCodec = {
  supportStatus: ({ set }) => ({
    state: set === 18 ? 'unverified' : 'unsupported',
    reason:
      set === 18
        ? 'Set 18 mapping, known-good fixture and manual client paste have not been verified.'
        : 'This set has no verified codec.',
    mappingVerified: false,
    fixtureVerified: false,
    manualPasteVerified: false,
  }),
  encode: (board) => ({ ok: false, error: teamPlanner.supportStatus({ set: board.set }).reason }),
};
