import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeCommunityDragon } from '../src/providers/communityDragon';
import { ExternalValidationError, reviewedPatch } from '../src/providers/externalMeta';
import { addPublicEntities, normalizePublicComps } from './metatft-normalize';
import { activateExternal } from './metatft-storage';
import {
  MetaTftRefreshError,
  safeMetaTftFailure,
  validateMetaTftPatchPreflight,
} from './metatft-diagnostics';
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
const patchUrl = 'https://api-hc.metatft.com/tft-stat-api/patch?queue=1100';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
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

async function collectRenderedCompRows(page: Page, providerCompIds: string[]) {
  const rows = [];
  for (const providerCompId of providerCompIds) {
    const row = page.locator(`#row_${providerCompId}`);
    if (!(await row.count())) continue;
    await row.scrollIntoViewIfNeeded().catch(() => undefined);
    await page
      .waitForFunction(
        (id) => {
          const element = document.getElementById(`row_${id}`);
          return element && !element.classList.contains('CompRowPlaceholder');
        },
        providerCompId,
        { timeout: 4000 },
      )
      .catch(() => undefined);
    if ((await row.getAttribute('class'))?.includes('CompRowPlaceholder')) continue;
    const captured = await row.evaluate((element, id) => {
      const difficultyLabels = [
        ...element.querySelectorAll('.CompRowTag.Easy, .CompRowTag.Medium, .CompRowTag.Hard'),
      ]
        .map((label) => label.textContent?.trim() ?? '')
        .filter(Boolean);
      const uniqueDifficultyLabels = [...new Set(difficultyLabels)];
      return {
        providerCompId: id,
        tier: element.querySelector('.CompRowTierBadge')?.textContent?.trim() ?? null,
        difficulty: uniqueDifficultyLabels.length === 1 ? uniqueDifficultyLabels[0] : null,
        levelingStyle: element.querySelector('.CompRowTag.boost')?.textContent?.trim() ?? null,
        packages: [...element.querySelectorAll('.Unit_Wrapper')].flatMap((holder) => {
          const href = holder
            .querySelector<HTMLAnchorElement>('a[href^="/units/"]')
            ?.getAttribute('href');
          const items = [
            ...holder.querySelectorAll<HTMLAnchorElement>('a.Items_Wrapper[href^="/items/"]'),
          ]
            .map((link) => link.getAttribute('href')?.replace('/items/', '') ?? '')
            .filter(Boolean);
          return href && items.length ? [{ holder: href.replace('/units/', ''), items }] : [];
        }),
      };
    }, providerCompId);
    rows.push(captured);
  }
  return rows;
}
try {
  let patchResponse: Response;
  try {
    patchResponse = await fetch(patchUrl, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new MetaTftRefreshError(
      'network-navigation',
      'MetaTFT refresh unavailable · using last good snapshot',
      { cause: error },
    );
  }
  if (!patchResponse.ok)
    throw new MetaTftRefreshError(
      'network-navigation',
      `MetaTFT patch preflight unavailable (${patchResponse.status}) · using last good snapshot`,
    );
  let patchBody: unknown;
  try {
    patchBody = await patchResponse.json();
  } catch (error) {
    throw new MetaTftRefreshError(
      'endpoint-schema',
      'MetaTFT patch endpoint or schema changed · using last good snapshot',
      { cause: error },
    );
  }
  validateMetaTftPatchPreflight(patchBody, reviewedPatch(data));
  captured.set('patch', { url: patchUrl, body: patchBody });

  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (error) {
    throw new MetaTftRefreshError(
      'browser-challenge',
      'MetaTFT browser collector could not start · using last good snapshot',
      { cause: error },
    );
  }
  const page = await browser.newPage();
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
  const requiredResponses = ['definitions', 'stats', 'lookup'].map((requiredKey) =>
    page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return allowed.get(url.pathname) === requiredKey && response.status() === 200;
      },
      { timeout: 30000 },
    ),
  );
  try {
    await page.goto('https://www.metatft.com/comps', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch (error) {
    throw new MetaTftRefreshError(
      'network-navigation',
      'MetaTFT navigation failed · using last good snapshot',
      { cause: error },
    );
  }
  try {
    await Promise.all(requiredResponses);
  } catch (error) {
    throw new MetaTftRefreshError(
      'endpoint-schema',
      'MetaTFT structured comp responses were unavailable · using last good snapshot',
      { cause: error },
    );
  }
  await Promise.all(pending);
  for (const key of ['definitions', 'stats', 'patch', 'lookup'])
    if (!captured.has(key))
      throw new MetaTftRefreshError(
        'endpoint-schema',
        `MetaTFT endpoint or schema changed (missing ${key}) · using last good snapshot`,
      );
  const pageText = await page.locator('body').innerText();
  const definitionBody = captured.get('definitions')!.body as {
    results?: { data?: { cluster_details?: Record<string, unknown> } };
  };
  const pageComps = await collectRenderedCompRows(
    page,
    Object.keys(definitionBody.results?.data?.cluster_details ?? {}),
  );
  const raw = {
    definitions: captured.get('definitions')!.body,
    stats: captured.get('stats')!.body,
    statsUrl: captured.get('stats')!.url,
    patch: captured.get('patch')!.body,
    lookup: captured.get('lookup')!.body,
    pageText,
    pageComps,
  };
  let snapshot;
  try {
    snapshot = normalizePublicComps(raw, data);
  } catch (error) {
    throw error instanceof MetaTftRefreshError || error instanceof ExternalValidationError
      ? error
      : new MetaTftRefreshError(
          'normalization-mapping',
          `MetaTFT normalization or mapping failed · using last good snapshot. ${error instanceof Error ? error.message : 'Unknown normalization error'}`,
          { cause: error },
        );
  }
  for (const kind of ['units', 'items', 'traits'] as const) {
    const responsePromise = page.waitForResponse(
      (r) =>
        new URL(r.url()).hostname === 'api-hc.metatft.com' &&
        allowed.get(new URL(r.url()).pathname) === kind &&
        r.status() === 200,
      { timeout: 25000 },
    );
    try {
      await page.goto(`https://www.metatft.com/${kind}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (error) {
      void responsePromise.catch(() => {});
      throw new MetaTftRefreshError(
        'network-navigation',
        `MetaTFT ${kind} navigation failed · using last good snapshot`,
        { cause: error },
      );
    }
    let entityResponse;
    try {
      entityResponse = await responsePromise;
    } catch (error) {
      throw new MetaTftRefreshError(
        'endpoint-schema',
        `MetaTFT ${kind} endpoint or schema changed · using last good snapshot`,
        { cause: error },
      );
    }
    let entityBody: unknown;
    try {
      entityBody = await entityResponse.json();
    } catch (error) {
      throw new MetaTftRefreshError(
        'endpoint-schema',
        `MetaTFT ${kind} endpoint returned an unreadable payload · using last good snapshot`,
        { cause: error },
      );
    }
    captured.set(kind, { url: entityResponse.url(), body: entityBody });
    await Promise.all(pending);
    if (!captured.has(kind))
      throw new MetaTftRefreshError(
        'endpoint-schema',
        `MetaTFT ${kind} endpoint or schema changed · using last good snapshot`,
      );
    try {
      addPublicEntities(snapshot, kind, captured.get(kind)!.body, raw.lookup, data);
    } catch (error) {
      throw new MetaTftRefreshError(
        'normalization-mapping',
        `MetaTFT normalization or mapping failed for ${kind} · using last good snapshot. ${error instanceof Error ? error.message : 'Unknown mapping error'}`,
        { cause: error },
      );
    }
  }
  await activateExternal(root, snapshot, data);
  await mkdir('public/data/external', { recursive: true });
  await activateExternal('public/data/external', snapshot, data);
  const publicCapture = {
    ...raw,
    units: captured.get('units')!.body,
    items: captured.get('items')!.body,
    traits: captured.get('traits')!.body,
  };
  await writeFile(join(diagnostics, 'public-collection.json'), JSON.stringify(publicCapture));
  if (process.argv.includes('--update-fixture')) {
    await writeFile('data/fixtures/metatft-public.json', JSON.stringify(publicCapture));
    await writeFile('data/fixtures/metatft-normalized.json', JSON.stringify(snapshot));
  }
  console.log(
    `Activated ${snapshot.comps.length} mapped public comps; patch ${snapshot.manifest.scope.patch}${snapshot.manifest.scope.hotfix ?? ''}. ${root}`,
  );
} catch (error) {
  const failure = safeMetaTftFailure(error);
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    await pages[0]?.screenshot({ path: join(diagnostics, 'failure.png') }).catch(() => {});
  }
  await writeFile(join(diagnostics, 'failure.txt'), `${failure.kind}: ${failure.message}`);
  console.error(`METATFT_REFRESH_ERROR:${failure.kind}:${failure.message}`);
  console.error(`Refresh failed; last good snapshot retained. Diagnostics: ${diagnostics}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
