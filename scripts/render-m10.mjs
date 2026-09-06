import { chromium } from 'playwright';
import fs from 'node:fs';
const pass = process.argv[2] ?? 'iteration1';
fs.mkdirSync(`artifacts/m10-${pass}`, { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu'],
});
for (const width of [1440, 1000, 860]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto('http://127.0.0.1:1420/?riot-fixture=1');
  await page.getByRole('heading', { name: 'Your plans', exact: true }).waitFor();
  const shot = async (name) => {
    await page.locator('main').evaluate((el) => el.scrollTo(0, 0));
    await page
      .locator('img')
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode().catch(() => {}))));
    await page.waitForTimeout(200); // Finish visual transitions before capture.
    await page.screenshot({ path: `artifacts/m10-${pass}/${name}-${width}.png` });
    console.log(
      name,
      width,
      await page
        .locator('main')
        .evaluate((el) => ({ overflow: el.scrollWidth > el.clientWidth, height: el.scrollHeight })),
    );
  };
  await shot('plans');
  await page.getByRole('button', { name: 'Explore playbook' }).first().click();
  await shot('playbook');
  await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
  await page.getByText('ACTIVE MATCH PLAN', { exact: true }).waitFor();
  await shot('active');
  await page.getByRole('button', { name: 'Comps', exact: true }).click();
  await page.getByRole('heading', { name: 'Comp Library', exact: true }).waitFor();
  await shot('catalog');
  await page.getByLabel('Search comps, units, or traits').fill('Invoker');
  await shot('catalog-filtered');
  await page.getByRole('button', { name: 'Post-game', exact: true }).click();
  await page.locator('.history-card').waitFor();
  await shot('history');
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Data & settings', exact: true }).waitFor();
  await shot('settings');
  await page.getByRole('button', { name: 'Scouting', exact: true }).click();
  await page.getByRole('heading', { name: 'Scouting', exact: true }).waitFor();
  await shot('scouting');
  await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
  await page.locator('.scout-result').waitFor();
  await shot('scan');
  await page.close();
}
await browser.close();
