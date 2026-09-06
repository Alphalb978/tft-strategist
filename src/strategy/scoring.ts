import type {
  ActiveSetVersion,
  AggregateMetaDataset,
  CandidateContest,
  Confidence,
  FeatureKey,
  LobbyPressure,
  PersonalProfile,
  Playbook,
  RecommendationCandidate,
  ScoreComponent,
  DiscoveryDataset,
} from '../domain/models';
import { candidateContestFor } from './lobbyPressure';
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
  meta?: AggregateMetaDataset | null;
  discovery?: DiscoveryDataset | null;
}
export function personalAdjustment(p: Playbook, profile?: PersonalProfile, weight = 0.05): number {
  if (!profile || profile.set !== p.set) return 0;
  const family = profile.families?.find((entry) => entry.familyId === p.family.id);
  if (family && family.games < (profile.minimumEvidenceGames ?? 5)) return 0;
  if (!family && profile.effectiveGames < 5) return 0;
  const relevance = profile.patch === p.patch ? 1 : 0.25;
  const affinity = family?.affinity ?? profile.familyAffinity[p.family.id] ?? 0;
  const maturity = family ? 1 : profile.effectiveGames / (profile.effectiveGames + 30);
  return clamp(weight, 0.05, 0.1) * 50 * clamp(affinity, -0.35, 0.35) * maturity * relevance;
}
export function confidenceFor(p: Playbook, context: ScoringContext): Confidence {
  const measured = context.meta?.familyStats.find((stat) => stat.familyId === p.family.id);
  const discovered = p.discovery
    ? context.discovery?.clusters.find((cluster) => cluster.id === p.discovery?.clusterId)
    : undefined;
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
    discovered
      ? {
          label: `${discovered.stats.games} clustered boards · ${Math.round(discovered.stats.confidence * 100)}% discovery confidence`,
          factor: discovered.stats.confidence,
        }
      : measured
        ? {
            label: `${measured.games} measured games · ${Math.round(measured.confidence * 100)}% meta confidence`,
            factor: measured.confidence,
          }
        : p.sampleSize
          ? { label: `${p.sampleSize} observed games`, factor: clamp(p.sampleSize / 200, 0.15, 1) }
          : { label: 'No compatible measured game sample', factor: 0.25 },
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
      label: discovered?.recommendationEligible
        ? 'Discovery evidence eligible'
        : measured?.quality === 'eligible'
          ? 'Measured strength eligible'
          : p.features.provenance.status === 'seeded'
            ? 'Seeded score metadata'
            : 'Derived / curated metadata',
      factor: discovered?.recommendationEligible
        ? 0.9
        : measured?.quality === 'eligible'
          ? 0.9
          : p.features.provenance.status === 'seeded'
            ? 0.25
            : 0.9,
    },
  ];
  const value = drivers.reduce((a, b) => a + b.factor, 0) / drivers.length;
  // Evidence class and seeded metadata are upper bounds; strong static data cannot promote a novel board.
  const bounded = Math.min(
    value,
    p.evidence === 'Experimental' &&
      measured?.quality !== 'eligible' &&
      !discovered?.recommendationEligible
      ? 0.39
      : 1,
  );
  return {
    level: bounded >= 0.75 ? 'High' : bounded >= 0.5 ? 'Medium' : 'Low',
    value: bounded,
    drivers,
  };
}
export function contestFor(p: Playbook, lobby?: LobbyPressure): CandidateContest {
  return candidateContestFor(p, lobby);
}
export function scoreCandidate(p: Playbook, context: ScoringContext): RecommendationCandidate {
  const measured = context.meta?.familyStats.find((stat) => stat.familyId === p.family.id);
  const discovered = p.discovery
    ? context.discovery?.clusters.find((cluster) => cluster.id === p.discovery?.clusterId)
    : undefined;
  const discoveryEligible = discovered?.recommendationEligible === true;
  const measuredEligible = measured?.quality === 'eligible' || discoveryEligible;
  const discoveredPlacementStrength = discovered
    ? clamp((8.5 - discovered.stats.averagePlacement) / 7.5)
    : 0;
  const measuredValues: Partial<Record<FeatureKey, number>> = discoveryEligible
    ? {
        meta:
          100 *
          clamp(
            0.5 * discoveredPlacementStrength +
              0.35 * discovered!.stats.topFour.shrunk +
              0.15 * discovered!.stats.wins.shrunk -
              0.2 * (1 - discovered!.stats.confidence),
          ),
        floor: 100 * discovered!.stats.topFour.shrunk,
        ceiling: 100 * clamp(discovered!.stats.wins.shrunk / 0.25),
      }
    : measured?.quality === 'eligible'
      ? {
          meta: measured.measuredStrength,
          floor: measured.measuredFloor,
          ceiling: measured.measuredCeiling,
        }
      : {};
  const components: ScoreComponent[] = (Object.keys(weights) as FeatureKey[]).map((key) => {
    const isOutcome = key === 'meta' || key === 'floor' || key === 'ceiling';
    const input = measuredValues[key] ?? (isOutcome ? null : clamp(p.features.values[key], 0, 100));
    return {
      key,
      label: labels[key],
      input,
      weight: weights[key],
      contribution: (input ?? 50) * weights[key],
      status:
        input === null
          ? 'unavailable'
          : measuredValues[key] !== undefined
            ? (discovered ? context.discovery?.sourceType : context.meta?.sourceType) === 'fixture'
              ? 'fixture'
              : 'measured'
            : p.features.provenance.status,
    };
  });
  const contest = contestFor(p, context.lobby);
  const lobbyValue = contest.lobbyFit;
  components.push({
    key: 'lobby',
    label: 'Lobby / contest fit',
    input: lobbyValue,
    weight: 0.1,
    contribution: (lobbyValue ?? 50) * 0.1,
    status: lobbyValue === null ? 'unavailable' : 'seeded',
  });
  const adjustment = personalAdjustment(p, context.personal, context.personalWeight);
  const personalFamily = context.personal?.families?.find(
    (entry) => entry.familyId === p.family.id,
  );
  components.push({
    key: 'personal',
    label: context.personal
      ? `Personal adjustment · ${adjustment > 0 ? 'positive' : adjustment < 0 ? 'negative' : 'neutral'} · ${personalFamily?.games ?? 0} games · ${Math.round((personalFamily?.confidence ?? 0) * 100)}% confidence`
      : 'Personal adjustment · unavailable',
    input: context.personal ? adjustment : null,
    weight: clamp(context.personalWeight ?? 0.05, 0.05, 0.1),
    contribution: adjustment,
    status: context.personal ? 'measured' : 'unavailable',
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
    .filter((c) => c.key !== 'personal' && c.key !== 'lobby' && c.weight > 0 && c.input !== null)
    .sort((a, b) => (b.input ?? 0) - (a.input ?? 0));
  return {
    playbook: p,
    score,
    components,
    confidence: confidenceFor(p, context),
    contest,
    reasons: measuredEligible
      ? [
          `${positives[0]?.label ?? 'Measured evidence'} is the strongest positive driver.`,
          discovered
            ? `${discovered.stats.games} clustered boards · ${Math.round(discovered.stats.confidence * 100)}% discovery confidence.`
            : `${measured!.games} classified games · ${Math.round(measured!.confidence * 100)}% aggregate-meta confidence.`,
        ]
      : [
          `${positives[0]?.label ?? 'Curated structure'} leads the available curated profile.`,
          measured
            ? `${measured.games} classified games do not clear the M5 quality gate.`
            : 'Measured outcome evidence is unavailable; neutral outcome fallback is explicit.',
        ],
  };
}
