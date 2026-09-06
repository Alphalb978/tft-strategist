import fs from 'node:fs';
import type { StaticData } from '../src/domain/models';
import { loadPlaybooks } from '../src/providers/playbooks';
import { FixtureRiotProvider } from '../src/providers/riot';
import { MemoryHistoryStore } from '../src/storage/history';
import { MemoryRepository } from '../src/storage/repository';
import { refreshMetaDiscovery } from '../src/services/discoveryRefresh';
import { match } from '../src/test/fixtures';
export async function metaFixture(count = 120, platform = 'EUW1') {
  const data = JSON.parse(fs.readFileSync('public/data/static-set18.json', 'utf8')) as StaticData;
  const plans = loadPlaybooks(data),
    now = new Date().toISOString();
  const identities = Array.from({ length: 8 }, (_, i) => ({
    puuid: `meta-fixture-${i}`,
    gameName: `Fixture ${i}`,
    tagLine: 'META',
    platform,
    routing: platform === 'NA1' ? 'AMERICAS' : 'EUROPE',
  }));
  const matches = Array.from({ length: count }, (_, i) => {
    const m = match(
      `${platform}-META-${i}`,
      identities.map((p) => p.puuid),
    );
    m.queueId = 1100;
    m.completedAt = new Date(Date.parse(now) - (i % 6) * 86400000 - 1000).toISOString();
    m.participants.forEach((p, j) => {
      const plan = plans[(i * 8 + j) % plans.length];
      p.level = plan.target.capacity;
      p.units = plan.target.units.map((u) => ({
        championId: u.championId,
        items: u.items,
        stars: u.stars ?? 1,
        rarity: null,
        rawName: null,
        unresolvedUnit: false,
        unresolvedItems: [],
      }));
    });
    return m;
  });
  const repo = new MemoryRepository(),
    history = new MemoryHistoryStore(),
    provider = new FixtureRiotProvider(matches, identities);
  // A cached population fixture exercises large incremental reuse without network requests.
  for (const m of matches) await history.putCompletedMatch(m, now);
  const result = await refreshMetaDiscovery(
    provider,
    history,
    repo,
    data,
    plans,
    {
      platform,
      regionalRoute: identities[0].routing,
      tiers: platform === 'NA1' ? ['CHALLENGER', 'GRANDMASTER', 'MASTER'] : ['CHALLENGER'],
      playersPerTier: 8,
      matchesPerPlayer: count,
      set: 18,
      windowDays: platform === 'NA1' ? 3 : 7,
      mode: 'standard',
      sourceType: 'fixture',
    },
    now,
  );
  return { version: 1 as const, meta: result.meta, discovery: result.discovery };
}
