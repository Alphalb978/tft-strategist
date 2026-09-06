import { describe, it, expect } from 'vitest';
import { data, playbooks, NOW } from './fixtures';
import { acceptanceMatches, discoveryFor, intelligenceMatches } from './m11Fixtures';
import { deriveIntelligence, OBSERVED_MODEL } from '../strategy/observedIntelligence';
import { buildCompRegistry } from '../services/compRegistry';
import { classifyObservedStyle } from '../strategy/observedStyle';
import { MemoryRepository, defaultSettings } from '../storage/repository';
import { MemoryHistoryStore } from '../storage/history';
import { rebuildCachedIntelligence } from '../services/intelligenceRefresh';
import { collectAggregateMeta } from '../services/metaPipeline';
import { FixtureRiotProvider } from '../providers/riot';
import { createRecommendations, lockPlanSession, loadApplication } from '../services/application';
import { emptyCurrentGame } from '../strategy/currentGame';
import { vi } from 'vitest';

describe('M11 human acceptance integration', () => {
  const matches = acceptanceMatches(),
    discovery = discoveryFor(matches);
  const model = deriveIntelligence(matches, playbooks, discovery, data, NOW);
  it('accepts native ranked records marked unverified while rejecting unsupported modes and queues', () => {
    expect(
      model.champions[playbooks[0].target.units[0].championId].estimate.sample,
    ).toBeGreaterThan(0);
    expect(model.profiles[playbooks[0].id].estimate.sample).toBeGreaterThanOrEqual(40);
    expect(
      deriveIntelligence(
        matches.map((m) => ({ ...m, modeSupport: 'unsupported' })),
        playbooks,
        discovery,
        data,
        NOW,
      ).scope.clientVersions,
    ).toHaveLength(0);
    expect(
      deriveIntelligence(
        matches.map((m) => ({ ...m, queueId: 1090 })),
        playbooks,
        discovery,
        data,
        NOW,
      ).scope.clientVersions,
    ).toHaveLength(0);
  });
  it('joins confidently related actual cluster rows to curated profiles without overlap duplication', () => {
    const foreign = intelligenceMatches();
    const d = discoveryFor(foreign);
    d.clusters[0].relation = {
      ...d.clusters[0].relation,
      state: 'known-family',
      familyId: playbooks[0].id,
      certainty: 0.9,
    };
    d.clusters.push({ ...d.clusters[0], id: 'duplicate-relation' });
    const joined = deriveIntelligence(foreign, playbooks, d, data, NOW);
    expect(joined.profiles[playbooks[0].id].estimate.sample).toBe(64);
    d.clusters.forEach((c) => (c.relation.certainty = 0.3));
    expect(
      deriveIntelligence(foreign, playbooks, d, data, NOW).profiles[playbooks[0].id].estimate
        .sample,
    ).toBe(0);
  });
  it('exposes mature core, flex, holders, packages, augments and conservative style', () => {
    const entries = buildCompRegistry(playbooks, data, discovery, model);
    const p = entries.find(
      (e) =>
        e.sourceKind === 'discovered' && e.playbook.observed?.units.some((u) => u.role === 'flex'),
    )!.playbook;
    expect(p.observed!.items.some((i) => i.ids.length === 3)).toBe(true);
    expect(p.observed!.augments.length).toBeGreaterThan(0);
    expect(classifyObservedStyle(p, data).label).toBe('Level 7 reroll-like');
    expect(classifyObservedStyle({ ...p, observed: undefined }, data).kind).toBe('unavailable');
    expect(classifyObservedStyle(p, data).reasons.join(' ')).not.toMatch(/3-2|4-1/);
  });
  it('upgrades old zero-profile models from existing immutable match IDs and persists the result', async () => {
    const history = new MemoryHistoryStore(),
      repo = new MemoryRepository();
    const identities = matches.map((m) => ({
      puuid: m.participants[0].puuid,
      gameName: 'Fixture',
      tagLine: 'TEST',
      platform: 'EUW1',
      routing: 'EUROPE',
    }));
    const provider = new FixtureRiotProvider(matches, identities);
    const result = await collectAggregateMeta(
      provider,
      history,
      repo,
      data,
      playbooks,
      {
        platform: 'EUW1',
        regionalRoute: 'EUROPE',
        set: 18,
        tiers: ['CHALLENGER'],
        playersPerTier: 40,
        matchesPerPlayer: 1,
        sourceType: 'fixture',
      },
      NOW,
    );
    const next = await rebuildCachedIntelligence(
      result.dataset,
      discovery,
      data,
      playbooks,
      history,
      repo,
      NOW,
    );
    expect(next.intelligence?.derivationVersion).toBe(OBSERVED_MODEL.version);
    expect(next.intelligence?.profiles[playbooks[0].id].estimate.sample).toBeGreaterThan(0);
    expect(
      (await repo.get<{ meta: { intelligence: { fingerprint: string } } }>('meta-current:v1'))!.meta
        .intelligence.fingerprint,
    ).toBe(next.intelligence?.fingerprint);
    expect(await history.getCompletedMatch(matches[0].id)).toEqual(matches[0]);
  });
  it('loads a pre-lock current-game draft and transfers it to the active session', async () => {
    const repo = new MemoryRepository();
    const game = { ...emptyCurrentGame(18, NOW), level: 7 };
    await repo.set('static', data);
    await repo.set('current-game:v1', game);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    try {
      const state = await loadApplication(repo);
      expect(state.currentGame).toEqual(game);
      const session = await lockPlanSession(
        state.portfolio.plans[0].candidate.playbook.id,
        state,
        repo,
        null,
        NOW,
      );
      expect(session.manualState.currentGame).toEqual(game);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(createRecommendations(data, defaultSettings, NOW).portfolio.plans).toHaveLength(3);
  });
});
