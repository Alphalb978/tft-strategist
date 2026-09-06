import { performance } from 'node:perf_hooks';
import type { CompletedMatch, MatchParticipant } from '../src/domain/models';
import { MemoryRepository } from '../src/storage/repository';
import { compareCanonicalBoards } from '../src/strategy/boardSimilarity';
import { canonicalizeFinalBoard } from '../src/strategy/canonicalBoard';
import {
  DEFAULT_DISCOVERY_CONFIG,
  deriveDiscoveryDataset,
  evaluateDiscoveryLifecycle,
  relateClusterRepresentative,
} from '../src/strategy/compDiscovery';
import { data, NOW, playbooks } from '../src/test/fixtures';

const eligible = data.champions.filter((unit) => unit.boardEligible && unit.shopStatus === 'pool');

function participant(index: number): MatchParticipant {
  const base = playbooks[index % playbooks.length];
  const variant = Math.floor(index / playbooks.length) % 16;
  const board = base.target.units.map((unit) => unit.championId);
  if (variant > 0) {
    const slot = board.length - 1 - (variant % Math.min(2, board.length));
    const replacement = eligible[(index * 17 + variant * 7) % eligible.length].id;
    if (!board.includes(replacement)) board[slot] = replacement;
  }
  return {
    puuid: `benchmark-${index}`,
    placement: (index % 8) + 1,
    level: base.target.capacity,
    units: board.map((championId) => ({
      championId,
      items: [],
      stars: (index % 3) + 1,
      rarity: null,
      rawName: null,
      unresolvedUnit: false,
      unresolvedItems: [],
    })),
    traits: [],
    augmentIds: [],
    unresolvedAugmentIds: [],
  };
}

function matchesFor(boardCount: number): CompletedMatch[] {
  return Array.from({ length: Math.ceil(boardCount / 8) }, (_, matchIndex) => ({
    id: `m6-benchmark-${boardCount}-${matchIndex}`,
    set: 18,
    setCoreName: 'TFTSet18',
    riotGameVersion: 'benchmark-client-build',
    tftContentPatch: null,
    tftContentPatchSource: 'unavailable',
    dataVersion: 'benchmark-v1',
    gameTimestamp: NOW,
    completedAt: NOW,
    queueId: null,
    gameType: 'benchmark',
    mapId: null,
    endOfGameResult: 'complete',
    modeSupport: 'supported',
    participants: Array.from({ length: 8 }, (_, offset) =>
      participant(matchIndex * 8 + offset),
    ).slice(0, Math.max(0, boardCount - matchIndex * 8)),
    source: 'fixture:m6-benchmark',
  }));
}

const canonicalInputs = Array.from({ length: 20_000 }, (_, index) => participant(index));
let started = performance.now();
const canonical = canonicalInputs.map((row) => canonicalizeFinalBoard(row, 18, data).board!);
const canonicalMs = performance.now() - started;
started = performance.now();
let similarityChecksum = 0;
for (let index = 0; index < 100_000; index++)
  similarityChecksum += compareCanonicalBoards(
    canonical[index % canonical.length],
    canonical[(index * 97 + 31) % canonical.length],
  ).value;
const similarityMs = performance.now() - started;

const clusterResults: Record<string, unknown>[] = [];
let last = null as ReturnType<typeof deriveDiscoveryDataset> | null;
for (const boardCount of [1_000, 8_000, 20_000]) {
  started = performance.now();
  last = deriveDiscoveryDataset({
    matches: matchesFor(boardCount),
    families: playbooks,
    data,
    sampleDefinitionFingerprint: `benchmark-${boardCount}`,
    sourceType: 'fixture',
    source: 'fixture:m6-benchmark',
    now: NOW,
  });
  clusterResults.push({
    boards: boardCount,
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    clusters: last.clusterCount,
    noiseBoards: last.noiseBoards,
    candidatePairs: last.candidatePairsCompared,
    pairBudgetReached: last.candidatePairBudgetReached,
    oversizedBlocksSkipped: last.oversizedBlocksSkipped,
  });
}

started = performance.now();
const relations = last!.clusters.map((cluster) =>
  relateClusterRepresentative(
    cluster.representative,
    cluster.unitPrevalence,
    playbooks,
    data,
    DEFAULT_DISCOVERY_CONFIG,
  ),
);
const relationMs = performance.now() - started;
started = performance.now();
const lifecycle = last!.clusters.map((cluster, index) =>
  evaluateDiscoveryLifecycle(relations[index], cluster.stats, DEFAULT_DISCOVERY_CONFIG),
);
const lifecycleMs = performance.now() - started;

const repository = new MemoryRepository();
await repository.set('comp-discovery', last);
started = performance.now();
for (let index = 0; index < 1_000; index++) await repository.get('comp-discovery');
const warmLoadMs = performance.now() - started;

console.log(
  JSON.stringify(
    {
      canonicalization: {
        boards: canonical.length,
        elapsedMs: Number(canonicalMs.toFixed(2)),
        boardsPerSecond: Math.round(canonical.length / (canonicalMs / 1_000)),
      },
      similarity: {
        comparisons: 100_000,
        elapsedMs: Number(similarityMs.toFixed(2)),
        comparisonsPerSecond: Math.round(100_000 / (similarityMs / 1_000)),
        checksum: Number(similarityChecksum.toFixed(2)),
      },
      clustering: clusterResults,
      relationPass: { clusters: relations.length, elapsedMs: Number(relationMs.toFixed(2)) },
      lifecyclePass: { clusters: lifecycle.length, elapsedMs: Number(lifecycleMs.toFixed(2)) },
      warmDerivedLoad: { loads: 1_000, elapsedMs: Number(warmLoadMs.toFixed(2)) },
      algorithm:
        'Exact-shape collapse + fixed-width champion combination index + bounded candidate graph + density/core components + bounded medoid sample.',
    },
    null,
    2,
  ),
);
