import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import captured from '../../data/fixtures/metatft-public.json';
import { normalizePublicComps, addPublicEntities } from '../../scripts/metatft-normalize';
import { activateExternal } from '../../scripts/metatft-storage';
import { data, playbooks, NOW } from './fixtures';
import {
  externalHash,
  externalStatus,
  entityMapper,
  validateExternal,
} from '../providers/externalMeta';
import { fuseEvidence, matchExternal, externalTrend } from '../strategy/evidenceFusion';
import { positionBoard, validPositions } from '../strategy/positioning';
import { opportunitySignals } from '../strategy/opportunities';
import { scoreCandidate } from '../strategy/scoring';
import { emptyCurrentGame } from '../strategy/currentGame';
import { evaluateCalibration } from '../strategy/calibration';
import {
  createRecommendations,
  lockPlanSession,
  savePlanSessionManualState,
} from '../services/application';
import { MemoryRepository, defaultSettings } from '../storage/repository';

function snapshot() {
  const s = normalizePublicComps(captured, data, NOW);
  for (const kind of ['units', 'items', 'traits'] as const)
    addPublicEntities(s, kind, captured[kind], captured.lookup, data);
  return s;
}
describe('M12 public snapshot boundary', () => {
  it('normalizes captured public responses, exact canonical aliases and scope', () => {
    const s = snapshot();
    expect(s.comps).toHaveLength(53);
    expect(s.units).toHaveLength(65);
    expect(s.items).toHaveLength(141);
    expect(s.traits).toHaveLength(36);
    expect(s.manifest.scope).toMatchObject({
      set: 18,
      patch: '18.1',
      hotfix: 'd',
      window: 'Last 3 days',
      queue: 1100,
    });
    expect(s.traits[0].stats.average).toBeNull();
    expect(s.traits[0].conditions?.length).toBeGreaterThan(0);
    expect(s.augments).toEqual([]);
  });
  it('rejects altered filters and changed response schema', () => {
    expect(() => normalizePublicComps({ ...captured, stats: {} }, data, NOW)).toThrow();
    expect(() =>
      normalizePublicComps(
        {
          ...captured,
          stats: {
            ...captured.stats,
            filter_adjustment: { ...captured.stats.filter_adjustment, override_applied: true },
          },
        },
        data,
        NOW,
      ),
    ).toThrow(/filters/);
  });
  it('never silently fuzzy-maps or resolves ambiguous aliases', () => {
    const map = entityMapper([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Alpha' },
    ]);
    expect(map('Alpha')).toBeNull();
    expect(map('Alph')).toBeNull();
    expect(map('a')).toBe('a');
  });
  it('rejects wrong patch, duplicates, invalid percentages and count collapse', () => {
    const good = snapshot();
    for (const mutate of [
      (s: typeof good) => {
        s.manifest.scope.patch = '0.0';
      },
      (s: typeof good) => {
        s.units.push(s.units[0]);
      },
      (s: typeof good) => {
        s.comps[0].stats.top4 = 23;
      },
      (s: typeof good) => {
        s.units = s.units.slice(0, 3);
      },
    ]) {
      const bad = structuredClone(good);
      mutate(bad);
      bad.manifest.contentHash = externalHash(bad);
      expect(() => validateExternal(bad, data, good)).toThrow();
    }
  });
  it('archives good data and retains it on failed activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm12-'));
    try {
      const s = snapshot();
      await activateExternal(root, s, data);
      await activateExternal(root, s, data);
      expect(await readdir(join(root, 'archive'))).toHaveLength(1);
      await expect(activateExternal(root, { ...s, comps: [] }, data)).rejects.toThrow();
      expect(JSON.parse(await readFile(join(root, 'current.json'), 'utf8')).comps).toHaveLength(53);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('marks compatible old data stale and excludes cross-patch trends', () => {
    const s = snapshot();
    expect(externalStatus(s, data, '2026-10-01T00:00:00Z')).toContain('Stale');
    const next = structuredClone(s);
    next.manifest.scope.patch = '18.2';
    expect(externalTrend(s, next, s.comps[0].id)).toBeNull();
  });
});
describe('M12 strategic evidence and decisions', () => {
  const scope = snapshot().manifest.scope;
  const e = { sample: 10000, average: 4, top4: 0.6, win: 0.15, playRate: 0.1 };
  const internal = { average: 3, top4: 0.8, win: 0.2, effectiveSample: 30, patch: '18.1' };
  it('large compatible prior dominates tiny local evidence, which still adjusts it', () => {
    const f = fuseEvidence(e, scope, NOW, internal, '18.1', NOW);
    expect(f.average).toBeGreaterThan(3.95);
    expect(f.average).toBeLessThan(4);
    expect(f.externalWeight).toBeGreaterThan(f.internalWeight * 50);
  });
  it('wrong patch contributes zero; missing external falls back', () => {
    for (const ext of [e, undefined]) {
      const f = fuseEvidence(ext, { ...scope, patch: '18.2' }, NOW, internal, '18.1', NOW);
      expect(f.externalWeight).toBe(0);
      expect(f.average).toBe(3);
    }
  });
  it('unknown scope and stale evidence reduce confidence and preserve disagreement', () => {
    const a = fuseEvidence(e, scope, NOW, undefined, '18.1', NOW),
      b = fuseEvidence(e, { ...scope, rank: null }, NOW, undefined, '18.1', NOW),
      c = fuseEvidence(e, scope, NOW, undefined, '18.1', '2026-11-01T00:00:00Z');
    expect(b.confidence).toBeLessThan(a.confidence);
    expect(c.externalWeight).toBeLessThan(1);
    const d = fuseEvidence(e, scope, NOW, { ...internal, effectiveSample: 500 }, '18.1', NOW);
    expect(d.disagreement).toBe(true);
    expect(opportunitySignals({ ...d, internalWeight: 5, externalWeight: 5 }, 0)).toEqual([]);
  });
  it('matches full structure and flex variants without merging a shared carry', () => {
    const c = snapshot().comps[0];
    expect(matchExternal(c.units, [], c).relation).toBe('strong');
    expect(
      matchExternal([...c.units.slice(0, -1), 'unknown'], c.units.slice(0, 3), c).relation,
    ).toBe('variant');
    expect(matchExternal([c.units[0], 'x', 'y', 'z'], [c.units[0]], c).relation).toBe('unknown');
  });
  it('positions deterministically from known range and fails closed without it', () => {
    const p = playbooks[0],
      d = structuredClone(data);
    const missing = positionBoard(p, d);
    expect(
      missing.positions.length === 0 ||
        validPositions(
          missing.positions,
          p.target.units.map((u) => u.championId),
          p.target.capacity,
        ),
    ).toBe(true);
    expect(positionBoard(p, d)).toEqual(missing);
    expect(
      validPositions(
        [
          { championId: 'a', row: 0, column: 0 },
          { championId: 'b', row: 0, column: 0 },
        ],
        ['a', 'b'],
        2,
      ),
    ).toBe(false);
    expect(validPositions([{ championId: 'a', row: 4, column: 0 }], ['a'], 1)).toBe(false);
  });
  it('scenario copies/items/level remain temporary and score deltas are additive', () => {
    const g = emptyCurrentGame(18, NOW),
      before = structuredClone(g),
      p = playbooks[0];
    const scenario = { ...g, copies: { [p.hero]: 6 }, level: 8 };
    const base = scoreCandidate(p, { data, version: data.version, now: NOW, currentGame: g }),
      after = scoreCandidate(p, { data, version: data.version, now: NOW, currentGame: scenario });
    expect(g).toEqual(before);
    expect(after.score).not.toBe(base.score);
    expect(
      after.components.reduce((s, c) => s + c.contribution, 0) -
        base.components.reduce((s, c) => s + c.contribution, 0),
    ).toBeCloseTo(after.score - base.score, 0);
  });
  it('hypothetical core contest affects relevant fit and never changes observed lobby', () => {
    const p = playbooks[0],
      a = scoreCandidate(p, { data, version: data.version, now: NOW }),
      b = scoreCandidate(p, {
        data,
        version: data.version,
        now: NOW,
        scenarioPressure: p.family.core,
      });
    expect(b.score).toBeLessThan(a.score);
    expect(b.components.find((c) => c.key === 'lobby')?.label).toContain('Hypothetical');
  });
  it('calibration is descriptive and never tunes weights on empty history', () => {
    expect(evaluateCalibration([], [])).toMatchObject({
      rows: [],
      buckets: [],
      weightsChanged: false,
    });
  });
  it('can replay isolated internal-only and external-only outcome baselines offline', () => {
    const external = snapshot();
    const context = { data, version: data.version, now: NOW, external };
    const p = playbooks.find((p) =>
      external.comps.some((c) =>
        ['strong', 'variant'].includes(
          matchExternal(
            p.target.units.map((u) => u.championId),
            p.family.core,
            c,
          ).relation,
        ),
      ),
    )!;
    const internal = scoreCandidate(p, { ...context, outcomeMode: 'internal-only' });
    const broad = scoreCandidate(p, { ...context, outcomeMode: 'external-only' });
    expect(internal.fusion).toBeUndefined();
    expect(broad.fusion!.externalWeight).toBeGreaterThan(30);
    expect(broad.fusion!.internalWeight).toBe(0);
    expect(broad.score).not.toBe(internal.score);
  });
  it('persists model/evidence identity and manual history without mutating the locked decision', async () => {
    const external = snapshot();
    const state = {
      data,
      ...createRecommendations(data, defaultSettings, NOW),
      settings: defaultSettings,
      activeSession: null,
      source: 'Bundled snapshot' as const,
      assets: {},
      external,
      currentGame: emptyCurrentGame(18, NOW),
    };
    const repo = new MemoryRepository();
    const session = await lockPlanSession(
      state.portfolio.plans[0].candidate.playbook.id,
      state,
      repo,
      null,
      NOW,
    );
    const updated = await savePlanSessionManualState(
      { ...state, activeSession: session },
      repo,
      { currentGame: { ...state.currentGame, level: 8 } },
      NOW,
    );
    expect(updated.snapshot.calibration).toMatchObject({
      engine: 'm12-fusion-v1',
      externalHash: external.manifest.contentHash,
    });
    expect(updated.snapshot.calibration?.initialState?.level).toBe(1);
    expect(updated.manualState.currentGameHistory?.[0].level).toBe(8);
    expect(await repo.get(`external:${external.manifest.contentHash}`)).toEqual(external);
    expect((await repo.getActivePlanSession())?.snapshot.portfolio.plans).toHaveLength(3);
  });
});
