import { describe, expect, it, vi } from 'vitest';
import {
  NativeRiotProvider,
  RiotProviderError,
  normalizeRiotMatch,
  sanitizeNativeRiotError,
} from '../providers/riot';
import { parseOpponentList, parseRiotId } from '../providers/riotId';
import { accountRouteFor, regionalRouteFor, spectatorTftSupported } from '../providers/riotRouting';

const catalog = {
  unitIds: new Set(['DA_18_Known']),
  itemIds: new Set(['DA_KnownItem']),
  traitIds: new Set(['DA_18_KnownTrait']),
  augmentIds: new Set(['DA_KnownAugment']),
};

const rawMatch = () => ({
  metadata: {
    data_version: '2',
    match_id: 'EUW1_123',
    participants: ['player'],
  },
  info: {
    game_datetime: Date.parse('2026-09-05T20:00:00Z'),
    game_version: 'Version 18.1.123.456',
    queue_id: 1234,
    tft_game_type: 'fixture-value-not-classified',
    tft_set_core_name: 'TFTSet18',
    tft_set_number: 18,
    mapId: 22,
    endOfGameResult: 'fixture-complete',
    participants: [
      {
        puuid: 'player',
        placement: 2,
        level: 8,
        augments: ['DA_KnownAugment', 'DA_FutureAugment'],
        traits: [
          {
            name: 'DA_18_KnownTrait',
            num_units: 4,
            style: 1,
            tier_current: 1,
            tier_total: 3,
          },
          { name: 'DA_18_FutureTrait', num_units: 2 },
        ],
        units: [
          {
            character_id: 'DA_18_Known',
            items: [],
            itemNames: ['DA_KnownItem', 'DA_FutureItem'],
            name: 'Known',
            rarity: 1,
            tier: 2,
          },
          {
            character_id: 'DA_18_FutureUnit',
            items: [999],
            tier: 1,
          },
        ],
      },
    ],
  },
});

describe('Riot routing and identity input', () => {
  it('maps platform and regional routes explicitly', () => {
    expect(regionalRouteFor('EUW1')).toBe('EUROPE');
    expect(regionalRouteFor('EUN1')).toBe('EUROPE');
    expect(regionalRouteFor('NA1')).toBe('AMERICAS');
    expect(regionalRouteFor('KR')).toBe('ASIA');
    expect(regionalRouteFor('OC1')).toBe('SEA');
    expect(accountRouteFor('OC1')).toBe('ASIA');
    expect(spectatorTftSupported('EUW1')).toBe(true);
    expect(spectatorTftSupported('PH2')).toBe(false);
    expect(() => regionalRouteFor('MOON1')).toThrow(/not a supported TFT platform/);
  });

  it('accepts Unicode, trims entries, and reports malformed/duplicate IDs', () => {
    expect(parseRiotId('  偵察者 # ＴＡＧ  ')).toEqual({
      gameName: '偵察者',
      tagLine: 'ＴＡＧ',
      display: '偵察者#ＴＡＧ',
    });
    const parsed = parseOpponentList(' Éclaireur#EUW\ninvalid\néclaireur#euw ');
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.invalid).toEqual(['invalid']);
    expect(parsed.duplicates).toEqual(['éclaireur#euw']);
    expect(() => parseRiotId('#tag')).toThrow(/gameName#tagLine/);
  });
});

describe('official match DTO normalization', () => {
  it('preserves official metadata and unresolved current-set evidence', () => {
    const match = normalizeRiotMatch(rawMatch(), catalog);
    expect(match).toMatchObject({
      id: 'EUW1_123',
      set: 18,
      patch: '18.1',
      queueId: 1234,
      gameType: 'fixture-value-not-classified',
      modeSupport: 'unverified',
    });
    expect(match.participants[0].units[1]).toMatchObject({
      championId: 'DA_18_FutureUnit',
      unresolvedUnit: true,
      unresolvedItems: ['riot-item:999'],
    });
    expect(match.participants[0].unresolvedAugmentIds).toEqual(['DA_FutureAugment']);
    expect(match.participants[0].traits[1]).toMatchObject({
      id: 'DA_18_FutureTrait',
      unresolved: true,
    });
    expect(match.participants[0].familyId).toBeUndefined();
    expect(match.participants[0].style).toBeUndefined();
  });

  it('rejects malformed or unexpected DTOs', () => {
    expect(() => normalizeRiotMatch({ nope: true }, catalog)).toThrow(RiotProviderError);
    const malformed = rawMatch();
    malformed.info.participants[0].placement = 0;
    expect(() => normalizeRiotMatch(malformed, catalog)).toThrow(/unexpected response shape/);
  });
});

describe('native bridge security and spectator normalization', () => {
  it.each([
    ['missing-key', null],
    ['not-found', 404],
    ['auth', 401],
    ['auth', 403],
    ['rate-limited', 429],
  ])('maps %s to a fixed safe error', async (code, status) => {
    const secret = 'RGAPI-super-secret';
    const bridge = {
      invoke: vi.fn().mockRejectedValue({ code, status, retryable: false, detail: secret }),
    };
    const provider = new NativeRiotProvider('EUW1', catalog, async () => bridge);
    const error = await provider.resolveAccount('Name', 'Tag').catch((value) => value);
    expect(error).toBeInstanceOf(RiotProviderError);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(sanitizeNativeRiotError(new Error(secret)))).not.toContain(secret);
  });

  it('keeps a missing match detail as a safe 404', async () => {
    const bridge = { invoke: vi.fn().mockRejectedValue({ code: 'not-found', status: 404 }) };
    const provider = new NativeRiotProvider('EUW1', catalog, async () => bridge);
    await expect(provider.completedMatch('EUW1_missing')).rejects.toMatchObject({
      code: 'not-found',
      status: 404,
    });
  });

  it('uses platform spectator data, excludes self/null, deduplicates and caps opponents', async () => {
    const participants = [
      { puuid: 'self' },
      { puuid: null },
      ...Array.from({ length: 9 }, (_, index) => ({ puuid: `p${index}` })),
      { puuid: 'p0' },
    ];
    const bridge = { invoke: vi.fn().mockResolvedValue({ participants }) };
    const provider = new NativeRiotProvider('EUW1', catalog, async () => bridge);
    const result = await provider.lobby({
      puuid: 'self',
      gameName: 'Me',
      tagLine: 'EUW',
      platform: 'EUW1',
      routing: 'EUROPE',
    });
    expect(result).toEqual({ ok: true, value: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'] });
    expect(bridge.invoke).toHaveBeenCalledWith(
      'riot_current_game',
      expect.objectContaining({ platform: 'EUW1' }),
    );
  });

  it('normalizes spectator 404 as not-in-game', async () => {
    const bridge = { invoke: vi.fn().mockRejectedValue({ code: 'not-found', status: 404 }) };
    const provider = new NativeRiotProvider('EUW1', catalog, async () => bridge);
    await expect(
      provider.lobby({
        puuid: 'self',
        gameName: 'Me',
        tagLine: 'EUW',
        platform: 'EUW1',
        routing: 'EUROPE',
      }),
    ).resolves.toEqual({ ok: false, error: 'not-in-game' });
  });
});
