import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import captured from '../data/fixtures/metatft-public.json';
import { normalizePublicComps, addPublicEntities } from './metatft-normalize';
import { data, playbooks, NOW } from '../src/test/fixtures';
import { fusedForPlan, matchExternal } from '../src/strategy/evidenceFusion';
import { optimizeBoards } from '../src/strategy/boardOptimizer';
import { scoreCandidate } from '../src/strategy/scoring';
import { emptyCurrentGame } from '../src/strategy/currentGame';
const run = (fn: () => void, n = 1) => {
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t) / n;
};
const normalization = run(() => {
  const s = normalizePublicComps(captured, data, NOW);
  for (const kind of ['units', 'items', 'traits'] as const)
    addPublicEntities(s, kind, captured[kind], captured.lookup, data);
}, 5);
const external = normalizePublicComps(captured, data, NOW);
const fusion = run(() => {
  for (const p of playbooks) fusedForPlan(p, external, data, NOW);
}, 100);
const matching = run(() => {
  for (const p of playbooks)
    for (const c of external.comps)
      matchExternal(
        p.target.units.map((u) => u.championId),
        p.family.core,
        c,
      );
}, 100);
const builder = run(() => {
  optimizeBoards({ data, plan: playbooks[0], external });
}, 3);
const whatIf = run(() => {
  for (const p of playbooks)
    scoreCandidate(p, {
      data,
      version: data.version,
      now: NOW,
      external,
      currentGame: { ...emptyCurrentGame(18, NOW), level: 8, copies: { [p.hero]: 6 } },
    });
}, 50);
const result = {
  version: 'm12-benchmark-v1',
  normalizationMs: normalization,
  fusionPortfolioMs: fusion,
  matchingCatalogMs: matching,
  builderMs: builder,
  whatIfPortfolioMs: whatIf,
  thresholds: { normalization: 1000, fusion: 100, matching: 100, builder: 5000, whatIf: 100 },
  render: 'Measured by M12 browser acceptance; see browser logs and screenshots',
};
console.log(JSON.stringify(result, null, 2));
await writeFile('artifacts/m12/benchmark.json', JSON.stringify(result, null, 2));
if (normalization > 1000 || fusion > 100 || matching > 100 || builder > 5000 || whatIf > 100)
  process.exitCode = 1;
