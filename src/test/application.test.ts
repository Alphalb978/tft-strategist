import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRecommendations,
  lockPlanSession,
  loadApplication,
  refreshApplication,
  type ApplicationState,
} from '../services/application';
import { defaultSettings, MemoryRepository } from '../storage/repository';
import { data, NOW } from './fixtures';
afterEach(() => vi.restoreAllMocks());
const state = (): ApplicationState => ({
  data,
  ...createRecommendations(data, defaultSettings, NOW),
  settings: defaultSettings,
  activeSession: null,
  source: 'Bundled snapshot',
  assets: {},
});
describe('application persistence and refresh', () => {
  it('falls back from a corrupt cache and discards a malformed selection', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', { ...data, champions: [{}] });
    await repo.set('selection', { set: 18, patch: '18.1', playbookId: 'solar-elderwood' });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(new Response(JSON.stringify(url.includes('asset-manifest') ? {} : data))),
        ),
    );
    const result = await loadApplication(repo);
    expect(result.source).toBe('Bundled snapshot');
    expect(result.activeSession).toBeNull();
    expect(result.notices.join()).toContain('cache ignored');
    expect(await repo.get('static')).toEqual(data);

    const restarted = await loadApplication(repo);
    expect(restarted.source).toBe('Local cache');
    expect(restarted.notices.join()).not.toContain('cache ignored');
  });
  it('rejects and safely supersedes an obsolete 18.1 static cache without recurring noise', async () => {
    const repo = new MemoryRepository();
    const obsolete = structuredClone(data);
    obsolete.version.patch = '18.1';
    await repo.set('static', obsolete);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(new Response(JSON.stringify(url.includes('asset-manifest') ? {} : data))),
        ),
    );

    const first = await loadApplication(repo);
    expect(first.source).toBe('Bundled snapshot');
    expect(first.data.version.patch).toBe('18.2');
    expect(first.notices.join()).toContain('cache ignored');
    expect((await repo.get<typeof data>('static'))?.version.patch).toBe('18.2');

    const restarted = await loadApplication(repo);
    expect(restarted.source).toBe('Local cache');
    expect(restarted.notices.join()).not.toContain('cache ignored');
  });
  it('fails closed when a bundled snapshot disagrees with the active patch', async () => {
    const repo = new MemoryRepository();
    const incompatible = structuredClone(data);
    incompatible.version.patch = '18.3';
    await repo.set('static', incompatible);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            new Response(JSON.stringify(url.includes('asset-manifest') ? {} : incompatible)),
          ),
        ),
    );

    await expect(loadApplication(repo)).rejects.toThrow('incompatible with the active patch');
    expect((await repo.get<typeof data>('static'))?.version.patch).toBe('18.3');
  });
  it('loads warm cache and clamps settings', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    await repo.set('settings', { personalWeight: 1, historyWindow: 90 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const result = await loadApplication(repo);
    expect(result.source).toBe('Local cache');
    expect(result.settings).toEqual({
      difficultyPreference: 'anything',
      personalWeight: 0.1,
      historyWindow: 10,
      riotId: '',
      riotPlatform: 'EUW1',
      homeRecommendation: defaultSettings.homeRecommendation,
      screenIntelligence: defaultSettings.screenIntelligence,
    });
    expect(result.portfolio.plans).toHaveLength(3);
  });
  it('preserves an existing persisted historyWindow of 20 without guessing intentionality', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    await repo.set('settings', {
      personalWeight: 0.05,
      historyWindow: 20,
      riotId: 'ExistingUser#EUW',
      riotPlatform: 'EUW1',
      homeRecommendation: defaultSettings.homeRecommendation,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const result = await loadApplication(repo);
    expect(result.settings.historyWindow).toBe(20);
    expect(result.settings.riotId).toBe('ExistingUser#EUW');
    expect(result.settings.homeRecommendation).toEqual(defaultSettings.homeRecommendation);
  });
  it('defaults historyWindow to 10 when unconfigured or invalid in stored settings', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    await repo.set('settings', {
      personalWeight: 0.08,
      riotId: 'NewUser#EUW',
      riotPlatform: 'EUW1',
      homeRecommendation: defaultSettings.homeRecommendation,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const result = await loadApplication(repo);
    expect(result.settings.historyWindow).toBe(10);
    expect(result.settings.personalWeight).toBe(0.08);
  });
  it('failed refresh preserves the previously successful cache', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(refreshApplication(state(), repo)).rejects.toThrow('offline');
    expect(await repo.get('static')).toEqual(data);
  });
  it('keeps cached plans usable if the optional art manifest fails', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await loadApplication(repo);
    expect(result.portfolio.plans).toHaveLength(3);
    expect(result.assets).toEqual({});
  });
  it('stores immutable selected-plan session snapshot', async () => {
    const repo = new MemoryRepository();
    const s = state();
    const session = await lockPlanSession(s.portfolio.plans[0].candidate.playbook.id, s, repo);
    expect(session.selectedPlaybookId).toBe(s.portfolio.plans[0].candidate.playbook.id);
    s.portfolio.plans = [];
    expect((await repo.getActivePlanSession())?.snapshot.portfolio.plans).toHaveLength(3);
  });
  it('refuses to lock a plan outside the portfolio', async () => {
    await expect(lockPlanSession('missing', state(), new MemoryRepository())).rejects.toThrow(
      'not in this portfolio',
    );
  });
});
