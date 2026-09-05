import { describe, expect, it } from 'vitest';
import raw from '../../data/fixtures/cdragon-set18.json';
import { assetUrl, normalizeCommunityDragon } from '../providers/communityDragon';
import { data, provenance } from './fixtures';
describe('real CommunityDragon fixture normalization', () => {
  it('ignores malformed out-of-set placeholders in the full export', () => {
    const full = {
      ...raw,
      items: [...raw.items, { apiName: 'TFT_legacy', name: null }],
      setData: [{ number: 17, mutator: 'TFTSet17', champions: [{ name: null }] }, ...raw.setData],
    };
    expect(normalizeCommunityDragon(full, provenance)).toEqual(data);
  });
  it('selects verified active mutator despite misleading internal name', () => {
    expect(raw.setData[0].name).toBe('Set10');
    expect(data.version.name).toBe('Enchanted Wilds');
    expect(data.version.set).toBe(18);
    expect(data.version.patchVerified).toBe(false);
  });
  it('normalizes IDs, costs, traits and art from source', () => {
    const x = data.champions.find((c) => c.name === 'Xayah')!;
    expect(x.id).toBe('DA_18_Xayah');
    expect(x.cost).toBe(1);
    expect(x.traitIds).toContain('DA_18_Elderwood');
    expect(x.icon).toMatch(/tft18_xayah.*\.png$/);
  });
  it('does not include neutral PvE units or historical items', () => {
    expect(data.champions.every((c) => c.id.startsWith('DA_'))).toBe(true);
    expect(data.items.every((i) => i.id.startsWith('DA_'))).toBe(true);
  });
  it('joins active item recipes and keeps augment enablement unverified', () => {
    expect(data.items.find((i) => i.id === 'DA_GuinsoosRageblade')?.components).toEqual([
      'DA_Component_RecurveBow',
      'DA_Component_NeedlesslyLargeRod',
    ]);
    expect(data.augments.length).toBeGreaterThan(200);
    expect(data.augments.every((a) => a.availability === 'unverified')).toBe(true);
  });
  it('keeps missing Eclipse thresholds unavailable', () => {
    expect(data.traits.find((t) => t.name === 'Eclipse')?.breakpoints).toEqual([]);
  });
  it('rejects a missing set and malformed unit instead of using memory', () => {
    expect(() => normalizeCommunityDragon({ ...raw, setData: [] }, provenance)).toThrow(/absent/);
    const bad = structuredClone(raw);
    bad.setData[0].champions[0].cost = -1;
    expect(() => normalizeCommunityDragon(bad, provenance)).toThrow();
  });
  it('rejects unknown trait references and missing identity probes', () => {
    const bad = structuredClone(raw);
    bad.setData[0].champions[0].traits = ['Invented'];
    expect(() => normalizeCommunityDragon(bad, provenance)).toThrow(/Unresolved trait/);
    bad.setData[0].champions = [];
    expect(() => normalizeCommunityDragon(bad, provenance)).toThrow(/identity probes/);
  });
  it('restricts asset paths and rejects traversal', () => {
    expect(assetUrl('https://evil.example/token')).toBeNull();
    expect(assetUrl('assets/../secret.png')).toBeNull();
    expect(assetUrl('None')).toBeNull();
  });
});
