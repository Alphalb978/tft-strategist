import type {
  ActiveKnowledgeVersion,
  AugmentKnowledge,
  ChampionKnowledge,
  CompKnowledge,
  CompMetaObservation,
  ItemKnowledge,
  KnowledgeRepository,
  SourceSnapshot,
  TraitKnowledge,
} from '../storage/knowledgeRepository';
import type {
  Augment,
  AugmentBranch,
  Board,
  Champion,
  CompFamily,
  CompVariant,
  Guidance,
  ID,
  Item,
  ItemPlan,
  Pivot,
  Playbook,
  Provenance,
  StaticData,
  StrategyFeatures,
  StrategyGuidance,
  TeamPlannerSupport,
  Trait,
  Verification,
} from '../domain/models';
import type { ExternalComp, ExternalSnapshot, ExternalStats } from '../domain/externalMeta';
import {
  activeBreakpoint,
  baseCapacityForLevel,
  capacityForBoard,
  traitCount,
} from '../rules/ruleSet';
import { teamPlanner } from '../rules/teamPlanner';
import { loadStrategyGuidance } from '../providers/strategyGuidance';
import { externalStatus } from '../providers/externalMeta';

export interface RuntimeKnowledgeCatalog {
  version: {
    set: number;
    patch: string | null;
    hotfix: string | null;
    sourceVersion: string;
  };
  snapshots: {
    static: ActiveKnowledgeVersion | null;
    curated: ActiveKnowledgeVersion | null;
    external: ActiveKnowledgeVersion | null;
  };
  sourceSnapshots: {
    static: SourceSnapshot | null;
    curated: SourceSnapshot | null;
    external: SourceSnapshot | null;
  };
  provenance: {
    static: Provenance;
    curated: Provenance;
    external: Provenance | null;
  };
  champions: ChampionKnowledge[];
  traits: TraitKnowledge[];
  items: ItemKnowledge[];
  augments: AugmentKnowledge[];
  comps: CompKnowledge[];
  playbooks: Playbook[];
  metaObservations: CompMetaObservation[];
  externalSnapshot: ExternalSnapshot | null;
}

const unavailable = <T>(note: string): Guidance<T> => ({ value: null, status: 'unverified', note });

export function computeTraitClaims(board: Board, data: StaticData): Board['traitClaims'] {
  return data.traits.flatMap((trait) => {
    if (trait.availability !== 'verified') return [];
    const breakpoint = activeBreakpoint(trait.breakpoints, traitCount(board, data, trait.id));
    return breakpoint === null ? [] : [{ traitId: trait.id, breakpoint }];
  });
}

/**
 * Materializes a rich canonical Playbook domain model from DB-backed CompKnowledge.
 */
export function materializePlaybook(
  comp: CompKnowledge,
  staticData: StaticData,
  snapshot: ActiveKnowledgeVersion | SourceSnapshot,
): Playbook {
  const setNumber = snapshot.setNumber ?? 18;
  const patch = snapshot.balancePatch ?? staticData.version.patch;

  const payload = comp.payload ?? {};

  const finalUnits = comp.units.filter((u) => u.stage === 'final');
  const coreUnits = finalUnits.filter((u) => u.slot === 'core').map((u) => u.championId);

  const hero =
    comp.heroId ??
    finalUnits.find((u) => u.role === 'carry')?.championId ??
    finalUnits[0]?.championId ??
    '';

  const provenance: Provenance = (payload.provenance as Provenance) ?? {
    source: ('sourceUri' in snapshot ? snapshot.sourceUri : null) ?? 'curated-file',
    fetchedAt:
      ('retrievedAt' in snapshot ? snapshot.retrievedAt : null) ??
      ('activatedAt' in snapshot ? snapshot.activatedAt : null) ??
      new Date().toISOString(),
    patch,
    status: 'curated',
    note: `${comp.title}. Curated strategy playbook from versioned knowledge DB.`,
    hash: comp.contentFingerprint,
  };

  const targetLevel = comp.targetLevel ?? finalUnits.length;
  const targetBoard: Board = {
    id: `${comp.id}-final`,
    set: setNumber,
    targetLevel,
    capacity: baseCapacityForLevel(targetLevel) ?? targetLevel,
    units: finalUnits.map((u) => ({
      championId: u.championId,
      items: [],
      slot: u.slot,
    })),
    requiredUnits: coreUnits,
    augmentIds: [],
    traitClaims: [],
    provenance,
  };
  targetBoard.capacity = capacityForBoard(targetBoard, staticData) ?? targetBoard.capacity;
  targetBoard.traitClaims = computeTraitClaims(targetBoard, staticData);

  // Group item packages by holder
  const packagesByHolder = new Map<string, string[]>();
  for (const pkg of comp.itemPackages) {
    const list = packagesByHolder.get(pkg.holderId) ?? [];
    list.push(pkg.itemId);
    packagesByHolder.set(pkg.holderId, list);
  }

  const items: ItemPlan[] = Array.from(packagesByHolder.entries()).map(([holder, priorities]) => ({
    holder,
    priorities,
    alternatives: unavailable<ID[]>('Item alternatives not verified.'),
    provenance,
  }));

  const compRoles: Array<{ championId: ID; role: 'carry' | 'tank' | 'support' }> = finalUnits
    .filter((u) => u.role !== null)
    .map((u) => ({ championId: u.championId, role: u.role! }));

  if (Array.isArray(payload.roles)) {
    for (const r of payload.roles as Array<{
      championId: ID;
      role: 'carry' | 'tank' | 'support';
    }>) {
      if (r.role === 'support' && !compRoles.some((cr) => cr.championId === r.championId)) {
        compRoles.push(r);
      }
    }
  }

  const family: CompFamily = (payload.family as CompFamily) ?? {
    id: comp.id,
    name: comp.title,
    core: coreUnits,
  };

  const curated = <T>(value: T): Guidance<T> => ({
    value,
    status: 'curated',
    source: provenance.source,
    note: 'Public guide, re-audited September 6. Outcome evidence not collected.',
  });

  const playbook: Playbook = {
    id: comp.id,
    set: setNumber,
    patch,
    family,
    title: comp.title,
    subtitle: comp.subtitle ?? '',
    hero,
    evidence: comp.evidenceLabel,
    provenance,
    sampleSize: typeof payload.sampleSize === 'number' ? payload.sampleSize : undefined,
    target: targetBoard,
    stages: Array.isArray(payload.stages) ? (payload.stages as Playbook['stages']) : [],
    roles: compRoles,
    items,
    components: Array.isArray(payload.components) ? (payload.components as string[]) : [],
    augments: Array.isArray(payload.augments) ? (payload.augments as AugmentBranch[]) : [],
    playSignals: comp.playSignals
      ? curated(comp.playSignals)
      : unavailable('No verified play signals.'),
    avoidSignals: comp.avoidSignals
      ? unavailable(comp.avoidSignals.join('; '))
      : unavailable(
          'No verified avoid thresholds; do not treat this example as a force recommendation.',
        ),
    levelPlan: comp.levelPlan ? curated(comp.levelPlan) : unavailable('No level timing verified.'),
    decisionMap: (payload.decisionMap as Playbook['decisionMap']) ?? { nodes: [], edges: [] },
    replacements:
      (payload.replacements as Playbook['replacements']) ??
      unavailable('Specific substitutes and their trait tradeoffs need evidence.'),
    pivots: Array.isArray(payload.pivots) ? (payload.pivots as Pivot[]) : [],
    variants: Array.isArray(payload.variants)
      ? (payload.variants as CompVariant[])
      : [
          {
            id: `${comp.id}-standard`,
            name: 'Source board',
            board: targetBoard,
            evidence: comp.evidenceLabel,
            provenance,
          },
        ],
    features: (payload.features as StrategyFeatures) ?? {
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
        source: 'db:default',
        fetchedAt: provenance.fetchedAt,
        patch,
        status: 'seeded',
        note: 'Default feature values',
      },
      itemCoverage: [],
      openingCoverage: [],
      style: comp.style ?? 'Standard',
      contestElasticity: 0.7,
      unitCriticality: Object.fromEntries(
        targetBoard.units.map((u) => [u.championId, coreUnits.includes(u.championId) ? 1 : 0.25]),
      ),
    },
    planner:
      (payload.planner as TeamPlannerSupport) ?? teamPlanner.supportStatus(staticData.version),
    strategy: undefined as unknown as StrategyGuidance,
  };

  if (payload.strategy) {
    playbook.strategy = payload.strategy as StrategyGuidance;
  } else {
    playbook.strategy = loadStrategyGuidance(playbook, staticData);
  }

  return playbook;
}

/**
 * Reconstructs StaticData domain model from DB-backed entity knowledge.
 */
export function materializeStaticData(
  champions: ChampionKnowledge[],
  traits: TraitKnowledge[],
  items: ItemKnowledge[],
  augments: AugmentKnowledge[],
  snapshot: ActiveKnowledgeVersion | SourceSnapshot,
  sourceSnapshot?: SourceSnapshot | null,
): StaticData {
  const setNumber = snapshot.setNumber ?? 18;
  const patch = snapshot.balancePatch ?? '18.1';
  const hotfix = snapshot.hotfix ?? null;
  const sourceVersion = snapshot.sourceVersion ?? `${setNumber}.${patch}`;

  const provenance: Provenance = {
    source: sourceSnapshot?.sourceUri ?? 'https://raw.communitydragon.org',
    fetchedAt:
      sourceSnapshot?.retrievedAt ??
      ('activatedAt' in snapshot ? snapshot.activatedAt : new Date().toISOString()),
    publishedAt: sourceSnapshot?.publishedAt ?? undefined,
    patch,
    status: (sourceSnapshot?.provenanceStatus as Verification) ?? 'verified',
    note: sourceSnapshot?.notes ?? 'Versioned SQLite knowledge static snapshot',
    hash: snapshot.contentHash,
  };

  let payloadData: { warnings?: string[]; name?: string } = {};
  if (sourceSnapshot?.rawReference) {
    try {
      payloadData = JSON.parse(sourceSnapshot.rawReference);
    } catch {
      /* ignore malformed rawReference */
    }
  }

  const mappedChampions: Champion[] = champions.map((c) => ({
    id: c.id,
    name: c.name,
    cost: c.cost,
    traitIds: c.traitIds,
    icon: c.icon,
    splash: c.splash,
    set: setNumber,
    role: c.role ?? undefined,
    shopStatus: c.shopStatus,
    boardEligible: c.boardEligible,
    provenance,
  }));

  const mappedTraits: Trait[] = traits.map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    breakpoints: t.breakpoints.map((b) => b.minUnits),
    counting: t.counting,
    availability: t.availability,
    provenance,
  }));

  const mappedItems: Item[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    icon: i.icon,
    components: i.components,
    category: i.category,
    set: setNumber,
    availability: i.availability,
    provenance,
  }));

  const mappedAugments: Augment[] = augments.map((a) => ({
    id: a.id,
    name: a.name,
    icon: null,
    set: setNumber,
    tier: a.tier ?? undefined,
    category: a.category ?? undefined,
    availability: a.availability,
    presentInExport: a.presentInExport,
    liveStatus: a.liveStatus,
    requiredTraits: a.requiredTraits,
    provenance,
  }));

  const knowledgeEntities: Record<string, NonNullable<ChampionKnowledge['mechanics']>> = {};
  const knowledgeFingerprints: Record<string, string> = {};

  for (const c of champions) {
    if (c.mechanics) knowledgeEntities[c.id] = c.mechanics;
    knowledgeFingerprints[c.id] = c.contentFingerprint;
  }
  for (const t of traits) {
    if (t.mechanics) knowledgeEntities[t.id] = t.mechanics;
    knowledgeFingerprints[t.id] = t.contentFingerprint;
  }
  for (const i of items) {
    if (i.mechanics) knowledgeEntities[i.id] = i.mechanics;
    knowledgeFingerprints[i.id] = i.contentFingerprint;
  }
  for (const a of augments) {
    if (a.mechanics) knowledgeEntities[a.id] = a.mechanics;
    knowledgeFingerprints[a.id] = a.contentFingerprint;
  }

  const parity: 'current' | 'known-stale' | 'unverified' =
    sourceSnapshot?.parityStatus === 'current' ||
    sourceSnapshot?.parityStatus === 'known-stale' ||
    sourceSnapshot?.parityStatus === 'unverified'
      ? sourceSnapshot.parityStatus
      : 'current';

  return {
    version: {
      set: setNumber,
      name: payloadData.name ?? `Set ${setNumber}`,
      patch,
      sourceVersion,
      schemaVersion: 2,
      patchVerified: true,
      parityStatus: parity,
      provenance,
    },
    champions: mappedChampions,
    traits: mappedTraits,
    items: mappedItems,
    augments: mappedAugments,
    warnings: payloadData.warnings ?? [],
    knowledge: {
      version: 'knowledge-v1',
      semanticVersion: 'semantic-v1',
      set: setNumber,
      identity: `set${setNumber}-knowledge`,
      balancePatch: patch,
      balanceHotfix: hotfix ?? undefined,
      fingerprint: snapshot.contentHash,
      fetchedAt: provenance.fetchedAt,
      source: provenance.source,
      parity,
      officialEvidence: [],
      entities: knowledgeEntities,
      entityFingerprints: knowledgeFingerprints,
      coverage: [],
    },
  };
}

/**
 * Projects an ExternalSnapshot from DB-stored meta snapshots and observations.
 */
export function projectExternalSnapshot(
  activeMeta: ActiveKnowledgeVersion,
  metaSnapshot: SourceSnapshot | null,
  observations: CompMetaObservation[],
  comps: CompKnowledge[],
  staticData: StaticData,
): ExternalSnapshot | null {
  if (!observations.length) return null;

  const compsMap = new Map<string, CompKnowledge>();
  for (const c of comps) {
    compsMap.set(c.id, c);
  }

  const externalComps: ExternalComp[] = [];

  for (const obs of observations) {
    const compKnowledge = compsMap.get(obs.compId);
    const finalUnits = compKnowledge?.units.filter((u) => u.stage === 'final') ?? [];
    const core = finalUnits.filter((u) => u.slot === 'core').map((u) => u.championId);
    const units = finalUnits.map((u) => u.championId);

    const raw = obs.rawStats as Partial<ExternalStats> | undefined;
    const stats: ExternalStats = {
      average: obs.averagePlacement ?? raw?.average ?? 4.5,
      top4: obs.top4Rate ?? raw?.top4 ?? 0.5,
      win: obs.winRate ?? raw?.win ?? 0.125,
      playRate: obs.pickRate ?? raw?.playRate ?? 0.05,
      sample: obs.sampleSize ?? raw?.sample ?? 1000,
    };

    const payload = (compKnowledge?.payload ?? {}) as Record<string, unknown>;

    const externalComp: ExternalComp = {
      id: obs.providerCompId,
      name: compKnowledge?.title ?? obs.providerCompId,
      tier: (payload.tier as string) ?? null,
      style: compKnowledge?.style ?? 'Standard',
      units: units.length ? units : obs.positions.map((p) => p.championId),
      core,
      stats,
      positions: obs.positions.length
        ? obs.positions
        : Array.isArray(payload.positions)
          ? (payload.positions as ExternalComp['positions'])
          : [],
      packages: obs.itemPackages.length
        ? obs.itemPackages
        : Array.isArray(payload.packages)
          ? (payload.packages as ExternalComp['packages'])
          : [],
      conditions: Array.isArray(payload.conditions)
        ? (payload.conditions as NonNullable<ExternalComp['conditions']>)
        : [],
    };
    if (obs.pickRate != null) {
      externalComp.pickRate = {
        value: obs.pickRate * 100,
        unit: 'percent',
        source: 'public-page',
      };
    }
    externalComps.push(externalComp);
  }

  let pop = 0;
  for (const c of externalComps) {
    if (c.stats.sample) pop += c.stats.sample;
  }

  const manifest: ExternalSnapshot['manifest'] = {
    scope: {
      set: activeMeta.setNumber,
      patch: activeMeta.balancePatch,
      hotfix: activeMeta.hotfix,
      rank: 'Diamond+',
      region: 'global',
      window: 'last-7-days',
      queue: 1100,
    },
    retrievedAt: metaSnapshot?.retrievedAt ?? activeMeta.activatedAt,
    providerUpdated: metaSnapshot?.publishedAt ?? null,
    collectorVersion: activeMeta.sourceVersion,
    normalizerVersion: activeMeta.sourceVersion,
    schemaVersion: 1,
    contentHash: activeMeta.contentHash,
    population: pop || null,
    warnings: [],
    provider: 'MetaTFT',
    sourceUrls: [metaSnapshot?.sourceUri ?? 'https://www.metatft.com/comps'],
  };

  const defaultStats: ExternalStats = {
    sample: pop || 1000,
    top4: 0.5,
    win: 0.125,
    playRate: 0.1,
    average: 4.5,
  };

  return {
    manifest,
    comps: externalComps,
    units: staticData.champions.map((c) => ({
      id: c.id,
      name: c.name,
      stats: defaultStats,
      tier: null,
    })),
    items: staticData.items.map((i) => ({
      id: i.id,
      name: i.name,
      stats: defaultStats,
      tier: null,
    })),
    traits: staticData.traits.map((t) => ({
      id: t.id,
      name: t.name,
      stats: defaultStats,
      tier: null,
    })),
    augments: staticData.augments.map((a) => ({
      id: a.id,
      name: a.name,
      tier: null,
      sourceType: 'external-reference',
    })),
  };
}

/**
 * Loads the canonical RuntimeKnowledgeCatalog from the versioned KnowledgeRepository.
 * Bulk queries all entities to avoid N+1 queries during UI rendering.
 */
export async function loadRuntimeKnowledgeCatalog(
  repo: KnowledgeRepository,
  options?: {
    staticSnapshotId?: string;
    curatedSnapshotId?: string;
    externalSnapshotId?: string;
    existingStaticData?: StaticData;
    existingExternalSnapshot?: ExternalSnapshot | null;
  },
): Promise<RuntimeKnowledgeCatalog | null> {
  const [activeStatic, activeCurated, activeExternal] = await Promise.all([
    repo.getActiveKnowledgeVersion('static'),
    repo.getActiveKnowledgeVersion('curated'),
    repo.getActiveKnowledgeVersion('external-meta'),
  ]);

  const staticSnapId = options?.staticSnapshotId ?? activeStatic?.snapshotId;
  const curatedSnapId = options?.curatedSnapshotId ?? activeCurated?.snapshotId;
  const externalSnapId = options?.externalSnapshotId ?? activeExternal?.snapshotId;

  if (!staticSnapId || !curatedSnapId) {
    return null;
  }

  const [
    staticSourceSnap,
    curatedSourceSnap,
    externalSourceSnap,
    champions,
    traits,
    items,
    augments,
    curatedComps,
    metaObservations,
  ] = await Promise.all([
    repo.getSourceSnapshot(staticSnapId),
    repo.getSourceSnapshot(curatedSnapId),
    externalSnapId ? repo.getSourceSnapshot(externalSnapId) : Promise.resolve(null),
    repo.listChampions({ snapshotId: staticSnapId }),
    repo.listTraits({ snapshotId: staticSnapId }),
    repo.listItems({ snapshotId: staticSnapId }),
    repo.listAugments({ snapshotId: staticSnapId }),
    repo.listComps({ snapshotId: curatedSnapId }),
    externalSnapId
      ? repo.listMetaObservations({ snapshotId: externalSnapId })
      : Promise.resolve([]),
  ]);

  const effectiveStaticVersion =
    activeStatic ??
    (staticSourceSnap
      ? {
          kind: 'static' as const,
          snapshotId: staticSourceSnap.snapshotId,
          setNumber: staticSourceSnap.setNumber,
          balancePatch: staticSourceSnap.balancePatch,
          hotfix: staticSourceSnap.hotfix,
          sourceVersion: staticSourceSnap.sourceVersion,
          contentHash: staticSourceSnap.contentHash,
          activatedAt: staticSourceSnap.createdAt,
        }
      : null);

  const effectiveCuratedVersion =
    activeCurated ??
    (curatedSourceSnap
      ? {
          kind: 'curated' as const,
          snapshotId: curatedSourceSnap.snapshotId,
          setNumber: curatedSourceSnap.setNumber,
          balancePatch: curatedSourceSnap.balancePatch,
          hotfix: curatedSourceSnap.hotfix,
          sourceVersion: curatedSourceSnap.sourceVersion,
          contentHash: curatedSourceSnap.contentHash,
          activatedAt: curatedSourceSnap.createdAt,
        }
      : null);

  const effectiveExternalVersion =
    activeExternal ??
    (externalSourceSnap
      ? {
          kind: 'external-meta' as const,
          snapshotId: externalSourceSnap.snapshotId,
          setNumber: externalSourceSnap.setNumber,
          balancePatch: externalSourceSnap.balancePatch,
          hotfix: externalSourceSnap.hotfix,
          sourceVersion: externalSourceSnap.sourceVersion,
          contentHash: externalSourceSnap.contentHash,
          activatedAt: externalSourceSnap.createdAt,
        }
      : null);

  if (!effectiveStaticVersion || !effectiveCuratedVersion) {
    return null;
  }

  const staticData =
    options?.existingStaticData ??
    materializeStaticData(
      champions,
      traits,
      items,
      augments,
      effectiveStaticVersion,
      staticSourceSnap,
    );

  const playbooks = curatedComps.map((comp) =>
    materializePlaybook(comp, staticData, effectiveCuratedVersion),
  );

  let externalSnapshot: ExternalSnapshot | null = options?.existingExternalSnapshot ?? null;
  if (!externalSnapshot && effectiveExternalVersion && metaObservations.length > 0) {
    const externalComps = await repo.listComps({
      snapshotId: effectiveExternalVersion.snapshotId,
      sourceKind: 'external-meta',
    });
    externalSnapshot = projectExternalSnapshot(
      effectiveExternalVersion,
      externalSourceSnap,
      metaObservations,
      externalComps,
      staticData,
    );
  }

  // Check snapshot compatibility
  if (externalSnapshot) {
    const status = externalStatus(externalSnapshot, staticData);
    if (status.includes('incompatible')) {
      externalSnapshot = null;
    }
  }

  if (
    effectiveExternalVersion &&
    effectiveExternalVersion.setNumber !== effectiveStaticVersion.setNumber
  ) {
    externalSnapshot = null;
  }

  if (
    effectiveExternalVersion &&
    (!effectiveExternalVersion.balancePatch ||
      (effectiveStaticVersion.balancePatch &&
        effectiveExternalVersion.balancePatch !== effectiveStaticVersion.balancePatch))
  ) {
    externalSnapshot = null;
  }

  const staticProvenance: Provenance = {
    source: staticSourceSnap?.sourceUri ?? 'static-cdn',
    fetchedAt: staticSourceSnap?.retrievedAt ?? effectiveStaticVersion.activatedAt,
    publishedAt: staticSourceSnap?.publishedAt ?? undefined,
    patch: effectiveStaticVersion.balancePatch,
    status: (staticSourceSnap?.provenanceStatus as Verification) ?? 'verified',
    note: staticSourceSnap?.notes ?? 'CommunityDragon static snapshot',
    hash: effectiveStaticVersion.contentHash,
  };

  const curatedProvenance: Provenance = {
    source: curatedSourceSnap?.sourceUri ?? 'curated-file',
    fetchedAt: curatedSourceSnap?.retrievedAt ?? effectiveCuratedVersion.activatedAt,
    publishedAt: curatedSourceSnap?.publishedAt ?? undefined,
    patch: effectiveCuratedVersion.balancePatch,
    status: 'curated',
    note: curatedSourceSnap?.notes ?? 'Curated playbooks snapshot',
    hash: effectiveCuratedVersion.contentHash,
  };

  const externalProvenance: Provenance | null =
    externalSnapshot && effectiveExternalVersion
      ? {
          source: externalSourceSnap?.sourceUri ?? 'external-scrape',
          fetchedAt: externalSourceSnap?.retrievedAt ?? effectiveExternalVersion.activatedAt,
          publishedAt: externalSourceSnap?.publishedAt ?? undefined,
          patch: effectiveExternalVersion.balancePatch,
          status: 'measured',
          note: externalSourceSnap?.notes ?? 'External meta snapshot',
          hash: effectiveExternalVersion.contentHash,
        }
      : null;

  return {
    version: {
      set: effectiveStaticVersion.setNumber,
      patch: effectiveStaticVersion.balancePatch,
      hotfix: effectiveStaticVersion.hotfix,
      sourceVersion: effectiveStaticVersion.sourceVersion,
    },
    snapshots: {
      static: effectiveStaticVersion,
      curated: effectiveCuratedVersion,
      external: externalSnapshot ? effectiveExternalVersion : null,
    },
    sourceSnapshots: {
      static: staticSourceSnap,
      curated: curatedSourceSnap,
      external: externalSnapshot ? externalSourceSnap : null,
    },
    provenance: {
      static: staticProvenance,
      curated: curatedProvenance,
      external: externalProvenance,
    },
    champions,
    traits,
    items,
    augments,
    comps: curatedComps,
    playbooks,
    metaObservations: externalSnapshot ? metaObservations : [],
    externalSnapshot,
  };
}
