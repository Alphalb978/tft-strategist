import { scoreCandidate } from '../strategy/scoring';
import { describe, expect, it } from 'vitest';
import { data, playbooks, NOW } from './fixtures';
import captured from '../../data/fixtures/metatft-public.json';
import { normalizePublicComps } from '../../scripts/metatft-normalize';
import { buildCompRegistry } from '../services/compRegistry';
import { candidateContestFor } from '../strategy/lobbyPressure';
import { contextualContributions, emptyCurrentGame } from '../strategy/currentGame';
import { optimizeBoards } from '../strategy/boardOptimizer';
import { validateBoard } from '../rules/validation';
import { externalStatus } from '../providers/externalMeta';
import { fusedForPlan } from '../strategy/evidenceFusion';
import { globalEntityIndex, resolveEntityIntelligence } from '../strategy/entityIntelligence';
import type { LobbyPressure } from '../domain/models';
import { id, itemA, itemB, profile, model } from './entityIntelligenceFixture';

const snapshot = () => {
  const s = normalizePublicComps(captured, data, NOW);
  s.manifest.retrievedAt = new Date().toISOString();
  return s;
};
function reference() {
  const s = snapshot();
  return {
    s,
    plan: buildCompRegistry(playbooks, data, undefined, undefined, s).find(
      (e) => e.sourceKind === 'external' && !e.playbook.family.core.length,
    )!.playbook,
  };
}
function lobby(pressure: number): LobbyPressure {
  return {
    state: 'complete',
    profiles: [{}],
    unitPressure: data.champions.map((c) => ({
      championId: c.id,
      normalizedPressure: pressure,
      evidenceCoverage: 1,
      totalEquivalentUsers: pressure * 7,
    })),
    coverage: 1,
  } as LobbyPressure;
}
describe('M12 pre-game correctness', () => {
  it('keeps unknown criticality neutral even under full lobby coverage; known low/high remain distinct', () => {
    const { plan } = reference();
    expect(candidateContestFor(plan, lobby(0))).toMatchObject({
      state: 'Unavailable',
      value: null,
      lobbyFit: null,
    });
    for (const scenarioPressure of [undefined, []]) {
      const scored = scoreCandidate(plan, {
        data,
        version: data.version,
        now: NOW,
        personalWeight: 0.05,
        lobby: lobby(0),
        scenarioPressure,
      });
      expect(scored.components.find((c) => c.key === 'lobby')).toMatchObject({
        input: null,
        contribution: 5,
        status: 'unavailable',
      });
    }
    expect(candidateContestFor(playbooks[0], lobby(0)).lobbyFit).toBeGreaterThan(50);
    expect(candidateContestFor(playbooks[0], lobby(1)).lobbyFit).toBeLessThan(50);
  });
  it('missing reference context grants no core/item/timing bonuses while known context retains them', () => {
    const { plan } = reference();
    const game = emptyCurrentGame(data.version.set, NOW);
    game.copies = Object.fromEntries(data.champions.map((c) => [c.id, 3]));
    game.items = data.items.map((i) => i.id);
    game.level = 2;
    game.levelKnown = true;
    game.economy = 'strong';
    const contributions = contextualContributions(plan, game, data);
    expect(
      contributions.some((c) =>
        ['context-copies', 'context-items', 'context-economy'].includes(c.key),
      ),
    ).toBe(false);
    expect(
      contextualContributions(playbooks[0], game, data).some((c) => c.key === 'context-copies'),
    ).toBe(true);
    expect(
      contextualContributions(playbooks[0], game, data).some((c) => c.key === 'context-items'),
    ).toBe(true);
  });
  it('retains most of a reference roster without fabricating hard core', () => {
    const { plan, s } = reference();
    const options = optimizeBoards({ data, plan, external: s });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(validateBoard(option.board, data)).toEqual([]);
      expect(option.board.requiredUnits).toEqual([]);
      expect(option.evidence).toBe('Experimental');
      expect(
        option.board.units.filter((u) =>
          plan.target.units.some((r) => r.championId === u.championId),
        ).length,
      ).toBeGreaterThanOrEqual(Math.ceil(plan.target.units.length * 0.75));
    }
    expect(optimizeBoards({ data, plan, external: s })).toEqual(options);
  });
  it('accepts verified same hotfix, excludes known mismatch, discounts unknown parity', () => {
    const { plan, s } = reference();
    s.manifest.scope.hotfix = 'd';
    const withHotfix = (hotfix?: string) => ({
      ...data,
      knowledge: { ...data.knowledge!, balanceHotfix: hotfix },
    });
    const known = fusedForPlan(plan, s, withHotfix('d'), s.manifest.retrievedAt);
    const unknown = fusedForPlan(plan, s, withHotfix(), s.manifest.retrievedAt);
    expect(known.externalWeight).toBeGreaterThan(0);
    expect(externalStatus(s, withHotfix('e'))).toContain('incompatible');
    expect(fusedForPlan(plan, s, withHotfix('e'), NOW).externalWeight).toBe(0);
    expect(unknown.externalWeight).toBeLessThan(known.externalWeight);
    expect(unknown.confidence).toBeLessThan(known.confidence);
    expect(externalStatus(s, withHotfix())).toContain('Hotfix parity unverified');
  });
});
function resolve(plan = playbooks[0], entityId = id, intelligence = model) {
  return resolveEntityIntelligence({ id: entityId, data, plan, intelligence });
}
describe('unified entity intelligence precedence', () => {
  const b = {
    ...playbooks[0],
    strategy: { ...playbooks[0].strategy, itemHolders: [] },
    observed: undefined,
  };
  const a = { ...b, observed: { ...profile, items: [{ ...profile.items[0], ids: [itemB] }] } };
  it('preserves comp A package; same champion in comp B falls back to global evidence', () => {
    expect(resolve(a)).toMatchObject({ source: 'Comp evidence', packages: [{ ids: [itemB] }] });
    expect(resolve(b)).toMatchObject({ source: 'Global evidence', packages: [{ ids: [itemA] }] });
    expect(resolve(b, itemA)).toMatchObject({
      source: 'Global evidence',
      packages: [{ holder: id }],
    });
    expect(resolve(a, itemB)).toMatchObject({ source: 'Comp evidence' });
  });
  it('requires eligible compatible evidence; never fabricates items from mechanics', () => {
    expect(resolveEntityIntelligence({ id, data, plan: b }).packages).toEqual([]);
    const thin = {
      ...model,
      champions: {
        [id]: {
          ...profile,
          items: [{ ...profile.items[0], estimate: { ...profile.estimate, eligible: false } }],
        },
      },
    };
    expect(resolve(b, id, thin).source).toBe('Unavailable');
    expect(resolve(b, id, { ...model, scope: { ...model.scope, patch: '0.0' } }).packages).toEqual(
      [],
    );
  });
  it('reuses cached global index and invalidates with new evidence', () => {
    expect(globalEntityIndex(data, model)).toBe(globalEntityIndex(data, model));
    expect(globalEntityIndex(data, { ...model, fingerprint: 'updated' })).not.toBe(
      globalEntityIndex(data, model),
    );
  });
});
