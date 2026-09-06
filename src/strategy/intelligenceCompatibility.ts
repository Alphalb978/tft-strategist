import type { IntelligenceModel, ObservedProfile } from '../domain/intelligence';
import type { StaticData } from '../domain/models';
import { stableFingerprint } from '../domain/fingerprint';

/** Reuse only summaries whose entity dependencies are untouched by a same-set export delta. */
export function reconcileIntelligence(
  model: IntelligenceModel | undefined,
  data: StaticData,
): IntelligenceModel | undefined {
  const knowledge = data.knowledge;
  if (
    !model ||
    !knowledge ||
    model.version !== 'intelligence-v1' ||
    model.scope.set !== data.version.set ||
    (knowledge.balancePatch !== null && knowledge.balancePatch !== model.scope.patch)
  )
    return undefined;
  if (model.knowledgeFingerprint === knowledge.fingerprint) return model;
  if (!model.entityFingerprints) return undefined;
  const changed = new Set(
    [
      ...new Set([
        ...Object.keys(model.entityFingerprints),
        ...Object.keys(knowledge.entityFingerprints),
      ]),
    ].filter((id) => model.entityFingerprints![id] !== knowledge.entityFingerprints[id]),
  );
  const affected = (profile: ObservedProfile) => {
    const ids = new Set([
      ...profile.units.map((u) => u.id),
      ...profile.items.flatMap((i) => [...i.ids, ...i.components]),
      ...profile.augments.map((a) => a.id),
    ]);
    for (const c of data.champions) if (ids.has(c.id)) c.traitIds.forEach((id) => ids.add(id));
    return [...ids].some((id) => changed.has(id));
  };
  const profiles = Object.fromEntries(
    Object.entries(model.profiles).filter(([, p]) => !affected(p)),
  );
  const champions = Object.fromEntries(
    Object.entries(model.champions).filter(([, p]) => !affected(p)),
  );
  const graph = model.graph.filter(
    (e) => ![...e.ids, ...e.sharedTraits].some((id) => changed.has(id)),
  );
  return {
    ...model,
    verifiedChampions: model.verifiedChampions
      ? Object.fromEntries(Object.entries(model.verifiedChampions).filter(([, p]) => !affected(p)))
      : undefined,
    profiles,
    champions,
    graph,
    knowledgeFingerprint: knowledge.fingerprint,
    entityFingerprints: knowledge.entityFingerprints,
    fingerprint: stableFingerprint({
      previous: model.fingerprint,
      knowledge: knowledge.fingerprint,
      profiles: Object.keys(profiles),
    }),
  };
}
