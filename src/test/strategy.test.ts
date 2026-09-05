import { describe, expect, it } from 'vitest';
import { confidenceFor, contestFor, personalAdjustment, scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import { summarizeCompletedMatch } from '../strategy/postGame';
import type { PersonalProfile, RecommendationCandidate } from '../domain/models';
import { data, match, NOW, playbooks } from './fixtures';
const context = { version: data.version, now: NOW };
describe('inspectable deterministic scoring', () => {
  it('has all components and deterministic total', () => {
    const c = scoreCandidate(playbooks[0], context);
    expect(c).toEqual(scoreCandidate(playbooks[0], context));
    expect(c.components).toHaveLength(11);
    expect(c.score).toBeCloseTo(
      c.components.reduce((s, c) => s + c.contribution, 0),
      1,
    );
    expect(c.components.find((c) => c.key === 'lobby')?.input).toBeNull();
  });
  it('bounds default personal influence and shrinks small / old-set samples', () => {
    const p: PersonalProfile = {
      set: 18,
      patch: '18.1',
      effectiveGames: 10000,
      familyAffinity: { [playbooks[0].id]: 1 },
      generatedAt: NOW,
      insights: [],
    };
    expect(personalAdjustment(playbooks[0], p)).toBeLessThanOrEqual(2.5);
    expect(personalAdjustment(playbooks[0], p, 100)).toBeLessThanOrEqual(5);
    expect(personalAdjustment(playbooks[0], { ...p, effectiveGames: 2 })).toBe(0);
    expect(personalAdjustment(playbooks[0], { ...p, set: 17 })).toBe(0);
    expect(personalAdjustment(playbooks[0], { ...p, patch: '18.0' })).toBeLessThan(
      personalAdjustment(playbooks[0], p),
    );
  });
  it('confidence differs from score and declines with missing/old evidence', () => {
    const p = structuredClone(playbooks[0]);
    p.evidence = 'Proven';
    p.sampleSize = 200;
    p.features.provenance.status = 'verified';
    const rich = {
      ...context,
      version: { ...data.version, patchVerified: true },
      lobby: {
        state: 'complete' as const,
        coverage: 1,
        expectedOpponents: 7,
        profiles: [],
        fetchedAt: NOW,
        errors: [],
      },
    };
    const high = confidenceFor(p, rich);
    expect(high.level).toBe('High');
    expect(confidenceFor(p, context).value).toBeLessThan(high.value);
    p.provenance.fetchedAt = '2025-01-01';
    expect(confidenceFor(p, context).value).toBeLessThan(0.6);
    expect(scoreCandidate(playbooks[0], context).confidence.level).toBe('Low');
  });
  it('never promotes experimental or seeded metadata due to other evidence', () => {
    const p = structuredClone(playbooks[0]);
    p.sampleSize = 100000;
    expect(
      confidenceFor(p, { ...context, version: { ...data.version, patchVerified: true } }).level,
    ).toBe('Low');
  });
  it('contest state is unavailable with no observations', () => {
    expect(contestFor(playbooks[0]).value).toBeNull();
  });
});
describe('portfolio interaction', () => {
  const candidate = (
    id: string,
    score: number,
    core: string[],
    items: string[],
    style: string,
  ): RecommendationCandidate => {
    const p = structuredClone(playbooks[0]);
    p.id = id;
    p.family.id = id;
    p.family.core = core;
    p.features.itemCoverage = items;
    p.features.openingCoverage = items;
    p.features.style = style;
    return { ...scoreCandidate(p, context), score };
  };
  it('chooses a complementary lower individual score over a redundant second-ranked plan', () => {
    const input = [
      candidate('A', 90, ['a', 'b'], ['Bow'], 'reroll'),
      candidate('B', 89, ['a', 'b'], ['Bow'], 'reroll'),
      candidate('C', 88, ['c'], ['Rod'], 'fast8'),
      candidate('D', 85, ['d'], ['Sword'], 'fast9'),
    ];
    const result = optimizePortfolio(input, NOW);
    expect(result.plans.map((p) => p.candidate.playbook.id)).toEqual(['A', 'C', 'D']);
    expect(result.interactions.find((i) => i.label === 'Shared core dependency')?.value).toBe(-0);
  });
  it('is deterministic, permutation-independent, and handles <3 candidates', () => {
    const cs = playbooks.map((p) => scoreCandidate(p, context));
    expect(optimizePortfolio(cs, NOW)).toEqual(optimizePortfolio([...cs].reverse(), NOW));
    expect(optimizePortfolio([], NOW).plans).toEqual([]);
    expect(optimizePortfolio(cs.slice(0, 2), NOW).plans).toHaveLength(2);
  });
  it('reports end-state mismatch without inventing loss causality', () => {
    const m = match('test');
    m.participants[0].units = [];
    const summary = summarizeCompletedMatch(m, 'a', playbooks[0]);
    expect(summary.possibleMismatches[0]).toContain('intentional pivot');
    expect(summary.observations[0]).toContain('0 of');
  });
});
