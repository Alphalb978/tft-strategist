import type {
  CompletedMatch,
  LadderPlayer,
  RiotIdentity,
  RiotTelemetry,
  Result,
} from '../src/domain/models';
import {
  normalizeRiotMatch,
  RiotProviderError,
  type RiotConnectionStatus,
  type RiotProvider,
  type RiotRequestOptions,
} from '../src/providers/riot';
import { regionalRouteFor, type RiotPlatform } from '../src/providers/riotRouting';
import { collectAggregateMeta } from '../src/services/metaPipeline';
import { MemoryHistoryStore } from '../src/storage/history';
import { MemoryRepository } from '../src/storage/repository';
import { data, playbooks } from '../src/test/fixtures';
import { createRecommendations } from '../src/services/application';
import { defaultSettings } from '../src/storage/repository';

const key = process.env.RIOT_API_KEY?.trim();
if (!key) throw new Error('RIOT_API_KEY is unavailable; live M5 smoke test was not started.');
const platform = (process.env.M5_RIOT_PLATFORM ?? 'EUW1').toUpperCase() as RiotPlatform;
const regional = regionalRouteFor(platform);
const platformHost = `${platform.toLowerCase()}.api.riotgames.com`;
const regionalHost = `${regional.toLowerCase()}.api.riotgames.com`;
const ladderIndexes = [2, 4];
const metrics = {
  requestsAttempted: 0,
  retries: 0,
  rateLimitWaits: 0,
  rateLimitWaitMs: 0,
};

async function getJson(url: string, options?: RiotRequestOptions): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    metrics.requestsAttempted++;
    const response = await fetch(url, {
      headers: { 'X-Riot-Token': key! },
      signal: options?.signal ?? AbortSignal.timeout(15_000),
    });
    if (response.ok) return response.json();
    if (response.status === 429 && attempt === 0) {
      const waitMs = Math.min(5_000, 1_000 * Number(response.headers.get('retry-after') ?? 1));
      metrics.retries++;
      metrics.rateLimitWaits++;
      metrics.rateLimitWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new RiotProviderError(
      response.status === 401 || response.status === 403 ? 'auth' : 'unavailable',
      response.status,
      response.status >= 500,
    );
  }
  throw new RiotProviderError('unavailable');
}

const catalog = {
  unitIds: new Set(data.champions.map((unit) => unit.id)),
  itemIds: new Set(data.items.map((item) => item.id)),
  traitIds: new Set(data.traits.map((trait) => trait.id)),
  augmentIds: new Set(data.augments.map((augment) => augment.id)),
};

class LiveSmokeProvider implements RiotProvider {
  async connectionStatus(): Promise<RiotConnectionStatus> {
    return { keyDetected: true, source: 'native-environment' };
  }
  async ladderPlayers(tier: LadderPlayer['tier'], limit: number): Promise<LadderPlayer[]> {
    const payload = (await getJson(
      `https://${platformHost}/tft/league/v1/${tier.toLowerCase()}?queue=RANKED_TFT`,
    )) as {
      tier: LadderPlayer['tier'];
      entries: { puuid: string; summonerId?: string; leaguePoints: number }[];
    };
    const ranked = payload.entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
    return ladderIndexes
      .slice(0, limit)
      .map((index) => ranked[index])
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .map((entry) => ({ ...entry, tier: payload.tier }));
  }
  async puuidBySummonerId(summonerId: string): Promise<string> {
    const payload = (await getJson(
      `https://${platformHost}/tft/summoner/v1/summoners/${encodeURIComponent(summonerId)}`,
    )) as { puuid: string };
    return payload.puuid;
  }
  async recentMatchIds(puuid: string, start: number, count: number): Promise<string[]> {
    return (await getJson(
      `https://${regionalHost}/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${count}`,
    )) as string[];
  }
  async completedMatch(id: string): Promise<CompletedMatch> {
    return normalizeRiotMatch(
      await getJson(`https://${regionalHost}/tft/match/v1/matches/${encodeURIComponent(id)}`),
      catalog,
    );
  }
  async metrics(): Promise<
    Omit<RiotTelemetry, 'cacheHits' | 'uniqueMatchDetailsFetched' | 'sharedMatchesDeduplicated'>
  > {
    return { ...metrics };
  }
  async resolveAccount(): Promise<RiotIdentity> {
    throw new RiotProviderError('unavailable');
  }
  async accountByPuuid(): Promise<RiotIdentity> {
    throw new RiotProviderError('unavailable');
  }
  async lobby(): Promise<Result<string[], 'unsupported'>> {
    return { ok: false, error: 'unsupported' };
  }
}

const provider = new LiveSmokeProvider();
const history = new MemoryHistoryStore();
const repository = new MemoryRepository();
const config = {
  platform,
  regionalRoute: regional,
  tiers: ['CHALLENGER' as const],
  playersPerTier: 2,
  matchesPerPlayer: 4,
  set: 18,
};
const coldStarted = performance.now();
const cold = await collectAggregateMeta(provider, history, repository, data, playbooks, config);
const coldFinished = performance.now();
const warm = await collectAggregateMeta(provider, history, repository, data, playbooks, config);
const warmFinished = performance.now();
const loaded = createRecommendations(data, defaultSettings, cold.dataset.collectedAt, cold.dataset);
const coldProviderMetrics = {
  requestsAttempted: cold.dataset.telemetry.requestsAttempted,
  retries: cold.dataset.telemetry.retries,
  rateLimitWaits: cold.dataset.telemetry.rateLimitWaits,
  rateLimitWaitMs: cold.dataset.telemetry.rateLimitWaitMs,
};
const warmProviderMetrics = {
  requestsAttempted:
    warm.dataset.telemetry.requestsAttempted - cold.dataset.telemetry.requestsAttempted,
  retries: warm.dataset.telemetry.retries - cold.dataset.telemetry.retries,
  rateLimitWaits: warm.dataset.telemetry.rateLimitWaits - cold.dataset.telemetry.rateLimitWaits,
  rateLimitWaitMs: warm.dataset.telemetry.rateLimitWaitMs - cold.dataset.telemetry.rateLimitWaitMs,
};
console.log(
  JSON.stringify(
    {
      sample: {
        platform: cold.dataset.platform,
        regionalRoute: cold.dataset.regionalRoute,
        cohort: cold.dataset.rankCohort,
        ladderPositions: ladderIndexes.map((index) => index + 1),
        collectedAt: cold.dataset.collectedAt,
        windowStart: cold.dataset.windowStart,
        windowEnd: cold.dataset.windowEnd,
        ladderPlayersConsidered: cold.dataset.cohortPlayersConsidered,
        playersSampled: cold.dataset.uniqueCohortPlayers,
        uniqueMatchIdsDiscovered: cold.dataset.discoveredMatchIds,
        matchPayloadsFetched: cold.dataset.telemetry.uniqueMatchDetailsFetched,
        currentSetMatches: cold.dataset.currentSetMatches,
        currentSetBoards: cold.dataset.currentSetBoards,
        classified: cold.dataset.classifiedBoards,
        ambiguous: cold.dataset.ambiguousBoards,
        unclassified: cold.dataset.unclassifiedBoards,
        familiesWithStats: cold.dataset.familyStats.length,
        familyStats: cold.dataset.familyStats.map((stat) => ({
          familyId: stat.familyId,
          games: stat.games,
          averagePlacement: Number(stat.averagePlacement.toFixed(3)),
          topFourRate: Number(stat.topFour.raw.toFixed(3)),
          winRate: Number(stat.wins.raw.toFixed(3)),
          confidence: Number(stat.confidence.toFixed(3)),
          quality: stat.quality,
        })),
        firstBoard: cold.observations[0]
          ? {
              state: cold.observations[0].classification.state,
              familyId: cold.observations[0].classification.familyId,
              score: Number(cold.observations[0].classification.score.toFixed(3)),
              margin: Number(cold.observations[0].classification.margin.toFixed(3)),
            }
          : null,
        applicationLoad: {
          compatibleDatasetLoaded: loaded.meta?.id === cold.dataset.id,
          familyStatsAvailable: loaded.meta?.familyStats.length ?? 0,
          eligibleMeasuredComponents: loaded.portfolio.plans.reduce(
            (count, plan) =>
              count +
              plan.candidate.components.filter((component) => component.status === 'measured')
                .length,
            0,
          ),
        },
        patchRelevance: cold.dataset.patchRelevance,
        errors: cold.dataset.errors,
      },
      cold: {
        ...coldProviderMetrics,
        cacheHits: cold.dataset.telemetry.cacheHits,
        uniqueMatchDetailsFetched: cold.dataset.telemetry.uniqueMatchDetailsFetched,
        sharedMatchesDeduplicated: cold.dataset.telemetry.sharedMatchesDeduplicated,
        elapsedMs: Number((coldFinished - coldStarted).toFixed(2)),
      },
      warm: {
        ...warmProviderMetrics,
        cacheHits: warm.dataset.telemetry.cacheHits,
        uniqueMatchDetailsFetched: warm.dataset.telemetry.uniqueMatchDetailsFetched,
        sharedMatchesDeduplicated: warm.dataset.telemetry.sharedMatchesDeduplicated,
        elapsedMs: Number((warmFinished - coldFinished).toFixed(2)),
      },
    },
    null,
    2,
  ),
);
