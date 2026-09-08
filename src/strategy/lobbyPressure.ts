import type {
  CandidateContest,
  CandidateRouteEvidence,
  CandidateRouteOpponent,
  LobbyPressure,
  LobbyUnitPressureEvidence,
  OpponentProfile,
  Playbook,
  UnitTrend,
} from '../domain/models';

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

export const M4_ROUTE_MODEL = {
  version: 'm4-route-overlap-v2',
  weights: {
    coreRecall: 0.45,
    anchorRecall: 0.25,
    targetRecall: 0.15,
    targetJaccard: 0.15,
    externalRecall: 0.5,
    externalJaccard: 0.5,
  },
  thresholds: {
    strongMatch: 0.65,
    coreDampingThreshold: 0.5,
    meaningfulRouteCommitment: 0.3,
  },
  aggregation: {
    model: 'saturating-union' as const,
    fullSampleConfidenceBaseline: 0.45,
    agreementBonusMax: 0.12,
  },
} as const;

export function deriveLobbyEvidenceCoverage(
  profiles: OpponentProfile[],
  expectedOpponents = M4_UNIT_MODEL.pressure.expectedLobbyOpponents,
  lobbyCoverage?: number,
): number {
  if (typeof lobbyCoverage === 'number' && Number.isFinite(lobbyCoverage) && lobbyCoverage > 0) {
    return clamp(lobbyCoverage);
  }
  if (!profiles.length || expectedOpponents <= 0) return 0;
  const totalCompleteness = profiles.reduce((sum, profile) => {
    if (profile.confidenceFactors) {
      const sampleCoverage = profile.confidenceFactors.sampleCoverage;
      const modeQuality = profile.confidenceFactors.modeQuality;
      const patchQuality = profile.confidenceFactors.patchQuality ?? 1;
      return sum + clamp(sampleCoverage * modeQuality * patchQuality);
    }
    const sampleCoverage = clamp(profile.relevantGames / M4_UNIT_MODEL.defaultHistoryTarget);
    return sum + clamp(sampleCoverage);
  }, 0);
  return clamp(totalCompleteness / expectedOpponents);
}

/**
 * These coefficients are an inspectable product model, not TFT rules or future-choice
 * probabilities. Any change requires a derivation-version bump.
 */
export const M4_UNIT_MODEL = {
  version: 'm4-unit-pressure-v1',
  profileVersion: 'opponent-unit-evidence-v4',
  defaultHistoryTarget: 10,
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

export function calculateBoardRouteSimilarity(
  boardChampionIds: Iterable<string>,
  candidate: Playbook,
): number {
  const boardSet = new Set(boardChampionIds);
  const targetUnits = new Set(candidate.target?.units?.map((u) => u.championId) ?? []);
  const coreUnits = candidate.family?.core ?? [];
  const hasCore = coreUnits.length > 0;

  if (hasCore) {
    const coreOverlapCount = coreUnits.filter((id) => boardSet.has(id)).length;
    const coreRecall = coreOverlapCount / coreUnits.length;

    if (coreUnits.length >= 2 && coreRecall < M4_ROUTE_MODEL.thresholds.coreDampingThreshold) {
      if (coreRecall === 0) return 0;
      const damping = (coreRecall / M4_ROUTE_MODEL.thresholds.coreDampingThreshold) ** 2;
      const targetOverlapCount =
        targetUnits.size > 0 ? [...targetUnits].filter((id) => boardSet.has(id)).length : 0;
      const targetRecall = targetUnits.size > 0 ? targetOverlapCount / targetUnits.size : 0;
      const unionSize = new Set([...boardSet, ...targetUnits]).size;
      const targetJaccard = unionSize > 0 ? targetOverlapCount / unionSize : 0;
      const raw =
        M4_ROUTE_MODEL.weights.coreRecall * coreRecall +
        M4_ROUTE_MODEL.weights.targetRecall * targetRecall +
        M4_ROUTE_MODEL.weights.targetJaccard * targetJaccard;
      return clamp(raw * damping);
    }

    const anchorRoles = candidate.roles.filter(
      (r) => (r.role === 'carry' || r.role === 'tank') && coreUnits.includes(r.championId),
    );
    const anchors = anchorRoles.length > 0 ? anchorRoles.map((r) => r.championId) : coreUnits;
    const anchorOverlapCount = anchors.filter((id) => boardSet.has(id)).length;
    const anchorRecall = anchorOverlapCount / anchors.length;

    const targetOverlapCount =
      targetUnits.size > 0 ? [...targetUnits].filter((id) => boardSet.has(id)).length : 0;
    const targetRecall = targetUnits.size > 0 ? targetOverlapCount / targetUnits.size : 0;
    const unionSize = new Set([...boardSet, ...targetUnits]).size;
    const targetJaccard = unionSize > 0 ? targetOverlapCount / unionSize : 0;

    const score =
      M4_ROUTE_MODEL.weights.coreRecall * coreRecall +
      M4_ROUTE_MODEL.weights.anchorRecall * anchorRecall +
      M4_ROUTE_MODEL.weights.targetRecall * targetRecall +
      M4_ROUTE_MODEL.weights.targetJaccard * targetJaccard;
    return clamp(score);
  }

  // External comp without verified core
  const targetOverlapCount =
    targetUnits.size > 0 ? [...targetUnits].filter((id) => boardSet.has(id)).length : 0;
  const targetRecall = targetUnits.size > 0 ? targetOverlapCount / targetUnits.size : 0;
  const unionSize = new Set([...boardSet, ...targetUnits]).size;
  const targetJaccard = unionSize > 0 ? targetOverlapCount / unionSize : 0;

  let score =
    M4_ROUTE_MODEL.weights.externalRecall * targetRecall +
    M4_ROUTE_MODEL.weights.externalJaccard * targetJaccard;

  if (targetRecall < 0.5) {
    score *= (targetRecall / 0.5) ** 2;
  }
  return clamp(score);
}

export function deriveOpponentRouteEvidence(
  profile: OpponentProfile,
  candidate: Playbook,
): CandidateRouteOpponent | null {
  const boards = profile.historicalBoards;
  if (!boards || boards.length === 0) return null;

  let totalWeight = 0;
  let weightedSimSum = 0;
  let stronglyMatchingBoards = 0;
  let recentFiveStrongMatches = 0;
  let recent5Count = 0;
  let recent5SimSum = 0;

  for (const board of boards) {
    const sim = calculateBoardRouteSimilarity(board.championIds, candidate);
    const isStrong = sim >= M4_ROUTE_MODEL.thresholds.strongMatch;
    totalWeight += board.weight;
    weightedSimSum += board.weight * sim;
    if (isStrong) stronglyMatchingBoards++;
    if (board.ordinal < M4_UNIT_MODEL.trend.recentGames) {
      recent5Count++;
      recent5SimSum += sim;
      if (isStrong) recentFiveStrongMatches++;
    }
  }

  if (totalWeight <= 0) return null;

  const weightedRouteSimilarity = clamp(weightedSimSum / totalWeight);
  const recentFiveSimilarity =
    recent5Count > 0 ? clamp(recent5SimSum / recent5Count) : weightedRouteSimilarity;
  const routeOverlap = clamp(0.6 * weightedRouteSimilarity + 0.4 * recentFiveSimilarity);

  return {
    puuid: profile.puuid,
    riotId: profile.riotId,
    confidence: clamp(profile.confidence),
    routeOverlap,
    stronglyMatchingBoards,
    recentFiveStrongMatches,
    recentWindowGames: recent5Count,
    totalBoards: boards.length,
  };
}

export function deriveLobbyRouteContest(
  profiles: OpponentProfile[],
  candidate: Playbook,
): { routeContest: number; evidence: CandidateRouteEvidence | null } {
  const opponents: CandidateRouteOpponent[] = [];
  for (const profile of profiles) {
    const opp = deriveOpponentRouteEvidence(profile, candidate);
    if (opp) opponents.push(opp);
  }

  const meaningful = opponents.filter(
    (o) => o.routeOverlap >= M4_ROUTE_MODEL.thresholds.meaningfulRouteCommitment,
  );

  if (meaningful.length === 0) {
    return { routeContest: 0, evidence: null };
  }

  meaningful.sort((a, b) => b.routeOverlap * b.confidence - a.routeOverlap * a.confidence);

  // Saturating-union aggregation across independent qualifying opponents:
  // q_p = clamp(routeOverlap_p * confidenceFactor_p, 0, 1)
  // rawRouteContest = 1 - product_over_opponents(1 - q_p)
  let complementProduct = 1;
  for (const opp of meaningful) {
    const confidenceFactor = clamp(
      opp.confidence / M4_ROUTE_MODEL.aggregation.fullSampleConfidenceBaseline,
    );
    const q_p = clamp(opp.routeOverlap * confidenceFactor);
    complementProduct *= 1 - q_p;
  }
  const rawRouteContest = clamp(1 - complementProduct);

  const contestElasticity = clamp(candidate.features.contestElasticity);
  const styleFactor = /slow roll/i.test(candidate.features.style)
    ? M4_UNIT_MODEL.contest.slowRollStyleFactor
    : M4_UNIT_MODEL.contest.defaultStyleFactor;

  const routeContest = clamp(rawRouteContest * contestElasticity * styleFactor);
  const summary = `${meaningful.length} opponent${meaningful.length === 1 ? '' : 's'} repeatedly matched this roster`;

  return {
    routeContest,
    evidence: {
      routeContest,
      opponentsWithRouteMatch: meaningful.length,
      matchingOpponents: meaningful,
      summary,
    },
  };
}

export function candidateContestFor(playbook: Playbook, lobby?: LobbyPressure): CandidateContest {
  const hasUnitCriticality = Object.values(playbook.features.unitCriticality).some(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (!lobby || lobby.state === 'unavailable' || !lobby.profiles.length) {
    return {
      state: 'Unavailable',
      value: null,
      lobbyFit: null,
      evidenceCoverage: 0,
      contestElasticity: clamp(playbook.features.contestElasticity),
      styleFactor: 1,
      pressuredUnits: [],
      note: 'Opponent history is unavailable; lobby fit remains neutral.',
      provenance: 'unavailable',
    };
  }

  const { routeContest, evidence: routeEvidence } = deriveLobbyRouteContest(
    lobby.profiles,
    playbook,
  );

  if (!hasUnitCriticality && (!routeEvidence || routeEvidence.opponentsWithRouteMatch === 0)) {
    return {
      state: 'Unavailable',
      value: null,
      lobbyFit: null,
      evidenceCoverage: 0,
      contestElasticity: clamp(playbook.features.contestElasticity),
      styleFactor: 1,
      pressuredUnits: [],
      note: 'Unit criticality or opponent history is unavailable; lobby fit remains neutral.',
      provenance: 'unavailable',
    };
  }

  const contestElasticity = clamp(playbook.features.contestElasticity);
  const styleFactor = /slow roll/i.test(playbook.features.style)
    ? M4_UNIT_MODEL.contest.slowRollStyleFactor
    : M4_UNIT_MODEL.contest.defaultStyleFactor;

  const pressureByUnit = new Map(
    (lobby.unitPressure ?? []).map((pressure) => [pressure.championId, pressure]),
  );

  const pressuredUnits: CandidateContest['pressuredUnits'] = hasUnitCriticality
    ? Object.entries(playbook.features.unitCriticality)
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
        .sort((a, b) => b.contribution - a.contribution || a.championId.localeCompare(b.championId))
    : [];

  const evidenceCoverage = deriveLobbyEvidenceCoverage(
    lobby.profiles,
    M4_UNIT_MODEL.pressure.expectedLobbyOpponents,
    lobby.coverage,
  );

  const unitContest = clamp(
    pressuredUnits.reduce((total, unit) => total + unit.contribution, 0),
  );

  const strongest = Math.max(unitContest, routeContest);
  const agreement = Math.min(unitContest, routeContest);
  const reinforcement = M4_ROUTE_MODEL.aggregation.agreementBonusMax * agreement;
  const value = clamp(strongest + reinforcement);

  const lobbyFit = 100 * clamp(0.5 + 0.5 * evidenceCoverage - value);

  const note =
    routeEvidence && routeEvidence.opponentsWithRouteMatch > 0
      ? `Historical route overlap (${routeEvidence.opponentsWithRouteMatch} matching opponent${routeEvidence.opponentsWithRouteMatch === 1 ? '' : 's'}) and critical unit pressure.`
      : 'Historical final-board overlap weighted by opponent evidence confidence, seeded unit criticality, role, core membership, and contest elasticity.';

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
    note,
    provenance: 'seeded-criticality-and-m4-history',
    unitContest,
    routeContest,
    routeEvidence,
  };
}
