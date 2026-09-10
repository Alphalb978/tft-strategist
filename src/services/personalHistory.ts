import type {
  CompletedMatch,
  PersonalCompPerformance,
  PersonalHistoryRefreshStatus,
  PersonalHistorySummary,
  PersonalMatchCorrection,
  PersonalMatchObservation,
  PersonalSampleConfidence,
  RiotIdentity,
  StaticData,
} from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { HistoryStore } from '../storage/history';
import type { Repository } from '../storage/repository';
import type { RuntimeKnowledgeCatalog } from './knowledgeCatalog';
import {
  classifyPersonalBoard,
  PERSONAL_COMP_CLASSIFIER_VERSION,
} from '../strategy/personalClassifier';

export interface RefreshPersonalHistoryResult {
  status: PersonalHistoryRefreshStatus;
  observations: PersonalMatchObservation[];
}

export async function refreshPersonalHistory(
  identity: RiotIdentity,
  provider: RiotProvider,
  historyStore: HistoryStore,
  repository: Repository,
  catalog: RuntimeKnowledgeCatalog | null,
  staticData: StaticData,
  targetCount = 20,
  options?: { force?: boolean },
  now = new Date().toISOString(),
): Promise<RefreshPersonalHistoryResult> {
  const cachedIndex = await historyStore.getRecentIndex(identity.puuid, identity.routing);
  const isFresh =
    !options?.force &&
    cachedIndex &&
    cachedIndex.ids.length >= targetCount &&
    Date.now() - Date.parse(cachedIndex.fetchedAt) < 5 * 60 * 1000;

  let matchIds: string[] = [];
  if (isFresh && cachedIndex) {
    matchIds = cachedIndex.ids.slice(0, targetCount);
  } else {
    matchIds = await provider.recentMatchIds(identity.puuid, 0, targetCount, {
      deadlineAt: Date.now() + 10_000,
    });
    await historyStore.putRecentIndex({
      puuid: identity.puuid,
      routing: identity.routing,
      targetCount,
      requestedCount: targetCount,
      ids: matchIds,
      exhausted: matchIds.length < targetCount,
      fetchedAt: now,
    });
  }

  // Deduplicate match IDs
  const uniqueMatchIds = [...new Set(matchIds)];
  let cachedMatchesReused = 0;
  let newMatchesFetched = 0;

  const completedMatches: CompletedMatch[] = [];
  for (const id of uniqueMatchIds) {
    const cached = await historyStore.getCompletedMatch(id);
    if (cached) {
      cachedMatchesReused++;
      completedMatches.push(cached);
    } else {
      try {
        const match = await provider.completedMatch(id, { deadlineAt: Date.now() + 8_000 });
        await historyStore.putCompletedMatch(match, now);
        newMatchesFetched++;
        completedMatches.push(match);
      } catch (err) {
        // If an individual match details call fails (e.g. rate limit), keep existing cached matches
        console.warn(`Failed to fetch completed match ${id}:`, err);
      }
    }
  }

  const existingObservations = await repository.listPersonalMatchObservations(identity.puuid);
  const existingMap = new Map(existingObservations.map((obs) => [obs.matchId, obs]));

  const newObservations: PersonalMatchObservation[] = [];
  for (const match of completedMatches) {
    const participant = match.participants.find((p) => p.puuid === identity.puuid);
    if (!participant) continue;

    const classification = classifyPersonalBoard(participant, match.set, catalog, staticData);
    const existing = existingMap.get(match.id);

    const observation: PersonalMatchObservation = {
      matchId: match.id,
      accountPuuid: identity.puuid,
      set: match.set,
      patch: match.tftContentPatch ?? null,
      riotGameVersion: match.riotGameVersion ?? null,
      gameTimestamp: match.gameTimestamp ?? match.completedAt,
      placement: participant.placement,
      level: participant.level,
      queueId: match.queueId ?? null,
      gameType: match.gameType ?? null,
      classifiedCompId: classification.compId,
      classificationState: classification.state,
      classificationConfidence: classification.confidence,
      classificationModelVersion: classification.classifierVersion,
      candidateCompIds: classification.candidateCompIds,
      runnerUpCompId: classification.runnerUpCompId,
      finalBoardHash: classification.finalBoardHash,
      units: participant.units.map((u) => ({
        championId: u.championId,
        stars: u.stars,
        items: u.items,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    newObservations.push(observation);
  }

  if (newObservations.length > 0) {
    await repository.putPersonalMatchObservations(newObservations);
  }

  const allObservations = await repository.listPersonalMatchObservations(identity.puuid);

  const status: PersonalHistoryRefreshStatus = {
    matchesFound: uniqueMatchIds.length,
    newMatchesFetched,
    cachedMatchesReused,
    lastUpdated: now,
    message: `${allObservations.length} games loaded · ${newMatchesFetched} new fetched · ${cachedMatchesReused} cached reused`,
  };

  return {
    status,
    observations: allObservations,
  };
}

export async function rederivePersonalMatchObservationsIfNeeded(
  observations: PersonalMatchObservation[],
  historyStore: HistoryStore,
  repository: Repository,
  catalog: RuntimeKnowledgeCatalog | null,
  staticData: StaticData,
): Promise<PersonalMatchObservation[]> {
  let modified = false;
  const rederivedList: PersonalMatchObservation[] = [];
  const now = new Date().toISOString();

  const targetSet =
    typeof staticData.version.set === 'number'
      ? staticData.version.set
      : Number.parseInt(String(staticData.version.set), 10);

  for (const obs of observations) {
    const obsSet = typeof obs.set === 'number' ? obs.set : Number.parseInt(String(obs.set), 10);
    const isCurrentSet = obsSet === targetSet;
    const isOldClassifier = obs.classificationModelVersion !== PERSONAL_COMP_CLASSIFIER_VERSION;
    const isZeroCandidateUnclassified =
      isCurrentSet &&
      obs.classificationState === 'unclassified' &&
      (!obs.candidateCompIds || obs.candidateCompIds.length === 0) &&
      (obs.classificationConfidence === 0 || obs.classifiedCompId === null);

    if (isCurrentSet && (isOldClassifier || isZeroCandidateUnclassified)) {
      const cached = await historyStore.getCompletedMatch(obs.matchId);
      const participant = cached?.participants.find((p) => p.puuid === obs.accountPuuid) ?? {
        puuid: obs.accountPuuid,
        placement: obs.placement,
        level: obs.level,
        units: obs.units.map((u) => ({
          championId: u.championId,
          stars: u.stars ?? 1,
          items: u.items ?? [],
          rarity: null,
          rawName: null,
          unresolvedUnit: false,
          unresolvedItems: [],
        })),
        traits: [],
        augmentIds: [],
        unresolvedAugmentIds: [],
      };

      const classification = classifyPersonalBoard(participant, obsSet, catalog, staticData);
      obs.classifiedCompId = classification.compId;
      obs.classificationState = classification.state;
      obs.classificationConfidence = classification.confidence;
      obs.classificationModelVersion = classification.classifierVersion;
      obs.candidateCompIds = classification.candidateCompIds;
      obs.runnerUpCompId = classification.runnerUpCompId;
      obs.finalBoardHash = classification.finalBoardHash;
      obs.updatedAt = now;
      modified = true;
      rederivedList.push(obs);
    }
  }

  if (modified && rederivedList.length > 0) {
    await repository.putPersonalMatchObservations(rederivedList);
  }

  return observations;
}

export function sampleConfidenceFor(games: number): PersonalSampleConfidence {
  if (games <= 2) return 'VERY LIMITED';
  if (games <= 4) return 'LIMITED';
  if (games <= 9) return 'DEVELOPING';
  return 'MEANINGFUL';
}

export function derivePersonalCompPerformance(
  observations: PersonalMatchObservation[],
  catalog: RuntimeKnowledgeCatalog | null,
  currentSet: number,
  corrections?: Map<string, PersonalMatchCorrection> | PersonalMatchCorrection[],
): PersonalCompPerformance[] {
  const normCurrentSet =
    typeof currentSet === 'number' ? currentSet : Number.parseInt(String(currentSet), 10);
  const correctionMap = new Map<string, PersonalMatchCorrection>();
  if (corrections) {
    const list = Array.isArray(corrections) ? corrections : [...corrections.values()];
    for (const c of list) {
      correctionMap.set(c.matchId, c);
    }
  }

  // Deduplicate by match ID to guarantee each match counts exactly once
  const uniqueMap = new Map<
    string,
    { obs: PersonalMatchObservation; compId: string; confidence: number }
  >();

  for (const obs of observations) {
    const obsSet = typeof obs.set === 'number' ? obs.set : Number.parseInt(String(obs.set), 10);
    if (obsSet !== normCurrentSet) continue;
    if (uniqueMap.has(obs.matchId)) continue;

    const correction = correctionMap.get(obs.matchId);
    if (correction) {
      if (correction.state === 'canonical' && correction.canonicalCompId) {
        // Validate that the comp belongs to current set in catalog
        const validComp =
          catalog?.playbooks.some(
            (p) =>
              (typeof p.set === 'number' ? p.set : Number.parseInt(String(p.set), 10)) ===
                normCurrentSet && p.id === correction.canonicalCompId,
          ) ||
          catalog?.comps.some((c) => c.id === correction.canonicalCompId);

        if (validComp) {
          uniqueMap.set(obs.matchId, {
            obs,
            compId: correction.canonicalCompId,
            confidence: 1.0, // Trusted ground-truth
          });
        } else {
          // Invalid or old-set comp rejected safely: fall back to automatic if classified
          if (obs.classificationState === 'classified' && obs.classifiedCompId) {
            uniqueMap.set(obs.matchId, {
              obs,
              compId: obs.classifiedCompId,
              confidence: obs.classificationConfidence,
            });
          }
        }
      } else if (correction.state === 'unclassified') {
        // Explicitly unclassified: do not attribute to any comp
        continue;
      } else {
        // Cleared or other: fall back to automatic
        if (obs.classificationState === 'classified' && obs.classifiedCompId) {
          uniqueMap.set(obs.matchId, {
            obs,
            compId: obs.classifiedCompId,
            confidence: obs.classificationConfidence,
          });
        }
      }
    } else {
      if (obs.classificationState === 'classified' && obs.classifiedCompId) {
        uniqueMap.set(obs.matchId, {
          obs,
          compId: obs.classifiedCompId,
          confidence: obs.classificationConfidence,
        });
      }
    }
  }

  const grouped = new Map<
    string,
    { obs: PersonalMatchObservation; confidence: number }[]
  >();
  for (const entry of uniqueMap.values()) {
    const list = grouped.get(entry.compId) ?? [];
    list.push({ obs: entry.obs, confidence: entry.confidence });
    grouped.set(entry.compId, list);
  }

  const results: PersonalCompPerformance[] = [];
  for (const [compId, matches] of grouped.entries()) {
    const sorted = [...matches].sort(
      (a, b) => Date.parse(b.obs.gameTimestamp) - Date.parse(a.obs.gameTimestamp),
    );
    const games = sorted.length;
    const totalPlacement = sorted.reduce((sum, m) => sum + m.obs.placement, 0);
    const averagePlacement = Math.round((totalPlacement / games) * 100) / 100;
    const top4Count = sorted.filter((m) => m.obs.placement <= 4).length;
    const top4Rate = Math.round((top4Count / games) * 100) / 100;
    const winCount = sorted.filter((m) => m.obs.placement === 1).length;
    const winRate = Math.round((winCount / games) * 100) / 100;
    const bestPlacement = Math.min(...sorted.map((m) => m.obs.placement));
    const recentPlacements = sorted.slice(0, 5).map((m) => m.obs.placement);
    const lastPlayed = sorted[0].obs.gameTimestamp;
    const sampleConfidence = sampleConfidenceFor(games);

    // Empirical Bayes shrinkage toward neutral 4.5 baseline with M=4 prior weight
    const priorMean = 4.5;
    const priorWeight = 4;
    const evidenceAdjustedEstimate =
      Math.round(((averagePlacement * games + priorMean * priorWeight) / (games + priorWeight)) * 100) / 100;

    const compTitle =
      catalog?.playbooks.find((p) => p.id === compId)?.title ??
      catalog?.comps.find((c) => c.id === compId)?.title ??
      compId;

    const classificationConfidenceAvg =
      Math.round(
        (sorted.reduce((sum, m) => sum + m.confidence, 0) / games) * 100,
      ) / 100;

    results.push({
      compId,
      compTitle,
      games,
      averagePlacement,
      top4Count,
      top4Rate,
      winCount,
      winRate,
      bestPlacement,
      recentPlacements,
      lastPlayed,
      sampleConfidence,
      evidenceAdjustedEstimate,
      classificationConfidenceAvg,
    });
  }

  return results.sort((a, b) => b.games - a.games || a.averagePlacement - b.averagePlacement);
}

export function derivePersonalHistorySummary(
  observations: PersonalMatchObservation[],
  compPerformances: PersonalCompPerformance[],
  currentSet: number,
): PersonalHistorySummary {
  // Deduplicate by match ID
  const uniqueMap = new Map<string, PersonalMatchObservation>();
  for (const obs of observations) {
    if (!uniqueMap.has(obs.matchId)) {
      uniqueMap.set(obs.matchId, obs);
    }
  }

  const normCurrentSet =
    typeof currentSet === 'number' ? currentSet : Number.parseInt(String(currentSet), 10);
  const all = [...uniqueMap.values()];
  const currentSetMatches = all.filter(
    (obs) =>
      (typeof obs.set === 'number' ? obs.set : Number.parseInt(String(obs.set), 10)) ===
      normCurrentSet,
  );
  const archivedOldSetGames = all.filter(
    (obs) =>
      (typeof obs.set === 'number' ? obs.set : Number.parseInt(String(obs.set), 10)) !==
      normCurrentSet,
  ).length;


  const currentSetGames = currentSetMatches.length;
  let currentSetAveragePlacement: number | null = null;
  let currentSetTop4Rate: number | null = null;
  let currentSetWinRate: number | null = null;

  if (currentSetGames > 0) {
    const totalPlacement = currentSetMatches.reduce((sum, m) => sum + m.placement, 0);
    currentSetAveragePlacement = Math.round((totalPlacement / currentSetGames) * 100) / 100;
    const top4Count = currentSetMatches.filter((m) => m.placement <= 4).length;
    currentSetTop4Rate = Math.round((top4Count / currentSetGames) * 100) / 100;
    const winCount = currentSetMatches.filter((m) => m.placement === 1).length;
    currentSetWinRate = Math.round((winCount / currentSetGames) * 100) / 100;
  }

  const mostPlayed = compPerformances.length > 0 ? compPerformances[0] : null;
  const mostPlayedComp = mostPlayed
    ? { compId: mostPlayed.compId, compTitle: mostPlayed.compTitle, games: mostPlayed.games }
    : null;

  // Minimum sample for highlighting strongest/weaker observed: at least 3 games
  const qualified = compPerformances.filter((c) => c.games >= 3);
  const sortedStrongest = [...qualified].sort(
    (a, b) => a.averagePlacement - b.averagePlacement || b.top4Rate - a.top4Rate,
  );
  const sortedWeaker = [...qualified].sort(
    (a, b) => b.averagePlacement - a.averagePlacement || a.top4Rate - b.top4Rate,
  );

  const strongest = sortedStrongest[0];
  const weaker =
    sortedWeaker[0] && sortedWeaker[0].compId !== strongest?.compId ? sortedWeaker[0] : null;

  return {
    currentSet,
    currentSetGames,
    archivedOldSetGames,
    currentSetAveragePlacement,
    currentSetTop4Rate,
    currentSetWinRate,
    mostPlayedComp,
    strongestObserved: strongest
      ? {
          compId: strongest.compId,
          compTitle: strongest.compTitle,
          games: strongest.games,
          averagePlacement: strongest.averagePlacement,
          top4Rate: strongest.top4Rate,
          sampleConfidence: strongest.sampleConfidence,
        }
      : null,
    weakerObserved: weaker
      ? {
          compId: weaker.compId,
          compTitle: weaker.compTitle,
          games: weaker.games,
          averagePlacement: weaker.averagePlacement,
          top4Rate: weaker.top4Rate,
          sampleConfidence: weaker.sampleConfidence,
        }
      : null,
  };
}
