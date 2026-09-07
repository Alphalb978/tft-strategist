import type { ExternalSnapshot } from '../domain/externalMeta';
import { matchExternal } from '../strategy/evidenceFusion';
import { externalStatus } from '../providers/externalMeta';
import { sparseGuidance } from '../strategy/guidanceInheritance';
import { teamPlanner } from '../rules/teamPlanner';
import type {
  CompRegistryEntry,
  DiscoveryCluster,
  DiscoveryDataset,
  Guidance,
  Playbook,
  StrategyGuidance,
  StaticData,
} from '../domain/models';
import { validatePlaybook } from '../rules/validation';
import { canonicalizeBoard } from '../strategy/canonicalBoard';
import { inheritDiscoveredGuidance } from '../strategy/guidanceInheritance';
import type { IntelligenceModel } from '../domain/intelligence';
import { friendlyCompName } from '../strategy/observedIntelligence';

const unavailable = <T>(note: string): Guidance<T> => ({
  value: null,
  status: 'unverified',
  note,
});

function discoveredPlaybook(
  cluster: DiscoveryCluster,
  data: StaticData,
  parentPlaybook?: Playbook,
): Playbook {
  const parent = cluster.relation.familyId;
  const title =
    cluster.relation.state === 'variant-candidate' && parent
      ? `Variant of ${parentPlaybook?.title ?? parent}`
      : friendlyCompName(
          cluster.unitPrevalence.filter((u) => u.prevalence >= 0.8).map((u) => u.championId),
          data,
        ).name;
  const provenance = {
    source: 'derived:aggregate-completed-boards',
    fetchedAt: cluster.transitions.at(-1)?.at ?? cluster.stats.freshestGameAt,
    patch: null,
    status: 'measured' as const,
    note: 'Neutral generated label and board structure derived from completed aggregate evidence.',
    hash: cluster.id,
  };
  const prevalence = new Map(
    cluster.unitPrevalence.map((unit) => [unit.championId, unit.prevalence]),
  );
  const core = cluster.unitPrevalence
    .filter((unit) => unit.prevalence >= 0.8)
    .map((unit) => unit.championId);
  const target = {
    id: `discovered-board-${cluster.id}`,
    set: data.version.set,
    targetLevel: cluster.representative.capacity,
    capacity: cluster.representative.capacity,
    units: cluster.representative.units.map((unit) => ({
      championId: unit.championId,
      items: [],
      stars: unit.stars ?? undefined,
      slot: core.includes(unit.championId) ? ('core' as const) : ('flex' as const),
    })),
    requiredUnits: core,
    augmentIds: [],
    traitClaims: [],
    provenance,
  };
  const hero = cluster.representative.units
    .slice()
    .sort(
      (a, b) =>
        (prevalence.get(b.championId) ?? 0) - (prevalence.get(a.championId) ?? 0) ||
        b.cost - a.cost ||
        a.championId.localeCompare(b.championId),
    )[0].championId;
  const playbook = {
    id: `discovered-${cluster.id}`,
    family: { id: `discovered-${cluster.id}`, name: title, core },
    set: data.version.set,
    patch: data.version.patch,
    title,
    subtitle:
      cluster.relation.state === 'variant-candidate'
        ? 'Repeated structural derivative; strategy details remain unverified.'
        : 'Recurring unknown board structure; neutral label pending curation.',
    hero,
    evidence:
      cluster.lifecycle === 'Variant' || cluster.lifecycle === 'Emerging'
        ? cluster.lifecycle
        : 'Experimental',
    provenance,
    sampleSize: cluster.stats.games,
    target,
    stages: [
      {
        stage: 'early',
        label: 'Early',
        board: unavailable('No evidence-backed opener is derived from final-board clustering.'),
        instruction: unavailable('Early-game guidance requires separate evidence.'),
        temporaryHolders: [],
      },
      {
        stage: 'mid',
        label: 'Mid',
        board: unavailable('No evidence-backed mid board is derived from final-board clustering.'),
        instruction: unavailable('Mid-game guidance requires separate evidence.'),
        temporaryHolders: [],
      },
      {
        stage: 'stabilization',
        label: 'Stabilize',
        board: unavailable('No stabilization board is inferred from aggregate final boards.'),
        instruction: unavailable('Roll and level timing are not inferred.'),
        temporaryHolders: [],
      },
      {
        stage: 'final',
        label: `Observed representative · ${target.capacity} capacity`,
        board: {
          value: target,
          status: 'measured',
          note: provenance.note,
          source: provenance.source,
        },
        instruction: unavailable('Final-board evidence does not establish a forcing line.'),
        temporaryHolders: [],
      },
    ],
    roles: [],
    items: [],
    components: [],
    augments: [],
    playSignals: unavailable('No play signals are inferred from final-board clusters.'),
    avoidSignals: unavailable('No avoid signals are inferred from final-board clusters.'),
    levelPlan: unavailable('Capacity is observed; the leveling plan is not established.'),
    decisionMap: { nodes: [], edges: [] },
    replacements: unavailable(
      'Prevalence is shown separately; replacement tradeoffs are unverified.',
    ),
    pivots: [],
    variants: [
      {
        id: `observed-${cluster.id}`,
        name: 'Observed representative',
        board: target,
        evidence:
          cluster.lifecycle === 'Variant' || cluster.lifecycle === 'Emerging'
            ? cluster.lifecycle
            : 'Experimental',
        provenance,
      },
    ],
    features: {
      values: {
        meta: 50,
        floor: 50,
        ceiling: 50,
        itemFlex: 50,
        augmentFlex: 50,
        transition: 50,
        tempo: 50,
        availability: 50,
        fragility: 50,
      },
      provenance: {
        ...provenance,
        status: 'unverified',
        note: 'Neutral product defaults; no item, transition, tempo, or fragility truth inferred.',
      },
      itemCoverage: [],
      openingCoverage: [],
      style: 'Unverified discovered structure',
      contestElasticity: 0.7,
      unitCriticality: Object.fromEntries(
        cluster.unitPrevalence.map((unit) => [unit.championId, unit.prevalence]),
      ),
    },
    planner: teamPlanner.supportStatus(data.version),
    strategy: undefined as unknown as StrategyGuidance,
    discovery: { clusterId: cluster.id, parentFamilyId: parent },
  } satisfies Playbook;
  playbook.strategy = inheritDiscoveredGuidance(playbook, cluster, data, parentPlaybook).guidance;
  return playbook;
}

export function buildCompRegistry(
  curated: Playbook[],
  data: StaticData,
  discovery?: DiscoveryDataset | null,
  intelligence?: IntelligenceModel,
  external?: ExternalSnapshot | null,
): CompRegistryEntry[] {
  const entries: CompRegistryEntry[] = curated.map((playbook) => {
    const canonical = canonicalizeBoard(playbook.target, data);
    const legal = validatePlaybook(playbook, data).every((issue) => issue.severity !== 'error');
    return {
      id: playbook.id,
      sourceKind: 'curated',
      lifecycle: legal ? playbook.evidence : 'Retired',
      playbook,
      structuralFingerprint: canonical.board?.fingerprint ?? 'invalid',
      clusterId: null,
      parentFamilyId: null,
      recommendationEligible: legal,
      support: null,
      effectiveSample: null,
      trendDelta: null,
      provenance: playbook.provenance,
    };
  });
  for (const cluster of discovery?.clusters ?? []) {
    if (cluster.relation.state === 'known-family') continue;
    const playbook = discoveredPlaybook(
      cluster,
      data,
      curated.find((entry) => entry.family.id === cluster.relation.familyId),
    );
    const legal = validatePlaybook(playbook, data).every((issue) => issue.severity !== 'error');
    entries.push({
      id: playbook.id,
      sourceKind: 'discovered',
      lifecycle: legal ? cluster.lifecycle : 'Retired',
      playbook,
      structuralFingerprint: cluster.representative.fingerprint,
      clusterId: cluster.id,
      parentFamilyId: cluster.relation.familyId,
      recommendationEligible:
        legal &&
        cluster.recommendationEligible &&
        !['Stale', 'Retired', 'Experimental'].includes(cluster.lifecycle),
      support: cluster.stats.games,
      effectiveSample: cluster.stats.effectiveSample,
      trendDelta: cluster.stats.adoption.mature ? cluster.stats.adoption.delta : null,
      provenance: playbook.provenance,
    });
  }
  for (const entry of entries) {
    const observed = intelligence?.profiles[entry.id];
    if (observed) entry.playbook.observed = observed;
    if (entry.sourceKind === 'discovered') {
      const naming = friendlyCompName(
        entry.playbook.family.core.length
          ? entry.playbook.family.core
          : entry.playbook.target.units.map((u) => u.championId),
        data,
        observed,
      );
      entry.playbook.naming = { version: naming.version, evidence: naming.evidence };
      if (!entry.parentFamilyId) {
        entry.playbook.title = naming.name;
        entry.playbook.family.name = naming.name;
      }
      entry.playbook.subtitle = 'Observed final-board structure; adaptation uses target gaps.';
    }
  }
  if (external && externalStatus(external, data).startsWith('Compatible')) {
    for (const comp of external.comps) {
      const matches = entries
        .filter((e) => e.sourceKind !== 'external')
        .map((entry) => ({
          entry,
          ...matchExternal(
            entry.playbook.target.units.map((u) => u.championId),
            entry.playbook.family.core,
            comp,
          ),
        }))
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
      for (const match of matches.filter((m) => m.relation === 'variant')) {
        if (!match.entry.externalId) {
          match.entry.externalId = comp.id;
          match.entry.externalRelation = 'variant';
        }
      }
      const exact = matches.filter((m) => m.relation === 'strong');
      if (exact.length) {
        for (const { entry } of exact) {
          entry.externalId = comp.id;
          entry.externalRelation = 'strong';
        }
        continue;
      }
      const template = curated[0];
      if (!template) continue;
      const id = `external-${data.version.set}-${comp.id}`;
      const provenance = {
        source: 'https://www.metatft.com/comps',
        fetchedAt: external.manifest.retrievedAt,
        patch: external.manifest.scope.patch,
        status: 'measured' as const,
        note: 'Public MetaTFT reference roster. Strategy timing and core roles are unknown unless separately sourced.',
        hash: external.manifest.contentHash,
      };
      const target = {
        ...template.target,
        id,
        units: comp.units.map((championId) => ({
          championId,
          items: [],
          slot: comp.core.includes(championId) ? ('core' as const) : ('flex' as const),
        })),
        requiredUnits: comp.core,
        capacity: comp.units.length,
        targetLevel: comp.units.length,
        augmentIds: [],
        traitClaims: [],
        provenance,
      };
      const plan: Playbook = {
        ...template,
        id,
        family: { id, name: comp.name, core: comp.core },
        title: comp.name,
        subtitle: 'External Reference · observed roster; partial guide',
        hero: comp.core[0] ?? comp.units[0],
        evidence: 'Experimental',
        provenance,
        sampleSize: undefined,
        target,
        stages: [],
        roles: [],
        items: [],
        components: [],
        augments: [],
        playSignals: unavailable('Play signals unavailable'),
        avoidSignals: unavailable('Avoid signals unavailable'),
        levelPlan: unavailable('Timing unavailable'),
        decisionMap: { nodes: [], edges: [] },
        replacements: unavailable('Replacements unavailable'),
        pivots: [],
        variants: [],
        observed: undefined,
        naming: undefined,
        discovery: undefined,
        features: {
          ...template.features,
          values: Object.fromEntries(
            Object.keys(template.features.values).map((k) => [k, 50]),
          ) as Playbook['features']['values'],
          provenance: { ...provenance, status: 'unverified' },
          style: comp.style ?? 'Style unavailable',
          itemCoverage: [],
          openingCoverage: [],
          unitCriticality: {},
        },
      };
      plan.strategy = sparseGuidance(plan, data);
      plan.strategy.sources = [
        {
          id: provenance.source,
          url: provenance.source,
          title: 'MetaTFT public comp reference',
          reviewedAt: provenance.fetchedAt,
          sourceVersion: provenance.hash,
          scope: 'Roster reference only',
          note: provenance.note,
        },
      ];
      // Reference structure is externally measured, never an internal discovery or a sourced timing guide.
      for (const stage of plan.strategy.stages) {
        stage.roster.sourceIds = [provenance.source];
        stage.roster.note = provenance.note;
        stage.targetLevel.sourceIds = [provenance.source];
      }
      const canonical = canonicalizeBoard(target, data);
      const legal =
        Boolean(canonical.board) &&
        validatePlaybook(plan, data).every((i) => i.severity !== 'error');
      if (!legal) continue;
      const parent = matches.find((m) => m.relation === 'variant');
      entries.push({
        id,
        sourceKind: 'external',
        externalId: comp.id,
        externalRelation: 'strong',
        lifecycle: 'Experimental',
        playbook: plan,
        structuralFingerprint: canonical.board!.fingerprint,
        clusterId: null,
        parentFamilyId: parent?.entry.playbook.family.id ?? null,
        recommendationEligible:
          (comp.stats.sample ?? 0) >= 500 &&
          Boolean(external.manifest.scope.rank && external.manifest.scope.window),
        support: null,
        effectiveSample: null,
        trendDelta: null,
        provenance,
      });
    }
  }
  return entries.sort(
    (a, b) =>
      Number(b.sourceKind === 'curated') - Number(a.sourceKind === 'curated') ||
      a.playbook.title.localeCompare(b.playbook.title) ||
      a.id.localeCompare(b.id),
  );
}
