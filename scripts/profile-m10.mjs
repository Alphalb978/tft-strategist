import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const timing = async (work) => {
  const t = performance.now();
  await work();
  return +(performance.now() - t).toFixed(1);
};
const cold = await timing(async () => {
  await page.goto('http://127.0.0.1:1420/');
  await page.locator('.plan-card').last().waitFor();
});
const routes = [];
for (let i = 0; i < 5; i++)
  routes.push(
    await timing(async () => {
      await page.getByRole('button', { name: 'Comps', exact: true }).click();
      await page.locator('.library-card').last().waitFor();
      await page.getByRole('button', { name: 'Your plans', exact: true }).click();
      await page.locator('.plan-card').last().waitFor();
    }),
  );
await page.getByRole('button', { name: 'Explore playbook' }).first().click();
await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
await page.getByText('ACTIVE MATCH PLAN', { exact: true }).waitFor();
const bytes = await page.evaluate(() => localStorage.getItem('strategist:v1:plan-sessions').length);
const resumes = [];
for (let i = 0; i < 5; i++)
  resumes.push(
    await timing(async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByText('ACTIVE MATCH PLAN', { exact: true }).waitFor();
    }),
  );
const result = {
  environment: 'Vite localhost, headless Edge, 1440x1000; wall clock includes Playwright',
  coldMs: cold,
  libraryHomeRoundTripMs: routes,
  persistedSessionCharacters: bytes,
  warmReloadResumeMs: resumes,
};
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(
  `artifacts/m10-performance-${process.argv[2] ?? 'current'}.json`,
  JSON.stringify(result, null, 2),
);
console.log(result);
await browser.close();
