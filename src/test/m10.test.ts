import { describe, expect, it, vi } from 'vitest';
import { normalizeAppearance, ACCENTS, BACKGROUNDS } from '../app/appearance';
import {
  candidatePlannerCode,
  decodePlannerCode,
  encodePlannerSlots,
  teamPlanner,
} from '../rules/teamPlanner';
import wire from '../../data/fixtures/set18-teamplanner-blitz.json';
import mapping from '../../data/rules/set18.teamplanner.json';
import { data, playbooks } from './fixtures';
import { discoverCurrentLobby } from '../services/currentLobby';
import { createRiotPreviewProvider, PREVIEW_OWN_RIOT_ID } from '../providers/riotPreview';
import { MemoryHistoryStore } from '../storage/history';
import { scanLobby } from '../services/scouting';

describe('M10 appearance isolation and contrast', () => {
  it('falls back safely for malformed, inherited, or missing preference values', () => {
    for (const value of [null, {}, 'purple', { accent: 'toString', background: '__proto__' }])
      expect(normalizeAppearance(value)).toEqual({ accent: 'Gold', background: 'Navy' });
    expect(
      normalizeAppearance({ accent: 'Purple', background: 'Charcoal', apiKey: 'ignored' }),
    ).toEqual({ accent: 'Purple', background: 'Charcoal' });
  });
  it('keeps every preset readable for accent text and dark primary-button text', () => {
    const luminance = (hex: string) => {
      const rgb = hex
        .slice(1)
        .match(/../g)!
        .map((x) => parseInt(x, 16) / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
      return (x + 0.05) / (y + 0.05);
    };
    for (const accent of Object.values(ACCENTS)) {
      expect(ratio(accent, '#11151c')).toBeGreaterThan(4.5);
      for (const colors of Object.values(BACKGROUNDS))
        for (const bg of colors.slice(0, 4)) expect(ratio(accent, bg)).toBeGreaterThan(4.5);
    }
  });
});
describe('M10 independently evidenced Set 18 planner', () => {
  it('decodes the external fixture in exact slot order, retains 404 unresolved, and re-encodes exactly', () => {
    const decoded = decodePlannerCode(wire.code);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.map((slot) => slot.plannerId)).toEqual(wire.slots);
    expect(decoded.value.map((slot) => slot.championId)).toEqual(wire.expectedPublicIds);
    expect(decoded.value[4].state).toBe('unresolved');
    expect(decoded.value[9].state).toBe('empty');
    expect(encodePlannerSlots(decoded.value.map((slot) => slot.plannerId))).toEqual({
      ok: true,
      value: wire.code,
    });
  });
  it('matches 64 eligible IDs directly to the audited current set, with no alias guesses', () => {
    const eligible = mapping.entries.filter((x) => x.boardEligible);
    expect(eligible).toHaveLength(64);
    expect(new Set(mapping.entries.map((x) => x.plannerId)).size).toBe(mapping.entries.length);
    for (const row of eligible)
      expect(data.champions.find((c) => c.id === row.championId)).toMatchObject({
        name: row.name,
        set: 18,
        boardEligible: true,
      });
  });
  it('rejects wrong set, prefix, length, suffix, slot range and non-hex', () => {
    for (const invalid of [
      wire.code.replace('02', '01'),
      wire.code.replace('Set18', 'Set17'),
      wire.code + '0',
      wire.code.replace('3eb', 'xyz'),
    ])
      expect(decodePlannerCode(invalid).ok).toBe(false);
    for (const slots of [[], Array(10).fill(-1), Array(10).fill(4096), Array(10).fill(0.5)])
      expect(encodePlannerSlots(slots).ok).toBe(false);
  });
  it('creates a known roster candidate with human-verified copying', () => {
    const board = playbooks.find((p) => p.id === 'adaptor-reroll')!.target;
    const code = candidatePlannerCode(board, data);
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    const decoded = decodePlannerCode(code.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.filter((s) => s.state !== 'empty').map((s) => s.championId)).toEqual(
      board.units.map((u) => u.championId),
    );
    expect(teamPlanner.encode(board)).toEqual({
      ok: true,
      value: '0241b40e41642443742a40f43a000000TFTSet18',
    });
    expect(teamPlanner.supportStatus({ set: 18 })).toMatchObject({
      mappingVerified: true,
      fixtureVerified: true,
      manualPasteVerified: true,
      state: 'supported',
    });
  });
  it('rejects Lux origins, placeholders, duplicates, runtime forms, excess capacity and changed static data', () => {
    const board = structuredClone(playbooks[0].target);
    for (const id of ['DA_Lux18_Base', 'DA_18_Lux_Sunbeam', 'DA_18_GnarBig', 'unknown']) {
      const changed = structuredClone(board);
      changed.units[0].championId = id;
      expect(candidatePlannerCode(changed, data).ok).toBe(false);
    }
    expect(candidatePlannerCode({ ...board, set: 17 }, data).ok).toBe(false);
    expect(candidatePlannerCode({ ...board, capacity: 1 }, data).ok).toBe(false);
    expect(
      candidatePlannerCode({ ...board, units: [board.units[0], board.units[0]] }, data).ok,
    ).toBe(false);
    const changed = structuredClone(data);
    changed.champions[0].cost++;
    expect(candidatePlannerCode(board, changed).ok).toBe(false);
    const lux = decodePlannerCode('02413000000000000000000000000000TFTSet18');
    expect(lux.ok && lux.value[0].state).toBe('ambiguous');
  });
});
describe('M10 current lobby uses the existing history pipeline', () => {
  it('resolves the configured account, discovers seven and reuses the warm own-account cache', async () => {
    const provider = createRiotPreviewProvider(data),
      store = new MemoryHistoryStore();
    const resolve = vi.spyOn(provider, 'resolveAccount');
    const discovered = await discoverCurrentLobby(provider, store, PREVIEW_OWN_RIOT_ID, 'EUW1');
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) return;
    expect(discovered.value.opponents).toHaveLength(7);
    expect(discovered.value.opponents.some((x) => x.puuid === discovered.value.own.puuid)).toBe(
      false,
    );
    const scanned = await scanLobby(discovered.value.opponents, provider, store, {
      set: 18,
      patch: data.version.patch,
      now: new Date().toISOString(),
      historyWindow: 20,
      requestedOpponents: 7,
      currentUnitIds: data.champions.map((c) => c.id),
      staticSourceVersion: data.version.sourceVersion,
    });
    expect(scanned.profilesCompleted).toBe(7);
    expect(scanned.relevantGamesAvailable).toBe(140);
    await discoverCurrentLobby(provider, store, PREVIEW_OWN_RIOT_ID, 'EUW1');
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('removes duplicate/self IDs, preserves partial coverage and tolerates missing display names', async () => {
    const provider = createRiotPreviewProvider(data);
    const own = await provider.resolveAccount('Strategist', 'M3');
    vi.spyOn(provider, 'lobby').mockResolvedValue({
      ok: true,
      value: [own.puuid, 'official-a', 'official-a', 'official-b', ''],
    });
    vi.spyOn(provider, 'accountByPuuid').mockRejectedValue(new Error('unavailable'));
    const result = await discoverCurrentLobby(
      provider,
      new MemoryHistoryStore(),
      PREVIEW_OWN_RIOT_ID,
      'EUW1',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.opponents.map((x) => x.puuid)).toEqual(['official-a', 'official-b']);
  });
  it('explains unsupported platform and missing key without starting a lobby request', async () => {
    const provider = createRiotPreviewProvider(data),
      lobby = vi.spyOn(provider, 'lobby');
    expect(
      (await discoverCurrentLobby(provider, new MemoryHistoryStore(), PREVIEW_OWN_RIOT_ID, 'PH2'))
        .ok,
    ).toBe(false);
    vi.spyOn(provider, 'connectionStatus').mockResolvedValue({
      keyDetected: false,
      source: 'unavailable',
    });
    expect(
      (await discoverCurrentLobby(provider, new MemoryHistoryStore(), PREVIEW_OWN_RIOT_ID, 'EUW1'))
        .ok,
    ).toBe(false);
    expect(lobby).not.toHaveBeenCalled();
  });
  it('does not invent participants when discovery returns no identities', async () => {
    const provider = createRiotPreviewProvider(data);
    vi.spyOn(provider, 'lobby').mockResolvedValue({ ok: true, value: [] });
    const result = await discoverCurrentLobby(
      provider,
      new MemoryHistoryStore(),
      PREVIEW_OWN_RIOT_ID,
      'EUW1',
    );
    expect(result.ok).toBe(false);
  });
});
