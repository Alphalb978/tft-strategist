import { describe, expect, it } from 'vitest';
import type {
  CompletedMatch,
  DiscoveryConfigSnapshot,
  LobbyPressure,
  MatchParticipant,
  Playbook,
} from '../domain/models';
import { familyDefinitionsFingerprint } from '../domain/fingerprint';
import { filterAndSortComps } from '../features/CompLibrary';
import { FixtureRiotProvider } from '../providers/riot';
import { buildCompRegistry } from '../services/compRegistry';
import { refreshMetaDiscovery } from '../services/discoveryRefresh';
import { redactProviderError } from '../services/metaPipeline';
import { MemoryHistoryStore } from '../storage/history';
import { MemoryRepository } from '../storage/repository';
import { compareCanonicalBoards } from '../strategy/boardSimilarity';
import { canonicalizeBoard, canonicalizeFinalBoard } from '../strategy/canonicalBoard';
import {
  compatibleDiscoveryDataset,
  DEFAULT_DISCOVERY_CONFIG,
  deriveDiscoveryDataset,
  discoveryConfigurationFingerprint,
} from '../strategy/compDiscovery';
import { scoreCandidate } from '../strategy/scoring';
import { data, match, NOW, playbooks } from './fixtures';

const championId = (name: string) => data.champions.find((unit) => unit.name === name)!.id;

function participant(ids: string[], placement = 3, stars = 1): MatchParticipant {
  return {
    puuid: 'fixture-player',
    placement,
    level: ids.length,
    units: ids.map((id) => ({
      championId: id,
      items: [],
      stars,
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

function boardIds(playbook: Playbook) {
  return playbook.target.units.map((unit) => unit.championId);
}

function repeatedMatches(
  prefix: string,
  ids: string[],
  count = 3,
  completedAt = NOW,
  placements: number[] = [1, 2, 3, 4, 1, 2, 3, 4],
): CompletedMatch[] {
  return Array.from({ length: count }, (_, matchIndex) => {
    const value = match(
      `${prefix}-${matchIndex}`,
      Array.from({ length: 8 }, (_, playerIndex) => `${prefix}-${matchIndex}-${playerIndex}`),
    );
    value.completedAt = completedAt;
    value.gameTimestamp = completedAt;
    value.participants = value.participants.map((row, playerIndex) => ({
      ...participant(ids, placements[playerIndex % placements.length]),
      puuid: row.puuid,
    }));
    return value;
  });
}

function derive(matches: CompletedMatch[], previous = null, config = DEFAULT_DISCOVERY_CONFIG) {
  return deriveDiscoveryDataset({
    matches,
    families: playbooks,
    data,
    sampleDefinitionFingerprint: 'fixture-m6-sample',
    sourceType: 'fixture',
    source: 'fixture:synthetic-discovery',
    now: NOW,
    config,
    previous,
  });
}

describe('M6 canonical boards and similarity', () => {
  it('normalizes ordering, separates star evidence, and fingerprints deterministically', () => {
    const ids = boardIds(playbooks[0]);
    const first = canonicalizeFinalBoard(participant(ids, 3, 2), 18, data);
    const reordered = canonicalizeFinalBoard(participant([...ids].reverse(), 6, 2), 18, data);
    expect(first.state).toBe('canonical');
    expect(first.board?.fingerprint).toBe(reordered.board?.fingerprint);
    expect(first.board?.units.every((unit) => unit.ordinaryCopies === 3)).toBe(true);
    expect(first.board?.units.map((unit) => unit.championId)).toEqual(
      [...ids].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('fails closed for unresolved and special/runtime units', () => {
    const unresolved = participant(['unknown-unit']);
    unresolved.units[0].unresolvedUnit = true;
    expect(canonicalizeFinalBoard(unresolved, 18, data)).toMatchObject({
      state: 'invalid',
      board: null,
      unresolvedUnitIds: ['unknown-unit'],
    });
    const special = data.champions.find(
      (unit) => !unit.boardEligible || unit.shopStatus !== 'pool',
    )!;
    expect(canonicalizeFinalBoard(participant([special.id]), 18, data).state).toBe('invalid');
  });

  it('keeps a flex substitution close while core changes and unrelated boards move farther away', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const identical = canonicalizeBoard(base.target, data).board!;
    expect(compareCanonicalBoards(identical, identical).value).toBe(1);
    const flex = structuredClone(base.target);
    flex.units[flex.units.length - 1].championId = championId('Ashe');
    const flexScore = compareCanonicalBoards(identical, canonicalizeBoard(flex, data).board!).value;
    const changed = structuredClone(base.target);
    changed.units = changed.units.map((unit, index) =>
      index < 4
        ? {
            ...unit,
            championId: [
              championId('Ashe'),
              championId('Elise'),
              championId('Caitlyn'),
              championId('Sivir'),
            ][index],
          }
        : unit,
    );
    const changedScore = compareCanonicalBoards(
      identical,
      canonicalizeBoard(changed, data).board!,
    ).value;
    const unrelatedIds = data.champions
      .filter(
        (unit) =>
          unit.boardEligible &&
          unit.shopStatus === 'pool' &&
          !base.target.units.some((boardUnit) => boardUnit.championId === unit.id),
      )
      .slice(0, base.target.units.length)
      .map((unit) => unit.id);
    const unrelated = canonicalizeFinalBoard(participant(unrelatedIds), 18, data).board!;
    expect(flexScore).toBeGreaterThan(0.75);
    expect(changedScore).toBeLessThan(flexScore);
    expect(compareCanonicalBoards(identical, unrelated).value).toBeLessThan(changedScore);
  });
});

describe('M6 indexed density discovery, relations, and lifecycle', () => {
  it('produces stable cluster IDs and leaves tiny structures as explicit noise', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const clustered = repeatedMatches('known', boardIds(base), 1);
    const tinyIds = data.champions
      .filter((unit) => unit.boardEligible && unit.shopStatus === 'pool')
      .slice(-8)
      .map((unit) => unit.id);
    const tiny = repeatedMatches('tiny', tinyIds, 1)[0];
    tiny.participants = tiny.participants.slice(0, 1);
    const first = derive([...clustered, tiny]);
    const second = derive([tiny, ...clustered]);
    expect(first.clusters).toHaveLength(1);
    expect(first.clusters[0].id).toBe(second.clusters[0].id);
    expect(first.clusters[0].relation).toMatchObject({
      state: 'known-family',
      familyId: base.id,
    });
    expect(first.noiseBoards).toBe(1);
  });

  it('extracts an inspectable mature variant diff and makes only the mature candidate eligible', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const omitted = base.target.units.at(-1)!.championId;
    const added = championId('Ashe');
    const variant = boardIds(base).map((id) => (id === omitted ? added : id));
    const mature = derive(repeatedMatches('variant', variant));
    const cluster = mature.clusters[0];
    expect(cluster.relation.state).toBe('variant-candidate');
    expect(cluster.relation.familyId).toBe(base.id);
    expect(cluster.relation.diff?.consistentlyAdded).toContain(added);
    expect(cluster.relation.diff?.consistentlyOmitted).toContain(omitted);
    expect(cluster.lifecycle).toBe('Variant');
    expect(cluster.recommendationEligible).toBe(true);

    const tinyWins = derive(repeatedMatches('tiny-winner', variant, 1, NOW, Array(8).fill(1)));
    expect(tinyWins.clusters[0].stats.wins.raw).toBe(1);
    expect(tinyWins.clusters[0].lifecycle).toBe('Experimental');
    expect(tinyWins.clusters[0].recommendationEligible).toBe(false);
    expect(tinyWins.clusters[0].recommendationGateReasons.join(' ')).toContain('support');
  });

  it('promotes a coherent unknown structure to Emerging without inventing a family name', () => {
    const used = new Set(playbooks.flatMap((entry) => boardIds(entry)));
    const unknown = data.champions
      .filter((unit) => unit.boardEligible && unit.shopStatus === 'pool' && !used.has(unit.id))
      .slice(0, 8)
      .map((unit) => unit.id);
    const result = derive(repeatedMatches('emerging', unknown));
    expect(result.clusters[0].relation.state).toBe('emerging-candidate');
    expect(result.clusters[0].lifecycle).toBe('Emerging');
    const entry = buildCompRegistry(playbooks, data, result).find(
      (value) => value.sourceKind === 'discovered',
    )!;
    expect(entry.playbook.title).toMatch(/Formation$/);
    expect(entry.playbook.naming?.evidence.length).toBeGreaterThan(0);
    expect(entry.recommendationEligible).toBe(true);
    expect(entry.playbook.provenance.status).toBe('measured');
  });

  it('derives mature adoption acceleration from separate recent and prior windows', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const variant = boardIds(base).map((id, index) =>
      index === base.target.units.length - 1 ? championId('Ashe') : id,
    );
    const unrelated = data.champions
      .filter(
        (unit) => unit.boardEligible && unit.shopStatus === 'pool' && !variant.includes(unit.id),
      )
      .slice(0, 8)
      .map((unit) => unit.id);
    const prior = '2026-08-20T21:00:00Z';
    const result = derive([
      ...repeatedMatches('recent', variant, 3, NOW),
      ...repeatedMatches('prior', unrelated, 3, prior),
    ]);
    const cluster = result.clusters.find((value) =>
      value.representative.units.some((u) => u.championId === championId('Ashe')),
    )!;
    expect(cluster.stats.adoption.mature).toBe(true);
    expect(cluster.stats.adoption.delta).toBeGreaterThan(0);
    expect(cluster.stats.adoption.recentBoards).toBe(24);
    expect(cluster.stats.adoption.priorBoards).toBe(24);
  });

  it('records demotion to Stale and retirement after evidence ages out', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const active = derive(repeatedMatches('aging', boardIds(base), 3));
    const stale = deriveDiscoveryDataset({
      matches: [],
      families: playbooks,
      data,
      sampleDefinitionFingerprint: 'fixture-m6-sample',
      sourceType: 'fixture',
      source: 'fixture:synthetic-discovery',
      now: '2026-10-05T21:00:00Z',
      previous: active,
    });
    expect(stale.clusters[0].lifecycle).toBe('Stale');
    expect(stale.clusters[0].transitions.at(-1)).toMatchObject({
      previousState: active.clusters[0].lifecycle,
      newState: 'Stale',
    });
    const retired = deriveDiscoveryDataset({
      matches: [],
      families: playbooks,
      data,
      sampleDefinitionFingerprint: 'fixture-m6-sample',
      sourceType: 'fixture',
      source: 'fixture:synthetic-discovery',
      now: '2026-11-05T21:00:00Z',
      previous: stale,
    });
    expect(retired.clusters[0].lifecycle).toBe('Retired');
  });
});

describe('M6 refresh, registry, recommendation, and safety integration', () => {
  it('invalidates changed static/family/model evidence and retires illegal curated structures', () => {
    const result = derive(repeatedMatches('compatible', boardIds(playbooks[0]), 1));
    const expected = {
      set: data.version.set,
      staticSourceVersion: data.version.sourceVersion,
      familyDefinitionsFingerprint: familyDefinitionsFingerprint(playbooks),
      configurationFingerprint: discoveryConfigurationFingerprint(DEFAULT_DISCOVERY_CONFIG),
    };
    expect(compatibleDiscoveryDataset(result, expected)).toBe(true);
    expect(familyDefinitionsFingerprint([...playbooks].reverse())).toBe(
      expected.familyDefinitionsFingerprint,
    );
    expect(
      compatibleDiscoveryDataset({ ...result, similarityModelVersion: 'changed' }, expected),
    ).toBe(false);
    expect(
      compatibleDiscoveryDataset(result, { ...expected, staticSourceVersion: 'changed' }),
    ).toBe(false);
    const illegal = structuredClone(playbooks[0]);
    illegal.target.units[0].championId = 'out-of-set-unit';
    const registry = buildCompRegistry([illegal], data, null);
    expect(registry[0]).toMatchObject({ lifecycle: 'Retired', recommendationEligible: false });
  });

  it('recomputes derived discovery from immutable cached matches on a warm refresh', async () => {
    const identities = ['cohort-a', 'cohort-b'].map((puuid) => ({
      puuid,
      gameName: puuid,
      tagLine: 'M6',
      platform: 'EUW1',
      routing: 'EUROPE',
    }));
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const variant = boardIds(base).map((id, index) =>
      index === base.target.units.length - 1 ? championId('Ashe') : id,
    );
    const matches = repeatedMatches('cached', variant).map((value) => ({
      ...value,
      participants: value.participants.map((row, index) => ({
        ...row,
        puuid: index % 2 ? 'cohort-b' : 'cohort-a',
      })),
    }));
    const provider = new FixtureRiotProvider(matches, identities);
    const history = new MemoryHistoryStore();
    const repository = new MemoryRepository();
    const sample = {
      platform: 'EUW1',
      regionalRoute: 'EUROPE',
      tiers: ['CHALLENGER' as const],
      playersPerTier: 2,
      matchesPerPlayer: 3,
      set: 18,
    };
    const cold = await refreshMetaDiscovery(
      provider,
      history,
      repository,
      data,
      playbooks,
      sample,
      NOW,
    );
    const changedConfig: DiscoveryConfigSnapshot = {
      ...DEFAULT_DISCOVERY_CONFIG,
      neighborhoodSimilarity: 0.79,
    };
    await repository.set('comp-discovery', {
      ...cold.discovery,
      configurationFingerprint: 'incompatible-legacy-model',
      clusters: [
        ...cold.discovery.clusters,
        { ...cold.discovery.clusters[0], id: 'legacy-cluster-that-must-not-be-carried' },
      ],
    });
    const warm = await refreshMetaDiscovery(
      provider,
      history,
      repository,
      data,
      playbooks,
      sample,
      NOW,
      changedConfig,
    );
    expect(cold.meta.telemetry.uniqueMatchDetailsFetched).toBe(3);
    expect(warm.meta.telemetry.uniqueMatchDetailsFetched).toBe(0);
    expect(warm.meta.telemetry.cacheHits).toBe(3);
    expect(warm.discovery.configurationFingerprint).not.toBe(
      cold.discovery.configurationFingerprint,
    );
    expect(warm.discovery.clusters.some((cluster) => cluster.id.startsWith('legacy-'))).toBe(false);
    expect(await repository.get('comp-discovery')).toMatchObject({
      derivationFingerprint: warm.discovery.derivationFingerprint,
    });
  });

  it('keeps M4 lobby pressure independent for an eligible discovered candidate', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const variant = boardIds(base).map((id, index) =>
      index === base.target.units.length - 1 ? championId('Ashe') : id,
    );
    const discovery = derive(repeatedMatches('recommendable', variant));
    const candidate = buildCompRegistry(playbooks, data, discovery).find(
      (entry) => entry.sourceKind === 'discovered',
    )!.playbook;
    const withoutLobby = scoreCandidate(candidate, {
      version: data.version,
      now: NOW,
      discovery,
    });
    const lobby: LobbyPressure = {
      state: 'complete',
      expectedOpponents: 7,
      requestedOpponents: 7,
      resolvedOpponents: 7,
      profilesCompleted: 7,
      profiles: Array(7).fill({}),
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
      unitPressure: candidate.target.units.map((unit) => ({
        championId: unit.championId,
        opponentsWithEvidence: 7,
        equivalentHistoricalUsers: 7,
        recentSpikeEquivalentUsers: 0,
        historicalCopyEquivalentUsers: 7,
        totalEquivalentUsers: 7,
        normalizedPressure: 1,
        evidenceCoverage: 1,
        sourceOpponents: [],
      })),
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
    const pressured = scoreCandidate(candidate, {
      version: data.version,
      now: NOW,
      discovery,
      lobby,
    });
    expect(pressured.components.find((item) => item.key === 'meta')?.input).toBe(
      withoutLobby.components.find((item) => item.key === 'meta')?.input,
    );
    expect(pressured.components.find((item) => item.key === 'lobby')?.input).not.toBeNull();
    expect(pressured.score).toBeLessThan(withoutLobby.score);
  });

  it('filters curated and lifecycle states and redacts credentials from persisted errors', () => {
    const base = playbooks.find((entry) => entry.id === 'adaptor-reroll')!;
    const variant = boardIds(base).map((id, index) =>
      index === base.target.units.length - 1 ? championId('Ashe') : id,
    );
    const discovery = derive(repeatedMatches('filters', variant));
    const registry = buildCompRegistry(playbooks, data, discovery);
    const library = registry.map((entry) => entry.playbook);
    const query = { search: '', style: 'all', sort: 'name' as const };
    expect(
      filterAndSortComps(library, data, null, { ...query, evidence: 'Curated' }, registry),
    ).toHaveLength(playbooks.length);
    expect(
      filterAndSortComps(library, data, null, { ...query, evidence: 'Variant' }, registry),
    ).toHaveLength(1);
    const secret = 'RGAPI-12345678-secret-value';
    expect(redactProviderError(new Error(`X-Riot-Token: ${secret}`))).not.toContain(secret);
  });
});
