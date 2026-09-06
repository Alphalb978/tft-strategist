import { data, playbooks, match, NOW } from './fixtures';
import { deriveDiscoveryDataset } from '../strategy/compDiscovery';
const curated = new Set(playbooks.flatMap((p) => p.target.units.map((u) => u.championId)));
export const unknownCore = data.champions
  .filter((c) => c.boardEligible && c.shopStatus === 'pool' && !curated.has(c.id))
  .slice(0, 6)
  .map((c) => c.id);
export const observedItems = data.items
  .filter((i) => i.category === 'combined' && i.components.length === 2)
  .slice(0, 3)
  .map((i) => i.id);
export const observedAugment = data.augments.find((a) => a.liveStatus !== 'disabled')!.id;
export function intelligenceMatches(count = 32) {
  return Array.from({ length: count }, (_, i) => {
    const m = match(`EUW1-m11-${i}`, [`known-${i}`, `guest-${i}`]);
    m.queueId = 1100;
    m.participants = m.participants.map((p) => ({
      ...p,
      placement: (i % 8) + 1,
      level: 6,
      units: unknownCore.map((championId, index) => ({
        championId,
        stars: index === 0 ? 3 : 2,
        items: index === 0 ? observedItems : [],
        rarity: null,
        rawName: null,
        unresolvedUnit: false,
        unresolvedItems: [],
      })),
      augmentIds: [observedAugment],
      traits: [],
    }));
    return m;
  });
}
export function discoveryFor(matches = intelligenceMatches()) {
  return deriveDiscoveryDataset({
    matches,
    families: playbooks,
    data,
    now: NOW,
    sourceType: 'fixture',
    source: 'fixture:m11-autonomous',
    sampleDefinitionFingerprint: 'm11-synthetic-ranked',
  });
}

/** Provider-shaped ranked records with recurring flex and a measured curated participant. */
export function acceptanceMatches(now = NOW) {
  const flex = data.champions
    .filter((c) => c.boardEligible && c.shopStatus === 'pool' && !unknownCore.includes(c.id))
    .slice(0, 2);
  return intelligenceMatches(40).map((m, i) => ({
    ...m,
    source: 'Riot tft-match-v1',
    modeSupport: 'unverified' as const,
    tftContentPatch: null,
    tftContentPatchSource: 'unavailable' as const,
    riotGameVersion: 'TFT Unreal Version ?.?.?.?',
    completedAt: new Date(Date.parse(now) - (i + 1) * 60000).toISOString(),
    participants: [
      ...m.participants.map((p) => ({
        ...p,
        level: 7,
        units: [...p.units, { ...p.units[1], championId: flex[i % 2].id, items: [] }],
      })),
      {
        ...m.participants[0],
        puuid: `curated-${i}`,
        level: playbooks[0].target.targetLevel,
        units: playbooks[0].target.units.map((u, j) => ({
          ...m.participants[0].units[0],
          championId: u.championId,
          stars: u.stars ?? 2,
          items: j === 0 ? observedItems : [],
        })),
      },
    ],
  }));
}
