import { familyDefinitionsFingerprint, stableFingerprint } from '../domain/fingerprint';
import type {
  AdoptionAcceleration,
  BinomialEstimate,
  CanonicalBoard,
  ClusterRelation,
  CompletedMatch,
  DiscoveryCluster,
  DiscoveryConfigSnapshot,
  DiscoveryDataset,
  DiscoveryLifecycleState,
  DiscoveryObservation,
  LifecycleTransition,
  Playbook,
  StaticData,
  VariantDiff,
} from '../domain/models';
import { canonicalizeBoard, canonicalizeFinalBoard, CANONICAL_BOARD_MODEL } from './canonicalBoard';
import { BOARD_SIMILARITY_MODEL, compareCanonicalBoards } from './boardSimilarity';

export const DISCOVERY_MODEL = {
  clusteringVersion: 'indexed-density-medoid-v2',
  relationVersion: 'anchor-relation-v1',
  lifecycleVersion: 'discovery-lifecycle-v1',
  statisticsVersion: 'discovery-statistics-v1',
} as const;

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfigSnapshot = {
  minimumClusterSupport: 6,
  neighborhoodSimilarity: 0.78,
  blockingUnitCount: 3,
  maximumBlockSize: 1_500,
  maximumCandidatePairs: 2_000_000,
  relationKnownThreshold: 0.88,
  relationVariantThreshold: 0.72,
  relationMinimumMargin: 0.05,
  emergingMinimumGames: 20,
  variantMinimumGames: 20,
  minimumConfidence: 0.55,
  maximumAgeDays: 21,
  minimumCohesion: 0.8,
  accelerationRecentDays: 7,
  accelerationPriorDays: 21,
};

export function discoveryConfigurationFingerprint(config: DiscoveryConfigSnapshot) {
  return stableFingerprint({
    canonical: CANONICAL_BOARD_MODEL,
    similarity: BOARD_SIMILARITY_MODEL,
    discovery: DISCOVERY_MODEL,
    config,
  });
}

const DAY = 86_400_000;
const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

type ShapeNode = {
  board: CanonicalBoard;
  observations: DiscoveryObservation[];
  neighbors: Set<number>;
};

function combinations(values: string[], width: number): string[] {
  if (width <= 1) return values;
  const result: string[] = [];
  const visit = (start: number, selected: string[]) => {
    if (selected.length === width) {
      result.push(selected.join('|'));
      return;
    }
    for (let index = start; index <= values.length - (width - selected.length); index++)
      visit(index + 1, [...selected, values[index]]);
  };
  visit(0, []);
  return result;
}

function wilson(successes: number, games: number, z = 1.96): BinomialEstimate {
  if (!games) return { raw: 0, shrunk: 0, lower: 0, upper: 1 };
  const raw = successes / games;
  const denominator = 1 + (z * z) / games;
  const centre = raw + (z * z) / (2 * games);
  const spread = z * Math.sqrt((raw * (1 - raw)) / games + (z * z) / (4 * games * games));
  return {
    raw,
    shrunk: (successes + 0.5 * 16) / (games + 16),
    lower: (centre - spread) / denominator,
    upper: (centre + spread) / denominator,
  };
}

function effectiveSample(rows: DiscoveryObservation[], nowMs: number) {
  const weights = rows.map((row) =>
    Math.exp((-Math.log(2) * Math.max(0, nowMs - Date.parse(row.completedAt))) / (14 * DAY)),
  );
  const sum = weights.reduce((total, value) => total + value, 0);
  const squares = weights.reduce((total, value) => total + value * value, 0);
  return (sum * sum) / Math.max(Number.EPSILON, squares);
}

function adoptionFor(
  clusterRows: DiscoveryObservation[],
  allRows: DiscoveryObservation[],
  nowMs: number,
  config: DiscoveryConfigSnapshot,
): AdoptionAcceleration {
  const recentStart = nowMs - config.accelerationRecentDays * DAY;
  const priorStart = recentStart - config.accelerationPriorDays * DAY;
  const recent = allRows.filter((row) => Date.parse(row.completedAt) >= recentStart);
  const prior = allRows.filter((row) => {
    const date = Date.parse(row.completedAt);
    return date >= priorStart && date < recentStart;
  });
  const member = new Set(clusterRows.map((row) => row.observationId));
  const recentClusterBoards = recent.filter((row) => member.has(row.observationId)).length;
  const priorClusterBoards = prior.filter((row) => member.has(row.observationId)).length;
  const recentFrequency = recent.length ? recentClusterBoards / recent.length : 0;
  const priorFrequency = prior.length ? priorClusterBoards / prior.length : 0;
  return {
    recentFrequency,
    priorFrequency,
    delta: recentFrequency - priorFrequency,
    recentBoards: recent.length,
    priorBoards: prior.length,
    recentClusterBoards,
    priorClusterBoards,
    mature: recent.length >= 20 && prior.length >= 20 && recentClusterBoards >= 5,
  };
}

export function relateClusterRepresentative(
  representative: CanonicalBoard,
  prevalence: DiscoveryCluster['unitPrevalence'],
  families: Playbook[],
  data: StaticData,
  config: DiscoveryConfigSnapshot,
): ClusterRelation {
  const ranked = families
    .flatMap((family) => {
      const canonical = canonicalizeBoard(family.target, data);
      return canonical.board
        ? [{ family, score: compareCanonicalBoards(representative, canonical.board).value }]
        : [];
    })
    .sort((a, b) => b.score - a.score || a.family.id.localeCompare(b.family.id));
  const top = ranked[0];
  const runner = ranked[1];
  const similarity = top?.score ?? 0;
  const margin = similarity - (runner?.score ?? 0);
  const prevalenceById = new Map(prevalence.map((unit) => [unit.championId, unit.prevalence]));
  const anchorIds = new Set(top?.family.target.units.map((unit) => unit.championId) ?? []);
  const diff: VariantDiff | null = top
    ? {
        sharedCore: top.family.family.core.filter((id) => (prevalenceById.get(id) ?? 0) >= 0.7),
        consistentlyAdded: prevalence
          .filter((unit) => unit.prevalence >= 0.7 && !anchorIds.has(unit.championId))
          .map((unit) => unit.championId)
          .sort(),
        consistentlyOmitted: [...anchorIds]
          .filter((id) => (prevalenceById.get(id) ?? 0) <= 0.3)
          .sort(),
        structuralDistance: 1 - similarity,
        capacityDelta: representative.capacity - top.family.target.capacity,
      }
    : null;
  const certainty = clamp(0.7 * similarity + 0.3 * clamp(margin / 0.2));
  const state =
    top &&
    similarity >= config.relationKnownThreshold &&
    margin >= config.relationMinimumMargin &&
    diff &&
    diff.consistentlyAdded.length === 0 &&
    diff.consistentlyOmitted.length === 0
      ? 'known-family'
      : top &&
          similarity >= config.relationVariantThreshold &&
          margin >= config.relationMinimumMargin
        ? 'variant-candidate'
        : 'emerging-candidate';
  return {
    state,
    familyId: state === 'emerging-candidate' ? null : (top?.family.id ?? null),
    similarity,
    runnerUpFamilyId: runner?.family.id ?? null,
    runnerUpSimilarity: runner?.score ?? 0,
    margin,
    certainty,
    diff: state === 'variant-candidate' ? diff : null,
    modelVersion: DISCOVERY_MODEL.relationVersion,
  };
}

export function evaluateDiscoveryLifecycle(
  relation: ClusterRelation,
  stats: DiscoveryCluster['stats'],
  config: DiscoveryConfigSnapshot,
): { state: DiscoveryLifecycleState; eligible: boolean; drivers: string[]; gates: string[] } {
  const threshold =
    relation.state === 'variant-candidate'
      ? config.variantMinimumGames
      : config.emergingMinimumGames;
  const gates = [
    ...(stats.games >= threshold ? [] : [`support ${stats.games}/${threshold}`]),
    ...(stats.confidence >= config.minimumConfidence
      ? []
      : [`confidence ${stats.confidence.toFixed(2)}/${config.minimumConfidence.toFixed(2)}`]),
    ...(stats.cohesion >= config.minimumCohesion
      ? []
      : [`cohesion ${stats.cohesion.toFixed(2)}/${config.minimumCohesion.toFixed(2)}`]),
    ...(stats.ageDays <= config.maximumAgeDays
      ? []
      : [`freshness ${stats.ageDays.toFixed(1)}d/${config.maximumAgeDays}d`]),
    ...(relation.state === 'variant-candidate' && relation.certainty < 0.72
      ? [`relation certainty ${relation.certainty.toFixed(2)}/0.72`]
      : []),
    ...(stats.topFour.lower < 0.25
      ? [`top-four lower bound ${stats.topFour.lower.toFixed(2)}/0.25`]
      : []),
  ];
  if (relation.state === 'known-family')
    return {
      state: stats.games >= threshold && gates.length === 0 ? 'Proven' : 'Experimental',
      eligible: false,
      drivers: [
        'Cluster is evidence for an immutable curated anchor; no duplicate candidate created.',
      ],
      gates,
    };
  const mature = gates.length === 0;
  return {
    state: mature
      ? relation.state === 'variant-candidate'
        ? 'Variant'
        : 'Emerging'
      : 'Experimental',
    eligible: mature,
    drivers: mature
      ? [
          `${stats.games} repeated boards clear support.`,
          `Cohesion ${stats.cohesion.toFixed(2)} and confidence ${stats.confidence.toFixed(2)} clear gates.`,
          `Top-four interval lower bound ${stats.topFour.lower.toFixed(2)} clears the outcome gate.`,
        ]
      : [
          'Candidate remains Experimental until every support, freshness, structure, and outcome gate clears.',
        ],
    gates,
  };
}

function transitionHistory(
  previous: DiscoveryCluster | undefined,
  state: DiscoveryLifecycleState,
  now: string,
  drivers: string[],
): LifecycleTransition[] {
  if (previous?.lifecycle === state) return previous.transitions;
  return [
    ...(previous?.transitions ?? []),
    {
      previousState: previous?.lifecycle ?? null,
      newState: state,
      at: now,
      evidenceModelVersion: DISCOVERY_MODEL.lifecycleVersion,
      drivers,
    },
  ];
}

function representativeFor(nodes: ShapeNode[], memberIndexes: number[]) {
  const candidates = memberIndexes
    .slice()
    .sort((a, b) => nodes[a].board.fingerprint.localeCompare(nodes[b].board.fingerprint))
    .slice(0, 128);
  const sample = memberIndexes.length <= 256 ? memberIndexes : candidates;
  return candidates
    .map((index) => ({
      index,
      score: sample.reduce(
        (sum, other) =>
          sum +
          compareCanonicalBoards(nodes[index].board, nodes[other].board).value *
            nodes[other].observations.length,
        0,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        nodes[a.index].board.fingerprint.localeCompare(nodes[b.index].board.fingerprint),
    )[0].index;
}

function stalePriorClusters(
  previous: DiscoveryDataset | null | undefined,
  currentIds: Set<string>,
  data: StaticData,
  now: string,
) {
  if (!previous || previous.set !== data.version.set) return [];
  const nowMs = Date.parse(now);
  return previous.clusters.flatMap((cluster) => {
    if (currentIds.has(cluster.id)) return [];
    const legal =
      canonicalizeBoard(
        {
          id: cluster.id,
          set: cluster.representative.set,
          targetLevel: cluster.representative.capacity,
          capacity: cluster.representative.capacity,
          units: cluster.representative.units.map((unit) => ({
            championId: unit.championId,
            items: [],
            stars: unit.stars ?? undefined,
            slot: 'flex' as const,
          })),
          requiredUnits: [],
          augmentIds: [],
          traitClaims: [],
          provenance: {
            source: 'derived:discovery',
            fetchedAt: now,
            patch: null,
            status: 'measured' as const,
            note: 'Lifecycle legality check.',
          },
        },
        data,
      ).state === 'canonical';
    const ageDays = Math.max(0, nowMs - Date.parse(cluster.stats.freshestGameAt)) / DAY;
    const next: DiscoveryLifecycleState = !legal || ageDays > 45 ? 'Retired' : 'Stale';
    return [
      {
        ...cluster,
        lifecycle: next,
        recommendationEligible: false,
        recommendationGateReasons: [
          legal
            ? 'No qualifying structure in the current refresh.'
            : 'Representative is illegal in the active set.',
        ],
        stats: { ...cluster.stats, ageDays },
        transitions: transitionHistory(cluster, next, now, [
          legal ? 'No qualifying structure in the current refresh.' : 'Active-set legality failed.',
          `Freshest evidence is ${ageDays.toFixed(1)} days old.`,
        ]),
      },
    ];
  });
}

export interface DiscoveryDerivationInput {
  matches: CompletedMatch[];
  families: Playbook[];
  data: StaticData;
  sampleDefinitionFingerprint: string;
  sourceType: DiscoveryDataset['sourceType'];
  source: string;
  now: string;
  config?: DiscoveryConfigSnapshot;
  previous?: DiscoveryDataset | null;
}

export function deriveDiscoveryDataset(input: DiscoveryDerivationInput): DiscoveryDataset {
  const config = input.config ?? DEFAULT_DISCOVERY_CONFIG;
  const errors: string[] = [];
  const observations: DiscoveryObservation[] = [];
  let invalidBoards = 0;
  const matches = input.matches.filter((match) => match.set === input.data.version.set);
  for (const match of matches)
    match.participants.forEach((participant, index) => {
      const result = canonicalizeFinalBoard(participant, match.set, input.data);
      if (!result.board) {
        invalidBoards++;
        return;
      }
      observations.push({
        observationId: stableFingerprint({ matchId: match.id, participantIndex: index }),
        matchId: match.id,
        completedAt: match.completedAt,
        placement: participant.placement,
        board: result.board,
      });
    });
  const grouped = new Map<string, ShapeNode>();
  for (const observation of observations) {
    const node = grouped.get(observation.board.fingerprint);
    if (node) node.observations.push(observation);
    else
      grouped.set(observation.board.fingerprint, {
        board: observation.board,
        observations: [observation],
        neighbors: new Set(),
      });
  }
  const nodes = [...grouped.values()].sort((a, b) =>
    a.board.fingerprint.localeCompare(b.board.fingerprint),
  );
  const blocks = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const ids = node.board.units.map((unit) => unit.championId);
    const width = Math.min(config.blockingUnitCount, ids.length);
    for (const token of combinations(ids, width)) {
      const bucket = blocks.get(token) ?? [];
      bucket.push(index);
      blocks.set(token, bucket);
    }
  });
  const candidatePairs = new Set<string>();
  let budgetReached = false;
  let oversizedBlocksSkipped = 0;
  for (const [, rawBucket] of [...blocks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bucket = rawBucket.slice().sort((a, b) => a - b);
    if (bucket.length > config.maximumBlockSize) {
      oversizedBlocksSkipped++;
      continue;
    }
    for (let left = 0; left < bucket.length - 1; left++) {
      for (let right = left + 1; right < bucket.length; right++) {
        candidatePairs.add(`${bucket[left]}:${bucket[right]}`);
        if (candidatePairs.size >= config.maximumCandidatePairs) {
          budgetReached = true;
          break;
        }
      }
      if (budgetReached) break;
    }
    if (budgetReached) break;
  }
  for (const pair of candidatePairs) {
    const [left, right] = pair.split(':').map(Number);
    if (
      compareCanonicalBoards(nodes[left].board, nodes[right].board).value >=
      config.neighborhoodSimilarity
    ) {
      nodes[left].neighbors.add(right);
      nodes[right].neighbors.add(left);
    }
  }
  if (budgetReached)
    errors.push('Candidate-pair budget reached; unmatched boards remain explicit noise.');
  if (oversizedBlocksSkipped)
    errors.push(
      `${oversizedBlocksSkipped} over-common blocking buckets were skipped; unmatched boards remain explicit noise.`,
    );
  const support = (index: number) =>
    nodes[index].observations.length +
    [...nodes[index].neighbors].reduce(
      (sum, neighbor) => sum + nodes[neighbor].observations.length,
      0,
    );
  const core = new Set(
    nodes
      .map((_, index) => index)
      .filter((index) => support(index) >= config.minimumClusterSupport),
  );
  const assigned = new Map<number, number>();
  const components: number[][] = [];
  for (const seed of [...core].sort((a, b) => a - b)) {
    if (assigned.has(seed)) continue;
    const componentIndex = components.length;
    const component: number[] = [];
    const queue = [seed];
    assigned.set(seed, componentIndex);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of [...nodes[current].neighbors].sort((a, b) => a - b))
        if (core.has(neighbor) && !assigned.has(neighbor)) {
          assigned.set(neighbor, componentIndex);
          queue.push(neighbor);
        }
    }
    components.push(component.sort((a, b) => a - b));
  }
  nodes.forEach((node, index) => {
    if (assigned.has(index)) return;
    const options = [...node.neighbors]
      .filter((neighbor) => assigned.has(neighbor))
      .map((neighbor) => ({
        component: assigned.get(neighbor)!,
        similarity: compareCanonicalBoards(node.board, nodes[neighbor].board).value,
      }))
      .sort((a, b) => b.similarity - a.similarity || a.component - b.component);
    if (options[0]) {
      assigned.set(index, options[0].component);
      components[options[0].component].push(index);
    }
  });
  const nowMs = Date.parse(input.now);
  const previousById = new Map(
    input.previous?.clusters.map((cluster) => [cluster.id, cluster]) ?? [],
  );
  let clusters = components
    .filter(
      (members) =>
        members.reduce((sum, index) => sum + nodes[index].observations.length, 0) >=
        config.minimumClusterSupport,
    )
    .map((members) => {
      const rows = members.flatMap((index) => nodes[index].observations);
      const representativeIndex = representativeFor(nodes, members);
      const representative = nodes[representativeIndex].board;
      const memberFingerprints = members.map((index) => nodes[index].board.fingerprint).sort();
      const id = `cluster-${stableFingerprint({
        version: DISCOVERY_MODEL.clusteringVersion,
        canonicalModelVersion: CANONICAL_BOARD_MODEL.version,
        representativeFingerprint: representative.fingerprint,
      }).slice(-8)}`;
      const unitCounts = new Map<string, number>();
      for (const row of rows)
        for (const unit of row.board.units)
          unitCounts.set(unit.championId, (unitCounts.get(unit.championId) ?? 0) + 1);
      const prevalence = [...unitCounts.entries()]
        .map(([championId, count]) => ({
          championId,
          observations: count,
          prevalence: count / rows.length,
        }))
        .sort((a, b) => b.prevalence - a.prevalence || a.championId.localeCompare(b.championId));
      const cohesion =
        rows.reduce(
          (sum, row) => sum + compareCanonicalBoards(row.board, representative).value,
          0,
        ) / rows.length;
      const relation = relateClusterRepresentative(
        representative,
        prevalence,
        input.families,
        input.data,
        config,
      );
      const freshestGameAt = rows
        .map((row) => row.completedAt)
        .sort()
        .at(-1)!;
      const ageDays = Math.max(0, nowMs - Date.parse(freshestGameAt)) / DAY;
      const topFour = wilson(rows.filter((row) => row.placement <= 4).length, rows.length);
      const wins = wilson(rows.filter((row) => row.placement === 1).length, rows.length);
      const stats: DiscoveryCluster['stats'] = {
        games: rows.length,
        uniqueMatches: new Set(rows.map((row) => row.matchId)).size,
        effectiveSample: effectiveSample(rows, nowMs),
        averagePlacement: rows.reduce((sum, row) => sum + row.placement, 0) / rows.length,
        topFour,
        wins,
        freshestGameAt,
        ageDays,
        cohesion,
        separation: 1,
        confidence: clamp(
          0.45 * (rows.length / (rows.length + 30)) +
            0.25 * cohesion +
            0.2 * Math.exp(-ageDays / 21) +
            0.1 * relation.certainty,
        ),
        adoption: adoptionFor(rows, observations, nowMs, config),
      };
      const lifecycle = evaluateDiscoveryLifecycle(relation, stats, config);
      const previous = previousById.get(id);
      return {
        id,
        memberFingerprints,
        representative,
        unitPrevalence: prevalence,
        stats,
        relation,
        lifecycle: lifecycle.state,
        transitions: transitionHistory(previous, lifecycle.state, input.now, lifecycle.drivers),
        recommendationEligible: lifecycle.eligible,
        recommendationGateReasons: lifecycle.gates,
      } satisfies DiscoveryCluster;
    });
  for (const cluster of clusters) {
    const otherSimilarity = clusters
      .filter((other) => other.id !== cluster.id)
      .map((other) => compareCanonicalBoards(cluster.representative, other.representative).value);
    cluster.stats.separation = 1 - Math.max(0, ...otherSimilarity);
  }
  const currentIds = new Set(clusters.map((cluster) => cluster.id));
  clusters = [
    ...clusters,
    ...stalePriorClusters(input.previous, currentIds, input.data, input.now),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const clusteredIndexes = new Set(assigned.keys());
  const noiseObservationIds = nodes.flatMap((node, index) =>
    clusteredIndexes.has(index) ? [] : node.observations.map((row) => row.observationId),
  );
  const familyFingerprint = familyDefinitionsFingerprint(input.families);
  const configurationFingerprint = discoveryConfigurationFingerprint(config);
  const derivationFingerprint = stableFingerprint({
    set: input.data.version.set,
    staticSourceVersion: input.data.version.sourceVersion,
    familyDefinitionsFingerprint: familyFingerprint,
    sampleDefinitionFingerprint: input.sampleDefinitionFingerprint,
    configurationFingerprint,
  });
  const dates = observations.map((row) => row.completedAt).sort();
  return {
    id: `${input.data.version.set}-${input.now}-${derivationFingerprint}`,
    schemaVersion: 1,
    set: input.data.version.set,
    state: observations.length === 0 ? 'unavailable' : errors.length ? 'partial' : 'complete',
    sourceType: input.sourceType,
    source: input.source,
    generatedAt: input.now,
    windowStart: dates[0] ?? null,
    windowEnd: dates.at(-1) ?? null,
    boardsAnalyzed: observations.length,
    invalidBoards,
    clusterCount: clusters.filter((cluster) => !['Stale', 'Retired'].includes(cluster.lifecycle))
      .length,
    knownFamilyClusters: clusters.filter(
      (cluster) =>
        cluster.relation.state === 'known-family' &&
        !['Stale', 'Retired'].includes(cluster.lifecycle),
    ).length,
    variantClusters: clusters.filter(
      (cluster) =>
        cluster.relation.state === 'variant-candidate' &&
        !['Stale', 'Retired'].includes(cluster.lifecycle),
    ).length,
    emergingClusters: clusters.filter(
      (cluster) =>
        cluster.relation.state === 'emerging-candidate' && cluster.lifecycle === 'Emerging',
    ).length,
    experimentalClusters: clusters.filter((cluster) => cluster.lifecycle === 'Experimental').length,
    noiseBoards: noiseObservationIds.length,
    candidatePairsCompared: candidatePairs.size,
    candidatePairBudgetReached: budgetReached,
    oversizedBlocksSkipped,
    clusters,
    noiseObservationIds,
    canonicalModelVersion: CANONICAL_BOARD_MODEL.version,
    similarityModelVersion: BOARD_SIMILARITY_MODEL.version,
    clusteringModelVersion: DISCOVERY_MODEL.clusteringVersion,
    relationModelVersion: DISCOVERY_MODEL.relationVersion,
    lifecycleModelVersion: DISCOVERY_MODEL.lifecycleVersion,
    statisticsVersion: DISCOVERY_MODEL.statisticsVersion,
    staticSourceVersion: input.data.version.sourceVersion,
    familyDefinitionsFingerprint: familyFingerprint,
    sampleDefinitionFingerprint: input.sampleDefinitionFingerprint,
    configurationFingerprint,
    derivationFingerprint,
    config,
    patchRelevance: 'unavailable',
    errors,
  };
}

export function compatibleDiscoveryDataset(
  dataset: DiscoveryDataset | null | undefined,
  expected: {
    set: number;
    staticSourceVersion: string;
    familyDefinitionsFingerprint: string;
    sampleDefinitionFingerprint?: string;
    configurationFingerprint?: string;
  },
) {
  return Boolean(
    dataset &&
      dataset.schemaVersion === 1 &&
      dataset.set === expected.set &&
      dataset.staticSourceVersion === expected.staticSourceVersion &&
      dataset.familyDefinitionsFingerprint === expected.familyDefinitionsFingerprint &&
      (!expected.sampleDefinitionFingerprint ||
        dataset.sampleDefinitionFingerprint === expected.sampleDefinitionFingerprint) &&
      (!expected.configurationFingerprint ||
        dataset.configurationFingerprint === expected.configurationFingerprint) &&
      dataset.canonicalModelVersion === CANONICAL_BOARD_MODEL.version &&
      dataset.similarityModelVersion === BOARD_SIMILARITY_MODEL.version &&
      dataset.clusteringModelVersion === DISCOVERY_MODEL.clusteringVersion &&
      dataset.relationModelVersion === DISCOVERY_MODEL.relationVersion &&
      dataset.lifecycleModelVersion === DISCOVERY_MODEL.lifecycleVersion &&
      dataset.statisticsVersion === DISCOVERY_MODEL.statisticsVersion &&
      dataset.configurationFingerprint === discoveryConfigurationFingerprint(dataset.config),
  );
}
