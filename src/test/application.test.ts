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
  });
  it('loads warm cache and clamps settings', async () => {
    const repo = new MemoryRepository();
    await repo.set('static', data);
    await repo.set('settings', { personalWeight: 1, historyWindow: 90 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const result = await loadApplication(repo);
    expect(result.source).toBe('Local cache');
    expect(result.settings).toEqual({
      personalWeight: 0.1,
      historyWindow: 20,
      riotId: '',
      riotPlatform: 'EUW1',
      homeRecommendation: defaultSettings.homeRecommendation,
    });
    expect(result.portfolio.plans).toHaveLength(3);
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
