import { expect, test } from '@playwright/test';
test('three plans, real art, readable detail and safe planner status', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Three plans. More possibilities.' })).toBeVisible(
    { timeout: 15_000 },
  );
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
  await page.getByRole('tab', { name: /Level 7 roll/ }).click();
  await expect(page.getByText('Exact board unavailable')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Three plans. More possibilities.' })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Data & settings', exact: true })).toBeVisible();
  await expect(page.getByText('known-stale', { exact: true })).toBeVisible();
  await expect(page.getByText(/Board & capacity: verified/)).toBeVisible();
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
test('M4 unit-history, lobby pressure, and recommendation fit are inspectable', async ({
  page,
}) => {
  await page.goto('/?riot-fixture=1');
  await expect(page.getByRole('heading', { name: 'Three plans. More possibilities.' })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByText('Fixture preview', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Riot ID', { exact: true })).toHaveValue('Strategist#M3');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Account resolved through the native Riot boundary.')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve & scan history' }).click();
  await expect(page.getByText('7/7 profiles')).toBeVisible();
  await expect(page.getByText('140/140 relevant games')).toBeVisible();
  await expect(page.locator('.opponent-profile-grid article')).toHaveCount(7);
  await expect(page.getByText('Historical unit pressure', { exact: true })).toBeVisible();
  const firstProfile = page.locator('.opponent-profile-grid article').first();
  await firstProfile.getByText(/Inspect \d+ unit signals/).click();
  expect(await firstProfile.locator('[data-unit-signal]').count()).toBeGreaterThan(3);
  await expect(firstProfile.getByText('last 5', { exact: true }).first()).toBeVisible();
  await expect(firstProfile.getByText(/rising|falling|stable/).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/m4-scouting-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Your plans', exact: true }).click();
  await expect(page.getByText(/Historical contest:/).first()).toBeVisible();
  await expect(page.getByLabel('Pressured critical units').first()).toBeVisible();
  await page.getByRole('button', { name: 'Explore playbook' }).first().click();
  await expect(page.locator('.contest-explanation').getByText('Lobby / contest fit')).toBeVisible();
  await expect(page.getByText(/equivalent historical users/).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/m4-playbook-1440.png', fullPage: true });
});
test('M4 partial identity resolution renders without fabricated opponent evidence', async ({
  page,
}) => {
  await page.goto('/?riot-fixture=1');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page
    .getByLabel('One Riot ID per line, or comma-separated', { exact: true })
    .fill('Scout One#M3\nMissing#M3');
  await page.getByRole('button', { name: 'Resolve & scan history', exact: true }).click();
  await expect(page.getByText('failed', { exact: true })).toBeVisible();
  await expect(page.getByText('partial', { exact: true })).toBeVisible();
  await expect(page.getByText('1/1 profiles')).toBeVisible();
  await expect(page.getByText('20/40 relevant games')).toBeVisible();
  await expect(page.locator('.opponent-profile-grid article')).toHaveCount(1);
});
test('M3.1 manual self-entry is explicitly ignored without a history scan', async ({ page }) => {
  await page.goto('/?riot-fixture=1');
  await expect(page.getByRole('heading', { name: 'Three plans. More possibilities.' })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Account resolved through the native Riot boundary.')).toBeVisible();
  await page
    .getByLabel('One Riot ID per line, or comma-separated', { exact: true })
    .fill('Strategist#M3');
  await page.getByRole('button', { name: 'Resolve & scan history', exact: true }).click();
  await expect(page.getByText('your account — ignored', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Your account was ignored; no opponent history requests were started.'),
  ).toBeVisible();
  await expect(page.locator('.scout-result')).toHaveCount(0);
});
test('M3 no-key state exposes no credential value', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByText('API key unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText(/RGAPI-/)).toHaveCount(0);
  await expect(page.getByLabel('Riot ID', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Platform')).toHaveValue('EUW1');
});
test('M5 Comp Library searches, filters, sorts, and opens attributed evidence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Comps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Comp Library' })).toBeVisible();
  await expect(page.locator('.library-card')).toHaveCount(13);
  await page.screenshot({ path: 'artifacts/m5-comps-1440.png', fullPage: true });
  await page.getByLabel('Search comps, units, or traits').fill('Elder Dragon');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByLabel('Search comps, units, or traits').fill('');
  await page.getByLabel('Roll style filter').selectOption('Fast 9');
  expect(await page.locator('.library-card').count()).toBeGreaterThan(0);
  await page.getByLabel('Roll style filter').selectOption('all');
  await page.getByLabel('Sort comps').selectOption('strength');
  await expect(page.getByText(/Outcome statistics are unavailable/)).toBeVisible();
  await page.locator('.library-card').first().click();
  await expect(page.getByText('Aggregate meta evidence', { exact: true })).toBeVisible();
  await expect(page.getByText(/Unavailable · recommendation outcome inputs/)).toBeVisible();
  expect(errors).toEqual([]);
});
for (const width of [1440, 1000, 860])
  test(`M6 discovery refresh and detail fit at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?riot-fixture=1');
    await expect(
      page.getByRole('heading', { name: 'Three plans. More possibilities.' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Comp discovery', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
    await expect(page.getByText(/boards analyzed across/)).toBeVisible();
    await expect(page.getByLabel('Comp discovery refresh status')).toContainText('21 boards');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/m6-data-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page.getByLabel('Evidence filter').selectOption('Curated');
    await expect(page.locator('.library-card')).toHaveCount(13);
    await page.getByLabel('Evidence filter').selectOption('all');
    await page.getByLabel('Search comps, units, or traits').fill('Variant of Adaptors');
    await expect(page.locator('.library-card')).toHaveCount(1);
    await expect(page.getByText(/Discovered · Experimental/)).toBeVisible();
    await page.locator('.library-card').click();
    await expect(page.getByRole('heading', { name: 'Discovery evidence' })).toBeVisible();
    await expect(page.getByText(/Not recommendation-eligible/)).toBeVisible();
    await expect(page.getByText('Positioning not verified', { exact: true })).toBeVisible();
    await expect(page.getByText('Decision Map unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('No supported pivot edge', { exact: true })).toBeVisible();
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/m6-detail-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

for (const width of [1440, 1000, 860])
  test(`M7 covered and partial playbooks are usable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Three plans. More possibilities.' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page.getByLabel('Search comps, units, or traits').fill('Adaptors');
    await page.locator('.library-card').click();
    await expect(page.getByRole('heading', { name: 'Build toward this board' })).toBeVisible();
    await expect(page.getByLabel('TFT board visualization')).toBeVisible();
    await expect(page.locator('.tft-hex')).toHaveCount(28);
    await expect(page.getByText('Positioning not verified', { exact: true })).toBeVisible();
    await expect(page.getByLabel('What am I looking for?')).toContainText('Slow roll at level 7');
    await page.getByRole('tab', { name: /Opener/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText('Master Yi');
    await page.getByRole('button', { name: /Yes Build toward the level 7 slow roll/ }).click();
    await expect(
      page.getByText('Branch complete. Reassess manually as the game changes.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Reset Decision Map' }).click();
    await expect(page.getByText('Natural Adaptors or reroll/artifact support?')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Portfolio pivot graph' })).toBeVisible();
    expect(await page.locator('.pivot-nodes button').count()).toBe(3);
    expect(await page.locator('.pivot-edges > button').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/m7-covered-${width}.png`, fullPage: true });

    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page.getByLabel('Search comps, units, or traits').fill('Apex Predator');
    await page.locator('.library-card').click();
    await expect(page.getByRole('tab', { name: /Sourced target only/ })).toBeVisible();
    await expect(page.getByText('Item guidance unavailable')).toBeVisible();
    await expect(page.getByText('Decision Map unavailable', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Level and roll plan')).toContainText('Fast 9');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/m7-partial-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
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
for (const width of [1000, 860])
  test(`M5 Comp Library controls fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await expect(page.locator('.library-card')).toHaveCount(13);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.getByLabel('Search comps, units, or traits').fill('Invoker');
    expect(await page.locator('.library-card').count()).toBeGreaterThan(0);
    await page.getByLabel('Sort comps').selectOption('sample');
    await page.screenshot({ path: `artifacts/m5-comps-${width}.png`, fullPage: true });
  });
for (const width of [1000, 860])
  test(`M4 scouting and lobby-fit layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?riot-fixture=1');
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Riot history & opponent scouting' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Resolve & scan history' }).click();
    await expect(page.getByText('7/7 profiles')).toBeVisible();
    await page.locator('.pressure-details summary').click();
    await page.locator('.unit-evidence-details summary').first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/m4-scouting-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await expect(page.getByLabel('Pressured critical units').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/m4-home-${width}.png`, fullPage: true });
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
