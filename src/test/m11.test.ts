import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import raw from '../../data/fixtures/cdragon-set18.json';
import { data, NOW, playbooks, provenance } from './fixtures';
import { normalizeCommunityDragon } from '../providers/communityDragon';
import { compileKnowledge, knowledgeDelta, resolveActiveSet } from '../providers/knowledge';
import { deriveIntelligence, friendlyCompName } from '../strategy/observedIntelligence';
import { buildCompRegistry } from '../services/compRegistry';
import {
  createRecommendations,
  rescoreRecommendations,
  type ApplicationState,
} from '../services/application';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import {
  emptyCurrentGame,
  contextualContributions,
  targetGap,
  validateCurrentGame,
} from '../strategy/currentGame';
import { optimizeBoards } from '../strategy/boardOptimizer';
import { validateBoard } from '../rules/validation';
import { scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import {
  intelligenceMatches,
  discoveryFor,
  unknownCore,
  observedItems,
  observedAugment,
} from './m11Fixtures';
import { Home } from '../features/Home';
import { createPlanSession, snapshotIsIntact, updateManualState } from '../services/planSession';
import { deriveFamilyStatistics } from '../strategy/metaStatistics';
import { collectAggregateMeta } from '../services/metaPipeline';
import { FixtureRiotProvider } from '../providers/riot';
import { MemoryHistoryStore } from '../storage/history';
import { reconcileIntelligence } from '../strategy/intelligenceCompatibility';
import type { LobbyPressure } from '../domain/models';
import { hydrateDerived, referenceDerived } from '../storage/derivedCache';

const matches = intelligenceMatches();
const discovery = discoveryFor(matches);
const model = deriveIntelligence(matches, playbooks, discovery, data, NOW);
const registry = buildCompRegistry(playbooks, data, discovery, model);
const discovered = registry.find((e) => e.sourceKind === 'discovered')!;
const baseState = (): ApplicationState => ({
  data,
  ...createRecommendations(data, defaultSettings, NOW),
  settings: defaultSettings,
  assets: {},
  activeSession: null,
  source: 'Bundled snapshot',
  personal: null,
});

describe('M11 patch knowledge compiler', () => {
  it('accepts a same-set balance refresh while marking old guidance stale', () => {
    const next = normalizeCommunityDragon(raw, { ...provenance, patch: '18.2' });
    const result = createRecommendations(next, defaultSettings, NOW);
    expect(result.playbooks.length).toBeGreaterThan(0);
    expect(result.playbooks.every((p) => p.strategy.freshness.state === 'stale')).toBe(true);
    expect(next.version.patchVerified).toBe(false);
  });
  it('accounts for every active structured entity and preserves source mechanics', () => {
    const k = data.knowledge!;
    expect(k.coverage.length).toBe(
      raw.setData[0].champions.length +
        raw.setData[0].traits.length +
        raw.setData[0].items.length +
        raw.setData[0].augments.length,
    );
    expect(k.coverage.every((e) => e.reason && (e.state === 'excluded' || k.entities[e.id]))).toBe(
      true,
    );
    expect(k.entities.DA_18_Xayah.abilityName).toBe('Deadly Plumage');
    expect(k.entities.DA_18_Xayah.stats).toMatchObject({ damage: 45, hp: 450, mana: 50, range: 4 });
    expect(k.entities.DA_18_Xayah.tags.some((t) => t.tag === 'physical')).toBe(true);
    expect(k.entities.DA_18_Xayah.unresolvedTokens.length).toBeGreaterThan(0);
    expect(k.entities.DA_18_Elderwood.breakpoints[0].minimum).toBe(3);
    expect(k.entities[observedAugment].rawDescription?.length).toBeGreaterThan(0);
    // The inspected source has null descriptions for combined items; never fill them from memory.
    for (const id of observedItems) expect(k.entities[id].rawDescription).toBeNull();
  });
  it('ignores fetch timestamps in mechanics fingerprints and identifies only changed entities', () => {
    expect(
      normalizeCommunityDragon(raw, { ...provenance, fetchedAt: '2026-09-06' }).knowledge
        ?.fingerprint,
    ).toBe(data.knowledge?.fingerprint);
    const changed = structuredClone(raw);
    changed.setData[0].champions.find((c) => c.apiName === 'DA_18_Xayah')!.stats.damage! += 1;
    const k = compileKnowledge(changed, data);
    expect(knowledgeDelta(data.knowledge!, k).changed).toEqual(['DA_18_Xayah']);
    expect(k.fingerprint).not.toBe(data.knowledge?.fingerprint);
    expect(normalizeCommunityDragon(raw, { ...provenance, patch: '18.2' }).version.patch).toBe(
      '18.2',
    );
  });
  it('fails closed on ambiguity and new-set isolation', () => {
    expect(() => resolveActiveSet([...raw.setData, ...raw.setData])).toThrow(/ambiguous/);
    expect(() => resolveActiveSet([{ number: 99, mutator: 'TFTSet99' }])).toThrow();
    expect(() =>
      compileKnowledge(raw, { ...data, version: { ...data.version, set: 99 } }),
    ).toThrow();
  });
  it('keeps missing advanced data displayable and unsupported source references explicitly excluded', () => {
    const minimal = structuredClone(raw) as unknown as {
      setData: { champions: Record<string, unknown>[]; items: string[] }[];
    };
    delete minimal.setData[0].champions[0].ability;
    delete minimal.setData[0].champions[0].stats;
    minimal.setData[0].items.push('missing-structured-entity');
    const k = compileKnowledge(minimal, data);
    expect(k.coverage.find((e) => e.id === 'missing-structured-entity')?.state).toBe('excluded');
    expect(k.entities[String(minimal.setData[0].champions[0].apiName)].description).toBeNull();
  });
});
describe('M11 autonomous observed intelligence', () => {
  it('invalidates only profiles depending on changed knowledge entities', () => {
    const untouched = data.champions.find((c) => !unknownCore.includes(c.id))!.id;
    const k = structuredClone(data.knowledge!);
    k.entityFingerprints[untouched] = 'changed';
    k.fingerprint = 'changed-export';
    const next = reconcileIntelligence(model, { ...data, knowledge: k });
    expect(next?.profiles[discovered.id]).toBeDefined();
    k.entityFingerprints[unknownCore[0]] = 'changed-core';
    expect(
      reconcileIntelligence(model, { ...data, knowledge: k })?.profiles[discovered.id],
    ).toBeUndefined();
    expect(
      reconcileIntelligence(model, { ...data, version: { ...data.version, set: 19 } }),
    ).toBeUndefined();
  });
  it('promotes an absent curated structure through evidence and creates a real playable profile', () => {
    expect(unknownCore.length).toBeGreaterThanOrEqual(3);
    expect(
      playbooks.some((p) =>
        unknownCore.every((id) => p.target.units.some((u) => u.championId === id)),
      ),
    ).toBe(false);
    expect(discovered.lifecycle).toBe('Emerging');
    expect(discovered.recommendationEligible).toBe(true);
    expect(discovered.playbook.title).not.toMatch(/cluster|[0-9a-f]{8}/);
    const p = discovered.playbook.observed!;
    expect(
      p.units
        .filter((u) => u.role === 'core')
        .map((u) => u.id)
        .sort(),
    ).toEqual([...unknownCore].sort());
    expect(p.units.find((u) => u.id === unknownCore[0])?.stars['3']).toBe(64);
    expect(p.levels['6']).toBe(64);
    expect(p.items.some((i) => i.ids.length === 2 && i.estimate.sample === 64)).toBe(true);
    expect(p.items.some((i) => i.ids.length === 3 && i.components.length === 6)).toBe(true);
    expect(p.augments[0].id).toBe(observedAugment);
    expect(p.pairs.length).toBeGreaterThan(0);
    expect(p.triples.length).toBeLessThanOrEqual(24);
    expect(p.estimate.effectiveSample).toBe(32);
    expect(p.estimate.top4Interval[0]).toBeLessThan(p.estimate.top4Interval[1]);
    expect(model.champions[unknownCore[0]].estimate.sample).toBe(64);
    expect(model.graph.some((e) => e.ids.includes(unknownCore[0]) && e.estimate.eligible)).toBe(
      true,
    );
    expect(
      discovered.playbook.stages
        .filter((s) => s.stage !== 'final')
        .every((s) => s.board.value === null && s.instruction.value === null),
    ).toBe(true);
    expect(discovered.playbook.levelPlan.value).toBeNull();
    expect(discovered.playbook.target.units.every((u) => !u.position)).toBe(true);
  });
  it('keeps naming deterministic and IDs independent of display names', () => {
    const a = friendlyCompName(unknownCore, data, discovered.playbook.observed);
    expect(a).toEqual(
      friendlyCompName([...unknownCore].reverse(), data, discovered.playbook.observed),
    );
    expect(
      buildCompRegistry(playbooks, data, discovery).find(
        (e) => e.clusterId === discovered.clusterId,
      )?.id,
    ).toBe(discovered.id);
  });
  it('does not promote tiny perfect outcomes or mix patches, modes and duplicate matches', () => {
    const tiny = intelligenceMatches(1);
    tiny[0].participants.forEach((p) => (p.placement = 1));
    const d = discoveryFor(tiny);
    expect(d.clusters[0]?.recommendationEligible ?? false).toBe(false);
    const observed = deriveIntelligence([...tiny, ...tiny], playbooks, d, data, NOW);
    expect(observed.champions[unknownCore[0]].estimate).toMatchObject({
      sample: 2,
      effectiveSample: 1,
      eligible: false,
    });
    const old = structuredClone(matches);
    old.forEach((m) => (m.tftContentPatch = '18.0'));
    const currentData = { ...data, knowledge: { ...data.knowledge!, balancePatch: '18.1' } };
    expect(
      deriveIntelligence(
        [...matches, ...old.map((m) => ({ ...m, id: `old-${m.id}` }))],
        playbooks,
        discovery,
        currentData,
        NOW,
      ).champions[unknownCore[0]].estimate.sample,
    ).toBe(64);
    expect(
      deriveIntelligence(matches, playbooks, discovery, data, NOW, {
        cohort: 'verified-rank',
        membership: ['known-0'],
      }).champions[unknownCore[0]].estimate.sample,
    ).toBe(1);
  });
});
describe('M11 recommendations, state and board search', () => {
  it('stores shared intelligence once and hydrates legacy and referenced meta without raw-history mutation', async () => {
    const blobs = new Map<string, unknown>();
    const original = {
      version: 1,
      meta: { intelligence: model, observations: [{ matchId: 'immutable' }] },
    };
    const encoded = await referenceDerived(original, async (key, value) => {
      blobs.set(key, value);
    });
    expect(JSON.stringify(encoded).length).toBeLessThan(1000);
    expect(blobs.size).toBe(1);
    expect(await hydrateDerived(encoded, async (key) => blobs.get(key))).toEqual(original);
    expect(await hydrateDerived(original, async () => null)).toEqual(original);
    expect(original.meta.intelligence).toBe(model);
  });
  it('uses the identical registry eligibility boundary before and after any lobby recomputation', () => {
    const state = baseState();
    const blocked = ['Experimental', 'Stale', 'Retired'].map((lifecycle, i) => ({
      ...discovered,
      id: `blocked-${i}`,
      lifecycle: lifecycle as typeof discovered.lifecycle,
      recommendationEligible: false,
      playbook: { ...discovered.playbook, id: `blocked-${i}` },
    }));
    state.registry = [...state.registry, ...blocked];
    state.playbooks.push(...blocked.map((e) => e.playbook));
    expect(
      rescoreRecommendations(state, undefined, NOW).plans.every(
        (p) => !p.candidate.playbook.id.startsWith('blocked'),
      ),
    ).toBe(true);
    state.registry.forEach((e) => (e.recommendationEligible = false));
    expect(rescoreRecommendations(state, undefined, NOW).plans).toEqual([]);
  });
  it('renders weak Home statistics as insufficient without prominent percentages', () => {
    const state = baseState();
    const family = state.portfolio.plans[0].candidate.playbook;
    const rows = Array.from({ length: 19 }, (_, i) => ({
      matchId: String(i),
      puuid: String(i),
      completedAt: NOW,
      placement: 1,
      classification: {
        state: 'classified' as const,
        familyId: family.family.id,
        score: 1,
        margin: 1,
      },
    }));
    const stats = deriveFamilyStatistics(
      rows as Parameters<typeof deriveFamilyStatistics>[0],
      [family],
      NOW,
    );
    state.meta = { familyStats: stats, rankCohort: [] } as unknown as ApplicationState['meta'];
    const html = renderToStaticMarkup(
      createElement(Home, {
        state,
        portfolio: state.portfolio,
        lobby: null,
        onOpen: () => {},
        onScout: () => {},
        onData: () => {},
      }),
    );
    expect(html).toContain('Insufficient sample');
    expect(html).not.toContain('Avg place');
    expect(html).not.toContain('100%');
  });
  it('persists validated current-game updates outside the immutable lock snapshot', async () => {
    const state = baseState(),
      repo = new MemoryRepository();
    const session = createPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      state.portfolio,
      null,
      NOW,
      'm11-session',
    );
    const game = {
      ...emptyCurrentGame(18, NOW),
      level: 6,
      stage: '3-2',
      copies: { [unknownCore[0]]: 3 },
      components: [data.items.find((i) => i.category === 'component')!.id],
      augments: [observedAugment],
    };
    const updated = updateManualState(session, { currentGame: game }, NOW);
    await repo.createPlanSession(updated);
    expect((await repo.getActivePlanSession())?.manualState.currentGame).toEqual(game);
    expect(snapshotIsIntact(updated)).toBe(true);
    expect(() => validateCurrentGame({ ...game, set: 19 }, data)).toThrow();
    expect(() => validateCurrentGame({ ...game, copies: { fake: 9 } }, data)).toThrow();
  });
  it('uses copies, components, augmented associations and retained units with neutral unsupported signals', () => {
    const p = discovered.playbook;
    const game = {
      ...emptyCurrentGame(18, NOW),
      level: 6,
      copies: { [unknownCore[0]]: 3 },
      items: observedItems,
      components: data.items.find((i) => i.id === observedItems[0])!.components,
      board: unknownCore,
    };
    expect(contextualContributions(p, game, data).some((c) => c.key === 'context-copies')).toBe(
      true,
    );
    expect(contextualContributions(p, game, data).some((c) => c.key === 'context-items')).toBe(
      true,
    );
    expect(targetGap(p, game).transitionBurden).toBe(0);
    expect(
      contextualContributions(
        p,
        { ...emptyCurrentGame(18, NOW), augmentCategory: 'invented' },
        data,
      ),
    ).toEqual([]);
    const score = scoreCandidate(p, {
      data,
      version: data.version,
      now: NOW,
      discovery,
      currentGame: game,
    });
    expect(score.score).toBeGreaterThan(
      scoreCandidate(p, { data, version: data.version, now: NOW, discovery }).score,
    );
  });
  it('searches deterministically, preserves desired core, and emits only reviewed legal boards', () => {
    const input = {
      data,
      plan: discovered.playbook,
      intelligence: model,
      desired: unknownCore.slice(0, 3),
      targetLevel: 6,
    };
    const a = optimizeBoards(input),
      b = optimizeBoards(input);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const result of a) {
      expect(validateBoard(result.board, data)).toEqual([]);
      expect(result.board.units.length).toBeLessThanOrEqual(6);
      expect(input.desired.every((id) => result.board.requiredUnits.includes(id))).toBe(true);
    }
    expect(optimizeBoards({ ...input, desired: ['fake-unit'] })).toEqual([]);
    expect(optimizeBoards({ ...input, targetLevel: 1 })).toEqual([]);
    expect(
      optimizeBoards({
        ...input,
        desired: [data.champions.find((c) => c.shopStatus === 'runtime-variant')!.id],
      }),
    ).toEqual([]);
    const novel = optimizeBoards({
      ...input,
      plan: { ...discovered.playbook, observed: undefined },
    });
    expect(novel.every((b) => b.evidence === 'Experimental')).toBe(true);
  });
  it('finds a lower-pressure alternative when a flex unit is historically contested', () => {
    const plan = {
      ...discovered.playbook,
      family: { ...discovered.playbook.family, core: unknownCore.slice(0, 3) },
    };
    const base = optimizeBoards({ data, plan, intelligence: model })[0];
    const flex = base.board.units.find((u) => !plan.family.core.includes(u.championId))!.championId;
    const lobby = {
      coverage: 1,
      unitPressure: [{ championId: flex, normalizedPressure: 1 }],
    } as unknown as LobbyPressure;
    const alternatives = optimizeBoards({ data, plan, intelligence: model, lobby });
    expect(alternatives.some((a) => !a.board.units.some((u) => u.championId === flex))).toBe(true);
    expect(alternatives.every((a) => validateBoard(a.board, data).length === 0)).toBe(true);
  });
  it('conditions augment associations on comp membership instead of promoting rare winners', () => {
    const alternatives = intelligenceMatches(32).map((m, i) => ({
      ...m,
      id: `EUW1-other-${i}`,
      participants: m.participants.map((p) => ({
        ...p,
        augmentIds: [],
        units: playbooks[0].target.units.map((u) => ({
          ...p.units[0],
          championId: u.championId,
          stars: u.stars ?? 1,
          items: [],
        })),
      })),
    }));
    const mixed = [...matches, ...alternatives];
    const d = discoveryFor(mixed),
      m = deriveIntelligence(mixed, playbooks, d, data, NOW);
    const plan = buildCompRegistry(playbooks, data, d, m).find(
      (e) => e.id === discovered.id,
    )!.playbook;
    expect(plan.observed?.augments[0].association).toBeGreaterThan(1);
    const game = { ...emptyCurrentGame(18, NOW), augments: [observedAugment] };
    expect(
      contextualContributions(plan, game, data).find((c) => c.key === 'context-augments')
        ?.contribution,
    ).toBeGreaterThan(0);
  });
  it('prefers scenario coverage over a redundant naive top three without Tear roles', () => {
    const base = scoreCandidate(playbooks[0], { version: data.version, now: NOW });
    const candidates = Array.from({ length: 4 }, (_, i) => ({
      ...base,
      score: 80 - i,
      playbook: { ...base.playbook, id: `scenario-${i}` },
      scenarios: [
        { id: i === 3 ? 'Low-contest fallback' : 'AD item route', fit: 1, evidence: 'fixture' },
      ],
    }));
    const portfolio = optimizePortfolio(candidates, NOW);
    expect(portfolio.plans.some((p) => p.candidate.playbook.id === 'scenario-3')).toBe(true);
    expect(portfolio.plans.some((p) => p.role === 'Low-contest fallback')).toBe(true);
    expect(portfolio.plans[0].role).toBe('Best current fit');
  });
  it('separates verified ladder members from broader discovery participants in acquisition', async () => {
    const identity = {
      puuid: 'known-0',
      gameName: 'Known',
      tagLine: 'TEST',
      platform: 'EUW1',
      routing: 'EUROPE',
    };
    const provider = new FixtureRiotProvider(matches, [identity]);
    const result = await collectAggregateMeta(
      provider,
      new MemoryHistoryStore(),
      new MemoryRepository(),
      data,
      playbooks,
      {
        platform: 'EUW1',
        regionalRoute: 'EUROPE',
        set: 18,
        tiers: ['CHALLENGER'],
        playersPerTier: 1,
        matchesPerPlayer: 20,
        mode: 'quick',
        sourceType: 'fixture',
      },
      NOW,
    );
    expect(result.dataset.verifiedRank?.observations.every((o) => o.puuid === identity.puuid)).toBe(
      true,
    );
    expect(result.dataset.statisticsPopulation).toBe('verified-rank');
    expect(result.dataset.observations.length).toBeGreaterThan(
      result.dataset.verifiedRank!.observations.length,
    );
    const withMembership = deriveIntelligence(matches, playbooks, discovery, data, NOW, {
      membership: [identity.puuid],
    });
    const withoutMembership = deriveIntelligence(matches, playbooks, discovery, data, NOW, {
      membership: [],
    });
    expect(withMembership.fingerprint).not.toBe(withoutMembership.fingerprint);
  });
});
