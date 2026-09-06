import type { CompletedMatch, RiotIdentity, StaticData } from '../domain/models';
import { FixtureRiotProvider } from './riot';

export const PREVIEW_OWN_RIOT_ID = 'Strategist#M3';
export const PREVIEW_OPPONENT_INPUT = [
  'Scout One#M3',
  'Scout Two#M3',
  'Éclaireur#M3',
  '偵察者#M3',
  'Scout Five#M3',
  'Scout Six#M3',
  'Scout Seven#M3',
].join('\n');

/** Deterministic development-only evidence used by UI/e2e without a Riot key. */
export function createRiotPreviewProvider(data: StaticData): FixtureRiotProvider {
  const names = [
    ['Strategist', 'M3'],
    ['Scout One', 'M3'],
    ['Scout Two', 'M3'],
    ['Éclaireur', 'M3'],
    ['偵察者', 'M3'],
    ['Scout Five', 'M3'],
    ['Scout Six', 'M3'],
    ['Scout Seven', 'M3'],
  ];
  const identities: RiotIdentity[] = names.map(([gameName, tagLine], index) => ({
    puuid: `fixture-puuid-${index}`,
    gameName,
    tagLine,
    platform: 'EUW1',
    routing: 'EUROPE',
  }));
  const opponents = identities.slice(1);
  const units = data.champions.filter((unit) => unit.boardEligible).slice(0, 6);
  const matches: CompletedMatch[] = Array.from({ length: 20 }, (_, matchIndex) => {
    const completedAt = new Date(Date.UTC(2026, 8, 5 - matchIndex, 18)).toISOString();
    return {
      id: `EUW1_FIXTURE_${matchIndex + 1}`,
      set: data.version.set,
      setCoreName: 'TFTSet18',
      riotGameVersion: 'Version 16.18.702.1234 (Sep 03 2026/12:00:00) [PUBLIC]',
      tftContentPatch: null,
      tftContentPatchSource: 'unavailable',
      dataVersion: 'fixture-v2',
      gameTimestamp: completedAt,
      completedAt,
      queueId: null,
      gameType: 'fixture-standard',
      mapId: null,
      endOfGameResult: 'fixture-complete',
      modeSupport: 'supported',
      source: 'fixture:m3-ui-preview',
      participants: opponents.map((identity, opponentIndex) => ({
        puuid: identity.puuid,
        riotId: `${identity.gameName}#${identity.tagLine}`,
        placement: ((opponentIndex + matchIndex) % 7) + 1,
        level: 8,
        units: units.slice(0, 3 + ((opponentIndex + matchIndex) % 3)).map((unit) => ({
          championId: unit.id,
          items: [],
          stars: 1,
          rarity: unit.cost,
          rawName: unit.name,
          unresolvedUnit: false,
          unresolvedItems: [],
        })),
        traits: [],
        augmentIds: [],
        unresolvedAugmentIds: [],
      })),
    };
  });
  return new FixtureRiotProvider(
    matches,
    identities,
    opponents.map((identity) => identity.puuid),
  );
}
