import { describe, expect, it, vi } from 'vitest';
import { FixtureRiotProvider } from '../providers/riot';
import { deriveOpponent, scanLobby } from '../services/scouting';
import { MemoryRepository } from '../storage/repository';
import { match, NOW } from './fixtures';
describe('future opponent path with explicitly synthetic fixtures', () => {
  it('deduplicates shared matches and reuses cache on warm scan', async () => {
    const provider = new FixtureRiotProvider([match('shared'), match('second')], []);
    const fetch = vi.spyOn(provider, 'completedMatch'),
      ids = vi.spyOn(provider, 'recentMatchIds');
    const repo = new MemoryRepository();
    const opts = { set: 18, patch: '18.1', now: NOW };
    const cold = await scanLobby(['a', 'b'], provider, repo, opts);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cold.profiles).toHaveLength(2);
    expect(cold.state).toBe('partial');
    await scanLobby(['a', 'b'], provider, repo, opts);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ids).toHaveBeenCalledTimes(2);
  });
  it('returns within timeout for a non-cooperative provider', async () => {
    const provider = new FixtureRiotProvider([], []);
    vi.spyOn(provider, 'recentMatchIds').mockImplementation(() => new Promise(() => {}));
    const result = await scanLobby(['a'], provider, new MemoryRepository(), {
      set: 18,
      patch: '18.1',
      now: NOW,
      timeoutMs: 30,
    });
    expect(result.state).toBe('unavailable');
    expect(result.errors.join()).toMatch(/partial/);
  });
  it('weights recency and patch relevance, excludes old sets and duplicate matches', () => {
    const current = match('current'),
      old = match('old', ['a'], '18.0'),
      wrong = match('wrong', ['a'], '17.9', 17);
    const recent = deriveOpponent('a', [current, current, wrong], 18, '18.1', NOW);
    expect(recent.relevantGames).toBe(1);
    expect(recent.effectiveSample).toBe(1);
    expect(deriveOpponent('a', [old], 18, '18.1', NOW).effectiveSample).toBe(0.25);
    current.completedAt = '2026-08-01T00:00:00Z';
    expect(deriveOpponent('a', [current], 18, '18.1', NOW).effectiveSample).toBeLessThan(0.1);
  });
  it('returns partial results when one match fails', async () => {
    const provider = new FixtureRiotProvider([match('good'), match('bad')], []);
    const original = provider.completedMatch.bind(provider);
    vi.spyOn(provider, 'completedMatch').mockImplementation((id) =>
      id === 'bad' ? Promise.reject(new Error('fixture error')) : original(id),
    );
    const result = await scanLobby(['a'], provider, new MemoryRepository(), {
      set: 18,
      patch: '18.1',
      now: NOW,
    });
    expect(result.state).toBe('partial');
    expect(result.profiles[0].sourceMatchIds).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
  });
});
