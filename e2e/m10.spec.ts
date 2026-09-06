import { capture } from './capture';
import { test, expect } from '@playwright/test';
for (const width of [1440, 1000, 860])
  test(`M10 automatic lobby, themes, safe session actions and offline recovery ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?riot-fixture=1');
    await page.getByRole('button', { name: 'Scouting', exact: true }).click();
    await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
    await expect(page.getByText(/7 opponents discovered/)).toBeVisible();
    await expect(page.getByText('7/7 profiles')).toBeVisible();
    await capture(page, { path: `artifacts/m10-auto-${width}.png` });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    const snapshot = await page.evaluate(
      () => JSON.parse(localStorage.getItem('strategist:v1:plan-sessions')!)[0].snapshotFingerprint,
    );
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    await page.getByRole('tab').first().click();
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await page.getByRole('button', { name: 'Purple accent', exact: true }).click();
    await page.getByRole('button', { name: 'Charcoal background', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'Purple');
    await expect(page.locator('html')).toHaveAttribute('data-background', 'Charcoal');
    await capture(page, { path: `artifacts/m10-theme-settings-${width}.png` });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'Purple');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('strategist:v1:plan-sessions')!)[0].snapshotFingerprint,
      ),
    ).toBe(snapshot);
    await page.route(/^https:\/\//, (route) => route.abort());
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeEnabled();
    await page.locator('.planner-verification>summary').click();
    await expect(page.getByLabel('Verified roster code')).toHaveValue(/^02[0-9a-f]{30}TFTSet18$/);
    await page.locator('main').evaluate((el) => el.scrollTo(0, 0));
    await capture(page, { path: `artifacts/m10-theme-active-${width}.png` });
    await page.getByRole('button', { name: 'Post-game', exact: true }).click();
    await expect(page.locator('.history-card')).toBeVisible();
    await capture(page, { path: `artifacts/m10-theme-history-${width}.png` });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await capture(page, { path: `artifacts/m10-theme-plans-${width}.png` });
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reset appearance', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'Gold');
    await expect(page.locator('html')).toHaveAttribute('data-background', 'Navy');
  });
test('M10 invalid appearance and failed persistence stay usable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('strategist:appearance:v1', 'invalid json'));
  await page.goto('/');
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'Gold');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'strategist:appearance:v1') throw new Error('quota');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Blue accent', exact: true }).click();
  await expect(
    page.getByText('Applied for this visit. Appearance could not be saved.'),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'Blue');
});

test('M10 current-lobby failures explain safe provider errors and retain retry', async ({
  page,
}) => {
  await page.goto('/?riot-fixture=1');
  await page.getByRole('button', { name: 'Scouting', exact: true }).click();
  for (const code of ['auth', 'rate-limited']) {
    await page.evaluate(async (code) => {
      const modulePath = '/src/providers/riot.ts';
      const { FixtureRiotProvider, RiotProviderError } = await import(
        /* @vite-ignore */ modulePath
      );
      FixtureRiotProvider.prototype.lobby = async () => {
        throw new RiotProviderError(code);
      };
    }, code);
    await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
    await expect(page.locator('.riot-message')).toContainText(
      code === 'auth' ? 'Riot rejected' : 'Riot is rate limiting',
    );
    await expect(
      page.getByRole('button', { name: 'Scan current lobby', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.riot-message')).toContainText('cached plans still work');
  }
});
