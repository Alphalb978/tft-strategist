import { expect, test } from '@playwright/test';
import { capture } from './capture';

test('MetaTFT enrichment and difficulty preference are visible without changing safety', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.plan-card')).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByLabel('Difficulty preference')).toBeVisible();
  await expect(page.locator('.plan-card .comp-meta-badges').first()).toBeVisible();
  await expect(page.locator('.plan-card .is-item-holder').first()).toBeVisible();

  await page.getByRole('button', { name: 'Easy', exact: true }).click();
  const blossom = page.locator('.plan-card').filter({ hasText: 'Blossom Sett' });
  await expect(blossom).toBeVisible();
  await expect(blossom.getByText('Preferred Fit', { exact: true })).toBeVisible();
  await expect(blossom.getByText('+ Difficulty preference', { exact: true })).toBeVisible();
  await expect(blossom.getByText('Final Safety', { exact: true })).toBeVisible();
  await expect(blossom.getByText('Fast 8', { exact: true })).toHaveCount(1);
  await expect(blossom.locator('.plan-role')).not.toContainText('Fast 8');
  await expect(blossom.getByText(/Evidence confidence:/)).toBeVisible();
  await capture(page, { path: 'artifacts/m12-final-companion/home-easy-preference.png' });
  await blossom.scrollIntoViewIfNeeded();
  await blossom
    .locator('img')
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode().catch(() => {}))),
    );
  await blossom.screenshot({
    path: 'artifacts/m12-final-companion/home-easy-preferred-comp.png',
  });

  await page.getByRole('button', { name: 'Comps', exact: true }).click();
  const firstComp = page.locator('.library-card').first();
  await expect(firstComp.getByLabel('MetaTFT comp details')).toBeVisible();
  await expect(firstComp.getByLabel('Champion lineup and trusted items')).toBeVisible();
  await firstComp.screenshot({ path: 'artifacts/m12-final-companion/comps-enriched.png' });

  await firstComp.click();
  await page.getByRole('button', { name: 'Details · stages / items / stats', exact: true }).click();
  const providerItems = page.getByLabel('MetaTFT recommended item holders');
  await expect(providerItems).toBeVisible();
  await expect(
    providerItems.getByText('provider recommendation', { exact: true }).first(),
  ).toBeVisible();
  await providerItems.screenshot({
    path: 'artifacts/m12-final-companion/playbook-provider-items.png',
  });

  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByLabel('Default difficulty preference')).toHaveValue('anything');
  await page.getByLabel('Default difficulty preference').scrollIntoViewIfNeeded();
  await capture(page, { path: 'artifacts/m12-final-companion/settings-difficulty.png' });

  expect(errors).toEqual([]);
});
