import { capture } from './capture';
import { expect, test } from '@playwright/test';
test('three plans, real art, readable detail and safe planner status', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Explore playbook' })).toHaveCount(3);
  await page
    .locator('.card-art img')
    .evaluateAll((images) => Promise.all(images.map((i) => (i as HTMLImageElement).decode())));
  expect(
    await page
      .locator('.card-art img')
      .evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
  ).toBe(true);
  await capture(page, { path: 'artifacts/home-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore playbook' }).first().click();
  await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Build toward this board' })).toBeVisible();
  await capture(page, { path: 'artifacts/playbook-1440.png', fullPage: true });
  await page.getByRole('tab', { name: /Level 7 roll/ }).click();
  await expect(page.getByText('Exact board unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Lock this plan' }).click();
  await expect(page.getByRole('button', { name: 'Plan active', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Active plan', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Active ·/)).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('button', { name: 'End session & save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Active plan', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('refresh failure keeps usable plans and settings persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Data & settings', exact: true })).toBeVisible();
  await expect(page.getByText('known-stale', { exact: true })).toBeVisible();
  await page.getByText('Advanced diagnostics · verification & storage', { exact: true }).click();
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
  await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await expect(page.getByText('Fixture preview', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Riot ID', { exact: true })).toHaveValue('Strategist#M3');
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(
    page.getByText('Account connected. Ready to scan your current lobby.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resolve & scan history' }).click();
  await expect(page.getByText('7/7 profiles')).toBeVisible();
  await expect(page.getByText('140/140 relevant games')).toBeVisible();
  await expect(page.locator('.opponent-profile-grid article')).toHaveCount(7);
  await expect(page.getByText('Historical unit pressure', { exact: true })).toBeVisible();
  await page.getByText('Opponent evidence · 7 profiles', { exact: true }).click();
  const firstProfile = page.locator('.opponent-profile-grid article').first();
  await firstProfile.getByText(/Inspect \d+ unit signals/).click();
  expect(await firstProfile.locator('[data-unit-signal]').count()).toBeGreaterThan(3);
  await expect(firstProfile.getByText('last 5', { exact: true }).first()).toBeVisible();
  await expect(firstProfile.getByText(/rising|falling|stable/).first()).toBeVisible();
  await capture(page, { path: 'artifacts/m4-scouting-1440.png', fullPage: true });
  await page.getByRole('button', { name: 'Your plans', exact: true }).click();
  await expect(page.getByText(/Historical contest:/).first()).toBeVisible();
  await expect(page.getByLabel('Pressured critical units').first()).toBeVisible();
  await page.getByRole('button', { name: 'Explore playbook' }).first().click();
  await page.locator('.why-panel > summary').click();
  await expect(page.locator('.contest-explanation').getByText('Lobby / contest fit')).toBeVisible();
  await expect(page.getByText(/equivalent historical users/).first()).toBeVisible();
  await capture(page, { path: 'artifacts/m4-playbook-1440.png', fullPage: true });
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
  await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(
    page.getByText('Account connected. Ready to scan your current lobby.'),
  ).toBeVisible();
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
  await capture(page, { path: 'artifacts/m5-comps-1440.png', fullPage: true });
  await page.getByLabel('Search comps, units, or traits').fill('Elder Dragon');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await page.getByLabel('Search comps, units, or traits').fill('');
  await page.getByLabel('Roll style filter').selectOption('Fast 9');
  expect(await page.locator('.library-card').count()).toBeGreaterThan(0);
  await page.getByLabel('Roll style filter').selectOption('all');
  await page.getByLabel('Sort comps').selectOption('strength');
  await expect(page.getByText(/Outcome statistics are unavailable/)).toBeVisible();
  await page.locator('.library-card').first().click();
  await page.locator('.why-panel > summary').click();
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
    await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Current meta', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh meta & discovery', exact: true }).click();
    await expect(page.getByText(/boards analyzed across/)).toBeVisible();
    await expect(page.getByLabel('Comp discovery refresh status')).toContainText('51 boards');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture(page, { path: `artifacts/m6-data-${width}.png`, fullPage: true });
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
    await capture(page, { path: `artifacts/m6-detail-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

for (const width of [1440, 1000, 860])
  test(`M8 lock, resume, switch, stale history, and end workflow at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Copy Team Code/ })).toHaveAttribute(
      'title',
      /Client paste verified/i,
    );
    await page.getByRole('button', { name: 'Lock this plan' }).click();
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    await expect(page.getByText(/Local snapshot · safe to resume offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Active plan', exact: true })).toBeVisible();
    await capture(page, { path: `artifacts/m8-active-${width}.png`, fullPage: true });

    const firstStage = page.getByRole('tab').first();
    const firstStageLabel = await firstStage.textContent();
    await firstStage.click();
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await expect(page.getByText(/Active ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    expect(await page.getByRole('tab').first().textContent()).toBe(firstStageLabel);

    await page.reload();
    await expect(page.getByText(/Active ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await page.locator('.pivot-edges > button').first().click();
    await expect(page.getByRole('button', { name: 'Switch to this plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Switch to this plan' }).click();
    await page.getByRole('button', { name: 'Confirm switch', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('previous session remains in history');
    await expect(page.getByText('ACTIVE MATCH PLAN', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const sessions = JSON.parse(
          localStorage.getItem('strategist:v1:plan-sessions') ?? '[]',
        ) as { state: string; endReason: string | null }[];
        return {
          total: sessions.length,
          active: sessions.filter((session) => session.state === 'active').length,
          replaced: sessions.filter((session) => session.endReason === 'replaced').length,
        };
      }),
    ).toEqual({ total: 2, active: 1, replaced: 1 });

    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.evaluate(() => {
      const sessions = JSON.parse(localStorage.getItem('strategist:v1:plan-sessions') ?? '[]') as {
        state: string;
        snapshot: { staticData: { items: { name: string }[] } };
      }[];
      const active = sessions.find((session) => session.state === 'active');
      if (!active) throw new Error('Missing active M8 fixture session');
      const changed = structuredClone(active.snapshot.staticData);
      changed.items[0].name = `${changed.items[0].name} changed`;
      localStorage.setItem('strategist:v1:static', JSON.stringify(changed));
    });
    await page.reload();
    await expect(page.getByText(/historical snapshot/)).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText('Showing the exact historical snapshot.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Copy Team Code/ })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(page, { path: `artifacts/m8-stale-active-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('button', { name: 'End session & save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Active plan', exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const sessions = JSON.parse(
          localStorage.getItem('strategist:v1:plan-sessions') ?? '[]',
        ) as { state: string }[];
        return sessions.every((session) => session.state === 'ended');
      }),
    ).toBe(true);
    await capture(page, { path: `artifacts/m8-ended-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

for (const width of [1440, 1000, 860])
  test(`M9 reconciliation, review, manual confirm, and personal evidence fit at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?riot-fixture=1');
    await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(
      page.getByText('Account connected. Ready to scan your current lobby.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.getByRole('button', { name: 'Explore playbook' }).first().click();
    await page.getByRole('button', { name: 'Lock this plan' }).click();
    await page.locator('.pivot-edges > button').first().click();
    await page.getByRole('button', { name: 'Switch to this plan' }).click();
    await page.getByRole('button', { name: 'Confirm switch', exact: true }).click();
    await page.getByRole('button', { name: 'Post-game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recent games & reviews' })).toBeVisible();
    await expect(page.getByText(/Sample too small/)).toBeVisible();
    await page.getByRole('button', { name: 'Check completed match', exact: true }).click();
    await expect(page.locator('[data-history-state="matched"]')).toBeVisible();
    await page.getByText('Result details & attribution', { exact: true }).click();
    await expect(page.getByText(/terminal plan/).first()).toBeVisible();
    await expect(page.getByText(/Result attribution uses only the terminal route/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(page, { path: `artifacts/m9-matched-${width}.png`, fullPage: true });

    await page.evaluate(() => {
      const key = 'strategist:v1:postgame-reconciliations';
      const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
        state: string;
        matchId: string | null;
        decision: string | null;
        candidates: Array<Record<string, unknown>>;
      }>;
      const row = rows[0];
      const first = row.candidates[0];
      row.state = 'ambiguous';
      row.matchId = null;
      row.decision = null;
      row.candidates = [
        first,
        {
          ...first,
          matchId: 'EUW1_FIXTURE_SELF_2',
          score: Number(first.score) - 0.01,
          placement: 2,
        },
      ];
      localStorage.setItem(key, JSON.stringify(rows));
      localStorage.setItem('strategist:v1:postgame-reviews', '[]');
    });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.getByRole('button', { name: 'Post-game', exact: true }).click();
    await expect(page.getByText('Manual confirmation required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm this match' })).toHaveCount(2);
    await capture(page, { path: `artifacts/m9-ambiguous-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirm this match' }).first().click();
    await page.getByRole('button', { name: 'Confirm link', exact: true }).click();
    await expect(page.locator('[data-history-state="matched"]')).toBeVisible();

    await page.evaluate(() => {
      const sessionKey = 'strategist:v1:plan-sessions';
      const sessions = JSON.parse(localStorage.getItem(sessionKey) ?? '[]') as Array<{
        snapshot: { playbook: { set: number } };
      }>;
      sessions.at(-1)!.snapshot.playbook.set = 17;
      localStorage.setItem(sessionKey, JSON.stringify(sessions));
      const reviewKey = 'strategist:v1:postgame-reviews';
      const current = JSON.parse(localStorage.getItem(reviewKey) ?? '[]') as Array<
        Record<string, unknown>
      >;
      const base = current[0] as Record<string, unknown> & {
        baseline: { derivationFingerprint: string | null };
        classifierVersion: string;
        canonicalModelVersion: string;
        similarityModelVersion: string;
      };
      const terminal = sessions.at(-1)! as unknown as {
        snapshotFingerprint: string;
      };
      const stableFingerprint = (value: unknown) => {
        const stable = (input: unknown): string => {
          if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
          if (input && typeof input === 'object')
            return `{${Object.entries(input as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
              .join(',')}}`;
          return JSON.stringify(input);
        };
        let hash = 2166136261;
        for (const character of stable(value)) {
          hash ^= character.charCodeAt(0);
          hash = Math.imul(hash, 16777619);
        }
        return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
      };
      const reviews = Array.from({ length: 20 }, (_, index) => {
        const matchId = `EUW1_MATURE_${index}`;
        const derivationFingerprint = stableFingerprint({
          reviewVersion: base.reviewVersion,
          matchId,
          terminalSnapshot: terminal.snapshotFingerprint,
          classifierVersion: base.classifierVersion,
          canonicalVersion: base.canonicalModelVersion,
          similarityVersion: base.similarityModelVersion,
          baseline: base.baseline.derivationFingerprint,
        });
        return {
          ...base,
          id: `fixture-review-${index}`,
          matchId,
          derivationFingerprint,
          baseline: {
            ...base.baseline,
            state: 'available',
            placementResidual: index % 2 ? 1.2 : 0.4,
            confidence: 0.85,
          },
          attribution: {
            eligible: true,
            familyId: (base.selectedPlan as { familyId: string }).familyId,
            confidence: 0.9,
            reasons: [],
          },
        };
      });
      localStorage.setItem(reviewKey, JSON.stringify(reviews));
    });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await page.getByRole('button', { name: 'Post-game', exact: true }).click();
    await expect(page.getByText('Old set · excluded from learning')).toBeVisible();
    await expect(page.getByText(/20 attributed current-set games/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await capture(page, { path: `artifacts/m9-mature-stale-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

for (const width of [1440, 1000, 860])
  test(`M7 covered and partial playbooks are usable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Comps', exact: true }).click();
    await page.getByLabel('Search comps, units, or traits').fill('Adaptors');
    await page.locator('.library-card').click();
    await expect(page.getByRole('heading', { name: 'Build toward this board' })).toBeVisible();
    await expect(page.getByLabel('Unpositioned target roster')).toBeVisible();
    await expect(
      page.getByLabel('Unpositioned target roster').locator('.unplaced-unit'),
    ).toHaveCount(8);
    await expect(page.locator('.tft-hex')).toHaveCount(0);
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
    await expect(page.getByRole('heading', { name: 'Pivot options' })).toBeVisible();
    expect(await page.locator('.pivot-nodes button').count()).toBe(3);
    expect(await page.locator('.pivot-edges > button').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(page, { path: `artifacts/m7-covered-${width}.png`, fullPage: true });

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
    await capture(page, { path: `artifacts/m7-partial-${width}.png`, fullPage: true });
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
    await capture(page, { path: `artifacts/home-${width}.png`, fullPage: true });
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
    await capture(page, { path: `artifacts/m5-comps-${width}.png`, fullPage: true });
  });
for (const width of [1000, 860])
  test(`M4 scouting and lobby-fit layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?riot-fixture=1');
    await page.getByRole('button', { name: 'Data & settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Riot account & lobby' })).toBeVisible();
    await page.getByRole('button', { name: 'Resolve & scan history' }).click();
    await expect(page.getByText('7/7 profiles')).toBeVisible();
    await page.locator('.pressure-details summary').click();
    await page.getByText('Opponent evidence · 7 profiles', { exact: true }).click();
    await page.locator('.unit-evidence-details summary').first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.locator('main').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await capture(page, { path: `artifacts/m4-scouting-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Your plans', exact: true }).click();
    await expect(page.getByLabel('Pressured critical units').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await capture(page, { path: `artifacts/m4-home-${width}.png`, fullPage: true });
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
  await capture(page, { path: 'artifacts/error-state.png' });
  await page.unroute('**/data/static-set18.json');
  await page.getByRole('button', { name: 'Retry local load' }).click();
  await expect(page.locator('.plan-card')).toHaveCount(3);
});
