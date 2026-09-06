import type {
  CandidateContest,
  LobbyPressure,
  LobbyUnitPressureEvidence,
  OpponentProfile,
  Playbook,
  UnitTrend,
} from '../domain/models';

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

/**
 * These coefficients are an inspectable product model, not TFT rules or future-choice
 * probabilities. Any change requires a derivation-version bump.
 */
export const M4_UNIT_MODEL = {
  version: 'm4-unit-pressure-v1',
  profileVersion: 'opponent-unit-evidence-v4',
  defaultHistoryTarget: 20,
  supportedHistoryTargets: [10, 15, 20] as const,
  recency: {
    ordinalHalfLifeGames: 10,
    ageHalfLifeDays: 14,
    ordinalShare: 0.6,
    ageShare: 0.4,
  },
  trend: {
    recentGames: 5,
    labelThreshold: 0.2,
  },
  pressure: {
    expectedLobbyOpponents: 7,
    meaningfulPresence: 0.15,
    recentSpikeMultiplier: 0.35,
    historicalCopyMultiplier: 0.25,
    maximumOrdinaryCopies: 9,
  },
  contest: {
    contributionScale: 2,
    stateMedium: 0.2,
    stateHigh: 0.5,
    roleFactors: { carry: 1.25, tank: 1.05, support: 0.6, unassigned: 0.75 },
    membershipFactors: { core: 1.15, flex: 0.55 },
    slowRollStyleFactor: 1.15,
    defaultStyleFactor: 1,
  },
  portfolio: {
    redundantPressurePenalty: 24,
  },
} as const;

export function gameRecencyWeight(ordinal: number, completedAt: string, now: string): number {
  const rank = Math.max(0, ordinal);
  const ordinalWeight = 2 ** (-rank / M4_UNIT_MODEL.recency.ordinalHalfLifeGames);
  const ageMs = Date.parse(now) - Date.parse(completedAt);
  const ageWeight =
    Number.isFinite(ageMs) && ageMs >= 0
      ? 2 ** (-(ageMs / 86_400_000) / M4_UNIT_MODEL.recency.ageHalfLifeDays)
      : ordinalWeight;
  return (
    M4_UNIT_MODEL.recency.ordinalShare * ordinalWeight + M4_UNIT_MODEL.recency.ageShare * ageWeight
  );
}

export function unitTrend(delta: number | null): UnitTrend {
  if (delta === null || !Number.isFinite(delta)) return 'unavailable';
  if (delta >= M4_UNIT_MODEL.trend.labelThreshold) return 'rising';
  if (delta <= -M4_UNIT_MODEL.trend.labelThreshold) return 'falling';
  return 'stable';
}

export function deriveLobbyUnitPressure(
  profiles: OpponentProfile[],
  currentUnitIds: Iterable<string>,
): LobbyUnitPressureEvidence[] {
  const expected = M4_UNIT_MODEL.pressure.expectedLobbyOpponents;
  const evidenceCoverage = clamp(
    profiles.reduce((total, profile) => total + clamp(profile.confidence), 0) / expected,
  );
  const ids = new Set(currentUnitIds);
  for (const profile of profiles)
    for (const evidence of profile.unitEvidence ?? []) ids.add(evidence.championId);

  return [...ids]
    .map((championId): LobbyUnitPressureEvidence => {
      const sources = profiles.flatMap((profile) => {
        const evidence = profile.unitEvidence?.find((unit) => unit.championId === championId);
        if (!evidence) return [];
        return [
          {
            puuid: profile.puuid,
            riotId: profile.riotId,
            confidence: clamp(profile.confidence),
            weightedPresence: clamp(evidence.weightedPresence),
            recentFiveRate: clamp(evidence.recentFiveRate),
            trendDelta: evidence.trendDelta,
            weightedHistoricalCopyDemand: evidence.historicalCopyDemand.weightedDemand,
          },
        ];
      });
      const equivalentHistoricalUsers = sources.reduce(
        (total, source) => total + source.confidence * source.weightedPresence,
        0,
      );
      const recentSpikeEquivalentUsers = sources.reduce(
        (total, source) => total + source.confidence * Math.max(0, source.trendDelta ?? 0),
        0,
      );
      const historicalCopyEquivalentUsers = sources.reduce((total, source) => {
        if (source.weightedHistoricalCopyDemand === null) return total;
        const extraCopyDemand = Math.max(
          0,
          source.weightedHistoricalCopyDemand - source.weightedPresence,
        );
        return (
          total +
          (source.confidence * extraCopyDemand) / (M4_UNIT_MODEL.pressure.maximumOrdinaryCopies - 1)
        );
      }, 0);
      const totalEquivalentUsers = Math.min(
        expected,
        equivalentHistoricalUsers +
          M4_UNIT_MODEL.pressure.recentSpikeMultiplier * recentSpikeEquivalentUsers +
          M4_UNIT_MODEL.pressure.historicalCopyMultiplier * historicalCopyEquivalentUsers,
      );
      return {
        championId,
        opponentsWithEvidence: sources.filter(
          (source) =>
            source.weightedPresence >= M4_UNIT_MODEL.pressure.meaningfulPresence ||
            source.recentFiveRate >= M4_UNIT_MODEL.pressure.meaningfulPresence,
        ).length,
        equivalentHistoricalUsers,
        recentSpikeEquivalentUsers,
        historicalCopyEquivalentUsers,
        totalEquivalentUsers,
        normalizedPressure: clamp(totalEquivalentUsers / expected),
        evidenceCoverage,
        sourceOpponents: sources.sort(
          (a, b) =>
            b.confidence * b.weightedPresence - a.confidence * a.weightedPresence ||
            a.puuid.localeCompare(b.puuid),
        ),
      };
    })
    .sort(
      (a, b) =>
        b.normalizedPressure - a.normalizedPressure || a.championId.localeCompare(b.championId),
    );
}

export function candidateContestFor(playbook: Playbook, lobby?: LobbyPressure): CandidateContest {
  if (
    !lobby ||
    lobby.state === 'unavailable' ||
    !lobby.profiles.length ||
    !lobby.unitPressure.length
  )
    return {
      state: 'Unavailable',
      value: null,
      lobbyFit: null,
      evidenceCoverage: 0,
      contestElasticity: clamp(playbook.features.contestElasticity),
      styleFactor: 1,
      pressuredUnits: [],
      note: 'No opponent unit-history evidence is available; lobby fit remains neutral.',
      provenance: 'unavailable',
    };

  const pressureByUnit = new Map(
    lobby.unitPressure.map((pressure) => [pressure.championId, pressure]),
  );
  const contestElasticity = clamp(playbook.features.contestElasticity);
  const styleFactor = /slow roll/i.test(playbook.features.style)
    ? M4_UNIT_MODEL.contest.slowRollStyleFactor
    : M4_UNIT_MODEL.contest.defaultStyleFactor;
  const pressuredUnits: CandidateContest['pressuredUnits'] = Object.entries(
    playbook.features.unitCriticality,
  )
    .flatMap(([championId, rawCriticality]) => {
      const pressure = pressureByUnit.get(championId);
      if (!pressure || pressure.normalizedPressure <= 0) return [];
      const role: CandidateContest['pressuredUnits'][number]['role'] =
        playbook.roles.find((entry) => entry.championId === championId)?.role ?? 'unassigned';
      const membership: CandidateContest['pressuredUnits'][number]['membership'] =
        playbook.family.core.includes(championId) ? 'core' : 'flex';
      const criticality = clamp(rawCriticality);
      const contribution =
        (pressure.normalizedPressure *
          criticality *
          M4_UNIT_MODEL.contest.roleFactors[role] *
          M4_UNIT_MODEL.contest.membershipFactors[membership] *
          contestElasticity *
          styleFactor) /
        M4_UNIT_MODEL.contest.contributionScale;
      return [
        {
          championId,
          criticality,
          role,
          membership,
          lobbyPressure: pressure.normalizedPressure,
          equivalentHistoricalUsers: pressure.totalEquivalentUsers,
          contribution,
        },
      ];
    })
    .sort((a, b) => b.contribution - a.contribution || a.championId.localeCompare(b.championId));
  const evidenceCoverage = lobby.unitPressure[0]?.evidenceCoverage ?? 0;
  const value = clamp(pressuredUnits.reduce((total, unit) => total + unit.contribution, 0));
  const lobbyFit = 100 * clamp(0.5 + 0.5 * evidenceCoverage - value);
  return {
    state:
      value >= M4_UNIT_MODEL.contest.stateHigh
        ? 'High'
        : value >= M4_UNIT_MODEL.contest.stateMedium
          ? 'Medium'
          : 'Low',
    value,
    lobbyFit,
    evidenceCoverage,
    contestElasticity,
    styleFactor,
    pressuredUnits,
    note: 'Historical final-board overlap weighted by opponent evidence confidence, seeded unit criticality, role, core membership, and contest elasticity.',
    provenance: 'seeded-criticality-and-m4-history',
  };
}
