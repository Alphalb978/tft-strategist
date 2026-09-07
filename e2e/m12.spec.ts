import { readFileSync } from 'node:fs';
import { externalHash } from '../src/providers/externalMeta';
import { test, expect } from '@playwright/test';
for (const width of [1440, 1000, 860])
  test(`M12 companion and isolated scenario ${width}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const external = JSON.parse(
      readFileSync(new URL('../data/fixtures/metatft-normalized.json', import.meta.url), 'utf8'),
    );
    external.manifest.retrievedAt = new Date().toISOString();
    external.manifest.contentHash = externalHash(external);
    await page.route('**/data/external/current.json', (route) => route.fulfill({ json: external }));
    await page.goto('/');
    await expect(page.locator('.plan-card')).toHaveCount(3, { timeout: 20000 });
    await page.evaluate(async () => {
      const paths = [
        '/src/test/fixtures.ts',
        '/src/test/m11Fixtures.ts',
        '/src/providers/riot.ts',
        '/src/storage/history.ts',
        '/src/storage/repository.ts',
        '/src/services/discoveryRefresh.ts',
        '/src/services/compRegistry.ts',
      ];
      const [f, m, r, h, repo, refresh, registry] = await Promise.all(
        paths.map((p) => import(/* @vite-ignore */ p)),
      );
      const now = new Date().toISOString(),
        matches = m
          .acceptanceMatches(now)
          .map((match: { participants: { units: unknown[] }[] }) => ({
            ...match,
            participants: [
              ...match.participants.slice(0, 2),
              ...f.playbooks.slice(0, 5).map(
                (
                  plan: {
                    target: {
                      targetLevel: number;
                      units: { championId: string; stars?: number }[];
                    };
                  },
                  index: number,
                ) => ({
                  ...match.participants[2],
                  puuid: `curated-${index}`,
                  level: plan.target.targetLevel,
                  units: plan.target.units.map((u, j) => ({
                    ...(match.participants[2].units[0] as object),
                    championId: u.championId,
                    stars: u.stars ?? 2,
                    items: j === 0 ? m.observedItems : [],
                  })),
                }),
              ),
            ],
          }));
      const identities = matches.map((match: { participants: { puuid: string }[] }) => ({
        puuid: match.participants[0].puuid,
        gameName: 'Acceptance',
        tagLine: 'TEST',
        platform: 'EUW1',
        routing: 'EUROPE',
      }));
      const result = await refresh.refreshMetaDiscovery(
        new r.FixtureRiotProvider(matches, identities),
        new h.MemoryHistoryStore(),
        new repo.MemoryRepository(),
        f.data,
        f.playbooks,
        {
          platform: 'EUW1',
          regionalRoute: 'EUROPE',
          set: 18,
          tiers: ['CHALLENGER'],
          playersPerTier: 40,
          matchesPerPlayer: 1,
          mode: 'standard',
          windowDays: 7,
          sourceType: 'fixture',
        },
        now,
      );
      const storage = await repo.openRepository();
      await storage.set('static', f.data);
      await storage.set('meta-current:v1', {
        version: 1,
        meta: result.meta,
        discovery: result.discovery,
      });
      const entries = registry.buildCompRegistry(
        f.playbooks,
        f.data,
        result.discovery,
        result.meta.intelligence,
      );
      const found = entries.find(
        (e: { sourceKind: string; playbook: { observed?: { units: { role: string }[] } } }) =>
          e.sourceKind === 'discovered' &&
          e.playbook.observed?.units.some((u) => u.role === 'flex'),
      );
      return {
        title: found.playbook.title,
        sample: found.playbook.observed.estimate.sample,
        curated: f.playbooks[0].title,
        unit: f.data.champions.find((c: { id: string }) => c.id === f.playbooks[0].family.core[0])
          .name,
        item: m.observedItems[0],
        augment: m.observedAugment,
        inspectName: f.data.champions.find((c: { id: string }) => c.id === m.unknownCore[0]).name,
      };
    });

    await page.reload();
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page.screenshot({ path: `artifacts/m12/followup-combined-library-${width}.png` });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.getByLabel('Current level', { exact: true }).selectOption('7');
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    const companion = page.getByLabel('Game companion', { exact: true });
    await expect(companion).toBeVisible();
    await expect(companion.locator('.companion-hex')).toHaveCount(28);
    await expect(companion.locator('.companion-hex .entity-chip').first()).toBeVisible();
    await companion.locator('.companion-roster .entity-chip').first().focus();
    await expect(page.getByRole('tooltip')).toContainText('cost');
    await expect(page.getByRole('tooltip')).toContainText('Core');
    await page.screenshot({ path: `artifacts/m12/hover-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(companion.locator('.companion-holder .entity-chip').first()).toBeVisible();
    {
      await companion.locator('.companion-holder > span .entity-chip').first().hover();
      await expect(page.getByRole('tooltip')).toContainText('Click or Enter for details');
      await page.mouse.move(10, 10);
    }
    await page.getByRole('button', { name: 'What If', exact: true }).click();
    const simulator = page.getByLabel('What If simulator');
    await simulator.getByLabel('Current level', { exact: true }).selectOption('9');
    await simulator.getByRole('checkbox').check();
    await expect(simulator.locator('.what-if-results')).toContainText('Hypothetical');
    await expect(companion.getByLabel('Current level', { exact: true }).first()).toHaveValue('7');
    await page.getByRole('button', { name: 'Discard scenario' }).click();
    await expect(simulator).toHaveCount(0);
    await page.getByRole('button', { name: 'Optimize board', exact: true }).click();
    await page.getByRole('button', { name: 'Build legal variants', exact: true }).click();
    await expect(page.locator('.builder-alternative').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close builder' }).click();
    await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Current level', { exact: true })).toHaveValue('7');
    await page.locator('main').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: `artifacts/m12/active-${width}.png` });
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    if (width === 1440)
      expect(
        (await companion.boundingBox())!.y + (await companion.boundingBox())!.height,
      ).toBeLessThan(1000);
  });
