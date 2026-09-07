import { expect, test } from '@playwright/test';

for (const width of [1440, 860])
  test(`Contest Edge Home is exact and compact at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel('Current level')).toHaveCount(0);
    await expect(page.locator('.home-plan-grid .plan-card')).toHaveCount(3);
    await expect(page.locator('.alternative-list article')).toHaveCount(5);
    await expect(page.getByText('Check a comp in this lobby', { exact: true })).toBeVisible();

    const ids = await page
      .locator('.home-plan-grid .plan-card h2, .alternative-name strong')
      .allTextContents();
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of await page.locator('.home-plan-grid .plan-card').all()) {
      const text = await card.getByLabel('Final Safety calculation').innerText();
      const base = Number(text.match(/Base Performance\s+(-?\d+\.\d)/)?.[1]);
      const lowPick = Number(text.match(/Low-pick edge\s+([+-]\d+\.\d)/)?.[1]);
      const lobby = Number(text.match(/Lobby\s+([+-]\d+\.\d)/)?.[1]);
      const final = Number(text.match(/Final Safety\s+(\d+\.\d)/)?.[1]);
      expect(final).toBe(Math.round((base + lowPick + lobby) * 10) / 10);
    }

    const primaryNames = await page.locator('.home-plan-grid .plan-card h2').allTextContents();
    const firstFinal = await page
      .locator('.home-plan-grid .plan-card')
      .first()
      .getByLabel('Final Safety calculation')
      .getByText(/Final Safety/)
      .innerText();
    await page.getByRole('button', { name: 'Add comparison' }).click();
    await expect(page.getByLabel('Comp checker comparison')).toBeVisible();
    await expect(page.locator('.checker-row').nth(1)).toContainText(
      firstFinal.match(/\d+\.\d/)![0],
    );
    await expect(page.locator('.checker-row').nth(1).locator('.checker-detail')).toContainText(
      /Avg .*Win .*Pick Rate/,
    );
    expect(await page.locator('.home-plan-grid .plan-card h2').allTextContents()).toEqual(
      primaryNames,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.locator('main').evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/post-live/home-${width}.png`, fullPage: true });
  });

test('Clear Lobby ends only the active lobby context', async ({ page }) => {
  await page.goto('/?riot-fixture=1');
  await page.getByRole('button', { name: 'Scouting', exact: true }).click();
  await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
  await expect(page.getByText('7/7 profiles')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Your plans', exact: true }).click();
  await expect(page.getByLabel('Active lobby status')).toContainText('7/7 scouted');
  await page.getByRole('button', { name: 'Clear Lobby', exact: true }).click();
  await expect(page.getByLabel('Active lobby status')).toContainText('Not scanned');
  await expect(page.getByRole('button', { name: 'Clear Lobby', exact: true })).toHaveCount(0);
  for (const score of await page.getByLabel('Final Safety calculation').all())
    await expect(score).toContainText('Lobby +0.0');
});

test('Recommendation Lab persists, validates, and resets defaults', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.getByText('Recommendation Lab', { exact: true }).click();
  const maxBonus = page.getByLabel('Maximum low-pick bonus');
  await expect(maxBonus).toHaveValue('6');
  await maxBonus.fill('5');
  await expect(page.getByRole('status')).toContainText('Settings saved locally');
  await page.reload();
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.getByText('Recommendation Lab', { exact: true }).click();
  await expect(page.getByLabel('Maximum low-pick bonus')).toHaveValue('5');
  await page.getByRole('button', { name: 'Reset Defaults', exact: true }).click();
  await expect(page.getByLabel('Maximum low-pick bonus')).toHaveValue('6');
  await expect(page.getByLabel('Top-4 weight')).toHaveValue('70');
  await expect(page.getByLabel('Average-placement weight')).toHaveValue('20');
  await expect(page.getByLabel('Win-rate weight')).toHaveValue('10');
  await expect(page.getByLabel('Base-performance percentile gate')).toHaveValue('50');
  await expect(page.getByLabel('Base-percentile ramp')).toHaveValue('35');
});
