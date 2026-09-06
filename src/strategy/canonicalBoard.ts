import { stableFingerprint } from '../domain/fingerprint';
import type {
  Board,
  CanonicalBoardUnit,
  CanonicalizationResult,
  MatchParticipant,
  StaticData,
} from '../domain/models';
import { ordinaryCopiesForStar } from '../rules/ruleSet';

export const CANONICAL_BOARD_MODEL = {
  version: 'canonical-board-v1',
  schemaVersion: 1 as const,
} as const;

type InputUnit = {
  championId: string;
  stars?: number | null;
  unresolvedUnit?: boolean;
};

function canonicalize(
  units: InputUnit[],
  capacity: number,
  set: number,
  data: StaticData,
): CanonicalizationResult {
  const champions = new Map(data.champions.map((unit) => [unit.id, unit]));
  const unresolved = new Set<string>();
  const reasons = new Set<string>();
  if (set !== data.version.set) reasons.add('Board set does not match the active static set.');
  if (!Number.isInteger(capacity) || capacity < 1)
    reasons.add('Board capacity is missing or invalid.');
  const normalized = new Map<string, CanonicalBoardUnit>();
  for (const input of units) {
    const champion = champions.get(input.championId);
    if (input.unresolvedUnit || !champion) {
      unresolved.add(input.championId);
      reasons.add('At least one unit cannot be resolved in the active catalog.');
      continue;
    }
    if (!champion.boardEligible || champion.shopStatus !== 'pool') {
      unresolved.add(input.championId);
      reasons.add('Special, placeholder, or runtime-only units have no verified canonical form.');
      continue;
    }
    const stars =
      input.stars === undefined || input.stars === null
        ? null
        : ordinaryCopiesForStar(input.stars) === null
          ? null
          : input.stars;
    if (input.stars !== undefined && input.stars !== null && stars === null)
      reasons.add('Unsupported star evidence cannot be canonicalized.');
    const existing = normalized.get(champion.id);
    normalized.set(champion.id, {
      championId: champion.id,
      cost: champion.cost,
      traitIds: [...champion.traitIds].sort(),
      stars:
        existing?.stars === null || stars === null
          ? (existing?.stars ?? stars)
          : Math.max(existing?.stars ?? 0, stars),
      ordinaryCopies:
        existing?.ordinaryCopies === null || stars === null
          ? (existing?.ordinaryCopies ?? null)
          : Math.max(existing?.ordinaryCopies ?? 0, ordinaryCopiesForStar(stars) ?? 0),
    });
  }
  if (reasons.size || !normalized.size)
    return {
      state: 'invalid',
      board: null,
      unresolvedUnitIds: [...unresolved].sort(),
      reasons: [...reasons, ...(!normalized.size ? ['Board has no canonical units.'] : [])],
    };
  const canonicalUnits = [...normalized.values()].sort((a, b) =>
    a.championId.localeCompare(b.championId),
  );
  const traitIds = [...new Set(canonicalUnits.flatMap((unit) => unit.traitIds))]
    .filter((id) =>
      data.traits.some((trait) => trait.id === id && trait.availability === 'verified'),
    )
    .sort();
  const structure = {
    modelVersion: CANONICAL_BOARD_MODEL.version,
    set,
    capacity,
    units: canonicalUnits.map((unit) => ({
      championId: unit.championId,
      stars: unit.stars,
      ordinaryCopies: unit.ordinaryCopies,
    })),
  };
  return {
    state: 'canonical',
    board: {
      schemaVersion: CANONICAL_BOARD_MODEL.schemaVersion,
      modelVersion: CANONICAL_BOARD_MODEL.version,
      set,
      capacity,
      boardSize: canonicalUnits.length,
      units: canonicalUnits,
      traitIds,
      fingerprint: stableFingerprint(structure),
    },
    unresolvedUnitIds: [],
    reasons: [],
  };
}

export function canonicalizeFinalBoard(
  participant: MatchParticipant,
  set: number,
  data: StaticData,
): CanonicalizationResult {
  return canonicalize(participant.units, participant.level, set, data);
}

export function canonicalizeBoard(board: Board, data: StaticData): CanonicalizationResult {
  return canonicalize(board.units, board.capacity, board.set, data);
}
