import { expect, test } from '@playwright/test';
test('three plans, real art, readable detail and safe planner status', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Three plans. More possibilities.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore playbook' })).toHaveCount(3);
  await page
    .locator('.card-art img')
    .evaluateAll((images) => Promise.all(images.map((i) => (i as HTMLImageElement).decode())));
  expect(
    await page
      .locator('.card-art img')
      .evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
  ).toBe(true);
  await page.screenshot({ path: 'artifacts/home-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore playbook' }).first().click();
  await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Build toward this board' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/playbook-1440.png', fullPage: true });
  await page.getByRole('tab', { name: 'Stabilize', exact: true }).click();
  await expect(page.getByText('Stabilization board unverified')).toBeVisible();
  await page.getByRole('button', { name: 'Lock this plan' }).click();
  await expect(page.getByRole('button', { name: 'Plan locked', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByText(/Portfolio locked ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByText(/Portfolio locked ·/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('refresh failure keeps usable plans and settings persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Data & settings', exact: true })).toBeVisible();
  await page.getByLabel('Opponent history target').selectOption('20');
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await page.reload();
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByLabel('Opponent history target')).toHaveValue('20');
  await page.route('https://raw.communitydragon.org/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Refresh static source' }).click();
  await expect(page.getByRole('status')).toContainText('previous data and plans');
  await page.getByRole('button', { name: 'Your plans', exact: true }).click();
  await expect(page.locator('.plan-card')).toHaveCount(3);
});
for (const width of [1000, 860])
  test(`desktop layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('.plan-card')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/home-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  });
test('bundled data and all visible art work without external requests', async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await page
    .locator('.card-art img')
    .evaluateAll((images) => Promise.all(images.map((i) => (i as HTMLImageElement).decode())));
  expect(
    await page
      .locator('img')
      .evaluateAll((images) =>
        images.every(
          (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
        ),
      ),
  ).toBe(true);
});
test('loading and failed bundled-load recovery are coherent', async ({ page }) => {
  await page.route('**/data/static-set18.json', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 503, body: 'unavailable' });
  });
  await page.goto('/');
  await expect(page.getByText('Preparing your plans')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry local load' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/error-state.png' });
  await page.unroute('**/data/static-set18.json');
  await page.getByRole('button', { name: 'Retry local load' }).click();
  await expect(page.locator('.plan-card')).toHaveCount(3);
});
