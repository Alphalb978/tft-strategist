// Drives the packaged WebView through its actual UI/native IPC/SQLite path.
// No credentials, request headers, player identities, or raw match payloads are recorded.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const label = process.argv[2] ?? 'cold';
if (!['cold', 'warm', 'cached'].includes(label)) throw Error('Unknown run label');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
await page.getByLabel('Meta region', { exact: true }).selectOption('EUN1');
await page.getByLabel('Meta rank', { exact: true }).selectOption('Challenger');
await page.getByLabel('Meta window', { exact: true }).selectOption('7');
await page.getByLabel('Meta collection mode', { exact: true }).selectOption('quick');
const started = Date.now();
await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
const progress = [];
await page.waitForTimeout(100);
while (await page.getByRole('button', { name: 'Cancel meta refresh' }).count()) {
  const text = await page
    .locator('.meta-progress')
    .innerText()
    .catch(() => '');
  if (text && text !== progress.at(-1)?.text) {
    progress.push({ elapsedMs: Date.now() - started, text });
    console.log(text.replaceAll('\n', ' · '));
  }
  if (Date.now() - started > 150_000) throw Error('Quick run exceeded validation ceiling');
  await page.waitForTimeout(500);
}
const elapsedMs = Date.now() - started;
const summary = await page.evaluate(async () => {
  const rows = await window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
    db: 'sqlite:strategist.db',
    query: "SELECT value FROM settings WHERE key='meta-current:v1'",
    values: [],
  });
  if (!rows.length) return { published: false };
  const { meta: m, discovery: d } = JSON.parse(rows[0].value);
  return {
    published: true,
    meta: Object.fromEntries(
      Object.entries(m).filter(([k]) => !['observations', 'familyStats'].includes(k)),
    ),
    families: m.familyStats,
    discovery: Object.fromEntries(
      Object.entries(d).filter(
        ([k]) => !['clusters', 'observations', 'boards', 'noiseObservationIds'].includes(k),
      ),
    ),
    clusters: d.clusters.map((c) => ({
      id: c.id,
      lifecycle: c.lifecycle,
      relation: c.relation,
      games: c.stats.games,
      uniqueMatches: c.stats.uniqueMatches,
      recommendationEligible: c.recommendationEligible,
    })),
  };
});
await page.locator('.discovery-status').screenshot({ path: `artifacts/meta-v1/live-${label}.png` });
fs.writeFileSync(
  `artifacts/m10-validation/meta-live-${label}.json`,
  JSON.stringify({ label, elapsedMs, progress, ...summary }, null, 2),
);
console.log(
  JSON.stringify({ label, elapsedMs, published: summary.published, meta: summary.meta }, null, 2),
);
await browser.close();
