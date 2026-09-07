import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeCommunityDragon } from '../src/providers/communityDragon';
import { addPublicEntities, normalizePublicComps } from './metatft-normalize';
import { activateExternal } from './metatft-storage';
const root = join(
  process.env.LOCALAPPDATA ?? '.cache',
  'TFT Strategist',
  'external-data',
  'metatft',
);
const diagnostics = join(root, 'diagnostics', new Date().toISOString().replace(/:/g, '-'));
await mkdir(diagnostics, { recursive: true });
const rawData = JSON.parse(await readFile('data/fixtures/cdragon-set18.json', 'utf8'));
const data = normalizeCommunityDragon(rawData, {
  source: 'Bundled audited CDragon snapshot',
  fetchedAt: new Date().toISOString(),
  patch: null,
  status: 'verified',
  note: 'Collector mapping catalog',
});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const captured = new Map<string, { url: string; body: unknown }>();
const pending: Promise<void>[] = [];
// Deliberately exclude usercontent, cookies, credentials, advertising and all app-only surfaces.
const allowed = new Map([
  ['/tft-comps-api/comps_data', 'definitions'],
  ['/tft-comps-api/comps_stats', 'stats'],
  ['/tft-stat-api/units', 'units'],
  ['/tft-stat-api/items_matches', 'items'],
  ['/tft-stat-api/traits', 'traits'],
  ['/tft-stat-api/patch', 'patch'],
  ['/lookups/TFTSet18_latest_en_us.json', 'lookup'],
]);
page.on('response', (response) => {
  const url = new URL(response.url()),
    key = allowed.get(url.pathname);
  if (
    !key ||
    !['api-hc.metatft.com', 'data.metatft.com'].includes(url.hostname) ||
    response.status() !== 200
  )
    return;
  pending.push(
    (async () => {
      try {
        captured.set(key, { url: response.url(), body: await response.json() });
      } catch {
        /* diagnosed below */
      }
    })(),
  );
});
try {
  await page.goto('https://www.metatft.com/comps', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.getByText('Avg Place', { exact: true }).first().waitFor({ timeout: 20000 });
  await Promise.all(pending);
  for (const key of ['definitions', 'stats', 'patch', 'lookup'])
    if (!captured.has(key))
      throw new Error(`Public response missing: ${key}; collector schema or network changed`);
  const pageText = await page.locator('body').innerText();
  const raw = {
    definitions: captured.get('definitions')!.body,
    stats: captured.get('stats')!.body,
    statsUrl: captured.get('stats')!.url,
    patch: captured.get('patch')!.body,
    lookup: captured.get('lookup')!.body,
    pageText,
  };
  const snapshot = normalizePublicComps(raw, data);
  for (const kind of ['units', 'items', 'traits'] as const) {
    const responsePromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).hostname === 'api-hc.metatft.com' &&
        allowed.get(new URL(r.url()).pathname) === kind &&
        r.status() === 200,
      { timeout: 25000 },
    );
    await page.goto(`https://www.metatft.com/${kind}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const entityResponse = await responsePromise;
    captured.set(kind, { url: entityResponse.url(), body: await entityResponse.json() });
    await Promise.all(pending);
    if (!captured.has(kind)) throw new Error(`Public ${kind} response unavailable`);
    addPublicEntities(snapshot, kind, captured.get(kind)!.body, raw.lookup, data);
  }
  await activateExternal(root, snapshot, data);
  await mkdir('public/data/external', { recursive: true });
  await activateExternal('public/data/external', snapshot, data);
  await writeFile(join(diagnostics, 'public-comp-input.json'), JSON.stringify(raw));
  console.log(
    `Activated ${snapshot.comps.length} mapped public comps; patch ${snapshot.manifest.scope.patch}${snapshot.manifest.scope.hotfix ?? ''}. ${root}`,
  );
} catch (error) {
  await page.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {});
  await writeFile(join(diagnostics, 'failure.txt'), String(error));
  console.error(`Refresh failed; last good snapshot retained. Diagnostics: ${diagnostics}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
