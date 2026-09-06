import type { CompletedMatch, RiotIdentity, StaticData } from '../domain/models';
import { loadPlaybooks } from './playbooks';
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
  const playbooks = loadPlaybooks(data);
  const eligible = data.champions.filter(
    (unit) => unit.boardEligible && unit.shopStatus === 'pool',
  );
  const units = [
    ...playbooks
      .flatMap((playbook) => playbook.family.core)
      .flatMap((championId) => eligible.filter((unit) => unit.id === championId)),
    ...playbooks
      .flatMap((playbook) => playbook.target.units)
      .flatMap((boardUnit) => eligible.filter((unit) => unit.id === boardUnit.championId)),
    ...eligible,
  ]
    .filter((unit, index, all) => all.findIndex((candidate) => candidate.id === unit.id) === index)
    .slice(0, 18);
  const discoveryBase = playbooks.find((playbook) => playbook.id === 'adaptor-reroll')!;
  const discoveryReplacement = eligible.find(
    (unit) => !discoveryBase.target.units.some((boardUnit) => boardUnit.championId === unit.id),
  )!;
  const discoveryVariant = discoveryBase.target.units.map((unit, index, all) =>
    index === all.length - 1
      ? discoveryReplacement
      : eligible.find((entry) => entry.id === unit.championId)!,
  );
  const previewNow = Date.now();
  const matches: CompletedMatch[] = Array.from({ length: 20 }, (_, matchIndex) => {
    const completedAt = new Date(previewNow - matchIndex * 86_400_000).toISOString();
    return {
      id: `EUW1_FIXTURE_${matchIndex + 1}`,
      set: data.version.set,
      setCoreName: 'TFTSet18',
      riotGameVersion: 'Version 16.18.702.1234 (Sep 03 2026/12:00:00) [PUBLIC]',
      tftContentPatch: null,
      tftContentPatchSource: 'unavailable',
      dataVersion: 'fixture-v2',
      gameTimestamp: completedAt,
      gameTimestampSemantics: 'fixture-completed-at',
      gameDurationSeconds: 2100,
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
        units: (opponentIndex < 2
          ? discoveryVariant
          : units
              .filter((_, unitIndex) => {
                if (unitIndex === 0) return true;
                if (unitIndex === 1) return matchIndex < 4 || matchIndex === 11;
                if (unitIndex === 2) return matchIndex >= 5 && matchIndex % 2 === 0;
                return (unitIndex + opponentIndex + matchIndex) % 4 === 0;
              })
              .slice(0, 8)
        ).map((unit, unitIndex) => ({
          championId: unit.id,
          items: [],
          stars: unitIndex === 0 && matchIndex % 5 === 0 ? 2 : 1,
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
  const ownMatches: CompletedMatch[] = matches.slice(0, 2).map((source, index) => ({
    ...structuredClone(source),
    id: `EUW1_FIXTURE_SELF_${index + 1}`,
    participants: [
      {
        ...structuredClone(source.participants[0]),
        puuid: identities[0].puuid,
        riotId: `${identities[0].gameName}#${identities[0].tagLine}`,
        placement: index + 1,
      },
    ],
  }));
  return new FixtureRiotProvider(
    [...ownMatches, ...matches],
    [...opponents, identities[0]],
    opponents.map((identity) => identity.puuid),
  );
}
