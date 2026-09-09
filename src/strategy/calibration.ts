import type {
  CalibrationV2Bucket,
  CalibrationV2Evaluation,
  MatchRecommendationLink,
  PersonalMatchObservation,
  PlanSession,
  PostGameReview,
} from '../domain/models';

/** Offline descriptive evaluation; never changes model weights. Terminal attribution only. */
export function evaluateCalibration(sessions: PlanSession[], reviews: PostGameReview[]) {
  const seen = new Set<string>();
  const rows = reviews.flatMap((review) => {
    if (!review.attribution.eligible || seen.has(review.matchId)) return [];
    const session = sessions.find((s) => s.id === review.terminalSessionId);
    if (!session || session.selectedPlaybookId !== review.selectedPlan.playbookId) return [];
    seen.add(review.matchId);
    const c = session.snapshot.candidate,
      placement = review.participant.placement;
    return [
      {
        model: session.snapshot.calibration?.engine ?? 'm11-or-earlier',
        external: session.snapshot.calibration?.externalHash ?? null,
        rank: session.snapshot.selectedRank,
        confidence: c.confidence.level,
        contest: c.contest.state,
        placement,
        fusedResidual: c.fusion?.average != null ? placement - c.fusion.average : null,
        internalResidual: review.baseline.placementResidual,
        baselineResiduals: Object.fromEntries(
          Object.entries(session.snapshot.calibration?.baselines ?? {}).map(([mode, plans]) => {
            const prediction = plans.find((p) => p.id === session.selectedPlaybookId)?.average;
            return [mode, prediction != null ? placement - prediction : null];
          }),
        ),
        personal: c.components.find((c) => c.key === 'personal')?.contribution ?? 0,
        stateChanges: session.manualState.currentGameHistory?.length ?? 0,
      },
    ];
  });
  const groups = new Map<string, { games: number; sum: number }>();
  for (const r of rows)
    for (const key of [
      `model:${r.model}`,
      `rank:${r.rank}`,
      `confidence:${r.confidence}`,
      `contest:${r.contest}`,
    ]) {
      const g = groups.get(key) ?? { games: 0, sum: 0 };
      g.games++;
      g.sum += r.placement;
      groups.set(key, g);
    }
  return {
    version: 'calibration-v1',
    rows,
    buckets: [...groups].map(([key, g]) => ({
      key,
      games: g.games,
      averagePlacement: g.sum / g.games,
    })),
    weightsChanged: false,
    limitations: [
      'Descriptive selection-biased outcomes, not causal model improvement.',
      'Only observed terminal decisions have outcomes. No counterfactual outcomes fabricated.',
      'M11 comparison requires historical versions and compatible stored evidence.',
    ],
  };
}

/**
 * Calibration V2: Extended descriptive evaluation across rank, safety, confidence,
 * contest, comp classification, and recommendation alignment.
 * Strictly observational: zero coefficient optimization, zero causal claims, weightsChanged = false.
 */
export function evaluateCalibrationV2(
  sessions: PlanSession[],
  reviews: PostGameReview[],
  observations: PersonalMatchObservation[] = [],
  links: MatchRecommendationLink[] = [],
): CalibrationV2Evaluation {
  const seen = new Set<string>();

  interface OutcomeEntry {
    matchId: string;
    placement: number;
    rank?: number;
    safetyBand?: 'safety:high' | 'safety:medium' | 'safety:guarded';
    confidence?: string;
    contest?: string;
    pressure?: string;
    comp?: string;
    followed?: 'followed:yes' | 'followed:no';
    evidenceConfidence?: string;
  }

  const outcomes: OutcomeEntry[] = [];

  // 1. Ingest plan-attributed reviews
  for (const review of reviews) {
    if (!review.attribution.eligible || seen.has(review.matchId)) continue;
    const session = sessions.find((s) => s.id === review.terminalSessionId);
    if (!session) continue;
    seen.add(review.matchId);

    const c = session.snapshot.candidate;
    const placement = review.participant.placement;
    const finalSafetyScore = c.home?.finalSafety ?? c.score;
    const safetyBand: 'safety:high' | 'safety:medium' | 'safety:guarded' =
      finalSafetyScore >= 80
        ? 'safety:high'
        : finalSafetyScore >= 60
          ? 'safety:medium'
          : 'safety:guarded';

    const rank = session.snapshot.selectedRank ?? 1;
    const classifiedComp =
      review.relation.classification.state === 'classified'
        ? review.relation.classification.familyId
        : undefined;

    const followed =
      classifiedComp && classifiedComp === session.selectedPlaybookId
        ? ('followed:yes' as const)
        : ('followed:no' as const);

    const relevantGames = session.snapshot.evidence.lobby?.relevantGamesAvailable ?? 0;
    outcomes.push({
      matchId: review.matchId,
      placement,
      rank,
      safetyBand,
      confidence: `confidence:${c.confidence.level}`,
      contest: `contest:${c.contest.state.toLowerCase()}`,
      pressure: `pressure:${c.contest.state.toLowerCase()}`,
      comp: classifiedComp ? `comp:${classifiedComp}` : undefined,
      followed,
      evidenceConfidence:
        relevantGames >= 10 ? 'evidence:meaningful' : 'evidence:limited',
    });
  }

  // 2. Ingest account-first personal observations
  for (const obs of observations) {
    if (seen.has(obs.matchId)) continue;
    seen.add(obs.matchId);

    const link = links.find(
      (l) =>
        (l.matchId && l.matchId === obs.matchId) ||
        (l.actualPlacement === obs.placement &&
          (l.actualClassifiedCompId === undefined || l.actualClassifiedCompId === obs.classifiedCompId)),
    );
    const finalSafetyScore = link?.finalSafety;
    const safetyBand =
      finalSafetyScore !== undefined
        ? finalSafetyScore >= 80
          ? ('safety:high' as const)
          : finalSafetyScore >= 60
            ? ('safety:medium' as const)
            : ('safety:guarded' as const)
        : undefined;

    const rank = link?.recommendedRank;
    const followed =
      link && link.state === 'linked' && link.recommendedPlaybookId
        ? obs.classifiedCompId === link.recommendedPlaybookId
          ? ('followed:yes' as const)
          : ('followed:no' as const)
        : undefined;

    outcomes.push({
      matchId: obs.matchId,
      placement: obs.placement,
      rank,
      safetyBand,
      contest: link?.contestState ? `contest:${link.contestState.toLowerCase()}` : undefined,
      comp: obs.classifiedCompId ? `comp:${obs.classifiedCompId}` : undefined,
      followed,
      evidenceConfidence:
        obs.classificationConfidence >= 0.75 ? 'evidence:meaningful' : 'evidence:limited',
    });
  }

  // Accumulate statistics per bucket
  const groupStats = new Map<
    string,
    { category: CalibrationV2Bucket['category']; games: number; sum: number; top4: number; wins: number }
  >();

  const addBucket = (key: string, category: CalibrationV2Bucket['category'], placement: number) => {
    const entry = groupStats.get(key) ?? { category, games: 0, sum: 0, top4: 0, wins: 0 };
    entry.games++;
    entry.sum += placement;
    if (placement <= 4) entry.top4++;
    if (placement === 1) entry.wins++;
    groupStats.set(key, entry);
  };

  for (const o of outcomes) {
    if (o.rank) addBucket(`rank:#${o.rank}`, 'rank', o.placement);
    if (o.safetyBand) addBucket(o.safetyBand, 'safety', o.placement);
    if (o.confidence) addBucket(o.confidence, 'confidence', o.placement);
    if (o.contest) addBucket(o.contest, 'contest', o.placement);
    if (o.pressure) addBucket(o.pressure, 'pressure', o.placement);
    if (o.comp) addBucket(o.comp, 'comp', o.placement);
    if (o.followed) addBucket(o.followed, 'followed', o.placement);
    if (o.evidenceConfidence) addBucket(o.evidenceConfidence, 'evidence', o.placement);
  }

  const buckets: CalibrationV2Bucket[] = [...groupStats.entries()].map(([key, data]) => ({
    key,
    category: data.category,
    games: data.games,
    averagePlacement: Math.round((data.sum / data.games) * 100) / 100,
    top4Rate: Math.round((data.top4 / data.games) * 100) / 100,
    winRate: Math.round((data.wins / data.games) * 100) / 100,
  }));

  return {
    version: 'calibration-v2',
    totalOutcomes: outcomes.length,
    buckets: buckets.sort((a, b) => b.games - a.games || a.key.localeCompare(b.key)),
    weightsChanged: false,
    limitations: [
      'Observational and selection-biased outcomes; does not establish causal recommendation quality.',
      'Only observed terminal choices have known outcomes. Counterfactual results are unavailable.',
      'Sample sizes may be small; do not interpret descriptive averages as statistical guarantees.',
      'Model scoring weights remain unchanged.',
    ],
  };
}
