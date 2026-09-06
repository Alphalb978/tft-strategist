import type {
  AggregateMetaDataset,
  CompletedMatch,
  LadderPlayer,
  MetaObservation,
  Playbook,
  StaticData,
} from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { HistoryStore } from '../storage/history';
import type { Repository } from '../storage/repository';
import { COMP_CLASSIFIER, classifyFinalBoard } from '../strategy/compClassifier';
import { META_STATISTICS, deriveFamilyStatistics } from '../strategy/metaStatistics';
import { familyDefinitionsFingerprint, stableFingerprint } from '../domain/fingerprint';

export interface MetaSampleConfig {
  platform: string;
  regionalRoute: string;
  tiers: LadderPlayer['tier'][];
  playersPerTier: number;
  matchesPerPlayer: number;
  set: number;
}

export const DEFAULT_META_SAMPLE: MetaSampleConfig = {
  platform: 'EUW1',
  regionalRoute: 'EUROPE',
  tiers: ['CHALLENGER'],
  playersPerTier: 3,
  matchesPerPlayer: 3,
  set: 18,
};

export { familyDefinitionsFingerprint, stableFingerprint } from '../domain/fingerprint';

export interface MetaCollectionResult {
  dataset: AggregateMetaDataset;
  observations: MetaObservation[];
  matches: CompletedMatch[];
}

export function redactProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unavailable';
  return message
    .replace(/RGAPI-[A-Za-z0-9-]+/gi, '[redacted]')
    .replace(/X-Riot-Token\s*[:=]\s*\S+/gi, 'X-Riot-Token: [redacted]');
}

export async function collectAggregateMeta(
  provider: RiotProvider,
  history: HistoryStore,
  repository: Repository,
  data: StaticData,
  playbooks: Playbook[],
  config: MetaSampleConfig = DEFAULT_META_SAMPLE,
  now = new Date().toISOString(),
): Promise<MetaCollectionResult> {
  const errors: string[] = [];
  const cohort: LadderPlayer[] = [];
  for (const tier of config.tiers) {
    try {
      cohort.push(...(await provider.ladderPlayers(tier, config.playersPerTier)));
    } catch (error) {
      errors.push(`${tier}: ${redactProviderError(error)}`);
    }
  }
  const sampledPlayers = cohort.slice(0, config.playersPerTier * config.tiers.length);
  const allIds: string[] = [];
  for (const { puuid } of sampledPlayers) {
    try {
      allIds.push(...(await provider.recentMatchIds(puuid, 0, config.matchesPerPlayer)));
    } catch (error) {
      errors.push(`match index: ${redactProviderError(error)}`);
    }
  }
  const matchIds = [...new Set(allIds)];
  const sharedMatchesDeduplicated = allIds.length - matchIds.length;
  const matches: CompletedMatch[] = [];
  let cacheHits = 0;
  let uniqueMatchDetailsFetched = 0;
  for (const id of matchIds) {
    const cached = await history.getCompletedMatch(id);
    if (cached) {
      cacheHits++;
      matches.push(cached);
      continue;
    }
    try {
      const match = await provider.completedMatch(id);
      await history.putCompletedMatch(match, now);
      uniqueMatchDetailsFetched++;
      matches.push(match);
    } catch (error) {
      errors.push(`match detail: ${redactProviderError(error)}`);
    }
  }
  const current = matches.filter((match) => match.set === config.set);
  const observations = current.flatMap((match) =>
    match.participants.map((participant) => ({
      matchId: match.id,
      puuid: participant.puuid,
      completedAt: match.completedAt,
      placement: participant.placement,
      classification: classifyFinalBoard(participant, playbooks, data),
    })),
  );
  const classifiedBoards = observations.filter(
    (observation) => observation.classification.state === 'classified',
  ).length;
  const ambiguousBoards = observations.filter(
    (observation) => observation.classification.state === 'ambiguous',
  ).length;
  const unclassifiedBoards = observations.length - classifiedBoards - ambiguousBoards;
  const familyFingerprint = familyDefinitionsFingerprint(playbooks);
  const sampleFingerprint = stableFingerprint(config);
  const derivationFingerprint = stableFingerprint({
    classifier: COMP_CLASSIFIER,
    statistics: META_STATISTICS,
    familyFingerprint,
    staticSourceVersion: data.version.sourceVersion,
    sampleFingerprint,
  });
  const providerMetrics = await provider.metrics();
  const dates = current.map((match) => match.completedAt).sort();
  const dataset: AggregateMetaDataset = {
    id: `${config.platform}-${config.set}-${now}`,
    schemaVersion: 1,
    set: config.set,
    state: observations.length === 0 ? 'unavailable' : errors.length ? 'partial' : 'complete',
    sourceType: 'riot-api',
    source: 'Riot tft-league-v1 + tft-match-v1',
    platform: config.platform,
    regionalRoute: config.regionalRoute,
    rankCohort: config.tiers,
    collectedAt: now,
    windowStart: dates[0] ?? null,
    windowEnd: dates.at(-1) ?? null,
    cohortPlayersConsidered: cohort.length,
    uniqueCohortPlayers: sampledPlayers.length,
    uniqueParticipants: new Set(observations.map((observation) => observation.puuid)).size,
    discoveredMatchIds: matchIds.length,
    fetchedMatchPayloads: matches.length,
    currentSetMatches: current.length,
    uniqueMatches: current.length,
    currentSetBoards: observations.length,
    classifiedBoards,
    ambiguousBoards,
    unclassifiedBoards,
    coverage: observations.length ? classifiedBoards / observations.length : 0,
    observations,
    familyStats: deriveFamilyStatistics(observations, playbooks, now),
    classifierVersion: COMP_CLASSIFIER.version,
    statisticsVersion: META_STATISTICS.version,
    familyDefinitionsFingerprint: familyFingerprint,
    staticSourceVersion: data.version.sourceVersion,
    sampleDefinitionFingerprint: sampleFingerprint,
    derivationFingerprint,
    patchRelevance: 'unavailable',
    telemetry: {
      ...providerMetrics,
      cacheHits,
      uniqueMatchDetailsFetched,
      sharedMatchesDeduplicated,
    },
    errors,
  };
  await repository.set('aggregate-meta', dataset);
  return { dataset, observations, matches };
}
