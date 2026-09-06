import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const width of [1440, 1000, 860]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.goto('http://127.0.0.1:1420/?riot-fixture=1');
  await page.locator('.plan-card').last().waitFor();
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.evaluate(async () => {
    const { FixtureRiotProvider } = await import('/src/providers/riot.ts');
    const original = FixtureRiotProvider.prototype.completedMatch;
    FixtureRiotProvider.prototype.completedMatch = async function (...args) {
      await new Promise((r) => setTimeout(r, 1500));
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
  await page.locator('.meta-progress').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `artifacts/meta-v1/progress-${width}.png` });
  if (await page.locator('main').evaluate((e) => e.scrollWidth > e.clientWidth))
    throw Error('Overflow');
  await page.getByRole('button', { name: 'Cancel meta refresh' }).click();
  await page.getByText('Meta refresh cancelled. Cached evidence retained.').waitFor();
  await page.close();
}
await browser.close();
