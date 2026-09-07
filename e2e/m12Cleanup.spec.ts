import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { externalHash } from '../src/providers/externalMeta';
for (const width of [1440, 1000, 860])
  test(`M12 cleanup metrics and Riot credentials ${width}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const snapshot = JSON.parse(
      readFileSync(new URL('../data/fixtures/metatft-normalized.json', import.meta.url), 'utf8'),
    );
    snapshot.manifest.retrievedAt = new Date().toISOString();
    for (const comp of snapshot.comps)
      comp.pickRate = { value: 0.48, unit: 'provider-display', source: 'public-page' };
    snapshot.manifest.contentHash = externalHash(snapshot);
    await page.route('**/data/external/current.json', (r) => r.fulfill({ json: snapshot }));
    const installBridge = () =>
      page.evaluate(() => {
        let stored = false,
          status = 'missing-key',
          lastSuccess: number | null = null;
        Object.assign(window, {
          __TAURI_INTERNALS__: {
            invoke: async (command: string) => {
              await new Promise((r) => setTimeout(r, 50));
              if (command === 'riot_save_key') {
                stored = true;
                status = 'configured';
              } else if (command === 'riot_remove_key') {
                stored = false;
                status = 'missing-key';
              } else if (command === 'riot_test_connection') {
                if (status === 'connected') {
                  status = 'auth';
                  throw { code: 'auth', status: 403, detail: 'RGAPI-mock-response-secret' };
                }
                status = 'connected';
                lastSuccess = Date.now();
              } else if (command !== 'riot_connection_status') throw { code: 'unavailable' };
              return {
                keyDetected: stored,
                storedConfigured: stored,
                source: stored ? 'secure-storage' : 'unavailable',
                status,
                lastSuccess,
              };
            },
          },
        });
      });
    await page.goto('/');
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await expect(page.getByLabel('MetaTFT Pick Rate').first()).toContainText('0.48');
    await expect(page.getByLabel('MetaTFT Pick Rate').first()).not.toContainText('%');
    await expect(page.getByLabel('MetaTFT Pick Rate').first()).toHaveAttribute(
      'title',
      /Broad MetaTFT/,
    );
    await page.screenshot({ path: `artifacts/m12/cleanup-library-${width}.png` });
    await page.locator('.library-card').first().click();
    await expect(page.getByLabel('Game companion')).toContainText('Pick Rate');
    await page.screenshot({ path: `artifacts/m12/cleanup-detail-primary-${width}.png` });
    await page.getByText('Evidence & method', { exact: true }).click();
    await page.getByText('Adoption · Evidence & Method', { exact: true }).click();
    await expect(page.getByText(/Share of our classified Riot boards/)).toBeVisible();
    await page.getByText(/Share of our classified Riot boards/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/m12/cleanup-detail-${width}.png` });
    await installBridge();
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    const api = page.getByLabel('Riot API settings');
    await api.scrollIntoViewIfNeeded();
    await expect(api.getByLabel('Riot API status')).toHaveText('Key required');
    await api.getByLabel('Riot API key').fill('RGAPI-local-test-only');
    await expect(api.getByLabel('Riot API key')).toHaveAttribute('type', 'password');
    await api.getByRole('button', { name: 'Save key', exact: true }).click();
    await expect(api.getByLabel('Riot API key')).toHaveValue('');
    await expect(api).toContainText('Saved securely');
    await api.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(api.getByLabel('Riot API status')).toHaveText('Connected');
    await page.screenshot({ path: `artifacts/m12/cleanup-settings-${width}.png` });
    await api.getByRole('button', { name: 'Test connection', exact: true }).click();
    await expect(api.getByLabel('Riot API status')).toHaveText('Invalid / expired');
    expect(await page.locator('body').innerText()).not.toContain('RGAPI-');
    await api.getByRole('button', { name: 'Remove key', exact: true }).click();
    await expect(api.getByLabel('Riot API status')).toHaveText('Key required');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('RGAPI-');
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await expect(page.locator('.plan-card')).toHaveCount(3);
  });
