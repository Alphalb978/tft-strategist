import type {
  MatchRecommendationLink,
  PersonalMatchObservation,
  PlanSession,
  MatchReconciliation,
  RecommendationPortfolio,
} from '../domain/models';

export interface StoredRecommendationSnapshot {
  id: string;
  payload: string;
  generated_at: string;
}

export function linkMatchToRecommendation(
  observation: PersonalMatchObservation,
  sessions: PlanSession[],
  reconciliations: MatchReconciliation[],
  snapshots: StoredRecommendationSnapshot[] = [],
): MatchRecommendationLink {
  // 1. Explicit PlanSession Linkage (Primary & Highest Confidence)
  const explicitRec = reconciliations.find(
    (r) => r.matchId === observation.matchId && r.state === 'matched',
  );

  let targetSession: PlanSession | null = null;
  if (explicitRec) {
    targetSession =
      sessions.find((s) => s.id === explicitRec.terminalSessionId) ??
      sessions.find((s) => explicitRec.sessionIds.includes(s.id) && s.state === 'ended') ??
      null;
  }

  if (!targetSession) {
    targetSession =
      sessions.find(
        (s) =>
          s.reconciliation?.matchId === observation.matchId,
      ) ?? null;
  }

  if (targetSession) {
    const candidate = targetSession.snapshot.candidate;
    const portfolio = targetSession.snapshot.portfolio;
    const rank = targetSession.snapshot.selectedRank ?? 1;
    const compId = candidate.playbook.id;
    const compTitle = candidate.playbook.title;
    const contestState = candidate.contest.state;
    const finalSafety = candidate.home?.finalSafety ?? candidate.score;

    const details: string[] = [
      `Locked Plan: #${rank} ${compTitle}`,
      `Contest: ${contestState}`,
      `Final Safety: ${finalSafety.toFixed(1)}`,
      `Final Placement: #${observation.placement}`,
    ];

    let statement = '';
    if (observation.classifiedCompId === compId) {
      statement = `Played the #${rank} recommended route (${compTitle}) · finished #${observation.placement}`;
    } else if (
      observation.classifiedCompId &&
      portfolio.plans.some((p) => p.candidate.playbook.id === observation.classifiedCompId)
    ) {
      const matchIndex = portfolio.plans.findIndex(
        (p) => p.candidate.playbook.id === observation.classifiedCompId,
      );
      statement = `Final board matched recommendation #${matchIndex + 1} (${portfolio.plans[matchIndex].candidate.playbook.title}) · finished #${observation.placement}`;
    } else if (contestState === 'High') {
      statement = `Recommended route was High contest; you pivoted to another comp · finished #${observation.placement}`;
    } else {
      statement = `Final board diverged from locked recommendation #${rank} (${compTitle}) · finished #${observation.placement}`;
    }

    return {
      matchId: observation.matchId,
      state: 'linked',
      sessionId: targetSession.id,
      recommendedPlaybookId: compId,
      recommendedPlaybookTitle: compTitle,
      recommendedRank: rank,
      contestState,
      finalSafety,
      actualClassifiedCompId: observation.classifiedCompId,
      actualPlacement: observation.placement,
      summaryStatement: statement,
      details,
    };
  }

  // 2. Candidate Recommendation Snapshot Association (Bounded Time Window)
  const matchTime = Date.parse(observation.gameTimestamp);
  if (Number.isFinite(matchTime) && snapshots.length > 0) {
    const plausibleSnapshots = snapshots.filter((snap) => {
      const snapTime = Date.parse(snap.generated_at);
      if (!Number.isFinite(snapTime)) return false;
      const deltaMinutes = (matchTime - snapTime) / 60_000;
      // Snapshot must be generated 0 to 75 minutes prior to game timestamp
      return deltaMinutes >= -5 && deltaMinutes <= 75;
    });

    if (plausibleSnapshots.length === 1) {
      try {
        const snap = plausibleSnapshots[0];
        const parsed = JSON.parse(snap.payload) as {
          portfolio?: RecommendationPortfolio;
          candidatePlaybooks?: Array<{ id: string; title: string }>;
        };
        const plans = parsed.portfolio?.plans ?? [];
        if (plans.length > 0) {
          const topPlan = plans[0];
          const topCompId = topPlan.candidate.playbook.id;
          const topCompTitle = topPlan.candidate.playbook.title;
          const contest = topPlan.candidate.contest.state;

          let statement = '';
          if (observation.classifiedCompId === topCompId) {
            statement = `Played the #1 recommended route (${topCompTitle}) · finished #${observation.placement}`;
          } else if (
            observation.classifiedCompId &&
            plans.some((p) => p.candidate.playbook.id === observation.classifiedCompId)
          ) {
            const idx = plans.findIndex(
              (p) => p.candidate.playbook.id === observation.classifiedCompId,
            );
            statement = `Final board matched recommendation #${idx + 1} (${plans[idx].candidate.playbook.title}) · finished #${observation.placement}`;
          } else {
            statement = `Final board did not match stored #1 recommendation (${topCompTitle}) · finished #${observation.placement}`;
          }

          return {
            matchId: observation.matchId,
            state: 'candidate',
            sessionId: snap.id,
            recommendedPlaybookId: topCompId,
            recommendedPlaybookTitle: topCompTitle,
            recommendedRank: 1,
            contestState: contest,
            finalSafety: topPlan.candidate.home?.finalSafety ?? topPlan.candidate.score,
            actualClassifiedCompId: observation.classifiedCompId,
            actualPlacement: observation.placement,
            summaryStatement: statement,
            details: [
              `Plausible recommendation snapshot from ${new Date(snap.generated_at).toLocaleTimeString()}`,
              `Top recommended route: ${topCompTitle} (${contest} contest)`,
            ],
          };
        }
      } catch {
        // Fall through to unassociated
      }
    } else if (plausibleSnapshots.length > 1) {
      return {
        matchId: observation.matchId,
        state: 'ambiguous',
        actualPlacement: observation.placement,
        actualClassifiedCompId: observation.classifiedCompId,
        summaryStatement: 'Multiple plausible recommendation snapshots found prior to match.',
        details: [
          `${plausibleSnapshots.length} snapshots generated within the pre-game time window.`,
        ],
      };
    }
  }

  // 3. No Recommendation Evidence Available
  return {
    matchId: observation.matchId,
    state: 'none',
    actualPlacement: observation.placement,
    actualClassifiedCompId: observation.classifiedCompId,
    summaryStatement: 'No recommendation snapshot attached to this game.',
    details: ['Match was played without an active recommendation snapshot.'],
  };
}
