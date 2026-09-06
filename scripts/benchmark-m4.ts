import type { CompletedMatch, RiotIdentity, StaticData } from '../src/domain/models';
import { loadPlaybooks } from '../src/providers/playbooks';
import { FixtureRiotProvider } from '../src/providers/riot';
import { scanLobby } from '../src/services/scouting';
import { MemoryHistoryStore } from '../src/storage/history';
import { optimizePortfolio } from '../src/strategy/portfolio';
import { scoreCandidate } from '../src/strategy/scoring';
import dataJson from '../public/data/static-set18.json';

const data = dataJson as StaticData;
const now = '2026-09-06T00:00:00.000Z';
const people: RiotIdentity[] = Array.from({ length: 7 }, (_, index) => ({
  puuid: `m4-benchmark-${index}`,
  gameName: `M4 Benchmark ${index + 1}`,
  tagLine: 'UNIT',
  platform: 'EUW1',
  routing: 'EUROPE',
}));
const units = data.champions
  .filter((unit) => unit.boardEligible && unit.shopStatus === 'pool')
  .slice(0, 12);
const matches: CompletedMatch[] = Array.from({ length: 20 }, (_, matchIndex) => {
  const timestamp = new Date(Date.parse(now) - matchIndex * 86_400_000).toISOString();
  return {
    id: `M4_BENCHMARK_${matchIndex}`,
    set: data.version.set,
    setCoreName: 'TFTSet18',
    riotGameVersion: 'fixture-build',
    tftContentPatch: null,
    tftContentPatchSource: 'unavailable',
    dataVersion: 'fixture-v2',
    gameTimestamp: timestamp,
    completedAt: timestamp,
    queueId: null,
    gameType: 'fixture-standard',
    mapId: null,
    endOfGameResult: 'fixture-complete',
    modeSupport: 'supported',
    source: 'fixture:m4-derivation-benchmark',
    participants: people.map((person, opponentIndex) => ({
      puuid: person.puuid,
      placement: ((opponentIndex + matchIndex) % 8) + 1,
      level: 8,
      units: units
        .filter((_, unitIndex) => (unitIndex + opponentIndex + matchIndex) % 3 !== 0)
        .map((unit, unitIndex) => ({
          championId: unit.id,
          items: [],
          stars: unitIndex % 5 === 0 ? 2 : 1,
          rarity: unit.cost,
          rawName: unit.name,
          unresolvedUnit: false,
          unresolvedItems: [],
        })),
      traits: [],
      augmentIds: [],
      unresolvedAugmentIds: [],
    })),
  };
});

const store = new MemoryHistoryStore();
for (const match of matches) await store.putCompletedMatch(match, now);
for (const person of people)
  await store.putRecentIndex({
    puuid: person.puuid,
    routing: person.routing,
    targetCount: 20,
    requestedCount: 20,
    ids: matches.map((match) => match.id),
    exhausted: true,
    fetchedAt: now,
  });

const result = await scanLobby(people, new FixtureRiotProvider([], people), store, {
  set: data.version.set,
  patch: data.version.patch,
  now,
  historyWindow: 20,
  currentUnitIds: data.champions.filter((unit) => unit.boardEligible).map((unit) => unit.id),
  copyEligibleUnitIds: new Set(
    data.champions
      .filter((unit) => unit.boardEligible && unit.shopStatus === 'pool')
      .map((unit) => unit.id),
  ),
  staticSourceVersion: data.version.sourceVersion,
});
const scoringStarted = performance.now();
const portfolio = optimizePortfolio(
  loadPlaybooks(data).map((playbook) =>
    scoreCandidate(playbook, { version: data.version, now, lobby: result }),
  ),
  now,
);
const scoringMs = performance.now() - scoringStarted;

console.table([
  {
    scenario: '7 × 20 warm immutable matches + M4',
    acquisitionMs: result.acquisitionMs.toFixed(2),
    profileAndPressureMs: result.derivationMs.toFixed(2),
    candidateAndPortfolioMs: scoringMs.toFixed(2),
    networkRequests: result.telemetry.requestsAttempted,
    cacheHits: result.telemetry.cacheHits,
    unitSignals: result.unitPressure.filter((unit) => unit.normalizedPressure > 0).length,
    portfolioPlans: portfolio.plans.length,
  },
]);
