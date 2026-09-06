import type { PersonalFamilyEvidence, PersonalProfile, PostGameReview } from '../domain/models';

export const PERSONAL_MODEL = {
  version: 'personal-residual-v1',
  schemaVersion: 1 as const,
  minimumGames: 5,
  shrinkagePriorGames: 20,
  confidencePriorGames: 25,
  recencyHalfLifeDays: 45,
  maximumAffinity: 0.35,
} as const;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function buildPersonalProfile(
  reviews: PostGameReview[],
  set: number,
  patch: string,
  now = new Date().toISOString(),
): PersonalProfile {
  const eligible = [
    ...new Map(
      reviews
        .filter(
          (review) =>
            review.set === set &&
            review.attribution.eligible &&
            review.baseline.placementResidual !== null,
        )
        .map((review) => [review.matchId, review]),
    ).values(),
  ];
  const byFamily = new Map<string, PostGameReview[]>();
  for (const review of eligible) {
    const familyId = review.attribution.familyId!;
    byFamily.set(familyId, [...(byFamily.get(familyId) ?? []), review]);
  }
  const families: PersonalFamilyEvidence[] = [...byFamily.entries()]
    .map(([familyId, familyReviews]) => {
      let weight = 0;
      let residual = 0;
      for (const review of familyReviews) {
        const ageDays = Math.max(0, Date.parse(now) - Date.parse(review.createdAt)) / 86_400_000;
        const recency = Math.pow(0.5, ageDays / PERSONAL_MODEL.recencyHalfLifeDays);
        const evidenceWeight = recency * review.attribution.confidence * review.baseline.confidence;
        weight += evidenceWeight;
        residual += clamp(review.baseline.placementResidual! / 3, -1, 1) * evidenceWeight;
      }
      const averageResidual = weight ? residual / weight : 0;
      const shrunkResidual =
        averageResidual * (weight / (weight + PERSONAL_MODEL.shrinkagePriorGames));
      const enough = familyReviews.length >= PERSONAL_MODEL.minimumGames;
      return {
        familyId,
        games: familyReviews.length,
        effectiveGames: weight,
        averageResidual,
        shrunkResidual: enough ? shrunkResidual : 0,
        affinity: enough
          ? clamp(shrunkResidual, -PERSONAL_MODEL.maximumAffinity, PERSONAL_MODEL.maximumAffinity)
          : 0,
        confidence: enough ? weight / (weight + PERSONAL_MODEL.confidencePriorGames) : 0,
        matchIds: familyReviews.map((review) => review.matchId),
      };
    })
    .sort((a, b) => b.confidence - a.confidence || a.familyId.localeCompare(b.familyId));
  const familyAffinity = Object.fromEntries(
    families.map((family) => [family.familyId, family.affinity]),
  );
  const effectiveGames = families.reduce((sum, family) => sum + family.effectiveGames, 0);
  const confidence = families.length ? Math.max(...families.map((family) => family.confidence)) : 0;
  const insights = families
    .filter(
      (family) =>
        family.games >= 10 && family.confidence >= 0.2 && Math.abs(family.affinity) >= 0.04,
    )
    .slice(0, 3)
    .map((family) => ({
      kind: family.affinity >= 0 ? ('strength' as const) : ('weakness' as const),
      text: `${family.affinity >= 0 ? 'Above' : 'Below'} baseline with ${family.familyId} in ${family.games} reconciled current-set games.`,
      confidence: {
        level:
          family.confidence >= 0.55
            ? ('High' as const)
            : family.confidence >= 0.3
              ? ('Medium' as const)
              : ('Low' as const),
        value: family.confidence,
        drivers: [{ label: `${family.games} attributed games`, factor: family.confidence }],
      },
      matchIds: family.matchIds,
    }));
  return {
    schemaVersion: 1,
    modelVersion: PERSONAL_MODEL.version,
    set,
    patch,
    effectiveGames,
    familyAffinity,
    generatedAt: now,
    sourceReviewIds: eligible.map((review) => review.id),
    confidence,
    minimumEvidenceGames: PERSONAL_MODEL.minimumGames,
    families,
    insights,
  };
}
