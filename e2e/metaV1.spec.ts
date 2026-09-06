import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { MetaBundle } from '../src/services/discoveryRefresh';
const metaFixture = async (count = 120, region = 'EUW1'): Promise<MetaBundle> =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/emit-meta-fixture.ts', String(count), region],
      { encoding: 'utf8', maxBuffer: 30_000_000 },
    ),
  );
import { capture } from './capture';
for (const width of [1440, 1000, 860])
  test(`Current meta catalog, scope and verified code at ${width}`, async ({ page, context }) => {
    const mature = await metaFixture(),
      small = await metaFixture(1, 'NA1');
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.locator('.plan-card').last().waitFor();
    await page.evaluate(
      ({ mature, small }) => {
        for (const [key, b] of [
          ['mature', mature],
          ['small', small],
        ] as const)
          localStorage.setItem(`strategist:v1:${key}`, JSON.stringify(b));
        localStorage.setItem('strategist:v1:meta-current:v1', JSON.stringify(mature));
        localStorage.setItem(
          'strategist:v1:meta-catalog-index:v1',
          JSON.stringify(['mature', 'small']),
        );
      },
      { mature, small },
    );
    await page.reload();
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await expect(page.getByText(/960 boards/)).toBeVisible();
    await expect(
      page.locator('.library-metrics').filter({ hasText: 'play rate' }).first(),
    ).toBeVisible();
    await page.getByLabel('Sort comps').selectOption('popularity');
    await capture(page, { path: `artifacts/meta-v1/mature-${width}.png` });
    await page.getByLabel('Catalog platform').selectOption('NA1');
    await expect(page.getByText(/8 boards/)).toBeVisible();
    await expect(page.getByLabel('Catalog rankCohort')).toHaveValue(
      'CHALLENGER / GRANDMASTER / MASTER',
    );
    await expect(page.getByLabel('Catalog windowDays')).toHaveValue('3');
    await expect(page.getByText(/Insufficient sample/).first()).toBeVisible();
    await capture(page, { path: `artifacts/meta-v1/insufficient-${width}.png` });
    await page.getByLabel('Catalog rankCohort').selectOption('CHALLENGER');
    await expect(page.getByLabel('Catalog platform')).toHaveValue('EUW1');
    await expect(page.getByLabel('Catalog windowDays')).toHaveValue('7');
    await page.getByLabel('Search comps, units, or traits').fill('Adaptors');
    await page.locator('.library-card').first().click();
    await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeEnabled();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /Copy Team Code/ }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '0241b40e41642443742a40f43a000000TFTSet18',
    );
    await capture(page, { path: `artifacts/meta-v1/team-code-${width}.png` });
    await page.locator('.augment-reference summary').click();
    await page.getByLabel('Find augment').fill('');
    await page.locator('#augments').scrollIntoViewIfNeeded();
    await expect(page.locator('.augment-reference .augment-tile')).toHaveCount(6);
    await capture(page, { path: `artifacts/meta-v1/augments-${width}.png` });
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Current meta', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Meta rank').locator('option:disabled')).toHaveCount(3);
    await expect(page.getByLabel('Meta window').locator('option:disabled')).toHaveCount(1);
    await capture(page, { path: `artifacts/meta-v1/settings-${width}.png` });
    expect(await page.locator('main').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
test('Meta refresh cancellation retains visible evidence and safe retry', async ({ page }) => {
  await page.goto('/?riot-fixture=1');
  await page.locator('.plan-card').last().waitFor();
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/providers/riot.ts';
    const { FixtureRiotProvider } = await import(/* @vite-ignore */ path);
    const original = FixtureRiotProvider.prototype.completedMatch;
    FixtureRiotProvider.prototype.completedMatch = async function (...args: unknown[]) {
      await new Promise((r) => setTimeout(r, 300));
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel meta refresh' })).toBeVisible();
  await page.locator('.meta-progress').scrollIntoViewIfNeeded();
  await capture(page, { path: 'artifacts/meta-v1/progress.png' });
  await page.getByRole('button', { name: 'Cancel meta refresh' }).click();
  await expect(page.getByText('Meta refresh cancelled. Cached evidence retained.')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
  await expect(page.getByText(/boards analyzed across/)).toBeVisible({ timeout: 15000 });
});
