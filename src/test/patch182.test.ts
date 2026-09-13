import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import normalized from '../../data/fixtures/metatft-normalized.json';
import rawStatic from '../../data/fixtures/cdragon-set18.json';
import type { ExternalSnapshot } from '../domain/externalMeta';
import {
  ExternalValidationError,
  externalHash,
  externalStatus,
  validateExternal,
} from '../providers/externalMeta';
import {
  MetaTftRefreshError,
  safeMetaTftFailure,
  validateMetaTftPatchPreflight,
} from '../../scripts/metatft-diagnostics';
import { activateExternal } from '../../scripts/metatft-storage';
import { ACTIVE_SET } from '../providers/communityDragon';
import { set18Rules } from '../rules/ruleSet';
import { data } from './fixtures';

function snapshot() {
  return structuredClone(normalized) as ExternalSnapshot;
}

function withScope(patch: string | null, set = 18) {
  const value = snapshot();
  value.manifest.scope.patch = patch;
  value.manifest.scope.set = set;
  value.manifest.contentHash = externalHash(value);
  return value;
}

describe('Patch 18.2 reviewed authority and MetaTFT safety', () => {
  it('accepts the reviewed Patch 18.2 MetaTFT snapshot', () => {
    expect(validateExternal(snapshot(), data).manifest.scope).toMatchObject({
      set: 18,
      patch: '18.2',
    });
    expect(externalStatus(snapshot(), data)).toContain('MetaTFT · Patch 18.2');
  });

  it.each(['18.1', '18.3'])(
    'rejects provider patch %s against the reviewed Patch 18.2 app',
    (patch) => {
      expect(() => validateExternal(withScope(patch), data)).toThrowError(
        new ExternalValidationError(
          'patch-mismatch',
          `External data patch mismatch: app expects 18.2, provider returned ${patch}. Last good snapshot retained.`,
        ),
      );
    },
  );

  it('rejects a set mismatch with safe expected and received metadata', () => {
    expect(() => validateExternal(withScope('18.2', 17), data)).toThrow(
      'External data set mismatch: app expects Set 18, provider returned Set 17. Last good snapshot retained.',
    );
  });

  it('preflights the public patch cheaply and refuses an unreviewed future patch', () => {
    expect(validateMetaTftPatchPreflight({ patch: '18.2', b_patch_version: '' }, '18.2')).toEqual(
      { patch: '18.2', b_patch_version: '' },
    );
    expect(() => validateMetaTftPatchPreflight({ patch: '18.3' }, '18.2')).toThrow(
      "MetaTFT currently reports TFT 18.3; Strategist is validated for 18.2. Update the app's reviewed TFT data before refreshing external meta. Last good snapshot retained.",
    );
    expect(() => validateMetaTftPatchPreflight({ version: '18.2' }, '18.2')).toThrow(
      'MetaTFT patch endpoint or schema changed',
    );
  });

  it('retains the last good snapshot after patch mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'patch182-'));
    try {
      const good = snapshot();
      await activateExternal(root, good, data);
      await expect(activateExternal(root, withScope('18.3'), data)).rejects.toThrow(
        'provider returned 18.3',
      );
      const retained = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
      expect(retained.manifest.contentHash).toBe(good.manifest.contentHash);
      expect(retained.manifest.scope.patch).toBe('18.2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies network failure safely without touching the last good snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'patch182-network-'));
    try {
      const good = snapshot();
      await activateExternal(root, good, data);
      const failure = safeMetaTftFailure(
        new MetaTftRefreshError(
          'network-navigation',
          'MetaTFT refresh unavailable · using last good snapshot',
        ),
      );
      expect(failure.kind).toBe('network-navigation');
      expect(failure.message).toBe('MetaTFT refresh unavailable · using last good snapshot');
      const retained = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
      expect(retained.manifest.contentHash).toBe(good.manifest.contentHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('continues to reject malformed and collapsed provider data', () => {
    expect(() => validateExternal({ manifest: {} }, data)).toThrow();
    const good = snapshot();
    const collapsed = snapshot();
    collapsed.units = collapsed.units.slice(0, 3);
    collapsed.manifest.contentHash = externalHash(collapsed);
    expect(() => validateExternal(collapsed, data, good)).toThrow('Partial scrape: units');
  });

  it('retains the reviewed active Set 18 identity and current structural roster', () => {
    const selected = rawStatic.setData[0];
    const ids = new Set(selected.champions.map((unit) => unit.apiName));
    expect(ACTIVE_SET).toMatchObject({ set: 18, patch: '18.2', mutator: 'TFTSet18' });
    expect(selected).toMatchObject({ number: 18, mutator: 'TFTSet18' });
    expect(ids.has('DA_18_Xayah')).toBe(true);
    expect(ids.has('DA_Fiddlesticks18')).toBe(true);
    expect(selected.champions).toHaveLength(74);
    expect(selected.traits).toHaveLength(36);
  });

  it('uses the official Patch 18.2 XP costs', () => {
    expect(set18Rules.experience.xpToNextLevel).toMatchObject({ 7: 56, 8: 64, 9: 64 });
    expect(set18Rules.experience.sourceRefs).toContain('riotPatch182');
  });

  it('keeps the represented Wisp cadence and leaves unmodeled Patch 18.2 prices out', () => {
    expect(set18Rules.mechanics.wisps).toMatchObject({
      shopPosition: 'rightmost',
      durationRounds: 1,
      planningPhaseOnly: true,
      appearsEveryOtherShop: true,
      stageFiveEveryOtherGuaranteedCategory: 'combat',
    });
    expect(set18Rules.patchAudit.reviewedNotModeled.join(' ')).toContain('Wisp prices');
    expect('prices' in set18Rules.mechanics.wisps).toBe(false);
  });
});
