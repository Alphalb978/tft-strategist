import type {
  DiscoveryCluster,
  Playbook,
  StrategyCoverageKey,
  StrategyFact,
  StrategyFactStatus,
  StrategyGuidance,
  StaticData,
} from '../domain/models';
import { staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import {
  STRATEGY_GUIDANCE_VERSION,
  STRATEGY_SCHEMA_VERSION,
  strategyRegistryFingerprint,
  strategyTargetFingerprint,
  unavailableFact,
} from '../providers/strategyGuidance';

const derivedFact = <T>(value: T, note: string): StrategyFact<T> => ({
  value,
  status: 'derived',
  sourceIds: ['derived:aggregate-completed-boards'],
  note,
});

const inheritedFact = <T>(fact: StrategyFact<T>, parentFamilyId: string): StrategyFact<T> => ({
  value: fact.value,
  status: 'inherited',
  sourceIds: fact.sourceIds,
  note: `${fact.note} Inherited from ${parentFamilyId} under strategy-inheritance-v1.`,
  inheritedFrom: parentFamilyId,
});

export function sparseGuidance(playbook: Playbook, data: StaticData): StrategyGuidance {
  const targetFingerprint = strategyTargetFingerprint(
    playbook.set,
    playbook.target.capacity,
    playbook.target.units.map((unit) => unit.championId),
  );
  const coverageFields: Record<StrategyCoverageKey, StrategyFactStatus> = {
    stageBoards: 'unavailable',
    rollLevel: 'unavailable',
    items: 'unavailable',
    augments: 'unavailable',
    replacements: 'unavailable',
    positioning: 'unavailable',
    warningsPivots: 'unavailable',
  };
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    guidanceVersion: `${STRATEGY_GUIDANCE_VERSION}+discovery-inheritance-v1`,
    reviewedAt: playbook.provenance.fetchedAt,
    set: playbook.set,
    staticSourceFingerprint: staticSetCompatibilityFingerprint(data),
    targetBoardFingerprint: targetFingerprint,
    registryFingerprint: strategyRegistryFingerprint(
      playbook.family.id,
      playbook.family.core,
      targetFingerprint,
    ),
    freshness: { state: 'current', reasons: [] },
    sources: [],
    coverage: { fields: coverageFields, supported: 0, total: 7 },
    watchUnits: unavailableFact(
      'Final-board prevalence does not establish which units should drive commitment.',
    ),
    stages: [
      {
        id: 'observed-target',
        label: 'Observed target only',
        timing: unavailableFact('Final-board evidence does not establish timing.'),
        targetLevel: derivedFact(
          playbook.target.targetLevel,
          'Capacity is mechanically derived from the observed final board and audited slot rules.',
        ),
        roster: derivedFact(
          playbook.target.units.map((unit) => ({
            championId: unit.championId,
            slot: unit.slot,
            role: 'none' as const,
          })),
          'Roster is the measured cluster representative; it is not an opener or transition claim.',
        ),
        instruction: unavailableFact('No strategy instruction is inferred from final boards.'),
        entryCondition: unavailableFact('No entry condition is inferred from final boards.'),
        exitCondition: unavailableFact('No exit condition is inferred from final boards.'),
        nextStateIds: [],
      },
    ],
    rollPlan: unavailableFact('Roll and level style are not inferred from final-board clusters.'),
    itemHolders: [],
    augmentBranches: [],
    replacements: [],
    warnings: unavailableFact('No forcing or pivot warning is inferred from final-board clusters.'),
    decisionMap: {
      rootNodeId: null,
      nodes: [],
      edges: [],
      status: 'unavailable',
      note: 'No Decision Map is inferred from final-board clusters.',
    },
    positioning: {
      precision: 'unverified',
      exact: unavailableFact('Final-board unit order does not encode exact hexes.'),
      coarse: unavailableFact('Final-board unit order does not encode formation bands.'),
      note: 'Positioning not verified. No units are assigned to invented hexes.',
    },
  };
}

export interface InheritanceDecision {
  guidance: StrategyGuidance;
  eligible: boolean;
  reasons: string[];
}

export function inheritDiscoveredGuidance(
  playbook: Playbook,
  cluster: DiscoveryCluster,
  data: StaticData,
  parent?: Playbook,
): InheritanceDecision {
  const guidance = sparseGuidance(playbook, data);
  const reasons: string[] = [];
  if (!parent) reasons.push('No curated parent guidance.');
  if (cluster.lifecycle !== 'Variant')
    reasons.push('Only mature Variant lifecycle entries may inherit.');
  if (cluster.relation.state !== 'variant-candidate')
    reasons.push('Cluster is not a curated-parent variant relation.');
  if (cluster.relation.diff?.capacityDelta !== 0) reasons.push('Target capacity changed.');
  if (parent?.strategy.freshness.state !== 'current') reasons.push('Parent guidance is stale.');
  const targetIds = new Set(playbook.target.units.map((unit) => unit.championId));
  const sharedCore = new Set(cluster.relation.diff?.sharedCore ?? []);
  const omitted = new Set(cluster.relation.diff?.consistentlyOmitted ?? []);
  if (parent && parent.family.core.some((id) => !targetIds.has(id) || !sharedCore.has(id)))
    reasons.push('Parent core is not fully retained.');
  if (parent && parent.family.core.some((id) => omitted.has(id)))
    reasons.push('A parent core unit is repeatedly omitted.');
  if (reasons.length || !parent) return { guidance, eligible: false, reasons };

  const inheritedHolders = parent.strategy.itemHolders
    .filter(
      (holder) =>
        targetIds.has(holder.holderId) &&
        !omitted.has(holder.holderId) &&
        holder.fact.value !== null &&
        holder.fact.status !== 'stale',
    )
    .map((holder) => ({
      ...holder,
      temporaryHolderIds: holder.temporaryHolderIds.filter((id) => targetIds.has(id)),
      fact: inheritedFact(holder.fact, parent.family.id),
      groups: holder.groups.map((group) => ({
        ...group,
        fact: inheritedFact(group.fact, parent.family.id),
      })),
    }));
  const inheritedWatch = parent.strategy.watchUnits.value?.filter((id) => targetIds.has(id)) ?? [];
  if (inheritedHolders.length) {
    guidance.itemHolders = inheritedHolders;
    guidance.coverage.fields.items = 'inherited';
  }
  if (inheritedWatch.length)
    guidance.watchUnits = inheritedFact(
      { ...parent.strategy.watchUnits, value: inheritedWatch },
      parent.family.id,
    );
  guidance.sources = parent.strategy.sources;
  guidance.coverage.supported = Object.values(guidance.coverage.fields).filter(
    (status) => status !== 'unavailable',
  ).length;
  return {
    guidance,
    eligible: true,
    reasons: [
      inheritedHolders.length
        ? 'Only retained holder item directions were inherited.'
        : 'No structurally compatible parent item holders were available.',
      'Stage boards, roll plan, augments, replacements, Decision Map and positioning were not inherited.',
    ],
  };
}
