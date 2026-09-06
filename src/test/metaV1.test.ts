import { describe, it, expect, vi } from 'vitest';
import { data, playbooks, match, NOW } from './fixtures';
import { FixtureRiotProvider, RiotProviderError } from '../providers/riot';
import { MemoryHistoryStore } from '../storage/history';
import { MemoryRepository } from '../storage/repository';
import {
  collectAggregateMeta,
  META_COHORTS,
  metaScopeKey,
  type MetaSampleConfig,
} from '../services/metaPipeline';
import { refreshMetaDiscovery } from '../services/discoveryRefresh';
import { familyRepresentation, familyTrend } from '../strategy/metaCatalog';
import { scoreCandidate } from '../strategy/scoring';
import { createRecommendations } from '../services/application';
import { defaultSettings } from '../storage/repository';
import { buildCompRegistry } from '../services/compRegistry';
import observed from '../../data/fixtures/m10-observed-fourteenth-comp.json';
import type { DiscoveryCluster } from '../domain/models';
import human from '../../data/fixtures/set18-teamplanner-human.json';
import { candidatePlannerCode, decodePlannerCode } from '../rules/teamPlanner';
const config: MetaSampleConfig = {
  platform: 'EUW1',
  regionalRoute: 'EUROPE',
  tiers: ['CHALLENGER'],
  playersPerTier: 5,
  matchesPerPlayer: 20,
  set: 18,
  windowDays: 7,
  mode: 'standard',
  sourceType: 'fixture',
};
const identities = ['a', 'b'].map((puuid) => ({
  puuid,
  gameName: puuid,
  tagLine: 'TEST',
  platform: 'EUW1',
  routing: 'EUROPE',
}));
function setup(count = 20) {
  const matches = Array.from({ length: count }, (_, i) => ({
    ...match(`EUW1-${i}`, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
    queueId: 1100,
  }));
  const provider = new FixtureRiotProvider(matches, identities),
    history = new MemoryHistoryStore(),
    repo = new MemoryRepository();
  return {
    matches,
    provider,
    history,
    repo,
    run: (c = config, options = {}) =>
      refreshMetaDiscovery(provider, history, repo, data, playbooks, c, NOW, undefined, options),
  };
}
describe('Current Meta V1', () => {
  it('acquires unique ladder players across documented upper cohorts with explicit scope', async () => {
    const s = setup();
    const ladder = vi.spyOn(s.provider, 'ladderPlayers');
    const result = await s.run({ ...config, tiers: [...META_COHORTS['Master+']] });
    expect(ladder.mock.calls.map((c) => c[0])).toEqual(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
    expect(result.meta.uniqueCohortPlayers).toBe(2);
    expect(result.meta.scope?.population).toContain('co-participant ranks unverified');
    expect(result.meta.platform).toBe('EUW1');
  });
  it('separates region, cohort and provider memberships, rejects false routes', async () => {
    expect(metaScopeKey(config)).not.toBe(
      metaScopeKey({ ...config, platform: 'NA1', regionalRoute: 'AMERICAS' }),
    );
    expect(metaScopeKey(config)).not.toBe(metaScopeKey({ ...config, tiers: ['MASTER'] }));
    await expect(setup().run({ ...config, platform: 'NA1' })).rejects.toThrow('Unsupported');
  });
  it('reuses immutable details and match indexes; cumulative membership survives absent recent IDs', async () => {
    const s = setup();
    const details = vi.spyOn(s.provider, 'completedMatch'),
      indexes = vi.spyOn(s.provider, 'recentMatchIds');
    const cold = await s.run();
    expect(cold.meta.telemetry.sharedMatchesDeduplicated).toBe(20);
    const warm = await s.run();
    expect(details).toHaveBeenCalledTimes(20);
    expect(indexes).toHaveBeenCalledTimes(2);
    expect(warm.meta.telemetry.cacheHits).toBe(20);
    vi.spyOn(s.provider, 'recentMatchIds').mockResolvedValue([]);
    const later = await refreshMetaDiscovery(
      s.provider,
      s.history,
      s.repo,
      data,
      playbooks,
      config,
      '2026-09-05T22:00:00Z',
    );
    expect(later.meta.uniqueMatches).toBe(20);
  });
  it('checkpoints pending acquisition and respects bounded concurrency', async () => {
    const s = setup(40);
    let active = 0,
      max = 0;
    const original = s.provider.completedMatch.bind(s.provider);
    vi.spyOn(s.provider, 'completedMatch').mockImplementation(async (id) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 1));
      const value = await original(id);
      active--;
      return value;
    });
    const first = await s.run({ ...config, mode: 'quick', matchesPerPlayer: 40 });
    expect(first.meta.uniqueMatches).toBe(20);
    expect(first.meta.scope?.pendingMatches).toBe(20);
    expect(first.meta.state).toBe('partial');
    expect(max).toBeLessThanOrEqual(2);
    const next = await s.run({ ...config, mode: 'quick', matchesPerPlayer: 40 });
    expect(next.meta.uniqueMatches).toBe(40);
  });
  it('retains atomic cached evidence after authentication failure and cancellation', async () => {
    const s = setup();
    await s.run();
    const before = await s.repo.get('meta-current:v1');
    vi.spyOn(s.provider, 'ladderPlayers').mockRejectedValue(new RiotProviderError('auth'));
    await expect(s.run()).rejects.toMatchObject({ code: 'auth' });
    expect(await s.repo.get('meta-current:v1')).toEqual(before);
    const controller = new AbortController();
    controller.abort();
    await expect(s.run(config, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(await s.repo.get('meta-current:v1')).toEqual(before);
  });
  it('cancels during acquisition without publishing while preserving fetched immutable matches', async () => {
    const s = setup();
    const controller = new AbortController();
    await expect(
      s.run(config, {
        signal: controller.signal,
        onProgress: (p: { newMatches: number }) => {
          if (p.newMatches >= 2) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(await s.repo.get('meta-current:v1')).toBeNull();
    expect(await s.history.getCompletedMatch('EUW1-0')).not.toBeNull();
    expect((await s.run()).meta.uniqueMatches).toBe(20);
  });
  it('accepts partial provider results but never replaces cache with no eligible evidence', async () => {
    const s = setup();
    vi.spyOn(s.provider, 'completedMatch').mockImplementation(async (id) => {
      if (id === 'EUW1-0') throw new RiotProviderError('rate-limited', 429, true);
      return s.matches.find((m) => m.id === id)!;
    });
    expect((await s.run()).meta.state).toBe('partial');
    const empty = setup(0);
    await empty.repo.set('meta-current:v1', { preserved: true });
    await expect(empty.run()).rejects.toThrow('No eligible');
    expect(await empty.repo.get('meta-current:v1')).toEqual({ preserved: true });
  });
  it('filters exact region acquisition, current set, ranked queue and rolling time window', async () => {
    const s = setup(4);
    s.matches[0].completedAt = '2026-09-01T12:00:00Z';
    s.matches[1].queueId = 1090;
    s.matches[2].set = 17;
    expect((await s.run({ ...config, windowDays: 1 })).meta.uniqueMatches).toBe(1);
    expect((await s.run({ ...config, windowDays: 7 })).meta.uniqueMatches).toBe(2);
  });
  it('defines popularity denominator separately from raw all-board frequency and modeled rates', async () => {
    const s = setup();
    s.matches.forEach((m) => (m.participants[7].units = []));
    const { meta } = await s.run();
    const stat = meta.familyStats[0];
    expect(meta.currentSetBoards).toBe(160);
    expect(meta.classifiedBoards).toBe(140);
    expect(familyRepresentation(stat, meta)).toMatchObject({
      rate: 1,
      denominator: 40,
      coverage: 0.875,
    });
    expect(stat.rawFrequency).toBe(1);
    expect(stat.topFour.raw).toBe(1);
    expect(meta.discoveryFamilyStats?.[0].rawFrequency).toBe(0.875);
    expect(meta.discoveryFamilyStats?.[0].topFour.raw).toBe(4 / 7);
    // Both verified fixture members always finish Top 4, including the cohort prior.
    expect(stat.topFour.shrunk).toBeLessThanOrEqual(stat.topFour.raw);
    expect(meta.discoveryFamilyStats?.[0].topFour.shrunk).not.toBe(
      meta.discoveryFamilyStats?.[0].topFour.raw,
    );
  });
  it('retains the twenty-observation quality gate and keeps popularity out of M4 penalties', async () => {
    const tiny = await setup(1).run();
    expect(tiny.meta.familyStats[0].quality).toBe('insufficient');
    const mature = await setup().run();
    expect(mature.meta.familyStats[0].quality).toBe('eligible');
    const context = { version: data.version, now: NOW, personalWeight: 0.05, meta: mature.meta };
    const base = scoreCandidate(playbooks[0], context);
    const altered = structuredClone(mature.meta);
    altered.familyStats.forEach((s) => {
      s.rawFrequency = 0.99;
      s.weightedFrequency = 0.99;
    });
    expect(scoreCandidate(playbooks[0], { ...context, meta: altered })).toEqual(base);
  });
  it('invalidates derived classification semantics without refetching immutable matches', async () => {
    const s = setup();
    await s.run();
    const changed = structuredClone(data);
    changed.version.sourceVersion += '-rederived';
    const detail = vi.spyOn(s.provider, 'completedMatch');
    const next = await collectAggregateMeta(
      s.provider,
      s.history,
      s.repo,
      changed,
      playbooks,
      config,
      NOW,
    );
    expect(detail).not.toHaveBeenCalled();
    expect(next.dataset.staticSourceVersion).toBe(changed.version.sourceVersion);
  });
  it('requires compatible complete windows and sufficient samples before reporting a trend', async () => {
    const { meta } = await setup().run();
    expect(familyTrend(meta.familyStats[0].familyId, meta)).toBeNull();
    const rows = structuredClone(meta.observations);
    meta.observations = [
      ...rows.map((r) => ({ ...r, completedAt: '2026-09-01T12:00:00Z' })),
      ...rows,
    ];
    expect(familyTrend(meta.familyStats[0].familyId, meta)?.direction).toBe('Stable');
    meta.state = 'partial';
    expect(familyTrend(meta.familyStats[0].familyId, meta)).toBeNull();
  });
  it('preserves legacy M10 keys and history while adding versioned meta storage', async () => {
    const s = setup();
    await s.repo.set('aggregate-meta', { legacy: true });
    await s.repo.set('selection', { preserve: true });
    const m = match('unrelated-history');
    await s.history.putCompletedMatch(m, NOW);
    await s.run();
    expect(await s.repo.get('aggregate-meta')).toEqual({ legacy: true });
    expect(await s.repo.get('selection')).toEqual({ preserve: true });
    expect(await s.history.getCompletedMatch(m.id)).toEqual(m);
  });
  it('regresses the human-verified exact ten-slot fixture', () => {
    const board = playbooks.find((p) => p.id === 'adaptor-reroll')!.target;
    expect(candidatePlannerCode(board, data)).toEqual({ ok: true, value: human.code });
    const decoded = decodePlannerCode(human.code);
    expect(decoded.ok && decoded.value.map((s) => s.plannerId)).toEqual(human.slots);
  });
  it('explains the exact human-observed fourteenth comp as a six-match experimental variant', async () => {
    const { discovery } = await setup().run();
    discovery.clusters = [observed.cluster as DiscoveryCluster];
    const registry = buildCompRegistry(playbooks, data, discovery);
    expect(registry).toHaveLength(14);
    expect(registry.find((r) => r.clusterId === 'cluster-0c0bd2fa')).toMatchObject({
      sourceKind: 'discovered',
      lifecycle: 'Experimental',
      support: 6,
      recommendationEligible: false,
      parentFamilyId: 'flora-executioners',
    });
  });
  it('expires cached rolling evidence for recommendations without deleting its observations', async () => {
    const result = await setup().run();
    const current = createRecommendations(
      data,
      defaultSettings,
      '2026-09-14T21:00:00Z',
      result.meta,
      result.discovery,
    );
    expect(current.meta?.familyStats.every((s) => s.quality === 'insufficient')).toBe(true);
    expect(current.meta?.observations).toEqual(result.meta.observations);
    expect(current.discovery?.clusters.every((c) => !c.recommendationEligible)).toBe(true);
  });
  it('does not blend matches from a transferred account into another platform scope', async () => {
    const s = setup(3);
    s.matches[1].id = 'EUN1-transfer';
    s.matches[2].completedAt = '2026-08-01T12:00:00Z';
    const result = await s.run({ ...config, windowDays: undefined });
    expect(result.meta.scope?.windowDays).toBe(7);
    expect(result.meta.uniqueMatches).toBe(1);
    expect(result.meta.observations.every((o) => o.matchId === 'EUW1-0')).toBe(true);
  });
  it('does not duplicate curated rows from known discovery clusters', async () => {
    const { discovery } = await setup().run();
    const registry = buildCompRegistry(playbooks, data, discovery);
    expect(new Set(registry.map((r) => r.id)).size).toBe(registry.length);
    expect(registry.filter((r) => r.sourceKind === 'curated')).toHaveLength(13);
  });
});
