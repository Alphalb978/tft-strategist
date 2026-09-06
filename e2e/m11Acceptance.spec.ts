import { expect, test } from '@playwright/test';
import { capture } from './capture';
for (const width of [1440, 1000, 860])
  test(`M11 human acceptance through normal product controls ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.locator('.plan-card')).toHaveCount(3, { timeout: 20000 });
    // Seed persisted evidence only. All inspection, builder and adaptation actions use production UI.
    const fixture = await page.evaluate(async () => {
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
        matches = m.acceptanceMatches(now);
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
    await page
      .locator('.library-card')
      .filter({ has: page.getByRole('heading', { name: fixture.title, exact: true }) })
      .click();
    await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible();
    const intelligence = page.getByLabel('Smart strategy intelligence');
    await expect(intelligence.locator('.observed-sample')).toContainText(
      `${fixture.sample} boards`,
    );
    await expect(intelligence.getByText('Level 7 reroll-like', { exact: true })).toBeVisible();
    await expect(
      intelligence.locator('.observed-units').nth(1).getByRole('button'),
    ).not.toHaveCount(0);
    await expect(
      intelligence.getByRole('heading', { name: '2-item packages' }).first(),
    ).toBeVisible();
    await expect(
      intelligence.getByRole('heading', { name: '3-item packages' }).first(),
    ).toBeVisible();
    await expect(intelligence.locator('.augment-evidence .entity-chip').first()).toBeVisible();
    await expect(intelligence.getByRole('heading', { name: 'Star profile' })).toBeVisible();
    await intelligence.scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/acceptance-profile-${width}.png` });
    await intelligence
      .getByRole('heading', { name: 'Observed holders, items and packages' })
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await capture(page, { path: `artifacts/m11/acceptance-items-${width}.png` });
    await intelligence
      .getByRole('heading', { name: 'Observed augments' })
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await capture(page, { path: `artifacts/m11/acceptance-augments-${width}.png` });
    await intelligence
      .getByRole('button', { name: `Inspect ${fixture.inspectName}`, exact: true })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toContainText('Observed champion context');
    await capture(page, { path: `artifacts/m11/acceptance-entity-${width}.png` });
    await page.getByRole('button', { name: 'Close entity details' }).click();
    await page.getByRole('button', { name: 'Optimize board', exact: true }).click();
    await page.getByLabel('Builder target level').selectOption('8');
    await page.getByRole('button', { name: 'Build legal variants', exact: true }).click();
    await expect(page.locator('.builder-alternative').first()).toContainText('Experimental');
    await expect(page.locator('.builder-alternative').first()).toContainText('Changes:');
    await capture(page, { path: `artifacts/m11/acceptance-builder-${width}.png` });
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page
      .locator('.library-card')
      .filter({ has: page.getByRole('heading', { name: fixture.curated, exact: true }) })
      .click();
    await expect(page.locator('.observed-sample')).toContainText('40 boards');
    await page.getByLabel('Smart strategy intelligence').scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/acceptance-curated-${width}.png` });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    const before = await page.locator('.plan-grid').innerText();
    await page.getByLabel('Current level', { exact: true }).selectOption('7');
    await page.getByLabel('Health band').selectOption('critical');
    await page.getByLabel('Economy band').selectOption('weak');
    await page.locator('.game-inventory > summary').click();
    await page.getByLabel('Find owned champion').fill(fixture.unit);
    await page.getByRole('button', { name: `${fixture.unit} +`, exact: true }).click();
    for (let i = 0; i < 4; i++)
      await page.getByRole('button', { name: `Add ${fixture.unit} copy`, exact: true }).click();
    await page.getByRole('button', { name: 'On board', exact: true }).click();
    await page.getByLabel('Add completed item').selectOption(fixture.item);
    await page.getByLabel('Add augment', { exact: true }).selectOption(fixture.augment);
    await expect.poll(() => page.locator('.plan-grid').innerText()).not.toBe(before);
    await expect(page.getByLabel('Contextual reasons').first()).toContainText('Context-aware');
    await expect(page.locator('.plan-grid')).toContainText('Supported item direction:');
    await expect(page.locator('.plan-grid')).toContainText(`5 ${fixture.unit} copies`);
    await page.locator('.plan-grid').scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/acceptance-context-${width}.png` });
    await page.reload();
    await expect(page.getByLabel('Current level', { exact: true })).toHaveValue('7');
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    await page.getByRole('button', { name: 'Lock this plan', exact: true }).click();
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Current level', { exact: true })).toHaveValue('7');
    await page.getByLabel('Current game state').scrollIntoViewIfNeeded();
    await capture(page, { path: `artifacts/m11/acceptance-active-${width}.png` });
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  });
