import { expect, test } from '@playwright/test';
import { capture } from './capture';
test.setTimeout(60000);
test('M11 browser catalog persists beyond localStorage quota and reads legacy payloads', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/storage/repository.ts';
    const { openRepository } = await import(/* @vite-ignore */ path);
    const repository = await openRepository();
    const key = 'meta-catalog:v1:storage-regression';
    const payload = { version: 1, observations: 'x'.repeat(6_000_000) };
    await repository.set(key, payload);
    const reference = localStorage.getItem(`strategist:v1:${key}`)!;
    const restored = await repository.get(key);
    await repository.set(key, { version: 2 });
    const replacement = await repository.get(key);
    localStorage.setItem(`strategist:v1:${key}`, JSON.stringify({ version: 0 }));
    const legacy = await repository.get(key);
    return {
      referenceBytes: reference.length,
      restoredLength: restored.observations.length,
      replacement,
      legacy,
    };
  });
  expect(result.referenceBytes).toBeLessThan(200);
  expect(result.restoredLength).toBe(6_000_000);
  expect(result.replacement).toEqual({ version: 2 });
  expect(result.legacy).toEqual({ version: 0 });
});
test('M11 autonomous discovered profile is visible through the production worker path', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.plan-card')).toHaveCount(3, { timeout: 20000 });
  const title = await page.evaluate(async () => {
    const paths = [
      '/src/test/fixtures.ts',
      '/src/test/m11Fixtures.ts',
      '/src/providers/riot.ts',
      '/src/storage/history.ts',
      '/src/storage/repository.ts',
      '/src/services/discoveryRefresh.ts',
      '/src/services/compRegistry.ts',
    ];
    const [f, m, riot, h, r, refresh, registry] = await Promise.all(
      paths.map((path) => import(/* @vite-ignore */ path)),
    );
    const matches = m.intelligenceMatches(32);
    const identities = matches.map((match: { participants: { puuid: string }[] }) => ({
      puuid: match.participants[0].puuid,
      gameName: match.participants[0].puuid,
      tagLine: 'TEST',
      platform: 'EUW1',
      routing: 'EUROPE',
    }));
    const result = await refresh.refreshMetaDiscovery(
      new riot.FixtureRiotProvider(matches, identities),
      new h.MemoryHistoryStore(),
      new r.MemoryRepository(),
      f.data,
      f.playbooks,
      {
        platform: 'EUW1',
        regionalRoute: 'EUROPE',
        set: 18,
        tiers: ['CHALLENGER'],
        playersPerTier: 32,
        matchesPerPlayer: 1,
        sourceType: 'fixture',
      },
      f.NOW,
    );
    localStorage.setItem('strategist:v1:static', JSON.stringify(f.data));
    localStorage.setItem(
      'strategist:v1:meta-current:v1',
      JSON.stringify({ version: 1, meta: result.meta, discovery: result.discovery }),
    );
    return registry
      .buildCompRegistry(f.playbooks, f.data, result.discovery, result.meta.intelligence)
      .find((e: { sourceKind: string }) => e.sourceKind === 'discovered').playbook.title;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Comps', exact: true }).click();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .click();
  await expect(page.getByRole('heading', { name: 'Observed core', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Observed holders, items and packages' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Observed augments' })).toBeVisible();
  await expect(page.getByText(/64 boards/).first()).toBeVisible();
  await page.getByLabel('Smart strategy intelligence').scrollIntoViewIfNeeded();
  await capture(page, { path: 'artifacts/m11/discovered-profile-1440.png' });
});

for (const width of [1440, 1000, 860])
  test(`M11 manual adaptation and knowledge at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.locator('.plan-card')).toHaveCount(3, { timeout: 20000 });
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    const before = await page.evaluate(
      () => JSON.parse(localStorage.getItem('strategist:v1:plan-sessions')!)[0].snapshotFingerprint,
    );
    await page.getByLabel('Current level', { exact: true }).selectOption('6');
    await page.getByLabel('Current stage', { exact: true }).selectOption('3-2');
    await page.getByLabel('Health band').selectOption('critical');
    await page.getByLabel('Economy band').selectOption('weak');
    await page.getByLabel('Find owned champion').fill('Xayah');
    await page.getByRole('button', { name: 'Xayah +', exact: true }).click();
    await page.getByRole('button', { name: 'Add Xayah copy', exact: true }).click();
    await page.getByRole('button', { name: 'On board', exact: true }).click();
    await expect(page.getByRole('button', { name: 'On board', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByLabel('Current game state').scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/current-game-${width}.png` });
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByLabel('Current level', { exact: true })).toHaveValue('6');
    await expect(page.getByLabel('Current stage', { exact: true })).toHaveValue('3-2');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('strategist:v1:plan-sessions')!)[0].snapshotFingerprint,
      ),
    ).toBe(before);
    await page.getByText('Entity mechanics', { exact: true }).click();
    await page.getByLabel('Inspect entity mechanics').selectOption('DA_18_Xayah');
    await expect(page.getByRole('heading', { name: 'Deadly Plumage' })).toBeVisible();
    await page.getByRole('button', { name: 'Close entity details' }).click();
    await page.getByRole('button', { name: 'Optimize board', exact: true }).click();
    await page.getByRole('button', { name: 'Build legal variants', exact: true }).click();
    await expect(page.getByText(/search score/).first()).toBeVisible();
    await page.getByLabel('Smart strategy intelligence').scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/intelligence-${width}.png` });
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await capture(page, { path: `artifacts/m11/plans-${width}.png` });
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(page.getByText(/Knowledge: knowledge-v1/)).toBeVisible();
    await capture(page, { path: `artifacts/m11/data-${width}.png` });
  });
