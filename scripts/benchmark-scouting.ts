import type { CompletedMatch, RiotIdentity, StaticData } from '../src/domain/models';
import { FixtureRiotProvider, type RiotProvider } from '../src/providers/riot';
import { scanLobby } from '../src/services/scouting';
import { MemoryHistoryStore } from '../src/storage/history';
import dataJson from '../public/data/static-set18.json';

const data = dataJson as StaticData;
const now = '2026-09-06T00:00:00.000Z';

function identities(count: number): RiotIdentity[] {
  return Array.from({ length: count }, (_, index) => ({
    puuid: `benchmark-player-${index}`,
    gameName: `Benchmark ${index + 1}`,
    tagLine: 'M3',
    platform: 'EUW1',
    routing: 'EUROPE',
  }));
}

function matches(players: RiotIdentity[], count: number): CompletedMatch[] {
  const units = data.champions.filter((unit) => unit.boardEligible).slice(0, 6);
  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(Date.parse(now) - index * 86_400_000).toISOString();
    return {
      id: `BENCHMARK_${index + 1}`,
      set: data.version.set,
      setCoreName: 'TFTSet18',
      riotGameVersion: 'Version 16.18.702.1234 (Sep 03 2026/12:00:00) [PUBLIC]',
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
      source: 'fixture:m3-benchmark',
      participants: players.map((identity, playerIndex) => ({
        puuid: identity.puuid,
        riotId: `${identity.gameName}#${identity.tagLine}`,
        placement: ((index + playerIndex) % 8) + 1,
        level: 8,
        units: units.map((unit) => ({
          championId: unit.id,
          items: [],
          stars: 1,
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
}

async function scenario(
  name: string,
  opponents: number,
  target: 10 | 20,
  prepare?: (store: MemoryHistoryStore, source: CompletedMatch[]) => Promise<void>,
) {
  const people = identities(opponents);
  const source = matches(people, target);
  const provider = new FixtureRiotProvider(source, people);
  const store = new MemoryHistoryStore();
  await prepare?.(store, source);
  const result = await scanLobby(people, provider, store, {
    set: data.version.set,
    patch: data.version.patch,
    now,
    historyWindow: target,
    timeoutMs: 5_000,
  });
  return { name, ...result.telemetry, elapsedMs: result.elapsedMs, coverage: result.coverage };
}

const rows = [];
rows.push(await scenario('1 × 10 cold', 1, 10));
rows.push(await scenario('7 × 10 cold', 7, 10));
rows.push(await scenario('7 × 20 cold', 7, 20));
rows.push(
  await scenario('7 × 20 warm immutable matches', 7, 20, async (store, source) => {
    for (const match of source) await store.putCompletedMatch(match, now);
  }),
);

{
  const people = identities(7);
  const source = matches(people, 20);
  const provider = new FixtureRiotProvider(source, people);
  const store = new MemoryHistoryStore();
  await scanLobby(people, provider, store, {
    set: data.version.set,
    patch: data.version.patch,
    now,
    historyWindow: 20,
  });
  const result = await scanLobby(people, provider, store, {
    set: data.version.set,
    patch: data.version.patch,
    now,
    historyWindow: 20,
  });
  rows.push({
    name: '7 × 20 warm profile/index',
    ...result.telemetry,
    elapsedMs: result.elapsedMs,
    coverage: result.coverage,
  });
}

{
  const people = identities(7);
  const source = matches(people.slice(0, 3), 10);
  const seedProvider = new FixtureRiotProvider(source, people);
  const store = new MemoryHistoryStore();
  await scanLobby(people.slice(0, 3), seedProvider, store, {
    set: data.version.set,
    patch: data.version.patch,
    now,
    historyWindow: 10,
  });
  const base = new FixtureRiotProvider([], people);
  const stalled: RiotProvider = {
    ...base,
    connectionStatus: base.connectionStatus.bind(base),
    resolveAccount: base.resolveAccount.bind(base),
    accountByPuuid: base.accountByPuuid.bind(base),
    lobby: base.lobby.bind(base),
    ladderPlayers: base.ladderPlayers.bind(base),
    puuidBySummonerId: base.puuidBySummonerId.bind(base),
    completedMatch: base.completedMatch.bind(base),
    metrics: base.metrics.bind(base),
    recentMatchIds: () => new Promise(() => undefined),
  };
  const result = await scanLobby(people, stalled, store, {
    set: data.version.set,
    patch: data.version.patch,
    now: '2026-09-06T01:00:00.000Z',
    historyWindow: 10,
    timeoutMs: 25,
  });
  rows.push({
    name: '7 × 10 timeout/partial',
    ...result.telemetry,
    elapsedMs: result.elapsedMs,
    coverage: result.coverage,
  });
}

console.table(
  rows.map((row) => ({
    scenario: row.name,
    elapsedMs: row.elapsedMs.toFixed(2),
    requests: row.requestsAttempted,
    cacheHits: row.cacheHits,
    details: row.uniqueMatchDetailsFetched,
    sharedDedup: row.sharedMatchesDeduplicated,
    retries: row.retries,
    limitWaits: row.rateLimitWaits,
    coverage: `${Math.round(row.coverage * 100)}%`,
  })),
);
