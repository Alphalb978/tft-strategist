import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { externalHash } from '../src/providers/externalMeta';
test('Comp overlay and global fallback render the same champion with explicit evidence scope', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = [
      '/node_modules/.vite/deps/react.js',
      '/node_modules/.vite/deps/react-dom_client.js',
      '/src/components/IntelligenceHover.tsx',
      '/src/test/fixtures.ts',
      '/src/test/entityIntelligenceFixture.ts',
    ];
    const [react, dom, hover, f, evidence] = await Promise.all(
      paths.map((p) => import(/* @vite-ignore */ p)),
    );
    const host = document.createElement('section');
    host.id = 'hover-fixture';
    host.className = 'panel';
    host.style.cssText =
      'position:fixed;inset:330px 100px auto;z-index:10000;min-height:350px;padding:50px;background:#151923';
    document.body.append(host);
    const b = {
      ...f.playbooks[0],
      strategy: { ...f.playbooks[0].strategy, itemHolders: [] },
      observed: undefined,
    };
    const a = {
      ...b,
      observed: {
        ...evidence.profile,
        items: [{ ...evidence.profile.items[0], ids: [evidence.itemB] }],
      },
    };
    dom.default.createRoot(host).render(
      react.default.createElement(
        'div',
        { style: { display: 'flex', gap: 330 } },
        ...[a, b].map((plan, index) =>
          react.default.createElement(
            'section',
            {
              'aria-label': index ? 'Comp B' : 'Comp A',
              key: index,
              style: { minWidth: 270 },
            },
            react.default.createElement(
              'h2',
              null,
              index ? 'Comp B · global fallback' : 'Comp A · specific package',
            ),
            react.default.createElement(hover.IntelligenceHover, {
              id: evidence.id,
              data: f.data,
              plan,
              intelligence: evidence.model,
              assets: {},
            }),
          ),
        ),
      ),
    );
  });
  await page.getByLabel('Comp A', { exact: true }).getByRole('button').focus();
  await expect(page.getByRole('tooltip')).toContainText('Comp evidence');
  await page.screenshot({ path: 'artifacts/m12/correctness-hover-comp.png' });
  await page.getByLabel('Comp B', { exact: true }).getByRole('button').focus();
  await expect(page.getByRole('tooltip')).toContainText('Global evidence');
  await expect(page.getByRole('tooltip')).not.toContainText('Supported item packages unavailable');
  await page.screenshot({ path: 'artifacts/m12/correctness-hover-global.png' });
});
test('External reference scoring and conservative builder', async ({ page }) => {
  const external = JSON.parse(
    readFileSync(new URL('../data/fixtures/metatft-normalized.json', import.meta.url), 'utf8'),
  );
  external.manifest.retrievedAt = new Date().toISOString();
  external.manifest.contentHash = externalHash(external);
  await page.route('**/data/external/current.json', (r) => r.fulfill({ json: external }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Comps', exact: true }).click();
  await page.getByLabel('Evidence filter').selectOption('External');
  await page.locator('.library-card').first().click();
  await expect(page.getByLabel('Game companion')).toContainText('Fused avg');
  await page.screenshot({ path: 'artifacts/m12/correctness-reference.png' });
  await page.getByRole('button', { name: 'Optimize board', exact: true }).click();
  await page.getByRole('button', { name: 'Build legal variants', exact: true }).click();
  await expect(page.locator('.builder-alternative').first()).toContainText('Experimental');
  await expect(page.locator('.builder-alternative').first()).toContainText(
    'Reference roster retention',
  );
  await page.locator('.builder-alternative').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/m12/correctness-builder.png' });
});

test('Riot source is prominent and saving replaces an expired environment credential', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    let source = 'native-environment',
      status = 'auth',
      stored = false;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === 'riot_save_key') {
            source = 'secure-storage';
            status = 'configured';
            stored = true;
          } else if (command === 'riot_test_connection') status = 'connected';
          else if (command !== 'riot_connection_status') throw { code: 'unavailable' };
          return {
            keyDetected: true,
            source,
            status,
            storedConfigured: stored,
            lastSuccess: status === 'connected' ? Date.now() : null,
          };
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  const api = page.getByLabel('Riot API settings');
  await expect(api).toContainText('Credential source: Environment override');
  await expect(api).toContainText('Invalid / expired');
  await api.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/m12/correctness-riot-environment.png' });
  await page.getByLabel('Riot API key', { exact: true }).fill('RGAPI-replacement-fixture');
  await page.getByRole('button', { name: 'Save key', exact: true }).click();
  await expect(api).toContainText('Credential source: Secure storage');
  await expect(api).toContainText('Key configured');
  await expect(page.getByLabel('Riot API key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByLabel('Riot API status')).toContainText('Connected');
  await expect(api).not.toContainText('RGAPI-replacement-fixture');
  await page.screenshot({ path: 'artifacts/m12/correctness-riot-saved.png' });
});
