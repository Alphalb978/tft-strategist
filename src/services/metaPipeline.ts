import type {
  AggregateMetaDataset,
  CompletedMatch,
  LadderPlayer,
  MetaObservation,
  Playbook,
  StaticData,
} from '../domain/models';
import { RiotProviderError, type RiotRequestOptions } from '../providers/riot';
import { regionalRouteFor } from '../providers/riotRouting';
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
  windowDays?: 1 | 3 | 7;
  mode?: 'quick' | 'standard' | 'deep';
  sourceType?: 'riot-api' | 'fixture';
}

export const META_BUDGETS = {
  quick: { playersPerTier: 5, matchesPerPlayer: 10, newMatches: 20, deadlineMs: 120_000 },
  standard: { playersPerTier: 20, matchesPerPlayer: 20, newMatches: 120, deadlineMs: 480_000 },
  deep: { playersPerTier: 50, matchesPerPlayer: 20, newMatches: 600, deadlineMs: 1_200_000 },
} as const;
export const META_COHORTS = {
  Challenger: ['CHALLENGER'],
  'Grandmaster+': ['CHALLENGER', 'GRANDMASTER'],
  'Master+': ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
} satisfies Record<string, LadderPlayer['tier'][]>;
export interface MetaProgress {
  phase: 'players' | 'matches' | 'analyzing' | 'discovery' | 'complete';
  players: number;
  playerTarget: number;
  uniqueMatches: number;
  newMatches: number;
  cachedMatches: number;
  boards: number;
  classified: number;
  ambiguous: number;
  unclassified: number;
}
export interface MetaCollectionOptions extends RiotRequestOptions {
  onProgress?: (progress: MetaProgress) => void;
  deferPublish?: boolean;
}
interface MetaMembership {
  version: 1;
  ids: string[];
  cursor: number;
  startedAt: string;
}
export function metaScopeKey(config: MetaSampleConfig) {
  return stableFingerprint({
    version: 1,
    platform: config.platform,
    route: config.regionalRoute,
    tiers: [...config.tiers].sort(),
    set: config.set,
    source: config.sourceType ?? 'riot-api',
  });
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
  options: MetaCollectionOptions = {},
): Promise<MetaCollectionResult> {
  const budget = config.mode ? META_BUDGETS[config.mode] : null;
  const windowDays = config.windowDays ?? (config.mode ? 7 : undefined);
  if (
    config.mode &&
    (config.set !== data.version.set ||
      regionalRouteFor(config.platform) !== config.regionalRoute ||
      !config.tiers.length ||
      config.tiers.some((t) => !['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(t)))
  )
    throw new Error('Unsupported meta cohort or region.');
  const metricsBefore = config.mode ? await provider.metrics() : null;
  const errors: string[] = [];
  const progress: MetaProgress = {
    phase: 'players',
    players: 0,
    playerTarget: 0,
    uniqueMatches: 0,
    newMatches: 0,
    cachedMatches: 0,
    boards: 0,
    classified: 0,
    ambiguous: 0,
    unclassified: 0,
  };
  const emit = () => options.onProgress?.({ ...progress });
  const requestOptions = {
    signal: options.signal,
    deadlineAt: options.deadlineAt ?? Date.now() + (budget?.deadlineMs ?? 120_000),
  };
  const check = () => {
    if (options.signal?.aborted) throw new RiotProviderError('cancelled');
  };
  const report = (error: unknown) => {
    check();
    if (
      error instanceof RiotProviderError &&
      ['auth', 'missing-key', 'invalid-route'].includes(error.code)
    )
      throw error;
    if (errors.length < 20) errors.push(redactProviderError(error));
  };
  check();
  const scopeKey = metaScopeKey(config);
  const membershipKey = `meta-membership:v1:${scopeKey}`;
  const membership = config.mode ? await repository.get<MetaMembership>(membershipKey) : null;
  const priorIds = membership?.version === 1 ? membership.ids : [];
  const cohort: LadderPlayer[] = [];
  for (const tier of [...new Set(config.tiers)]) {
    check();
    try {
      cohort.push(
        ...(await provider.ladderPlayers(
          tier,
          config.mode ? 500 : config.playersPerTier,
          requestOptions,
        )),
      );
    } catch (error) {
      report(error);
    }
  }
  // Rotate a bounded slice through each ladder; quick refresh always prioritizes the leaders.
  const cursor = config.mode === 'quick' ? 0 : (membership?.cursor ?? 0);
  const sampledPlayers = [
    ...new Map(
      config.tiers
        .flatMap((tier) => {
          const entries = cohort.filter((p) => p.tier === tier);
          if (!entries.length) return [];
          const offset = cursor % entries.length;
          return [...entries.slice(offset), ...entries.slice(0, offset)].slice(
            0,
            config.playersPerTier,
          );
        })
        .map((player) => [player.puuid, player]),
    ).values(),
  ];
  progress.playerTarget = sampledPlayers.length;
  emit();
  const allIds: string[] = [];
  for (const { puuid } of sampledPlayers) {
    check();
    try {
      const cachedIndex = config.mode
        ? await history.getRecentIndex(puuid, config.regionalRoute)
        : null;
      if (
        cachedIndex &&
        Date.parse(now) - Date.parse(cachedIndex.fetchedAt) < 600_000 &&
        cachedIndex.requestedCount >= config.matchesPerPlayer
      )
        allIds.push(...cachedIndex.ids.slice(0, config.matchesPerPlayer));
      else {
        const ids = await provider.recentMatchIds(
          puuid,
          0,
          config.matchesPerPlayer,
          requestOptions,
        );
        allIds.push(...ids);
        if (config.mode)
          await history.putRecentIndex({
            puuid,
            routing: config.regionalRoute,
            targetCount: config.matchesPerPlayer,
            requestedCount: config.matchesPerPlayer,
            ids,
            exhausted: ids.length < config.matchesPerPlayer,
            fetchedAt: now,
          });
      }
    } catch (error) {
      report(error);
    }
    progress.players++;
    emit();
    if (Date.now() >= requestOptions.deadlineAt) break;
  }
  const matchIds = [...new Set([...allIds, ...priorIds])];
  const sharedMatchesDeduplicated = allIds.length - new Set(allIds).size;
  if (config.mode)
    await repository.set(membershipKey, {
      version: 1,
      ids: matchIds,
      cursor: cursor + config.playersPerTier,
      startedAt: membership?.startedAt ?? now,
    } satisfies MetaMembership);
  progress.uniqueMatches = matchIds.length;
  progress.phase = 'matches';
  emit();
  const matches: CompletedMatch[] = [];
  let cacheHits = 0;
  let uniqueMatchDetailsFetched = 0;
  let detailAttempts = 0;
  // Native provider owns rate headers, Retry-After, retries and cancellation. Two in flight.
  let next = 0;
  const detailResults = await Promise.allSettled(
    Array.from({ length: 2 }, async () => {
      while (next < matchIds.length) {
        check();
        const id = matchIds[next++];
        const cached = await history.getCompletedMatch(id);
        if (cached) {
          cacheHits++;
          matches.push(cached);
          progress.cachedMatches++;
          emit();
          continue;
        }
        if (
          (budget && detailAttempts >= budget.newMatches) ||
          Date.now() >= requestOptions.deadlineAt
        )
          continue;
        detailAttempts++;
        try {
          const match = await provider.completedMatch(id, requestOptions);
          if (match.id !== id) throw new RiotProviderError('malformed-response');
          await history.putCompletedMatch(match, now);
          uniqueMatchDetailsFetched++;
          matches.push(match);
          progress.newMatches++;
          emit();
        } catch (error) {
          report(error);
        }
      }
    }),
  );
  for (const result of detailResults) if (result.status === 'rejected') throw result.reason;
  check();
  matches.sort((a, b) => a.id.localeCompare(b.id));
  if (matches.length < matchIds.length)
    errors.push(
      'Collection budget or provider availability left some matches pending. Refresh again to continue.',
    );
  const windowStart = windowDays ? Date.parse(now) - windowDays * 86_400_000 : -Infinity;
  const current = matches.filter(
    (match) =>
      match.set === config.set &&
      Date.parse(match.completedAt) >= windowStart &&
      Date.parse(match.completedAt) <= Date.parse(now) &&
      (!config.mode || (match.queueId === 1100 && match.id.split(/[_-]/)[0] === config.platform)),
  );
  const observations: MetaObservation[] = [];
  const classificationKey = stableFingerprint({
    classifier: COMP_CLASSIFIER,
    families: familyDefinitionsFingerprint(playbooks),
    static: data.version.sourceVersion,
  });
  progress.phase = 'analyzing';
  emit();
  for (let index = 0; index < current.length; index++) {
    check();
    const match = current[index];
    const key = `meta-classified:v1:${classificationKey}:${match.id}`;
    const cached = config.mode ? await repository.get<MetaObservation[]>(key) : null;
    const rows =
      cached ??
      match.participants.map((participant) => ({
        matchId: match.id,
        puuid: participant.puuid,
        completedAt: match.completedAt,
        placement: participant.placement,
        classification: classifyFinalBoard(participant, playbooks, data),
      }));
    if (config.mode && !cached) await repository.set(key, rows);
    observations.push(...rows);
    progress.boards += rows.length;
    progress.classified += rows.filter((r) => r.classification.state === 'classified').length;
    progress.ambiguous += rows.filter((r) => r.classification.state === 'ambiguous').length;
    progress.unclassified = progress.boards - progress.classified - progress.ambiguous;
    if (index % 25 === 0) {
      emit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const classifiedBoards = observations.filter(
    (observation) => observation.classification.state === 'classified',
  ).length;
  const ambiguousBoards = observations.filter(
    (observation) => observation.classification.state === 'ambiguous',
  ).length;
  const unclassifiedBoards = observations.length - classifiedBoards - ambiguousBoards;
  const familyFingerprint = familyDefinitionsFingerprint(playbooks);
  const sampleFingerprint = config.mode
    ? stableFingerprint({
        scopeKey,
        days: windowDays,
        semantics: 'ranked-lobbies-and-verified-membership-v2',
      })
    : stableFingerprint(config);
  const derivationFingerprint = stableFingerprint({
    classifier: COMP_CLASSIFIER,
    statistics: META_STATISTICS,
    familyFingerprint,
    staticSourceVersion: data.version.sourceVersion,
    sampleFingerprint,
  });
  const providerMetrics = await provider.metrics();
  if (metricsBefore)
    for (const key of Object.keys(providerMetrics) as (keyof typeof providerMetrics)[])
      providerMetrics[key] = Math.max(0, providerMetrics[key] - metricsBefore[key]);
  const dates = current.map((match) => match.completedAt).sort();
  const dataset: AggregateMetaDataset = {
    id: `${config.platform}-${config.set}-${now}`,
    schemaVersion: 1,
    set: config.set,
    state: observations.length === 0 ? 'unavailable' : errors.length ? 'partial' : 'complete',
    sourceType: config.sourceType ?? 'riot-api',
    scope: config.mode
      ? {
          version: 1,
          key: scopeKey,
          windowDays: windowDays ?? 7,
          collectionStartedAt: membership?.startedAt ?? now,
          collectionEndedAt: new Date().toISOString(),
          population:
            'Ranked lobbies containing sampled ladder players; co-participant ranks unverified',
          mode: config.mode,
          pendingMatches: matchIds.length - matches.length,
        }
      : undefined,
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
    verifiedRank: {
      version: 1,
      membership: [...new Set(cohort.map((p) => p.puuid))].sort(),
      fetchedAt: now,
      tiers: config.tiers,
      complete: errors.length === 0 && cohort.length < 500,
      observations: observations.filter((o) => cohort.some((p) => p.puuid === o.puuid)),
      familyStats: deriveFamilyStatistics(
        observations.filter((o) => cohort.some((p) => p.puuid === o.puuid)),
        playbooks,
        now,
      ),
    },
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
  check();
  progress.phase = options.deferPublish ? 'discovery' : 'complete';
  if (config.mode && dataset.verifiedRank) {
    dataset.discoveryFamilyStats = dataset.familyStats;
    dataset.familyStats = dataset.verifiedRank.familyStats;
    dataset.statisticsPopulation = 'verified-rank';
  }
  emit();
  if (!options.deferPublish) await repository.set('aggregate-meta', dataset);
  return { dataset, observations, matches: current };
}
