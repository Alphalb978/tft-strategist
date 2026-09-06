import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { metaFixture } from './meta-fixture';
import { loadPlaybooks } from '../src/providers/playbooks';
import { filterAndSortComps } from '../src/features/CompLibrary';
import { deriveFamilyStatistics } from '../src/strategy/metaStatistics';
import type { StaticData } from '../src/domain/models';
const data = JSON.parse(fs.readFileSync('public/data/static-set18.json', 'utf8')) as StaticData;
const start = performance.now(),
  heap = process.memoryUsage().heapUsed;
const bundle = await metaFixture(1000);
const collectMs = performance.now() - start;
const plans = loadPlaybooks(data);
const statsStart = performance.now();
deriveFamilyStatistics(bundle.meta.observations, plans, new Date().toISOString());
const statisticsMs = performance.now() - statsStart;
const sortStart = performance.now();
for (let i = 0; i < 100; i++)
  filterAndSortComps(plans, data, bundle.meta, {
    search: '',
    evidence: 'all',
    style: 'all',
    sort: 'popularity',
  });
const sortMs = (performance.now() - sortStart) / 100;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:1420');
await page.locator('.plan-card').last().waitFor();
await page.evaluate(
  (b) => localStorage.setItem('strategist:v1:meta-current:v1', JSON.stringify(b)),
  bundle,
);
const reloadStart = performance.now();
await page.reload();
await page.locator('.plan-card').last().waitFor();
const startupMs = performance.now() - reloadStart;
const routeStart = performance.now();
await page.getByRole('button', { name: 'Comps', exact: true }).click();
await page.locator('.library-card').last().waitFor();
const routeMs = performance.now() - routeStart;
await browser.close();
const result = {
  boards: bundle.meta.currentSetBoards,
  classified: bundle.meta.classifiedBoards,
  cachedMatches: bundle.meta.telemetry.cacheHits,
  newMatches: bundle.meta.telemetry.uniqueMatchDetailsFetched,
  collectAndDiscoveryMs: collectMs,
  statisticsMs,
  sortMeanMs: sortMs,
  startupMs,
  routeMs,
  bundleBytes: Buffer.byteLength(JSON.stringify(bundle)),
  nodeHeapDeltaMiB: (process.memoryUsage().heapUsed - heap) / 1048576,
};
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync('artifacts/m10-validation/meta-benchmark.json', JSON.stringify(result, null, 2));
if (
  result.boards !== 8000 ||
  sortMs > 100 ||
  statisticsMs > 2000 ||
  collectMs > 15000 ||
  startupMs > 5000 ||
  routeMs > 2000
)
  process.exitCode = 1;
