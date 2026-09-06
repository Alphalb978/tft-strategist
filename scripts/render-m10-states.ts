import { chromium } from '@playwright/test';
import fs from 'node:fs';
import type { StaticData, RiotIdentity } from '../src/domain/models';
import { loadPlaybooks } from '../src/providers/playbooks';
import { FixtureRiotProvider } from '../src/providers/riot';
import { collectAggregateMeta } from '../src/services/metaPipeline';
import { MemoryHistoryStore } from '../src/storage/history';
import { MemoryRepository } from '../src/storage/repository';
import { match } from '../src/test/fixtures';
import { createRecommendations } from '../src/services/application';
import { defaultSettings } from '../src/storage/repository';
import { candidatePlannerCode } from '../src/rules/teamPlanner';
const data = JSON.parse(fs.readFileSync('public/data/static-set18.json', 'utf8')) as StaticData;
const plans = loadPlaybooks(data),
  now = new Date().toISOString();
const identities: RiotIdentity[] = Array.from({ length: 8 }, (_, i) => ({
  puuid: `visual-${i}`,
  gameName: `Visual ${i}`,
  tagLine: 'M10',
  platform: 'EUW1',
  routing: 'EUROPE',
}));
const matches = Array.from({ length: 130 }, (_, i) => {
  const value = match(
    `visual-${i}`,
    identities.map((x) => x.puuid),
  );
  value.completedAt = now;
  value.participants.forEach((person, j) => {
    const plan = plans[(i * 8 + j) % plans.length];
    person.units = plan.target.units.map((unit) => ({
      championId: unit.championId,
      items: unit.items,
      stars: unit.stars ?? 1,
      rarity: null,
      rawName: null,
      unresolvedUnit: false,
      unresolvedItems: [],
    }));
  });
  const priority = Array.from({ length: 8 }, (_, j) => (i * 8 + j) % plans.length);
  value.participants.forEach((person, j) => {
    person.placement = 1 + priority.filter((k) => k < priority[j]).length;
  });
  return value;
});
const collected = await collectAggregateMeta(
  new FixtureRiotProvider(matches, identities),
  new MemoryHistoryStore(),
  new MemoryRepository(),
  data,
  plans,
  {
    platform: 'EUW1',
    regionalRoute: 'EUROPE',
    tiers: ['CHALLENGER'],
    playersPerTier: 8,
    matchesPerPlayer: 130,
    set: 18,
  },
  now,
);
collected.dataset.sourceType = 'fixture';
collected.dataset.source = 'Deterministic M10 visual acceptance fixture; not live meta';
console.log(
  'fixture',
  collected.dataset.familyStats.length,
  createRecommendations(data, defaultSettings, now, collected.dataset).notices,
);
const candidate = plans.find((p) => p.id === 'adaptor-reroll')!;
console.log(
  'HUMAN PLANNER CANDIDATE',
  JSON.stringify({
    code: candidatePlannerCode(candidate.target, data),
    names: candidate.target.units.map(
      (u) => data.champions.find((c) => c.id === u.championId)!.name,
    ),
    filled: candidate.target.units.length,
  }),
);
fs.mkdirSync('artifacts/m10-states', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const width of [1440, 1000, 860]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const shot = async (name: string) => {
    await page.locator('main').evaluate((el) => el.scrollTo(0, 0));
    await page
      .locator('img')
      .evaluateAll((images) =>
        Promise.all(images.map((i) => (i as HTMLImageElement).decode().catch(() => {}))),
      );
    await page.waitForTimeout(200);
    await page.screenshot({ path: `artifacts/m10-states/${name}-${width}.png` });
    if (await page.locator('main').evaluate((el) => el.scrollWidth > el.clientWidth))
      throw Error(`${name} overflow at ${width}`);
  };
  await page.goto('http://127.0.0.1:1420/?riot-fixture=1');
  await page.locator('.plan-card').last().waitFor();
  await page.evaluate(
    (dataset) => localStorage.setItem('strategist:v1:aggregate-meta', JSON.stringify(dataset)),
    collected.dataset,
  );
  await page.reload();
  await page.locator('.plan-card').last().waitFor();
  if (!(await page.locator('.plan-outcomes').allTextContents()).join(' ').includes('games'))
    throw Error(
      'Strong evidence fixture did not load: ' + (await page.locator('main').innerText()),
    );
  await shot('plans-strong');
  await page.getByRole('button', { name: 'Scouting', exact: true }).click();
  await page.getByRole('heading', { name: 'Scouting', exact: true }).waitFor();
  await page.evaluate(async () => {
    const modulePath = '/src/providers/riot.ts';
    const { FixtureRiotProvider } = await import(/* @vite-ignore */ modulePath);
    const original = FixtureRiotProvider.prototype.recentMatchIds;
    FixtureRiotProvider.prototype.recentMatchIds = async function (...args: unknown[]) {
      await new Promise((r) => setTimeout(r, 1500));
      return original.apply(this, args);
    };
    FixtureRiotProvider.prototype.lobby = async () => ({
      ok: true,
      value: ['fixture-puuid-1', 'fixture-puuid-2', 'fixture-puuid-3'],
    });
  });
  await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
  await page.getByRole('progressbar').waitFor();
  await shot('scan-loading');
  await page.locator('.scout-result').waitFor();
  await shot('scan-partial');
  await page.getByRole('button', { name: 'Your plans', exact: true }).click();
  await page.locator('.plan-card').last().waitFor();
  await shot('plans-partial-scout');
  await page.getByRole('button', { name: 'Scouting', exact: true }).click();
  await page.getByRole('heading', { name: 'Scouting', exact: true }).waitFor();
  for (const scenario of ['not-in-game', 'expired-key', 'rate-limit']) {
    await page.evaluate(async (scenario) => {
      const modulePath = '/src/providers/riot.ts';
      const { FixtureRiotProvider, RiotProviderError } = await import(
        /* @vite-ignore */ modulePath
      );
      FixtureRiotProvider.prototype.lobby = async () => {
        if (scenario === 'not-in-game') return { ok: false, error: 'not-in-game' };
        throw new RiotProviderError(
          scenario === 'expired-key' ? 'auth' : 'rate-limited',
          scenario === 'expired-key' ? 403 : 429,
        );
      };
    }, scenario);
    await page.getByRole('button', { name: 'Scan current lobby', exact: true }).click();
    await page.locator('.riot-message').waitFor();
    await page.getByRole('progressbar').waitFor({ state: 'hidden' });
    await shot(scenario);
  }
  await page.close();
}
await browser.close();
