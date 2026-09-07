import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { externalHash } from '../src/providers/externalMeta';
for (const width of [1440, 1000, 860])
  test(`M12 unified catalog and refresh ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const external = JSON.parse(
      readFileSync(new URL('../data/fixtures/metatft-normalized.json', import.meta.url), 'utf8'),
    );
    external.manifest.retrievedAt = new Date().toISOString();
    external.manifest.contentHash = externalHash(external);
    await page.route('**/data/external/current.json', (r) => r.fulfill({ json: external }));
    await page.goto('/');
    await expect(page.getByLabel('Current level')).toHaveValue('', { timeout: 20000 });
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await expect(page.getByLabel('External meta scope')).toContainText('MetaTFT');
    await expect(page.getByLabel('External meta scope')).toContainText('Plat+');
    await page.screenshot({ path: `artifacts/m12/followup-library-${width}.png` });
    await page.getByLabel('Evidence filter').selectOption('External');
    await expect(page.locator('.library-card').first()).toContainText('External Reference');
    expect(await page.locator('.library-card').count()).toBeGreaterThan(20);
    await page.screenshot({ path: `artifacts/m12/followup-external-${width}.png` });
    await page.locator('.library-card').first().click();
    await expect(page.getByLabel('Game companion')).toBeVisible();
    await expect(page.getByLabel('Game companion')).toContainText('Fused avg');
    await page.locator('.companion-hex .entity-chip').first().focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    expect(await page.getByRole('tooltip').innerText()).not.toMatch(/@[A-Za-z0-9]+@|\\n|<[^>]+>/);
    await page.screenshot({ path: `artifacts/m12/followup-hover-${width}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Refresh MetaTFT Data', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('External Meta status')).toContainText('Compatible');
    await page.screenshot({ path: `artifacts/m12/followup-settings-${width}.png` });
  });
