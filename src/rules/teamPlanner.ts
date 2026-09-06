import type { ActiveSetVersion, Board, Result, TeamPlannerSupport } from '../domain/models';
export interface TeamPlannerCodec {
  supportStatus(set: Pick<ActiveSetVersion, 'set'>): TeamPlannerSupport;
  encode(board: Board): Result<string, string>;
}
export const TEAM_PLANNER_CONTRACT_VERSION = 'team-planner-support-v2';
export const teamPlanner: TeamPlannerCodec = {
  supportStatus: ({ set }) => ({
    state: set === 18 ? 'unverified' : 'unsupported',
    contractVersion: TEAM_PLANNER_CONTRACT_VERSION,
    formatVersion: set === 18 ? 'candidate-v2-public-claim' : null,
    reason:
      set === 18
        ? 'Set 18 has public candidate format evidence, but this app has no audited planner-ID mapping, independent known-good fixture, or manual TFT-client paste verification.'
        : 'This set has no verified codec.',
    mappingVerified: false,
    fixtureVerified: false,
    manualPasteVerified: false,
    knownGoodFixtureIds: [],
  }),
  encode: (board) => ({ ok: false, error: teamPlanner.supportStatus({ set: board.set }).reason }),
};
