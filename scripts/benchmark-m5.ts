import { performance } from 'node:perf_hooks';
import { data, match, NOW, playbooks } from '../src/test/fixtures';
import { classifyFinalBoard } from '../src/strategy/compClassifier';
import { deriveFamilyStatistics } from '../src/strategy/metaStatistics';
import { FixtureRiotProvider } from '../src/providers/riot';
import { MemoryHistoryStore } from '../src/storage/history';
import { MemoryRepository } from '../src/storage/repository';
import { collectAggregateMeta } from '../src/services/metaPipeline';
import type { RiotIdentity } from '../src/domain/models';

const participants = Array.from({ length: 8_000 }, (_, index) => {
  const playbook = playbooks[index % playbooks.length];
  return (match(`benchmark-${Math.floor(index / 8)}`, [`p-${index}`]).participants[0] = {
    ...match('fixture', [`p-${index}`]).participants[0],
    placement: (index % 8) + 1,
    units: playbook.target.units.map((unit) => ({
      championId: unit.championId,
      items: [],
      stars: 1,
      rarity: null,
      rawName: null,
      unresolvedUnit: false,
      unresolvedItems: [],
    })),
  });
});
const started = performance.now();
const observations = participants.map((participant, index) => ({
  matchId: `benchmark-${Math.floor(index / 8)}`,
  puuid: participant.puuid,
  completedAt: NOW,
  placement: participant.placement,
  classification: classifyFinalBoard(participant, playbooks, data),
}));
const classifiedAt = performance.now();
const stats = deriveFamilyStatistics(observations, playbooks, NOW);
const finished = performance.now();
console.table([
  {
    boards: observations.length,
    families: stats.length,
    classificationMs: (classifiedAt - started).toFixed(2),
    statisticsMs: (finished - classifiedAt).toFixed(2),
    totalMs: (finished - started).toFixed(2),
  },
]);

const identities: RiotIdentity[] = ['cohort-a', 'cohort-b'].map((puuid) => ({
  puuid,
  gameName: puuid,
  tagLine: 'M5',
  platform: 'EUW1',
  routing: 'EUROPE',
}));
const matches = Array.from({ length: 10 }, (_, index) =>
  match(
    `shared-${index}`,
    identities.map((identity) => identity.puuid),
  ),
);
const provider = new FixtureRiotProvider(matches, identities);
const history = new MemoryHistoryStore();
const repository = new MemoryRepository();
const config = {
  platform: 'EUW1',
  regionalRoute: 'EUROPE',
  tiers: ['CHALLENGER' as const],
  playersPerTier: 2,
  matchesPerPlayer: 10,
  set: 18,
};
const coldStarted = performance.now();
const cold = await collectAggregateMeta(
  provider,
  history,
  repository,
  data,
  playbooks,
  config,
  NOW,
);
const coldFinished = performance.now();
const warm = await collectAggregateMeta(
  provider,
  history,
  repository,
  data,
  playbooks,
  config,
  NOW,
);
const warmFinished = performance.now();
console.table([
  {
    scenario: '10 shared matches · cold then warm',
    coldMs: (coldFinished - coldStarted).toFixed(2),
    warmMs: (warmFinished - coldFinished).toFixed(2),
    coldDetails: cold.dataset.telemetry.uniqueMatchDetailsFetched,
    warmDetails: warm.dataset.telemetry.uniqueMatchDetailsFetched,
    warmCacheHits: warm.dataset.telemetry.cacheHits,
    sharedDedup: warm.dataset.telemetry.sharedMatchesDeduplicated,
  },
]);
