import type { PlanSession, PostGameReview } from '../domain/models';
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
