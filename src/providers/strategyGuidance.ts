import rawSeed from '../../data/playbooks/set18.strategy.json';
import { stableFingerprint, staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import type {
  ID,
  Playbook,
  StrategyCoverageKey,
  StrategyFact,
  StrategyFactStatus,
  StrategyGuidance,
  StrategyStageState,
  StaticData,
} from '../domain/models';
import { strategySeedSchema, type StrategySeedEntry } from '../domain/strategySchema';

export const STRATEGY_SCHEMA_VERSION = 1 as const;
export const STRATEGY_GUIDANCE_VERSION = 'set18-strategy-v1';

const seed = strategySeedSchema.parse(rawSeed);

export function strategyTargetFingerprint(set: number, capacity: number, unitIds: ID[]) {
  return stableFingerprint({
    version: 'strategy-target-v1',
    set,
    capacity,
    unitIds: [...unitIds].sort(),
  });
}

export function strategyRegistryFingerprint(
  familyId: ID,
  coreIds: ID[],
  targetBoardFingerprint: string,
) {
  return stableFingerprint({
    version: 'strategy-registry-v1',
    familyId,
    coreIds: [...coreIds].sort(),
    targetBoardFingerprint,
  });
}

export const unavailableFact = <T>(note: string): StrategyFact<T> => ({
  value: null,
  status: 'unavailable',
  sourceIds: [],
  note,
});

const sourcedFact = <T>(value: T, sourceIds: ID[], note: string): StrategyFact<T> => ({
  value,
  status: 'sourced',
  sourceIds,
  note,
});

function staleFact<T>(fact: StrategyFact<T>, reasons: string[]): StrategyFact<T> {
  if (fact.status === 'unavailable') return fact;
  return {
    value: null,
    status: 'stale',
    sourceIds: fact.sourceIds,
    note: `${fact.note} Inactive: ${reasons.join(' ')}`,
    inheritedFrom: fact.inheritedFrom,
  };
}

function sourceFact(
  input: { value: string; sourceIds: string[]; note: string } | null,
  unavailableNote: string,
) {
  return input
    ? sourcedFact(input.value, input.sourceIds, input.note)
    : unavailableFact<string>(unavailableNote);
}

function resolveChampionId(data: StaticData, name: string) {
  const matches = data.champions.filter((champion) => champion.name === name);
  if (matches.length !== 1) throw new Error(`Cannot resolve strategy unit ${name}`);
  return matches[0].id;
}

function stageFromSeed(stage: StrategySeedEntry['stages'][number], data: StaticData) {
  return {
    id: stage.id,
    label: stage.label,
    timing: sourceFact(stage.timing, 'Exact timing unavailable.'),
    targetLevel:
      stage.targetLevel === null
        ? unavailableFact<number>('Target level unavailable for this state.')
        : sourcedFact(stage.targetLevel, stage.sourceIds, 'Published level for this state.'),
    roster:
      stage.units.length === 0
        ? unavailableFact(
            'The source describes this milestone but does not publish an exact board.',
          )
        : sourcedFact(
            stage.units.map((unit) => ({
              championId: resolveChampionId(data, unit.name),
              slot: unit.slot,
              role: unit.role,
            })),
            stage.sourceIds,
            'Roster transcribed from the inspected public source.',
          ),
    instruction: sourceFact(stage.instruction, 'No source-backed instruction for this state.'),
    entryCondition: sourceFact(
      stage.entryCondition,
      'No source-backed entry condition for this state.',
    ),
    exitCondition: sourceFact(
      stage.exitCondition,
      'No source-backed exit condition for this state.',
    ),
    nextStateIds: stage.nextStateIds,
  } satisfies StrategyStageState;
}

function staleGuidance(guidance: StrategyGuidance): StrategyGuidance {
  const reasons = guidance.freshness.reasons;
  return {
    ...guidance,
    watchUnits: staleFact(guidance.watchUnits, reasons),
    stages: guidance.stages.map((stage) => ({
      ...stage,
      timing: staleFact(stage.timing, reasons),
      targetLevel: staleFact(stage.targetLevel, reasons),
      roster: staleFact(stage.roster, reasons),
      instruction: staleFact(stage.instruction, reasons),
      entryCondition: staleFact(stage.entryCondition, reasons),
      exitCondition: staleFact(stage.exitCondition, reasons),
    })),
    rollPlan: staleFact(guidance.rollPlan, reasons),
    itemHolders: guidance.itemHolders.map((holder) => ({
      ...holder,
      fact: staleFact(holder.fact, reasons),
      groups: holder.groups.map((group) => ({ ...group, fact: staleFact(group.fact, reasons) })),
    })),
    augmentBranches: guidance.augmentBranches.map((branch) => ({
      ...branch,
      signal: staleFact(branch.signal, reasons),
      consequence: staleFact(branch.consequence, reasons),
    })),
    replacements: [],
    warnings: staleFact(guidance.warnings, reasons),
    decisionMap: {
      ...guidance.decisionMap,
      status: guidance.decisionMap.status === 'unavailable' ? 'unavailable' : 'stale',
      nodes: guidance.decisionMap.nodes.map((node) => ({
        ...node,
        fact: staleFact(node.fact, reasons),
      })),
      edges: guidance.decisionMap.edges.map((edge) => ({
        ...edge,
        fact: staleFact(edge.fact, reasons),
      })),
    },
    positioning: {
      ...guidance.positioning,
      precision: 'unverified',
      exact: staleFact(guidance.positioning.exact, reasons),
      coarse: staleFact(guidance.positioning.coarse, reasons),
    },
    coverage: {
      ...guidance.coverage,
      fields: Object.fromEntries(
        Object.keys(guidance.coverage.fields).map((key) => [key, 'stale']),
      ) as Record<StrategyCoverageKey, StrategyFactStatus>,
      supported: 0,
    },
  };
}

export function loadStrategyGuidance(playbook: Playbook, data: StaticData): StrategyGuidance {
  const entry = seed.entries.find((candidate) => candidate.familyId === playbook.family.id);
  if (!entry) throw new Error(`Missing M7 strategy ledger entry for ${playbook.family.id}`);
  const expectedTargetIds = entry.expectedTarget.unitNames.map((name) =>
    resolveChampionId(data, name),
  );
  const expectedCoreIds = entry.expectedCore.map((name) => resolveChampionId(data, name));
  const expectedTargetFingerprint = strategyTargetFingerprint(
    seed.set,
    entry.expectedTarget.capacity,
    expectedTargetIds,
  );
  const expectedRegistryFingerprint = strategyRegistryFingerprint(
    entry.familyId,
    expectedCoreIds,
    expectedTargetFingerprint,
  );
  const actualTargetFingerprint = strategyTargetFingerprint(
    playbook.set,
    playbook.target.capacity,
    playbook.target.units.map((unit) => unit.championId),
  );
  const actualRegistryFingerprint = strategyRegistryFingerprint(
    playbook.family.id,
    playbook.family.core,
    actualTargetFingerprint,
  );
  const freshnessReasons: string[] = [];
  if (seed.schemaVersion !== STRATEGY_SCHEMA_VERSION)
    freshnessReasons.push('Strategy schema version changed.');
  if (seed.guidanceVersion !== STRATEGY_GUIDANCE_VERSION)
    freshnessReasons.push('Guidance model version changed.');
  if (seed.set !== data.version.set) freshnessReasons.push('Active set changed.');
  if (seed.staticSourceFingerprint !== staticSetCompatibilityFingerprint(data))
    freshnessReasons.push('Static-source fingerprint changed.');
  if (expectedTargetFingerprint !== actualTargetFingerprint)
    freshnessReasons.push('Target board or capacity changed.');
  if (expectedRegistryFingerprint !== actualRegistryFingerprint)
    freshnessReasons.push('Family core/registry fingerprint changed.');
  const sourceIds = new Set(entry.sourceIds);
  const sources = seed.sources.filter((source) => sourceIds.has(source.id));
  if (sources.length !== sourceIds.size) freshnessReasons.push('A strategy source is unavailable.');

  const stages = entry.stages.map((stage) => stageFromSeed(stage, data));
  if (!stages.length)
    stages.push({
      id: 'target',
      label: 'Sourced target only',
      timing: unavailableFact('No exact timing is published.'),
      targetLevel: sourcedFact(
        playbook.target.targetLevel,
        entry.sourceIds,
        'Target capacity follows the public final board and audited slot rules.',
      ),
      roster: sourcedFact(
        playbook.target.units.map((unit) => ({
          championId: unit.championId,
          slot: unit.slot,
          role: 'none' as const,
        })),
        entry.sourceIds,
        'Final roster only; this is not stage-progression evidence.',
      ),
      instruction: unavailableFact('No source-backed stage instruction.'),
      entryCondition: unavailableFact('No source-backed entry condition.'),
      exitCondition: unavailableFact('No source-backed exit condition.'),
      nextStateIds: [],
    });

  const itemHolders = entry.itemHolders.map((holder) => ({
    holderId: resolveChampionId(data, holder.holder),
    role: holder.role,
    groups: holder.groups.map((group) => ({
      kind: group.kind,
      itemIds: group.itemIds,
      fact: sourcedFact(group.note, group.sourceIds, group.note),
    })),
    temporaryHolderIds: holder.temporaryHolders.map((name) => resolveChampionId(data, name)),
    componentIds: holder.componentIds,
    fact: sourcedFact(holder.note, holder.sourceIds, holder.note),
  }));
  const augmentBranches = entry.augmentBranches.map((branch) => ({
    id: branch.id,
    category: branch.category,
    augmentIds: [],
    signal: sourcedFact(branch.signal.value, branch.signal.sourceIds, branch.signal.note),
    consequence: sourcedFact(
      branch.consequence.value,
      branch.consequence.sourceIds,
      branch.consequence.note,
    ),
  }));
  const decisionMap = entry.decisionMap
    ? {
        rootNodeId: entry.decisionMap.rootNodeId,
        nodes: entry.decisionMap.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          kind: node.kind,
          fact: {
            value: node.note,
            status: node.status,
            sourceIds: node.sourceIds,
            note: node.note,
          },
        })),
        edges: entry.decisionMap.edges.map((edge) => ({
          id: edge.id,
          from: edge.from,
          to: edge.to,
          label: edge.label,
          conditionKind: edge.conditionKind,
          fact: {
            value: edge.note,
            status: edge.status,
            sourceIds: edge.sourceIds,
            note: edge.note,
          },
        })),
        status: 'sourced' as const,
        note: entry.decisionMap.note,
      }
    : {
        rootNodeId: null,
        nodes: [],
        edges: [],
        status: 'unavailable' as const,
        note: 'No source-backed branching conditions are available.',
      };
  const positioning = entry.positioning
    ? {
        precision: entry.positioning.precision,
        exact: sourcedFact(
          entry.positioning.exact.map((position) => ({
            championId: resolveChampionId(data, position.unitName),
            row: position.row,
            column: position.column,
          })),
          entry.positioning.sourceIds,
          entry.positioning.note,
        ),
        coarse: sourcedFact(
          entry.positioning.coarse.map((position) => ({
            championId: resolveChampionId(data, position.unitName),
            band: position.band,
            side: position.side,
          })),
          entry.positioning.sourceIds,
          entry.positioning.note,
        ),
        note: entry.positioning.note,
      }
    : {
        precision: 'unverified' as const,
        exact: unavailableFact<never[]>('Exact hexes were not directly verified.'),
        coarse: unavailableFact<never[]>('No sourced coarse formation is available.'),
        note: 'Positioning not verified. No units are assigned to invented hexes.',
      };
  const coverageFields: Record<StrategyCoverageKey, StrategyFactStatus> = {
    stageBoards: entry.stages.length ? 'sourced' : 'unavailable',
    rollLevel: entry.rollPlan ? 'sourced' : 'unavailable',
    items: itemHolders.length ? 'sourced' : 'unavailable',
    augments: augmentBranches.length ? 'sourced' : 'unavailable',
    replacements: 'unavailable',
    positioning: entry.positioning ? 'sourced' : 'unavailable',
    warningsPivots: entry.warnings || entry.decisionMap ? 'sourced' : 'unavailable',
  };
  const guidance: StrategyGuidance = {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    guidanceVersion: seed.guidanceVersion,
    reviewedAt: seed.reviewedAt,
    set: seed.set,
    staticSourceFingerprint: seed.staticSourceFingerprint,
    targetBoardFingerprint: expectedTargetFingerprint,
    registryFingerprint: expectedRegistryFingerprint,
    freshness: {
      state: freshnessReasons.length ? 'stale' : 'current',
      reasons: freshnessReasons,
    },
    sources,
    coverage: {
      fields: coverageFields,
      supported: Object.values(coverageFields).filter((status) => status !== 'unavailable').length,
      total: Object.keys(coverageFields).length,
    },
    watchUnits: entry.watchUnits.length
      ? sourcedFact(
          entry.watchUnits.map((name) => resolveChampionId(data, name)),
          entry.sourceIds,
          'Units explicitly emphasized by the inspected source.',
        )
      : unavailableFact('The source does not establish units to watch beyond the final roster.'),
    stages,
    rollPlan: entry.rollPlan
      ? sourcedFact(entry.rollPlan.milestones, entry.rollPlan.sourceIds, entry.rollPlan.note)
      : unavailableFact('No source-backed level or roll plan.'),
    itemHolders,
    augmentBranches,
    replacements: [],
    warnings: entry.warnings
      ? sourcedFact(entry.warnings.values, entry.warnings.sourceIds, entry.warnings.note)
      : unavailableFact('No source-backed warning or pivot condition.'),
    decisionMap,
    positioning,
  };
  return freshnessReasons.length ? staleGuidance(guidance) : guidance;
}

export function strategyLedger() {
  return seed;
}
