import { externalHash, validateExternal } from '../providers/externalMeta';
import { describe, it, expect, vi } from 'vitest';
import { data, playbooks, NOW } from './fixtures';
import captured from '../../data/fixtures/metatft-public.json';
import { normalizePublicComps, publicPickRate } from '../../scripts/metatft-normalize';
import { adoptionMetrics, PICK_HELP, DIRECT_HELP } from '../components/AdoptionMetric';
import { NativeRiotProvider, safeConnectionStatus, riotStatusLabel } from '../providers/riot';
import type { AggregateMetaDataset } from '../domain/models';
function fixture() {
  const external = normalizePublicComps(captured, data, NOW);
  external.comps = [
    {
      ...external.comps[0],
      units: playbooks[0].target.units.map((u) => u.championId),
      pickRate: { value: 0.48, unit: 'provider-display', source: 'public-page' },
    },
  ];
  const meta = {
    familyStats: [{ familyId: playbooks[0].family.id, games: 21, confidence: 0.7 }],
    classifiedBoards: 100,
    coverage: 0.8,
    rankCohort: ['MASTER', 'GRANDMASTER', 'CHALLENGER'],
    platform: 'EUN1',
    scope: { windowDays: 7 },
  } as unknown as AggregateMetaDataset;
  return { data, external, meta };
}
describe('M12 adoption labels', () => {
  it('formats provider milliseconds as the actual update date', () => {
    const raw = { ...captured, stats: { ...captured.stats, updated: Date.parse(NOW) } };
    expect(normalizePublicComps(raw, data, NOW).manifest.providerUpdated).toBe(
      NOW.replace('Z', '.000Z'),
    );
  });
  it('retains snapshot validation through JSON storage when Pick Rate is absent', () => {
    const s = normalizePublicComps(captured, data, NOW);
    const roundtrip = JSON.parse(JSON.stringify(s));
    expect(externalHash(roundtrip)).toBe(s.manifest.contentHash);
    expect(() => validateExternal(roundtrip, data)).not.toThrow();
  });
  it('separates reported external Pick Rate and classified Direct Share', () => {
    const result = adoptionMetrics(playbooks[0], fixture(), NOW);
    expect(result.pick).toMatchObject({ value: 0.48, unit: 'provider-display' });
    expect(result.direct).toBe(0.21);
    expect(result.scope).toContain('EUN1');
    expect(PICK_HELP).toContain('MetaTFT');
    expect(DIRECT_HELP).toContain('classified Riot boards');
  });
  it.each(['patch', 'stale', 'unmapped', 'scope', 'invalid', 'missing'] as const)(
    'falls back without fake Pick Rate: %s',
    (kind) => {
      const state = fixture();
      if (kind === 'patch') state.external.manifest.scope.patch = '0.0';
      if (kind === 'stale') state.external.manifest.retrievedAt = '2025-01-01T00:00:00Z';
      if (kind === 'unmapped') state.external.comps[0].units = [];
      if (kind === 'scope') state.external.manifest.scope.rank = null;
      if (kind === 'invalid') state.external.comps[0].pickRate!.value = NaN;
      if (kind === 'missing') delete state.external.comps[0].pickRate;
      const result = adoptionMetrics(playbooks[0], state, NOW);
      expect(result.pick).toBeNull();
      expect(result.direct).toBe(0.21);
    },
  );
  it('reads only explicit public row values and preserves their units', () => {
    expect(
      publicPickRate(
        'Adaptor Master Yi\nlvl 7\nAvg Place\n4.03\nPick Rate\n0.48\nWin Rate\n14.7%',
        'Adaptor Master Yi',
      ),
    ).toMatchObject({ value: 0.48, unit: 'provider-display' });
    expect(publicPickRate('Example\nAvg Place\n4.03\nPick Rate\n0.48%', 'Example')).toMatchObject({
      value: 0.48,
      unit: 'percent',
    });
    expect(publicPickRate('Sample 400 Population 1000', 'Example')).toBeUndefined();
  });
});
describe('Riot credential provider boundary', () => {
  const catalog = {
    unitIds: new Set<string>(),
    itemIds: new Set<string>(),
    traitIds: new Set<string>(),
    augmentIds: new Set<string>(),
  };
  it('uses existing bridge for save/test/remove and returns only safe status', async () => {
    const key = 'RGAPI-fixture-secret';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const invoke = vi.fn().mockResolvedValue({
      keyDetected: true,
      storedConfigured: true,
      source: 'secure-storage',
      status: 'connected',
      lastSuccess: 1000,
      key,
    });
    const provider = new NativeRiotProvider('EUW1', catalog, async () => ({ invoke }));
    const statuses = [
      await provider.saveCredential(key),
      await provider.testConnection(),
      await provider.removeCredential(),
      await provider.connectionStatus(),
    ];
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      'riot_save_key',
      'riot_test_connection',
      'riot_remove_key',
      'riot_connection_status',
    ]);
    expect(invoke.mock.calls[1][1]).toMatchObject({ platform: 'EUW1' });
    expect(JSON.stringify(statuses)).not.toContain(key);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it.each(['auth', 'rate-limited', 'transient', 'unavailable'])(
    'safe connection error %s',
    async (code) => {
      const provider = new NativeRiotProvider('EUW1', catalog, async () => ({
        invoke: vi.fn().mockRejectedValue({ code, detail: 'RGAPI-do-not-expose' }),
      }));
      const error = await provider.testConnection().catch((e) => e);
      expect(error.code).toBe(code);
      expect(JSON.stringify(error)).not.toContain('RGAPI');
      expect(riotStatusLabel(code)).not.toContain('RGAPI');
    },
  );
  it('missing native bridge preserves offline status', async () => {
    const provider = new NativeRiotProvider('EUW1', catalog, async () => {
      throw Error('offline');
    });
    expect((await provider.connectionStatus()).keyDetected).toBe(false);
    expect(safeConnectionStatus({ keyDetected: false, key: 'secret' })).not.toHaveProperty('key');
  });
});
