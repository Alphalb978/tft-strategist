import { describe, expect, it, vi } from 'vitest';
import { FixtureRiotProvider } from '../providers/riot';
import {
  OPPONENT_DERIVATION_VERSION,
  deriveOpponent,
  resolveOpponentIdentities,
  scanLobby,
} from '../services/scouting';
import { MemoryHistoryStore } from '../storage/history';
import { match, NOW } from './fixtures';
describe('future opponent path with explicitly synthetic fixtures', () => {
  it('deduplicates shared matches and reuses cache on warm scan', async () => {
    const provider = new FixtureRiotProvider([match('shared'), match('second')], []);
    const fetch = vi.spyOn(provider, 'completedMatch'),
      ids = vi.spyOn(provider, 'recentMatchIds');
    const repo = new MemoryHistoryStore();
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
    const result = await scanLobby(['a'], provider, new MemoryHistoryStore(), {
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
    const unmapped = deriveOpponent('a', [match('unmapped', ['a'], null)], 18, '18.1', NOW);
    expect(unmapped.effectiveSample).toBe(1);
    expect(unmapped.patchRelevance).toMatchObject({
      status: 'unavailable',
      comparableGames: 0,
      samePatchGames: null,
    });
    expect(unmapped.confidenceFactors.patchQuality).toBeNull();
    current.completedAt = '2026-08-01T00:00:00Z';
    expect(deriveOpponent('a', [current], 18, '18.1', NOW).effectiveSample).toBeLessThan(0.1);
  });
  it('keeps sensible inspectable confidence for 15 recent games with unmapped Riot builds', () => {
    const games = Array.from({ length: 15 }, (_, index) => {
      const value = match(`live-shape-${index}`, ['a'], null);
      value.completedAt = new Date(Date.parse(NOW) - index * 86_400_000).toISOString();
      return value;
    });
    const profile = deriveOpponent('a', games, 18, '18.1', NOW, 15);
    const expectedRecency =
      Array.from({ length: 15 }, (_, index) => Math.exp(-index / 14)).reduce(
        (total, weight) => total + weight,
        0,
      ) / 15;
    expect(profile.relevantGames).toBe(15);
    expect(profile.patchRelevance.status).toBe('unavailable');
    expect(profile.confidenceFactors).toMatchObject({
      sampleCoverage: 1,
      modeQuality: 1,
      patchQuality: null,
    });
    expect(profile.confidenceFactors.recencyQuality).toBeCloseTo(expectedRecency, 8);
    expect(profile.confidence).toBeCloseTo(expectedRecency, 8);
    expect(profile.confidence).toBeGreaterThan(0.6);
  });
  it('keeps an 11-of-15 live-shaped sample partial', async () => {
    const source = Array.from({ length: 11 }, (_, index) =>
      match(`partial-live-shape-${index}`, ['a'], null),
    );
    const result = await scanLobby(
      ['a'],
      new FixtureRiotProvider(source, []),
      new MemoryHistoryStore(),
      { set: 18, patch: '18.1', now: NOW, historyWindow: 15 },
    );
    expect(result.state).toBe('partial');
    expect(result.relevantGamesAvailable).toBe(11);
    expect(result.relevantGamesTarget).toBe(15);
    expect(result.coverage).toBeCloseTo(11 / 15);
    expect(result.profiles[0].patchRelevance.status).toBe('unavailable');
  });
  it('returns partial results when one match fails', async () => {
    const provider = new FixtureRiotProvider([match('good'), match('bad')], []);
    const original = provider.completedMatch.bind(provider);
    vi.spyOn(provider, 'completedMatch').mockImplementation((id) =>
      id === 'bad' ? Promise.reject(new Error('fixture error')) : original(id),
    );
    const result = await scanLobby(['a'], provider, new MemoryHistoryStore(), {
      set: 18,
      patch: '18.1',
      now: NOW,
    });
    expect(result.state).toBe('partial');
    expect(result.profiles[0].sourceMatchIds).toEqual(['good']);
    expect(result.errors).toHaveLength(1);
  });
  it('pages beyond raw IDs until the relevant-game target is reached', async () => {
    const wrong = Array.from({ length: 20 }, (_, index) =>
      match(`wrong-${index}`, ['a'], '17.9', 17),
    );
    const current = Array.from({ length: 10 }, (_, index) => match(`current-${index}`, ['a']));
    const provider = new FixtureRiotProvider([...wrong, ...current], []);
    const ids = vi.spyOn(provider, 'recentMatchIds');
    const result = await scanLobby(['a'], provider, new MemoryHistoryStore(), {
      set: 18,
      patch: '18.1',
      now: NOW,
      historyWindow: 10,
    });
    expect(ids).toHaveBeenCalledTimes(2);
    expect(result.profiles[0].relevantGames).toBe(10);
    expect(result.state).toBe('complete');
  });
  it('refreshes a stale index and reuses immutable completed matches', async () => {
    const provider = new FixtureRiotProvider([match('cached', ['a'])], []);
    const store = new MemoryHistoryStore();
    await store.putRecentIndex({
      puuid: 'a',
      routing: 'fixture',
      targetCount: 10,
      requestedCount: 1,
      ids: ['cached'],
      exhausted: true,
      fetchedAt: '2026-09-05T20:00:00Z',
    });
    await store.putCompletedMatch(match('cached', ['a']), NOW);
    const ids = vi.spyOn(provider, 'recentMatchIds');
    const details = vi.spyOn(provider, 'completedMatch');
    const result = await scanLobby(['a'], provider, store, {
      set: 18,
      patch: '18.1',
      now: NOW,
      historyWindow: 10,
    });
    expect(ids).toHaveBeenCalledTimes(1);
    expect(details).not.toHaveBeenCalled();
    expect(result.telemetry.cacheHits).toBeGreaterThan(0);
  });
  it('emits a warm profile immediately and retains it when refresh fails', async () => {
    const provider = new FixtureRiotProvider([], []);
    vi.spyOn(provider, 'recentMatchIds').mockRejectedValue(new Error('offline raw detail'));
    const store = new MemoryHistoryStore();
    const cached = deriveOpponent('a', [match('old-cache', ['a'])], 18, '18.1', NOW);
    await store.putProfile(cached, 'old-cache');
    const warm = vi.fn();
    const result = await scanLobby(['a'], provider, store, {
      set: 18,
      patch: '18.1',
      now: '2026-09-05T22:00:00Z',
      historyWindow: 10,
      onWarmResult: warm,
    });
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0][0].profiles[0].freshness).toBe('stale');
    expect(result.profiles[0].sourceMatchIds).toEqual(['old-cache']);
    expect(result.state).toBe('partial');
  });
  it('resolves valid manual identities partially while ignoring duplicates', async () => {
    const provider = new FixtureRiotProvider(
      [],
      [
        {
          puuid: 'a',
          gameName: 'Éclaireur',
          tagLine: 'EUW',
          platform: 'EUW1',
          routing: 'EUROPE',
        },
      ],
    );
    const result = await resolveOpponentIdentities(
      ' Éclaireur#EUW\néclaireur#euw\nMissing#EUW\nmalformed ',
      provider,
      new MemoryHistoryStore(),
      'EUW1',
      NOW,
    );
    expect(result.requested).toBe(3);
    expect(result.resolved.map((identity) => identity.puuid)).toEqual(['a']);
    expect(result.duplicates).toHaveLength(1);
    expect(result.entries.map((entry) => entry.state)).toEqual(
      expect.arrayContaining(['resolved', 'failed', 'invalid']),
    );
  });
  it('marks the resolved own account as ignored and never offers it for history fetching', async () => {
    const own = {
      puuid: 'own-puuid',
      gameName: 'Strategist',
      tagLine: 'M3',
      platform: 'EUW1',
      routing: 'EUROPE',
    };
    const provider = new FixtureRiotProvider([], [own]);
    const history = vi.spyOn(provider, 'recentMatchIds');
    const result = await resolveOpponentIdentities(
      'Strategist#M3',
      provider,
      new MemoryHistoryStore(),
      'EUW1',
      NOW,
      own.puuid,
    );
    expect(result.resolved).toEqual([]);
    expect(result.entries).toEqual([
      expect.objectContaining({ input: 'Strategist#M3', state: 'ignored-self' }),
    ]);
    expect(history).not.toHaveBeenCalled();
  });
  it('keeps derivation classification explicitly unavailable', () => {
    const profile = deriveOpponent('a', [match('evidence', ['a'])], 18, '18.1', NOW);
    expect(profile.derivationVersion).toBe(OPPONENT_DERIVATION_VERSION);
    expect(profile.classification).toEqual(
      expect.objectContaining({ family: 'unavailable', style: 'unavailable' }),
    );
    expect(profile.familyFrequency).toBeUndefined();
    expect(profile.forceIndex).toBeUndefined();
  });
});
