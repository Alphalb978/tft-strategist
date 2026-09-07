import { hotfixParity } from '../providers/externalMeta';
import type {
  ExternalComp,
  ExternalScope,
  ExternalSnapshot,
  ExternalStats,
} from '../domain/externalMeta';
import type { Playbook, StaticData } from '../domain/models';
export const FUSION_VERSION = 'm12-fusion-v2';
export function matchExternal(units: string[], core: string[], comp: ExternalComp) {
  const union = new Set([...units, ...comp.units]);
  const overlap = units.filter((id) => comp.units.includes(id)).length / Math.max(1, union.size);
  const recall = core.length
    ? core.filter((id) => comp.units.includes(id)).length / core.length
    : overlap;
  const score = 0.7 * overlap + 0.3 * recall;
  const relation =
    overlap === 1
      ? 'strong'
      : overlap >= 0.65 && recall >= 0.8
        ? 'variant'
        : overlap >= 0.4
          ? 'weak'
          : 'unknown';
  return { relation, score };
}
export function relatedExternal(plan: Playbook, snapshot?: ExternalSnapshot | null) {
  return snapshot?.comps
    .map((comp) => ({
      comp,
      ...matchExternal(
        plan.target.units.map((u) => u.championId),
        plan.family.core,
        comp,
      ),
    }))
    .filter((r) => r.relation === 'strong' || r.relation === 'variant')
    .sort((a, b) => b.score - a.score || a.comp.id.localeCompare(b.comp.id))[0];
}
export interface FusedEstimate {
  average: number | null;
  top4: number | null;
  win: number | null;
  externalWeight: number;
  internalWeight: number;
  confidence: number;
  disagreement: boolean;
  sources: string[];
}
export function fuseEvidence(
  external: ExternalStats | undefined,
  scope: ExternalScope | undefined,
  retrievedAt: string | undefined,
  internal:
    | {
        average: number | null;
        top4: number | null;
        win: number | null;
        effectiveSample: number;
        patch: string | null;
      }
    | undefined,
  patch: string,
  now: string,
  relation = 1,
  internalHotfix?: string | null,
): FusedEstimate {
  const parity = hotfixParity(internalHotfix, scope?.hotfix);
  const compatible = scope?.patch === patch && scope?.queue === 1100 && parity !== 'incompatible';
  const age = retrievedAt
    ? Math.max(0, (Date.parse(now) - Date.parse(retrievedAt)) / 86400000)
    : Infinity;
  const knownScope = Boolean(scope?.rank && scope?.window);
  // Discount correlated public aggregate boards and overlapping populations; never sum them as independent games.
  const ew =
    compatible && external?.average !== null
      ? (external?.sample ?? 0) *
        0.25 *
        Math.exp(-age / 7) *
        (knownScope ? 1 : 0.1) *
        relation *
        (parity === 'unverified' ? 0.7 : 1)
      : 0;
  const iw = internal?.patch === patch && internal.average !== null ? internal.effectiveSample : 0;
  const estimate = (key: 'average' | 'top4' | 'win') => {
    const e = external?.[key],
      i = internal?.[key];
    const a = e != null ? ew : 0,
      b = i != null ? iw : 0;
    return a + b > 0 ? ((e ?? 0) * a + (i ?? 0) * b) / (a + b) : null;
  };
  const disagreement =
    ew >= 100 &&
    iw >= 100 &&
    Math.abs((external?.average ?? 4.5) - (internal?.average ?? 4.5)) >
      Math.max(0.4, 2 * Math.sqrt(5.25 / ew + 5.25 / iw));
  return {
    average: estimate('average'),
    top4: estimate('top4'),
    win: estimate('win'),
    externalWeight: ew,
    internalWeight: iw,
    confidence:
      Math.min(knownScope ? 0.9 : 0.45, (ew + iw) / (ew + iw + 150)) *
      (disagreement ? 0.7 : 1) *
      (ew > 0 && parity === 'unverified' ? 0.8 : 1),
    disagreement,
    sources: [
      parity === 'unverified'
        ? 'Hotfix parity unverified · external weight and confidence discounted'
        : parity === 'incompatible'
          ? 'Hotfix mismatch · external evidence excluded'
          : 'Verified matching hotfix',
      ew
        ? `MetaTFT · ${external?.sample} provider boards · ${ew.toFixed(0)} discounted weight · ${scope?.rank ?? 'unknown rank'} · ${scope?.window ?? 'unknown window'} · ${scope?.patch}${scope?.hotfix ?? ''}`
        : 'Compatible external outcome evidence unavailable',
      iw
        ? `Direct Riot · ${iw.toFixed(0)} effective boards`
        : 'Patch-verified direct outcomes unavailable',
      'Associations, not causal effects. Populations may overlap.',
    ],
  };
}
export function fusedForPlan(
  plan: Playbook,
  snapshot: ExternalSnapshot | null | undefined,
  data: StaticData,
  now: string,
) {
  const relation = relatedExternal(plan, snapshot);
  const p = plan.observed;
  return fuseEvidence(
    snapshot?.manifest.scope.set === data.version.set ? relation?.comp.stats : undefined,
    snapshot?.manifest.scope,
    snapshot?.manifest.retrievedAt,
    p?.estimate.eligible ? { ...p.estimate, patch: p.scope.patch } : undefined,
    data.knowledge?.balancePatch ?? data.version.patch,
    now,
    relation?.relation === 'strong' ? 1 : 0.5,
    data.knowledge?.balanceHotfix,
  );
}
export function externalTrend(older: ExternalSnapshot, newer: ExternalSnapshot, id: string) {
  if (
    JSON.stringify(older.manifest.scope) !== JSON.stringify(newer.manifest.scope) ||
    !newer.manifest.scope.rank ||
    !newer.manifest.scope.window ||
    Date.parse(older.manifest.retrievedAt) >= Date.parse(newer.manifest.retrievedAt)
  )
    return null;
  const a = older.comps.find((c) => c.id === id)?.stats,
    b = newer.comps.find((c) => c.id === id)?.stats;
  if (
    !a ||
    !b ||
    (a.sample ?? 0) < 500 ||
    (b.sample ?? 0) < 500 ||
    a.playRate === null ||
    b.playRate === null
  )
    return null;
  return {
    adoption: b.playRate - a.playRate,
    performance: a.average !== null && b.average !== null ? b.average - a.average : null,
  };
}
