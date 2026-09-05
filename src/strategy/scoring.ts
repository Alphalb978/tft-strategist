import type {
  ActiveSetVersion,
  Confidence,
  FeatureKey,
  LobbyPressure,
  PersonalProfile,
  Playbook,
  RecommendationCandidate,
  ScoreComponent,
} from '../domain/models';
export const clamp = (n: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const weights: Record<FeatureKey, number> = {
  meta: 0.2,
  floor: 0.16,
  ceiling: 0.09,
  itemFlex: 0.1,
  augmentFlex: 0.07,
  transition: 0.1,
  tempo: 0.1,
  availability: 0.08,
  fragility: -0.04,
};
const labels: Record<FeatureKey, string> = {
  meta: 'Meta / evidence input',
  floor: 'Consistency / floor',
  ceiling: 'Ceiling / cap',
  itemFlex: 'Item flexibility',
  augmentFlex: 'Augment flexibility',
  transition: 'Transition quality',
  tempo: 'Stage / tempo safety',
  availability: 'Roll / availability',
  fragility: 'Dependency fragility',
};
export interface ScoringContext {
  version: ActiveSetVersion;
  now: string;
  lobby?: LobbyPressure;
  personal?: PersonalProfile;
  personalWeight?: number;
}
export function personalAdjustment(p: Playbook, profile?: PersonalProfile, weight = 0.05): number {
  if (!profile || profile.set !== p.set || profile.effectiveGames < 5) return 0;
  const relevance = profile.patch === p.patch ? 1 : 0.25;
  return (
    clamp(weight, 0.05, 0.1) *
    50 *
    clamp(profile.familyAffinity[p.family.id] ?? 0, -1, 1) *
    (profile.effectiveGames / (profile.effectiveGames + 30)) *
    relevance
  );
}
export function confidenceFor(p: Playbook, context: ScoringContext): Confidence {
  const date = Math.min(
    Date.parse(p.provenance.fetchedAt),
    Date.parse(context.version.provenance.publishedAt ?? context.version.provenance.fetchedAt),
  );
  const age = Number.isFinite(date) ? Math.max(0, Date.parse(context.now) - date) / 86400000 : 100;
  const drivers = [
    {
      label: `${p.evidence} evidence`,
      factor: { Proven: 1, Variant: 0.8, Emerging: 0.6, Experimental: 0.35 }[p.evidence],
    },
    { label: 'Source freshness', factor: Math.exp(-age / 14) },
    {
      label: p.sampleSize ? `${p.sampleSize} observed games` : 'No measured game sample',
      factor: p.sampleSize ? clamp(p.sampleSize / 200, 0.15, 1) : 0.25,
    },
    {
      label:
        context.version.patchVerified && p.patch === context.version.patch
          ? 'Current patch verified'
          : 'Hotfix parity unverified',
      factor: context.version.patchVerified && p.patch === context.version.patch ? 1 : 0.4,
    },
    {
      label: context.lobby?.coverage ? 'Partial lobby evidence' : 'Lobby data missing',
      factor: 0.25 + 0.75 * clamp(context.lobby?.coverage ?? 0),
    },
    {
      label:
        p.features.provenance.status === 'seeded'
          ? 'Seeded score metadata'
          : 'Derived / curated metadata',
      factor: p.features.provenance.status === 'seeded' ? 0.25 : 0.9,
    },
  ];
  const value = drivers.reduce((a, b) => a + b.factor, 0) / drivers.length;
  // Evidence class and seeded metadata are upper bounds; strong static data cannot promote a novel board.
  const bounded = Math.min(
    value,
    p.evidence === 'Experimental' || p.features.provenance.status === 'seeded' ? 0.39 : 1,
  );
  return {
    level: bounded >= 0.75 ? 'High' : bounded >= 0.5 ? 'Medium' : 'Low',
    value: bounded,
    drivers,
  };
}
export function contestFor(
  p: Playbook,
  lobby?: LobbyPressure,
): { state: RecommendationCandidate['contest']['state']; value: number | null } {
  if (!lobby || !lobby.profiles.length || lobby.state === 'unavailable')
    return { state: 'Unavailable', value: null };
  const importance = Object.values(p.features.unitCriticality).reduce((a, b) => a + b, 0) || 1;
  const pressure = clamp(
    lobby.profiles.reduce(
      (sum, profile) =>
        sum +
        (Object.entries(p.features.unitCriticality).reduce(
          (s, [id, w]) => s + (profile.unitFrequency[id] ?? 0) * w,
          0,
        ) /
          importance) *
          profile.confidence *
          p.features.contestElasticity,
      0,
    ),
  );
  return { state: pressure > 0.65 ? 'High' : pressure > 0.3 ? 'Medium' : 'Low', value: pressure };
}
export function scoreCandidate(p: Playbook, context: ScoringContext): RecommendationCandidate {
  const components: ScoreComponent[] = (Object.keys(weights) as FeatureKey[]).map((key) => ({
    key,
    label: labels[key],
    input: clamp(p.features.values[key], 0, 100),
    weight: weights[key],
    contribution: clamp(p.features.values[key], 0, 100) * weights[key],
    status: p.features.provenance.status,
  }));
  const contest = contestFor(p, context.lobby);
  const lobbyValue = contest.value === null ? null : (1 - contest.value) * 100;
  components.push({
    key: 'lobby',
    label: 'Lobby / contest fit',
    input: lobbyValue,
    weight: 0.1,
    contribution: (lobbyValue ?? 50) * 0.1,
    status: lobbyValue === null ? 'unavailable' : 'curated',
  });
  const adjustment = personalAdjustment(p, context.personal, context.personalWeight);
  components.push({
    key: 'personal',
    label: 'Personal adjustment',
    input: context.personal ? adjustment : null,
    weight: clamp(context.personalWeight ?? 0.05, 0.05, 0.1),
    contribution: adjustment,
    status: context.personal ? 'curated' : 'unavailable',
  });
  const score =
    Math.round(
      clamp(
        components.reduce((s, c) => s + c.contribution, 0),
        0,
        100,
      ) * 10,
    ) / 10;
  const positives = components
    .filter((c) => c.key !== 'personal' && c.key !== 'lobby' && c.weight > 0)
    .sort((a, b) => (b.input ?? 0) - (a.input ?? 0));
  return {
    playbook: p,
    score,
    components,
    confidence: confidenceFor(p, context),
    contest,
    reasons: [
      `${positives[0].label} leads its seeded profile.`,
      'Public guide board; performance evidence is not yet measured.',
    ],
  };
}
