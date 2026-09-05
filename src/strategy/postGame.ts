import type { CompletedMatch, Playbook, PostGameSummary, SelectedPlan } from '../domain/models';
export function summarizeCompletedMatch(
  match: CompletedMatch,
  puuid: string,
  playbook: Playbook,
  selection?: SelectedPlan,
): PostGameSummary {
  const player = match.participants.find((p) => p.puuid === puuid);
  if (!player) throw new Error('Player absent from completed match');
  const sameSet = match.set === playbook.set;
  const found = playbook.family.core.filter((id) =>
    player.units.some((u) => u.championId === id),
  ).length;
  return {
    matchId: match.id,
    selectedPlanId: selection?.id,
    placement: player.placement,
    observations: sameSet
      ? [`Final board contains ${found} of ${playbook.family.core.length} intended core units.`]
      : ['Selected plan is from a different set; comparison unavailable.'],
    possibleMismatches:
      sameSet && found < playbook.family.core.length
        ? ['Final board differs from the selected core. This may reflect an intentional pivot.']
        : [],
    nextAdjustment:
      'Review the final board alongside your selected playbook; completed history cannot explain every decision.',
    provenance: {
      source: match.source,
      fetchedAt: match.completedAt,
      patch: match.patch,
      status: 'verified',
      note: 'End-state comparison only; no causal attribution.',
    },
  };
}
