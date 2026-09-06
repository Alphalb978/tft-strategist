import { describe, expect, it } from 'vitest';
import type { DiscoveryCluster, Playbook, StrategyDecisionMap, StaticData } from '../domain/models';
import {
  familyDefinitionsFingerprint,
  staticSetCompatibilityFingerprint,
} from '../domain/fingerprint';
import { loadPlaybooks } from '../providers/playbooks';
import {
  loadStrategyGuidance,
  strategyLedger,
  unavailableFact,
} from '../providers/strategyGuidance';
import { validatePlaybook } from '../rules/validation';
import { createRecommendations } from '../services/application';
import { defaultSettings } from '../storage/repository';
import { inheritDiscoveredGuidance } from '../strategy/guidanceInheritance';
import {
  buildPivotGraph,
  buildQuickStrip,
  deriveReplacement,
  traverseDecisionMap,
  validateDecisionMap,
} from '../strategy/playbookIntelligence';
import { scoreCandidate } from '../strategy/scoring';
import { data, NOW, playbooks } from './fixtures';

const byId = (id: string) => playbooks.find((playbook) => playbook.id === id)!;
const championId = (name: string) => data.champions.find((unit) => unit.name === name)!.id;

describe('M7 strategy playbook intelligence', () => {
  it('parses a versioned source ledger covering every curated family', () => {
    const ledger = strategyLedger();
    expect(ledger.schemaVersion).toBe(1);
    expect(ledger.guidanceVersion).toBe('set18-strategy-v1');
    expect(ledger.entries).toHaveLength(13);
    expect(new Set(ledger.entries.map((entry) => entry.familyId))).toEqual(
      new Set(playbooks.map((playbook) => playbook.family.id)),
    );
    expect(ledger.sources).toHaveLength(5);
    expect(ledger.sources.every((source) => source.url.startsWith('https://'))).toBe(true);
    expect(ledger.sources.every((source) => source.reviewedAt === ledger.reviewedAt)).toBe(true);
  });

  it('validates provenance, active-set stage boards, item holders and augment states', () => {
    for (const playbook of playbooks) {
      expect(playbook.strategy.freshness.state).toBe('current');
      expect(
        validatePlaybook(playbook, data).filter((issue) => issue.severity === 'error'),
      ).toEqual([]);
    }
    const covered = byId('adaptor-reroll');
    expect(covered.strategy.stages).toHaveLength(4);
    expect(covered.strategy.itemHolders.every((holder) => holder.fact.status === 'sourced')).toBe(
      true,
    );
    expect(covered.strategy.augmentBranches.map((branch) => branch.category)).toEqual([
      'reroll',
      'item/component',
    ]);
    expect(covered.strategy.augmentBranches.every((branch) => !branch.augmentIds.length)).toBe(
      true,
    );
  });

  it('keeps partial evidence and unavailable fields explicit', () => {
    const partial = byId('apex-predator');
    expect(partial.strategy.coverage.supported).toBe(1);
    expect(partial.strategy.stages).toHaveLength(1);
    expect(partial.strategy.stages[0].label).toBe('Sourced target only');
    expect(partial.strategy.itemHolders).toEqual([]);
    expect(partial.strategy.augmentBranches).toEqual([]);
    expect(partial.strategy.decisionMap.status).toBe('unavailable');
    expect(partial.strategy.positioning.precision).toBe('unverified');
  });

  it('loads reviewed guidance as current across real refresh metadata changes', () => {
    const refreshed = structuredClone(data) as StaticData;
    refreshed.version.sourceVersion = 'Sun, 06 Sep 2026 12:34:56 GMT';
    refreshed.version.provenance = {
      ...refreshed.version.provenance,
      source: 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json?cache=refresh',
      fetchedAt: '2026-09-06T12:35:00Z',
      publishedAt: 'Sun, 06 Sep 2026 12:34:56 GMT',
      note: 'Mutable transport metadata must not define strategy compatibility.',
      hash: undefined,
    };
    const refreshedPlaybooks = loadPlaybooks(refreshed);
    expect(refreshedPlaybooks).toHaveLength(playbooks.length);
    expect(
      refreshedPlaybooks.every((playbook) => playbook.strategy.freshness.state === 'current'),
    ).toBe(true);
    expect(
      refreshedPlaybooks.find((playbook) => playbook.id === 'adaptor-reroll')?.strategy,
    ).toMatchObject({
      coverage: { supported: 5, total: 7 },
      rollPlan: { status: 'sourced' },
      decisionMap: { status: 'sourced' },
    });
  });

  it('ignores collection order and non-semantic mutable metadata in static compatibility', () => {
    const reordered = structuredClone(data) as StaticData;
    reordered.champions.reverse();
    reordered.traits.reverse();
    reordered.items.reverse();
    reordered.augments.reverse();
    reordered.warnings = ['A different runtime notice.'];
    for (const champion of reordered.champions) {
      champion.traitIds.reverse();
      champion.icon = null;
      champion.splash = null;
      champion.provenance = { ...champion.provenance, fetchedAt: 'later', note: 'changed' };
    }
    for (const trait of reordered.traits) {
      trait.breakpoints.reverse();
      trait.icon = null;
    }
    for (const item of reordered.items) {
      item.components.reverse();
      item.icon = null;
    }
    for (const augment of reordered.augments) {
      augment.requiredTraits.reverse();
      augment.icon = null;
    }
    expect(staticSetCompatibilityFingerprint(reordered)).toBe(
      staticSetCompatibilityFingerprint(data),
    );
    expect(
      loadPlaybooks(reordered).every((playbook) => playbook.strategy.freshness.state === 'current'),
    ).toBe(true);
  });

  it('marks guidance stale and suppresses facts after a semantic static-source change', () => {
    const changed = structuredClone(data) as StaticData;
    changed.champions.find((champion) => champion.name === 'Xayah')!.cost += 1;
    const stale = loadPlaybooks(changed)[0];
    expect(stale.strategy.freshness).toMatchObject({ state: 'stale' });
    expect(stale.strategy.freshness.reasons).toContain('Static-source fingerprint changed.');
    expect(stale.strategy.watchUnits).toMatchObject({ status: 'stale', value: null });
    expect(stale.strategy.rollPlan).toMatchObject({ status: 'stale', value: null });
    expect(stale.strategy.itemHolders[0].fact.status).toBe('stale');
    expect(validatePlaybook(stale, changed).map((issue) => issue.code)).toContain('strategy-stale');
  });

  it('marks an actual active-set incompatibility stale', () => {
    const changed = structuredClone(data) as StaticData;
    changed.version.set += 1;
    const stale = loadStrategyGuidance(byId('adaptor-reroll'), changed);
    expect(stale.freshness.state).toBe('stale');
    expect(stale.freshness.reasons).toContain('Active set changed.');
    expect(stale.rollPlan).toMatchObject({ status: 'stale', value: null });
  });

  it('keeps M6 family ordering and M7 static compatibility fingerprints deterministic', () => {
    expect(familyDefinitionsFingerprint([...playbooks].reverse())).toBe(
      familyDefinitionsFingerprint(playbooks),
    );
    expect(staticSetCompatibilityFingerprint(structuredClone(data))).toBe(
      staticSetCompatibilityFingerprint(data),
    );
  });

  it('derives only mechanical replacement legality and trait deltas', () => {
    const playbook = byId('solar-elderwood');
    const result = deriveReplacement(
      playbook.target,
      championId('Hecarim'),
      championId('Master Yi'),
      data,
    );
    expect(result.legal).toBe(true);
    expect(result.capacityDelta).toBe(0);
    expect(result.traitDelta.length).toBeGreaterThan(0);
    expect(result.warning).toContain('does not mean equal strategic strength');
  });

  it('traverses deterministic acyclic manual Decision Maps', () => {
    const map = byId('solar-elderwood').strategy.decisionMap;
    expect(validateDecisionMap(map)).toEqual([]);
    expect(traverseDecisionMap(map, 'core-signal', 'core-yes')?.id).toBe('contest');
    expect(traverseDecisionMap(map, 'contest', 'contest-low')?.id).toBe('commit');
    expect(traverseDecisionMap(map, 'contest', 'core-yes')).toBeNull();
    const cyclic = structuredClone(map);
    cyclic.edges.push({
      ...cyclic.edges[0],
      id: 'cycle',
      from: 'commit',
      to: 'core-signal',
    });
    expect(validateDecisionMap(cyclic).map((issue) => issue.code)).toContain('cycle');
  });

  it('rejects unsupported Decision Map live-state conditions', () => {
    const map = structuredClone(byId('adaptor-reroll').strategy.decisionMap) as StrategyDecisionMap;
    map.edges[0].conditionKind = 'automatic-live-shop' as never;
    expect(validateDecisionMap(map)).toContainEqual(
      expect.objectContaining({ code: 'unsupported-condition' }),
    );
  });

  it('generates the quick strip and pivot graph deterministically from supported facts', () => {
    const result = createRecommendations(data, defaultSettings, NOW);
    const playbook = result.portfolio.plans[0].candidate.playbook;
    const names = (id: string) => data.champions.find((unit) => unit.id === id)?.name ?? id;
    const items = (id: string) => data.items.find((item) => item.id === id)?.name ?? id;
    expect(buildQuickStrip(playbook, result.portfolio, names, items)).toEqual(
      buildQuickStrip(playbook, result.portfolio, names, items),
    );
    const graph = buildPivotGraph(result.portfolio);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.edges.every((edge) => edge.reasons.length > 0)).toBe(true);
    expect(graph.edges.every((edge) => edge.status === 'derived')).toBe(true);
  });

  it('does not create a pivot edge from final-board overlap alone', () => {
    const partial = ['apex-predator', 'flora-executioners', 'blackthorn-sprykin'].map((id) =>
      scoreCandidate(byId(id), { version: data.version, now: NOW }),
    );
    const portfolio = {
      plans: partial.map((candidate, index) => ({ candidate, role: `Plan ${index + 1}` })),
      objective: 0,
      interactions: [],
      generatedAt: NOW,
      version: 'test',
    };
    expect(buildPivotGraph(portfolio).edges).toEqual([]);
  });

  it('distinguishes sourced exact positioning from unverified positioning', () => {
    const playbook = structuredClone(byId('solar-elderwood'));
    expect(playbook.strategy.positioning.precision).toBe('unverified');
    expect(
      validatePlaybook(playbook, data).some((issue) => issue.code === 'strategy-position'),
    ).toBe(false);
    playbook.strategy.positioning = {
      precision: 'exact',
      exact: {
        value: [{ championId: playbook.target.units[0].championId, row: 0, column: 0 }],
        status: 'sourced',
        sourceIds: [playbook.strategy.sources[0].id],
        note: 'Synthetic verified fixture.',
      },
      coarse: unavailableFact('Not used by exact fixture.'),
      note: 'Synthetic exact-position fixture.',
    };
    expect(
      validatePlaybook(playbook, data).filter((issue) => issue.code === 'strategy-position'),
    ).toEqual([]);
    playbook.strategy.positioning.precision = 'unverified';
    expect(validatePlaybook(playbook, data).map((issue) => issue.code)).toContain(
      'strategy-position',
    );
  });

  it('inherits only retained holder facts for a mature structurally compatible Variant', () => {
    const parent = byId('adaptor-reroll');
    const discovered = structuredClone(parent) as Playbook;
    discovered.id = 'discovered-safe';
    discovered.family = { id: 'discovered-safe', name: 'Safe variant', core: parent.family.core };
    discovered.target.units[discovered.target.units.length - 1].championId = championId('Ashe');
    const cluster = {
      lifecycle: 'Variant',
      relation: {
        state: 'variant-candidate',
        diff: {
          sharedCore: parent.family.core,
          consistentlyAdded: [championId('Ashe')],
          consistentlyOmitted: [championId('Yorick')],
          structuralDistance: 0.1,
          capacityDelta: 0,
        },
      },
    } as unknown as DiscoveryCluster;
    const inherited = inheritDiscoveredGuidance(discovered, cluster, data, parent);
    expect(inherited.eligible).toBe(true);
    expect(inherited.guidance.itemHolders.length).toBeGreaterThan(0);
    expect(
      inherited.guidance.itemHolders.every((holder) => holder.fact.status === 'inherited'),
    ).toBe(true);
    expect(inherited.guidance.rollPlan.status).toBe('unavailable');
    expect(inherited.guidance.decisionMap.status).toBe('unavailable');
  });

  it('blocks inheritance when a parent core/item holder is removed', () => {
    const parent = byId('adaptor-reroll');
    const discovered = structuredClone(parent) as Playbook;
    discovered.id = 'discovered-unsafe';
    discovered.family = { id: 'discovered-unsafe', name: 'Unsafe variant', core: [] };
    discovered.target.units = discovered.target.units.filter(
      (unit) => unit.championId !== championId('Master Yi'),
    );
    const cluster = {
      lifecycle: 'Variant',
      relation: {
        state: 'variant-candidate',
        diff: {
          sharedCore: parent.family.core.filter((id) => id !== championId('Master Yi')),
          consistentlyAdded: [],
          consistentlyOmitted: [championId('Master Yi')],
          structuralDistance: 0.2,
          capacityDelta: 0,
        },
      },
    } as unknown as DiscoveryCluster;
    const inherited = inheritDiscoveredGuidance(discovered, cluster, data, parent);
    expect(inherited.eligible).toBe(false);
    expect(inherited.guidance.itemHolders).toEqual([]);
    expect(inherited.reasons.join(' ')).toContain('core');
  });

  it('does not let M7 guidance change M4 or recommendation scoring inputs', () => {
    const original = byId('solar-elderwood');
    const sparse = structuredClone(original);
    sparse.strategy.watchUnits = unavailableFact('Synthetic sparse strategy.');
    sparse.strategy.rollPlan = unavailableFact('Synthetic sparse strategy.');
    sparse.strategy.itemHolders = [];
    const before = scoreCandidate(original, { version: data.version, now: NOW });
    const after = scoreCandidate(sparse, { version: data.version, now: NOW });
    expect(after.score).toBe(before.score);
    expect(after.components).toEqual(before.components);
    expect(after.contest).toEqual(before.contest);
  });
});
