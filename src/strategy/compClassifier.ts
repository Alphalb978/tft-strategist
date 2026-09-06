import type { CompClassification, MatchParticipant, Playbook, StaticData } from '../domain/models';

export const COMP_CLASSIFIER = {
  version: 'set18-family-classifier-v1',
  weights: { core: 0.45, board: 0.35, roles: 0.15, size: 0.05 },
  minimumScore: 0.62,
  minimumCoreRecall: 0.5,
  ambiguityMargin: 0.08,
} as const;

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

export function classifyFinalBoard(
  participant: MatchParticipant,
  families: Playbook[],
  data: StaticData,
): CompClassification {
  const eligible = new Set(
    data.champions.filter((unit) => unit.boardEligible).map((unit) => unit.id),
  );
  const board = new Set(
    participant.units
      .filter((unit) => eligible.has(unit.championId))
      .map((unit) => unit.championId),
  );
  const ranked = families
    .map((playbook) => {
      const target = new Set(playbook.target.units.map((unit) => unit.championId));
      const core = new Set(playbook.family.core);
      const roles = new Set(playbook.roles.map((role) => role.championId));
      const overlap = [...board].filter((id) => target.has(id)).length;
      const coreRecall = ratio([...core].filter((id) => board.has(id)).length, core.size);
      const boardSimilarity = ratio(overlap, new Set([...board, ...target]).size);
      const rolePresence = roles.size
        ? ratio([...roles].filter((id) => board.has(id)).length, roles.size)
        : coreRecall;
      const sizeFit =
        1 - ratio(Math.abs(board.size - target.size), Math.max(1, board.size, target.size));
      const score =
        coreRecall * COMP_CLASSIFIER.weights.core +
        boardSimilarity * COMP_CLASSIFIER.weights.board +
        rolePresence * COMP_CLASSIFIER.weights.roles +
        sizeFit * COMP_CLASSIFIER.weights.size;
      return {
        familyId: playbook.family.id,
        score,
        coreRecall,
        boardSimilarity,
        rolePresence,
        sizeFit,
      };
    })
    .sort((a, b) => b.score - a.score || a.familyId.localeCompare(b.familyId));
  const top = ranked[0] ?? {
    familyId: null,
    score: 0,
    coreRecall: 0,
    boardSimilarity: 0,
    rolePresence: 0,
    sizeFit: 0,
  };
  const runnerUp = ranked[1];
  const margin = top.score - (runnerUp?.score ?? 0);
  const clears =
    top.familyId !== null &&
    top.score >= COMP_CLASSIFIER.minimumScore &&
    top.coreRecall >= COMP_CLASSIFIER.minimumCoreRecall;
  const state = !clears
    ? ('unclassified' as const)
    : runnerUp && margin < COMP_CLASSIFIER.ambiguityMargin
      ? ('ambiguous' as const)
      : ('classified' as const);
  return {
    state,
    familyId: state === 'classified' ? top.familyId : null,
    score: top.score,
    runnerUpFamilyId: runnerUp?.familyId ?? null,
    runnerUpScore: runnerUp?.score ?? 0,
    margin,
    coreRecall: top.coreRecall,
    boardSimilarity: top.boardSimilarity,
    rolePresence: top.rolePresence,
    sizeFit: top.sizeFit,
    classifierVersion: COMP_CLASSIFIER.version,
  };
}
