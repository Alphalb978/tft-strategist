import { describe, expect, it, vi } from 'vitest';
import type {
  AggregateMetaDataset,
  FamilyMetaStats,
  LobbyPressure,
  MatchParticipant,
  MetaObservation,
  RiotIdentity,
} from '../domain/models';
import { filterAndSortComps } from '../features/CompLibrary';
import { FixtureRiotProvider } from '../providers/riot';
import { collectAggregateMeta, familyDefinitionsFingerprint } from '../services/metaPipeline';
import { MemoryHistoryStore } from '../storage/history';
import { MemoryRepository } from '../storage/repository';
import { classifyFinalBoard, COMP_CLASSIFIER } from '../strategy/compClassifier';
import {
  compatibleMetaDataset,
  deriveFamilyStatistics,
  META_STATISTICS,
} from '../strategy/metaStatistics';
import { scoreCandidate } from '../strategy/scoring';
import { validatePlaybook } from '../rules/validation';
import { data, match, NOW, playbooks } from './fixtures';

const participant = (ids: string[], placement = 1): MatchParticipant => ({
  puuid: 'fixture-player',
  placement,
  level: ids.length,
  units: ids.map((championId) => ({
    championId,
    items: [],
    stars: 1,
    rarity: null,
    rawName: null,
    unresolvedUnit: false,
    unresolvedItems: [],
  })),
  traits: [],
  augmentIds: [],
  unresolvedAugmentIds: [],
});

const observation = (
  familyIndex: number,
  index: number,
  placement: number,
  completedAt = NOW,
): MetaObservation => {
  const playbook = playbooks[familyIndex];
  return {
    matchId: `m-${familyIndex}-${Math.floor(index / 8)}`,
    puuid: `p-${familyIndex}-${index}`,
    completedAt,
    placement,
    classification: classifyFinalBoard(
      participant(
        playbook.target.units.map((unit) => unit.championId),
        placement,
      ),
      playbooks,
      data,
    ),
  };
};

function dataset(stats: FamilyMetaStats[]): AggregateMetaDataset {
  const familyFingerprint = familyDefinitionsFingerprint(playbooks);
  return {
    id: 'fixture-meta',
    schemaVersion: 1,
    set: 18,
    state: 'complete',
    sourceType: 'fixture',
    source: 'fixture',
    platform: 'FIXTURE1',
    regionalRoute: 'FIXTURE',
    rankCohort: ['CHALLENGER'],
    collectedAt: NOW,
    windowStart: NOW,
    windowEnd: NOW,
    cohortPlayersConsidered: 2,
    uniqueCohortPlayers: 2,
    uniqueParticipants: 80,
    discoveredMatchIds: 10,
    fetchedMatchPayloads: 10,
    currentSetMatches: 10,
    uniqueMatches: 10,
    currentSetBoards: 80,
    classifiedBoards: 80,
    ambiguousBoards: 0,
    unclassifiedBoards: 0,
    coverage: 1,
    observations: [],
    familyStats: stats,
    classifierVersion: COMP_CLASSIFIER.version,
    statisticsVersion: META_STATISTICS.version,
    familyDefinitionsFingerprint: familyFingerprint,
    staticSourceVersion: data.version.sourceVersion,
    sampleDefinitionFingerprint: 'fixture-sample',
    derivationFingerprint: 'fixture-derivation',
    patchRelevance: 'unavailable',
    telemetry: {
      requestsAttempted: 0,
      cacheHits: 0,
      retries: 0,
      rateLimitWaits: 0,
      rateLimitWaitMs: 0,
      uniqueMatchDetailsFetched: 0,
      sharedMatchesDeduplicated: 0,
    },
    errors: [],
  };
}

describe('M5 verified comp definitions and retrospective classifier', () => {
  it('ships at least twelve distinct legal source-backed families', () => {
    expect(playbooks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(playbooks.map((playbook) => playbook.family.id)).size).toBe(playbooks.length);
    for (const playbook of playbooks) {
      expect(playbook.provenance.source).toMatch(/^https:\/\//);
      expect(
        validatePlaybook(playbook, data).filter((issue) => issue.severity === 'error'),
      ).toEqual([]);
    }
  });

  it('classifies a clear board and exposes deterministic score, margin, and version', () => {
    const target = playbooks.find((playbook) => playbook.id === 'blackthorn-sprykin')!;
    const result = classifyFinalBoard(
      participant(target.target.units.map((unit) => unit.championId)),
      playbooks,
      data,
    );
    expect(result).toMatchObject({
      state: 'classified',
      familyId: target.family.id,
      classifierVersion: COMP_CLASSIFIER.version,
      score: 1,
    });
    expect(result.margin).toBeGreaterThanOrEqual(COMP_CLASSIFIER.ambiguityMargin);
  });

  it('keeps common, partial, and unrelated boards ambiguous or unclassified', () => {
    const consuming = playbooks.find((playbook) => playbook.id === 'consuming-flora')!;
    const blackthorn = playbooks.find((playbook) => playbook.id === 'blackthorn-sprykin')!;
    const common = consuming.target.units
      .map((unit) => unit.championId)
      .filter(
        (id) =>
          blackthorn.target.units.some((unit) => unit.championId === id) &&
          id !== data.champions.find((unit) => unit.name === 'Rammus')!.id,
      );
    expect(classifyFinalBoard(participant(common), playbooks, data).state).toBe('ambiguous');
    expect(classifyFinalBoard(participant([]), playbooks, data).state).toBe('unclassified');
    const partial = [...consuming.family.core, consuming.target.units[0].championId];
    expect(['classified', 'ambiguous', 'unclassified']).toContain(
      classifyFinalBoard(participant(partial), playbooks, data).state,
    );
  });
});

describe('M5 measured statistics and calibration', () => {
  it('derives placement, top-four, win, bot-four, weighting, uncertainty, and shrinkage', () => {
    const rows = Array.from({ length: 40 }, (_, index) => observation(0, index, (index % 8) + 1));
    const stat = deriveFamilyStatistics(rows, playbooks, NOW).find(
      (value) => value.familyId === playbooks[0].family.id,
    )!;
    expect(stat.games).toBe(40);
    expect(stat.averagePlacement).toBe(4.5);
    expect(stat.topFour.raw).toBe(0.5);
    expect(stat.wins.raw).toBe(0.125);
    expect(stat.botFour.raw).toBe(0.5);
    expect(stat.topFour.lower).toBeLessThan(stat.topFour.raw);
    expect(stat.topFour.upper).toBeGreaterThan(stat.topFour.raw);
    expect(stat.effectiveSample).toBeCloseTo(40, 3);
    expect(stat.placementCounts['1']).toBe(5);
  });

  it('does not let one lucky win become eligible or dominate mature evidence', () => {
    const mature = Array.from({ length: 40 }, (_, index) =>
      observation(0, index, index % 2 ? 3 : 4),
    );
    const lucky = [observation(1, 0, 1)];
    const stats = deriveFamilyStatistics([...mature, ...lucky], playbooks, NOW);
    const matureStat = stats.find((stat) => stat.familyId === playbooks[0].family.id)!;
    const luckyStat = stats.find((stat) => stat.familyId === playbooks[1].family.id)!;
    expect(luckyStat.wins.raw).toBe(1);
    expect(luckyStat.wins.shrunk).toBeLessThan(0.2);
    expect(luckyStat.quality).toBe('insufficient');
    expect(matureStat.measuredStrength).toBeGreaterThan(luckyStat.measuredStrength);
  });

  it('measured strength reorders equal candidates while M4 lobby pressure remains independent', () => {
    const first = structuredClone(playbooks[0]);
    const second = structuredClone(playbooks[1]);
    second.features.values = { ...first.features.values };
    const rows = [
      ...Array.from({ length: 40 }, (_, index) => observation(0, index, index % 2 ? 2 : 3)),
      ...Array.from({ length: 40 }, (_, index) => observation(1, index, index % 2 ? 5 : 6)),
    ];
    const meta = dataset(deriveFamilyStatistics(rows, playbooks, NOW));
    const context = { version: data.version, now: NOW, meta };
    const strong = scoreCandidate(first, context);
    const weak = scoreCandidate(second, context);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.components.find((component) => component.key === 'meta')?.status).toBe('fixture');
    const core = first.family.core[0];
    const lobby: LobbyPressure = {
      state: 'complete',
      expectedOpponents: 7,
      requestedOpponents: 7,
      resolvedOpponents: 7,
      profilesCompleted: 7,
      profiles: Array.from({ length: 7 }, () => ({})) as LobbyPressure['profiles'],
      unitPressureVersion: 'm4-unit-pressure-v1',
      coverage: 1,
      relevantGamesAvailable: 140,
      relevantGamesTarget: 140,
      freshProfiles: 7,
      cachedProfiles: 0,
      acquisitionMs: 0,
      derivationMs: 0,
      elapsedMs: 0,
      fetchedAt: NOW,
      errors: [],
      unitPressure: [
        {
          championId: core,
          opponentsWithEvidence: 7,
          equivalentHistoricalUsers: 7,
          recentSpikeEquivalentUsers: 0,
          historicalCopyEquivalentUsers: 7,
          totalEquivalentUsers: 7,
          normalizedPressure: 1,
          evidenceCoverage: 1,
          sourceOpponents: [],
        },
      ],
      telemetry: {
        requestsAttempted: 0,
        cacheHits: 0,
        retries: 0,
        rateLimitWaits: 0,
        rateLimitWaitMs: 0,
        uniqueMatchDetailsFetched: 0,
        sharedMatchesDeduplicated: 0,
      },
    };
    const pressured = scoreCandidate(first, { ...context, lobby });
    expect(pressured.components.find((component) => component.key === 'meta')?.input).toBe(
      strong.components.find((component) => component.key === 'meta')?.input,
    );
    expect(pressured.score).toBeLessThan(strong.score);
  });

  it('invalidates incompatible derived evidence fingerprints', () => {
    const value = dataset([]);
    const expected = {
      classifierVersion: COMP_CLASSIFIER.version,
      statisticsVersion: META_STATISTICS.version,
      familyDefinitionsFingerprint: familyDefinitionsFingerprint(playbooks),
      staticSourceVersion: data.version.sourceVersion,
    };
    expect(compatibleMetaDataset(value, expected)).toBe(true);
    expect(compatibleMetaDataset({ ...value, classifierVersion: 'changed' }, expected)).toBe(false);
    expect(
      compatibleMetaDataset({ ...value, familyDefinitionsFingerprint: 'changed' }, expected),
    ).toBe(false);
  });
});

describe('M5 bounded acquisition and Comp Library', () => {
  it('returns explicit unavailable and partial aggregate states', async () => {
    const empty = await collectAggregateMeta(
      new FixtureRiotProvider([], []),
      new MemoryHistoryStore(),
      new MemoryRepository(),
      data,
      playbooks,
      {
        platform: 'EUW1',
        regionalRoute: 'EUROPE',
        tiers: ['CHALLENGER'],
        playersPerTier: 1,
        matchesPerPlayer: 1,
        set: 18,
      },
      NOW,
    );
    expect(empty.dataset.state).toBe('unavailable');

    const identities: RiotIdentity[] = ['a', 'b'].map((puuid) => ({
      puuid,
      gameName: puuid,
      tagLine: 'M5',
      platform: 'EUW1',
      routing: 'EUROPE',
    }));
    const provider = new FixtureRiotProvider([match('partial', ['a'])], identities);
    const recent = provider.recentMatchIds.bind(provider);
    provider.recentMatchIds = async (puuid, start, count) => {
      if (puuid === 'b') throw new Error('fixture partial');
      return recent(puuid, start, count);
    };
    const partial = await collectAggregateMeta(
      provider,
      new MemoryHistoryStore(),
      new MemoryRepository(),
      data,
      playbooks,
      {
        platform: 'EUW1',
        regionalRoute: 'EUROPE',
        tiers: ['CHALLENGER'],
        playersPerTier: 2,
        matchesPerPlayer: 1,
        set: 18,
      },
      NOW,
    );
    expect(partial.dataset.state).toBe('partial');
    expect(partial.dataset.currentSetBoards).toBe(1);
    expect(partial.dataset.errors).toHaveLength(1);
  });

  it('deduplicates shared matches, filters current set, persists, and warm-reruns from cache', async () => {
    const identities: RiotIdentity[] = ['a', 'b'].map((puuid) => ({
      puuid,
      gameName: puuid,
      tagLine: 'M5',
      platform: 'EUW1',
      routing: 'EUROPE',
    }));
    const current = match('shared-current', ['a', 'b']);
    const stale = match('old-set', ['a', 'b'], null, 17);
    const provider = new FixtureRiotProvider([current, stale], identities);
    const legacyIdentifierLookup = vi.spyOn(provider, 'puuidBySummonerId');
    const history = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const config = {
      platform: 'EUW1',
      regionalRoute: 'EUROPE',
      tiers: ['CHALLENGER' as const],
      playersPerTier: 2,
      matchesPerPlayer: 2,
      set: 18,
    };
    const cold = await collectAggregateMeta(
      provider,
      history,
      repository,
      data,
      playbooks,
      config,
      NOW,
    );
    expect(cold.dataset.uniqueMatches).toBe(1);
    expect(legacyIdentifierLookup).not.toHaveBeenCalled();
    expect(cold.dataset.telemetry.sharedMatchesDeduplicated).toBe(2);
    expect(cold.dataset.telemetry.uniqueMatchDetailsFetched).toBe(2);
    expect(cold.observations).toHaveLength(2);
    expect(await repository.get('aggregate-meta')).toBeTruthy();
    const warm = await collectAggregateMeta(
      provider,
      history,
      repository,
      data,
      playbooks,
      config,
      NOW,
    );
    expect(warm.dataset.telemetry.cacheHits).toBe(2);
    expect(warm.dataset.telemetry.uniqueMatchDetailsFetched).toBe(0);
  });

  it('searches comp, unit, and trait; filters styles; and sorts missing metrics last', () => {
    const base = { search: 'elder dragon', evidence: 'all', style: 'all', sort: 'name' as const };
    expect(
      filterAndSortComps(playbooks, data, null, base).some((p) => p.id === 'apex-predator'),
    ).toBe(true);
    const style = filterAndSortComps(playbooks, data, null, {
      ...base,
      search: '',
      style: 'Fast 9',
    });
    expect(style.length).toBeGreaterThan(0);
    expect(style.every((playbook) => playbook.features.style.includes('Fast 9'))).toBe(true);
    const oneStat = deriveFamilyStatistics(
      Array.from({ length: 24 }, (_, index) => observation(0, index, (index % 4) + 1)),
      playbooks,
      NOW,
    );
    expect(
      filterAndSortComps(playbooks, data, dataset(oneStat), {
        ...base,
        search: '',
        sort: 'sample',
      })[0].id,
    ).toBe(playbooks[0].id);
  });
});
