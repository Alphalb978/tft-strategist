import type { BoardSimilarity, CanonicalBoard } from '../domain/models';

export const BOARD_SIMILARITY_MODEL = {
  version: 'board-similarity-v1',
  weights: {
    unitStructure: 0.82,
    boardSize: 0.08,
    traits: 0.06,
    starPattern: 0.04,
  },
  costWeightStep: 0.08,
} as const;

const ratio = (a: number, b: number) => (b > 0 ? a / b : 1);

function setJaccard(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  return ratio([...a].filter((value) => b.has(value)).length, union.size);
}

export function compareCanonicalBoards(
  left: CanonicalBoard,
  right: CanonicalBoard,
): BoardSimilarity {
  if (left.set !== right.set)
    return {
      value: 0,
      unitStructure: 0,
      boardSize: 0,
      traits: 0,
      starPattern: 0,
      modelVersion: BOARD_SIMILARITY_MODEL.version,
    };
  const a = new Map(left.units.map((unit) => [unit.championId, unit]));
  const b = new Map(right.units.map((unit) => [unit.championId, unit]));
  const ids = new Set([...a.keys(), ...b.keys()]);
  let intersection = 0;
  let union = 0;
  const shared: string[] = [];
  for (const id of ids) {
    const unit = a.get(id) ?? b.get(id)!;
    const weight = 1 + Math.max(0, unit.cost - 1) * BOARD_SIMILARITY_MODEL.costWeightStep;
    union += weight;
    if (a.has(id) && b.has(id)) {
      intersection += weight;
      shared.push(id);
    }
  }
  const unitStructure = ratio(intersection, union);
  const boardSize =
    1 - Math.abs(left.boardSize - right.boardSize) / Math.max(1, left.boardSize, right.boardSize);
  const traits = setJaccard(left.traitIds, right.traitIds);
  const starPattern = shared.length
    ? shared.reduce((sum, id) => {
        const l = a.get(id)!.stars;
        const r = b.get(id)!.stars;
        if (l === null && r === null) return sum + 1;
        if (l === null || r === null) return sum + 0.5;
        return sum + Math.max(0, 1 - Math.abs(l - r) / 2);
      }, 0) / shared.length
    : 0;
  const value =
    unitStructure * BOARD_SIMILARITY_MODEL.weights.unitStructure +
    boardSize * BOARD_SIMILARITY_MODEL.weights.boardSize +
    traits * BOARD_SIMILARITY_MODEL.weights.traits +
    starPattern * BOARD_SIMILARITY_MODEL.weights.starPattern;
  return {
    value: Math.min(1, Math.max(0, value)),
    unitStructure,
    boardSize,
    traits,
    starPattern,
    modelVersion: BOARD_SIMILARITY_MODEL.version,
  };
}
