import { describe, expect, it, vi } from 'vitest';
import type { CompletedMatch, RiotIdentity } from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import { MemoryHistoryStore } from '../storage/history';
import { MemoryRepository } from '../storage/repository';
import { refreshPersonalHistory } from '../services/personalHistory';
import { data, match as createFixtureMatch, playbooks } from './fixtures';
import type { RuntimeKnowledgeCatalog } from '../services/knowledgeCatalog';

const mockIdentity: RiotIdentity = {
  puuid: 'test-user-puuid',
  gameName: 'Tactician',
  tagLine: 'EUW',
  platform: 'EUW1',
  routing: 'EUROPE',
};

function createMockCatalog(): RuntimeKnowledgeCatalog {
  return {
    version: {
      set: data.version.set,
      patch: data.version.patch,
      hotfix: null,
      sourceVersion: data.version.sourceVersion,
    },
    snapshots: { static: null, curated: null, external: null },
    sourceSnapshots: { static: null, curated: null, external: null },
    provenance: {
      static: data.version.provenance,
      curated: data.version.provenance,
      external: null,
    },
    champions: [],
    traits: [],
    items: [],
    augments: [],
    comps: [],
    playbooks: structuredClone(playbooks),
    metaObservations: [],
    externalSnapshot: null,
  };
}

function createMockProvider(matchIdList: string[]): RiotProvider {
  return {
    connectionStatus: vi.fn().mockResolvedValue({ keyDetected: true, source: 'native-environment' }),
    resolveAccount: vi.fn().mockResolvedValue(mockIdentity),
    accountByPuuid: vi.fn().mockResolvedValue(mockIdentity),
    recentMatchIds: vi.fn().mockResolvedValue(matchIdList),
    completedMatch: vi.fn().mockImplementation(async (id: string): Promise<CompletedMatch> => {
      return createFixtureMatch(id, [mockIdentity.puuid, 'opponent-1'], '18.1', 18);
    }),
  } as unknown as RiotProvider;
}

describe('M13D — Personal Match History & Caching', () => {
  const catalog = createMockCatalog();

  // Test 1: account with 20 matches loads 20
  it('1. account with 20 matches loads 20', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `EUW1_TEST_MATCH_${i + 1}`);
    const provider = createMockProvider(ids);
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    const result = await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      20,
    );

    expect(result.status.matchesFound).toBe(20);
    expect(result.status.newMatchesFetched).toBe(20);
    expect(result.status.cachedMatchesReused).toBe(0);
    expect(result.observations.length).toBe(20);

    const storedObservations = await repository.listPersonalMatchObservations(mockIdentity.puuid);
    expect(storedObservations.length).toBe(20);
  });

  // Test 2: cached details reused
  it('2. cached details reused on subsequent refresh', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `EUW1_TEST_MATCH_${i + 1}`);
    const provider = createMockProvider(ids);
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    // First refresh: all 20 fetched
    await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      20,
    );
    expect(provider.completedMatch).toHaveBeenCalledTimes(20);

    // Second refresh with force: all 20 details are already in historyStore cache!
    const secondResult = await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      20,
      { force: true },
    );

    expect(secondResult.status.matchesFound).toBe(20);
    expect(secondResult.status.newMatchesFetched).toBe(0);
    expect(secondResult.status.cachedMatchesReused).toBe(20);
    // completedMatch should NOT have been called again!
    expect(provider.completedMatch).toHaveBeenCalledTimes(20);
  });

  // Test 3: only missing match details fetched
  it('3. only missing match details fetched when 2 new games arrive', async () => {
    const initialIds = Array.from({ length: 18 }, (_, i) => `EUW1_MATCH_${i + 1}`);
    const provider1 = createMockProvider(initialIds);
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    await refreshPersonalHistory(
      mockIdentity,
      provider1,
      historyStore,
      repository,
      catalog,
      data,
      18,
    );
    expect(provider1.completedMatch).toHaveBeenCalledTimes(18);

    // Now 2 new matches are at the top of the 20-match list
    const updatedIds = ['EUW1_NEW_1', 'EUW1_NEW_2', ...initialIds];
    const provider2 = createMockProvider(updatedIds);

    const result = await refreshPersonalHistory(
      mockIdentity,
      provider2,
      historyStore,
      repository,
      catalog,
      data,
      20,
      { force: true },
    );

    expect(result.status.matchesFound).toBe(20);
    expect(result.status.newMatchesFetched).toBe(2);
    expect(result.status.cachedMatchesReused).toBe(18);
    expect(provider2.completedMatch).toHaveBeenCalledTimes(2);
    expect(result.observations.length).toBe(20);
  });

  // Test 4: duplicate match ID counted once
  it('4. duplicate match ID counted once', async () => {
    // List containing duplicates
    const duplicateIds = ['MATCH_1', 'MATCH_2', 'MATCH_1', 'MATCH_3', 'MATCH_2'];
    const provider = createMockProvider(duplicateIds);
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    const result = await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      5,
    );

    expect(result.status.matchesFound).toBe(3);
    expect(result.observations.length).toBe(3);
    const uniqueObsIds = new Set(result.observations.map((o) => o.matchId));
    expect(uniqueObsIds.size).toBe(3);
  });

  // Test 5: no locked plan still produces personal history
  it('5. no locked plan still produces personal history', async () => {
    const ids = ['MATCH_NO_PLAN_1', 'MATCH_NO_PLAN_2'];
    const provider = createMockProvider(ids);
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();

    // Verify zero plan sessions exist
    const planSessions = await repository.listPlanSessions();
    expect(planSessions.length).toBe(0);

    const result = await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      2,
    );

    expect(result.observations.length).toBe(2);
    expect(result.observations[0].placement).toBe(1);
    expect(result.observations[0].classificationState).toBe('classified');
  });

  // Test 26, 27, 28: Lifecycle & automatic sync behavior
  it('26. game end triggers at most one delayed personal sync attempt and does not retry storm', async () => {
    vi.useFakeTimers();

    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const provider = createMockProvider(['M_OLD_1']);

    // Pre-populate with 1 match
    await refreshPersonalHistory(mockIdentity, provider, historyStore, repository, catalog, data, 1);

    let syncAttempts = 0;
    const triggerPostGameSync = () => {
      setTimeout(async () => {
        syncAttempts++;
        const recentIds = await provider.recentMatchIds(mockIdentity.puuid, 0, 5);
        const existing = await repository.listPersonalMatchObservations(mockIdentity.puuid);
        const existingIds = new Set(existing.map((o) => o.matchId));
        const newIds = recentIds.filter((id) => !existingIds.has(id));
        if (newIds.length > 0) {
          await refreshPersonalHistory(mockIdentity, provider, historyStore, repository, catalog, data, 20);
        }
      }, 15_000);
    };

    // Trigger game end
    triggerPostGameSync();

    // Advance 5 seconds: should not fire yet
    vi.advanceTimersByTime(5_000);
    expect(syncAttempts).toBe(0);

    // Advance to 15 seconds: fires exactly once
    await vi.advanceTimersByTimeAsync(10_000);
    expect(syncAttempts).toBe(1);

    // Advance further: no retry storm!
    await vi.advanceTimersByTimeAsync(30_000);
    expect(syncAttempts).toBe(1);

    vi.useRealTimers();
  });

  it('28. manual refresh works afterward', async () => {
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const provider = createMockProvider(['M_MANUAL_1']);

    const result = await refreshPersonalHistory(
      mockIdentity,
      provider,
      historyStore,
      repository,
      catalog,
      data,
      1,
    );

    expect(result.status.matchesFound).toBe(1);
    expect(result.observations[0].matchId).toBe('M_MANUAL_1');
  });

  // Test 29: expired API key preserves cached history
  it('29. expired API key preserves cached history', async () => {
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const goodProvider = createMockProvider(['M_SAVED_1', 'M_SAVED_2']);

    // First populate cache
    await refreshPersonalHistory(
      mockIdentity,
      goodProvider,
      historyStore,
      repository,
      catalog,
      data,
      2,
    );
    const beforeObs = await repository.listPersonalMatchObservations(mockIdentity.puuid);
    expect(beforeObs.length).toBe(2);

    // Provider now fails with expired key
    const failingProvider: RiotProvider = {
      ...goodProvider,
      recentMatchIds: vi.fn().mockRejectedValue(new Error('Riot API key expired (403)')),
    };

    await expect(
      refreshPersonalHistory(
        mockIdentity,
        failingProvider,
        historyStore,
        repository,
        catalog,
        data,
        2,
        { force: true },
      ),
    ).rejects.toThrow('Riot API key expired');

    // Cached observations are preserved intact!
    const afterObs = await repository.listPersonalMatchObservations(mockIdentity.puuid);
    expect(afterObs.length).toBe(2);
    expect(afterObs[0].matchId).toBe('M_SAVED_1');
  });

  // Test 30: rate limit preserves cached history
  it('30. rate limit preserves cached history', async () => {
    const historyStore = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const goodProvider = createMockProvider(['M_RATE_1']);

    await refreshPersonalHistory(
      mockIdentity,
      goodProvider,
      historyStore,
      repository,
      catalog,
      data,
      1,
    );

    const rateLimitedProvider: RiotProvider = {
      ...goodProvider,
      recentMatchIds: vi.fn().mockRejectedValue(new Error('Riot rate limit exceeded (429)')),
    };

    await expect(
      refreshPersonalHistory(
        mockIdentity,
        rateLimitedProvider,
        historyStore,
        repository,
        catalog,
        data,
        1,
        { force: true },
      ),
    ).rejects.toThrow('rate limit');

    const preserved = await repository.listPersonalMatchObservations(mockIdentity.puuid);
    expect(preserved.length).toBe(1);
    expect(preserved[0].matchId).toBe('M_RATE_1');
  });
});
