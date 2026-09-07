import type { CurrentGameState, IntelligenceModel, ObservedProfile } from '../domain/intelligence';
import type { Playbook, StaticData } from '../domain/models';
import type { ExternalSnapshot } from '../domain/externalMeta';
import { externalStatus } from '../providers/externalMeta';
import { reconcileIntelligence } from './intelligenceCompatibility';

type Package = { holder: string; ids: string[] };
type Index = Map<string, Package[]>;
const cache = new WeakMap<
  StaticData,
  {
    model?: IntelligenceModel;
    plans: Playbook[];
    index: Index;
    guidance: Index;
    profiles: Record<string, ObservedProfile>;
  }
>();
const noPlans: Playbook[] = [];
function sourced(plan: Playbook): Package[] {
  return plan.strategy.itemHolders
    .filter((h) => h.fact.value && ['sourced', 'inherited'].includes(h.fact.status))
    .flatMap((h) =>
      h.groups
        .filter((g) => g.fact.value && ['sourced', 'inherited'].includes(g.fact.status))
        .map((g) => ({ holder: h.holderId, ids: g.itemIds })),
    );
}
/** Summaries are already deduplicated/shrunk at refresh. Index once per immutable evidence/catalog generation. */
export function globalEntityIndex(data: StaticData, model?: IntelligenceModel, plans = noPlans) {
  const previous = cache.get(data);
  if (previous && previous.model === model && previous.plans === plans) return previous;
  const compatible =
    model?.scope.patch === (data.knowledge?.balancePatch ?? data.version.patch) &&
    Date.now() - Date.parse(model.generatedAt) <= 21 * 86400000
      ? reconcileIntelligence(model, data)
      : undefined;
  const profiles: Record<string, ObservedProfile> = {};
  const index: Index = new Map();
  const add = (p: Package, target = index) => {
    for (const id of [p.holder, ...p.ids]) {
      const rows = target.get(id) ?? [];
      if (!rows.some((r) => r.holder === p.holder && r.ids.join('|') === p.ids.join('|')))
        rows.push(p);
      target.set(id, rows);
    }
  };
  for (const id of Object.keys(compatible?.champions ?? {})) {
    const verified = compatible?.verifiedChampions?.[id];
    const profile = verified?.estimate.eligible ? verified : compatible?.champions[id];
    if (
      !profile ||
      profile.scope.set !== data.version.set ||
      profile.scope.patch !== (data.knowledge?.balancePatch ?? data.version.patch)
    )
      continue;
    profiles[id] = profile;
    profile.items.filter((p) => p.holder === id && p.estimate.eligible).forEach((p) => add(p));
  }
  const guidance: Index = new Map();
  plans
    .filter(
      (p) =>
        p.set === data.version.set &&
        p.provenance.patch === (data.knowledge?.balancePatch ?? data.version.patch),
    )
    .forEach((p) => sourced(p).forEach((row) => add(row, guidance)));
  const result = { model, plans, index, guidance, profiles };
  cache.set(data, result);
  return result;
}
export function resolveEntityIntelligence(input: {
  id: string;
  data: StaticData;
  plan?: Playbook;
  plans?: Playbook[];
  intelligence?: IntelligenceModel;
  external?: ExternalSnapshot | null;
  game?: CurrentGameState;
}) {
  const { id, data, plan, intelligence, external, game } = input;
  const champion = data.champions.find((c) => c.id === id);
  const item = data.items.find((i) => i.id === id);
  const matches = (p: Package) =>
    champion ? p.holder === id : Boolean(item && p.ids.includes(id));
  const global = globalEntityIndex(data, intelligence, input.plans);
  const observed = plan?.observed;
  const comp =
    observed?.scope.set === data.version.set &&
    observed.scope.patch === (data.knowledge?.balancePatch ?? data.version.patch)
      ? observed.items.filter((p) => p.estimate.eligible && matches(p))
      : [];
  const compSourced = plan ? sourced(plan).filter(matches) : [];
  const common = global.index.get(id) ?? [];
  const guidance = global.guidance.get(id) ?? [];
  const packages = comp.length
    ? comp
    : compSourced.length
      ? compSourced
      : common.length
        ? common
        : guidance;
  const source = comp.length
    ? 'Comp evidence'
    : compSourced.length
      ? 'Comp sourced guidance'
      : common.length
        ? 'Global evidence'
        : guidance.length
          ? 'Global sourced guidance'
          : 'Unavailable';
  const rows = externalStatus(external, data).startsWith('Compatible')
    ? champion
      ? external?.units
      : item
        ? external?.items
        : external?.traits
    : [];
  return {
    champion,
    item,
    mechanics: data.knowledge?.entities[id],
    profile: global.profiles[id],
    packages: packages.slice(0, 3),
    source,
    aggregate: rows?.find((e) => e.id === id),
    ownedCopies: game?.copies[id] ?? 0,
    onBoard: game?.board.includes(id) ?? false,
  };
}
