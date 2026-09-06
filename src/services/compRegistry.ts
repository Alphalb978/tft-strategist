import type {
  CompRegistryEntry,
  DiscoveryCluster,
  DiscoveryDataset,
  Guidance,
  Playbook,
  StaticData,
} from '../domain/models';
import { validatePlaybook } from '../rules/validation';
import { canonicalizeBoard } from '../strategy/canonicalBoard';

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
      : `Emerging cluster ${cluster.id.replace('cluster-', '')}`;
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
  return {
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
    planner: {
      state: 'unsupported',
      reason: 'Discovered boards do not bypass Team Planner verification.',
      mappingVerified: false,
      fixtureVerified: false,
      manualPasteVerified: false,
    },
    discovery: { clusterId: cluster.id, parentFamilyId: parent },
  };
}

export function buildCompRegistry(
  curated: Playbook[],
  data: StaticData,
  discovery?: DiscoveryDataset | null,
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
      recommendationEligible: legal && cluster.recommendationEligible,
      support: cluster.stats.games,
      effectiveSample: cluster.stats.effectiveSample,
      trendDelta: cluster.stats.adoption.mature ? cluster.stats.adoption.delta : null,
      provenance: playbook.provenance,
    });
  }
  return entries.sort(
    (a, b) =>
      Number(b.sourceKind === 'curated') - Number(a.sourceKind === 'curated') ||
      a.playbook.title.localeCompare(b.playbook.title) ||
      a.id.localeCompare(b.id),
  );
}
