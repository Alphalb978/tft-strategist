import raw from '../../data/fixtures/cdragon-set18.json';
import { normalizeCommunityDragon, STATIC_URL } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import type { CompletedMatch, Provenance } from '../domain/models';
export const NOW = '2026-09-05T21:00:00Z';
export const provenance: Provenance = {
  source: STATIC_URL,
  fetchedAt: NOW,
  publishedAt: '2026-08-29T00:53:00Z',
  patch: null,
  status: 'verified',
  note: 'Real reduced fixture',
};
export const data = normalizeCommunityDragon(raw, provenance);
export const playbooks = loadPlaybooks(data);
export function match(id: string, people = ['a', 'b'], patch = '18.1', set = 18): CompletedMatch {
  return {
    id,
    set,
    setCoreName: `TFTSet${set}`,
    patch,
    gameVersion: `Version ${patch}.fixture`,
    dataVersion: 'fixture-v2',
    gameTimestamp: NOW,
    completedAt: NOW,
    queueId: null,
    gameType: 'fixture-standard',
    mapId: null,
    endOfGameResult: 'fixture-complete',
    modeSupport: 'supported',
    source: 'fixture:synthetic-matches',
    participants: people.map((puuid, i) => ({
      puuid,
      placement: i + 1,
      level: 7,
      units: playbooks[0].target.units.map((unit) => ({
        championId: unit.championId,
        items: unit.items,
        stars: unit.stars ?? 1,
        rarity: null,
        rawName: null,
        unresolvedUnit: false,
        unresolvedItems: [],
      })),
      traits: [],
      augmentIds: [],
      unresolvedAugmentIds: [],
      familyId: playbooks[0].id,
      style: 'reroll',
    })),
  };
}
