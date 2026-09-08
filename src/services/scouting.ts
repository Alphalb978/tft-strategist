import type {
  CanonicalRouteSignature,
  CompletedMatch,
  LobbyPressure,
  OpponentHistoricalBoard,
  OpponentProfile,
  OpponentRouteAffinity,
  RiotIdentity,
  RiotTelemetry,
} from '../domain/models';
import { parseOpponentList, type ParsedRiotId } from '../providers/riotId';
import { RiotProviderError, type RiotProvider } from '../providers/riot';
import { ordinaryCopiesForStar } from '../rules/ruleSet';
import type { HistoryStore, RecentMatchIndex } from '../storage/history';
import { clamp } from '../strategy/scoring';
import {
  deriveLobbyUnitPressure,
  deriveOpponentRouteAffinityV3,
  gameRecencyWeight,
  M4_UNIT_MODEL,
  unitTrend,
} from '../strategy/lobbyPressure';

export const OPPONENT_DERIVATION_VERSION = M4_UNIT_MODEL.profileVersion;
export const RECENT_INDEX_TTL_MS = 5 * 60 * 1000;
export const IDENTITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_IDS = 60;

const emptyTelemetry = (): RiotTelemetry => ({
  requestsAttempted: 0,
  cacheHits: 0,
  retries: 0,
  rateLimitWaits: 0,
  rateLimitWaitMs: 0,
  uniqueMatchDetailsFetched: 0,
  sharedMatchesDeduplicated: 0,
});

function isFresh(fetchedAt: string, now: string, ttl: number) {
  const age = Date.parse(now) - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function relevantMatch(match: CompletedMatch, puuid: string, set: number) {
  return (
    match.set === set &&
    match.modeSupport !== 'unsupported' &&
    match.participants.some((participant) => participant.puuid === puuid)
  );
}

export interface OpponentDerivationOptions {
  copyEligibleUnitIds?: ReadonlySet<string>;
  staticSourceVersion?: string;
  routeSignatures?: CanonicalRouteSignature[];
}

function shortFingerprint(values: Iterable<string>) {
  let hash = 2_166_136_261;
  for (const char of [...values].sort().join('|')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function opponentDerivationVersion(target: number, options: OpponentDerivationOptions = {}) {
  const source = options.staticSourceVersion ?? 'static-unavailable';
  const copyCatalog = options.copyEligibleUnitIds
    ? `copy-${shortFingerprint(options.copyEligibleUnitIds)}`
    : 'copy-unavailable';
  const routeCatalog = options.routeSignatures?.length
    ? `routes-${shortFingerprint(options.routeSignatures.map((r) => r.compId))}`
    : 'routes-default';
  return `${OPPONENT_DERIVATION_VERSION}:target-${target}:static-${source}:${copyCatalog}:${routeCatalog}`;
}

export function deriveOpponent(
  puuid: string,
  matches: CompletedMatch[],
  set: number,
  patch: string,
  now: string,
  target: number = M4_UNIT_MODEL.defaultHistoryTarget,
  freshness: OpponentProfile['freshness'] = 'fresh',
  riotId?: string,
  derivationOptions: OpponentDerivationOptions = {},
): OpponentProfile {
  const relevant = [
    ...new Map(
      matches.filter((match) => relevantMatch(match, puuid, set)).map((match) => [match.id, match]),
    ).values(),
  ].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const sample = relevant.slice(0, target);
  const unitFrequency: Record<string, number> = {};
  const traitFrequency: Record<string, number> = {};
  const augmentFrequency: Record<string, number> = {};
  const unitGames: Record<string, number> = {};
  const recentUnitGames: Record<string, number> = {};
  const priorUnitGames: Record<string, number> = {};
  const copyWeightedTotals: Record<string, number> = {};
  const copyPresenceWeights: Record<string, number> = {};
  const copyEvidenceGames: Record<string, number> = {};
  const historicalBoards: OpponentHistoricalBoard[] = [];
  const unresolved = {
    units: new Set<string>(),
    items: new Set<string>(),
    traits: new Set<string>(),
    augments: new Set<string>(),
  };
  let effectiveSample = 0;
  let recencyEffectiveSample = 0;
  let placementWeight = 0;
  let placementTotal = 0;
  let topFourWeight = 0;
  let samePatchGames = 0;
  let comparablePatchGames = 0;
  let unverifiedModeGames = 0;
  for (const [ordinal, match] of sample.entries()) {
    const participant = match.participants.find((candidate) => candidate.puuid === puuid)!;
    const recencyWeight = gameRecencyWeight(ordinal, match.completedAt, now);
    const patchComparable =
      match.tftContentPatch !== null && match.tftContentPatchSource !== 'unavailable';
    const samePatch = patchComparable && match.tftContentPatch === patch;
    const patchWeight = patchComparable && !samePatch ? 0.25 : 1;
    const weight = recencyWeight * patchWeight;
    if (!Number.isFinite(weight)) continue;
    recencyEffectiveSample += recencyWeight;
    if (patchComparable) comparablePatchGames++;
    if (samePatch) samePatchGames++;
    if (match.modeSupport === 'unverified') unverifiedModeGames++;
    effectiveSample += weight;
    placementTotal += participant.placement * weight;
    placementWeight += weight;
    if (participant.placement <= 4) topFourWeight += weight;
    const boardChampionIds = [
      ...new Set(
        participant.units
          .filter((unit) => !unit.unresolvedUnit)
          .map((unit) => unit.championId),
      ),
    ];
    historicalBoards.push({
      matchId: match.id,
      completedAt: match.completedAt,
      ordinal,
      weight,
      placement: participant.placement,
      championIds: boardChampionIds,
    });
    const unitsById = new Map<string, typeof participant.units>();
    for (const unit of participant.units) {
      const group = unitsById.get(unit.championId) ?? [];
      group.push(unit);
      unitsById.set(unit.championId, group);
      if (unit.unresolvedUnit) unresolved.units.add(unit.championId);
      unit.unresolvedItems.forEach((id) => unresolved.items.add(id));
    }
    for (const [championId, units] of unitsById) {
      unitFrequency[championId] = (unitFrequency[championId] ?? 0) + weight;
      unitGames[championId] = (unitGames[championId] ?? 0) + 1;
      if (ordinal < M4_UNIT_MODEL.trend.recentGames)
        recentUnitGames[championId] = (recentUnitGames[championId] ?? 0) + 1;
      else priorUnitGames[championId] = (priorUnitGames[championId] ?? 0) + 1;

      let copies = 0;
      let copySupported = Boolean(derivationOptions.copyEligibleUnitIds?.has(championId));
      for (const unit of units) {
        const unitCopies = ordinaryCopiesForStar(unit.stars);
        if (unit.unresolvedUnit || unitCopies === null) copySupported = false;
        else copies += unitCopies;
      }
      if (copySupported) {
        const boundedCopies = Math.min(M4_UNIT_MODEL.pressure.maximumOrdinaryCopies, copies);
        copyWeightedTotals[championId] =
          (copyWeightedTotals[championId] ?? 0) + boundedCopies * weight;
        copyPresenceWeights[championId] = (copyPresenceWeights[championId] ?? 0) + weight;
        copyEvidenceGames[championId] = (copyEvidenceGames[championId] ?? 0) + 1;
      }
    }
    for (const trait of new Map(participant.traits.map((value) => [value.id, value])).values()) {
      traitFrequency[trait.id] = (traitFrequency[trait.id] ?? 0) + weight;
      if (trait.unresolved) unresolved.traits.add(trait.id);
    }
    for (const augment of new Set(participant.augmentIds)) {
      augmentFrequency[augment] = (augmentFrequency[augment] ?? 0) + weight;
    }
    participant.unresolvedAugmentIds.forEach((id) => unresolved.augments.add(id));
  }
  for (const frequency of [unitFrequency, traitFrequency, augmentFrequency])
    for (const key of Object.keys(frequency)) frequency[key] /= effectiveSample || 1;
  const recentWindowGames = Math.min(M4_UNIT_MODEL.trend.recentGames, sample.length);
  const priorWindowGames = Math.max(0, sample.length - recentWindowGames);
  const unitEvidence = Object.keys(unitGames)
    .map((championId) => {
      const gamesAppeared = unitGames[championId];
      const recentFiveAppearances = recentUnitGames[championId] ?? 0;
      const priorAppearances = priorUnitGames[championId] ?? 0;
      const recentFiveRate = recentWindowGames ? recentFiveAppearances / recentWindowGames : 0;
      const priorWindowRate = priorWindowGames ? priorAppearances / priorWindowGames : null;
      const trendDelta = priorWindowRate === null ? null : recentFiveRate - priorWindowRate;
      const evidenceGames = copyEvidenceGames[championId] ?? 0;
      const averageCopies = copyPresenceWeights[championId]
        ? copyWeightedTotals[championId] / copyPresenceWeights[championId]
        : null;
      const weightedDemand = evidenceGames
        ? copyWeightedTotals[championId] / (effectiveSample || 1)
        : null;
      return {
        championId,
        gamesAppeared,
        sampleGames: sample.length,
        rawPresenceRate: sample.length ? gamesAppeared / sample.length : 0,
        weightedPresence: unitFrequency[championId] ?? 0,
        recentFiveAppearances,
        recentWindowGames,
        recentFiveRate,
        priorAppearances,
        priorWindowGames,
        priorWindowRate,
        trendDelta,
        trend: unitTrend(trendDelta),
        historicalCopyDemand: {
          status: evidenceGames ? ('verified-ordinary' as const) : ('unavailable' as const),
          evidenceGames,
          evidenceCoverage: gamesAppeared ? evidenceGames / gamesAppeared : 0,
          weightedAverageFinalCopies: averageCopies,
          weightedDemand,
          note: evidenceGames
            ? 'Historical final-board evidence using verified ordinary 1/3/9 star-copy math; capped at nine copies per unit/game.'
            : 'Unavailable for unresolved, special/non-pool, or unsupported star-tier evidence.',
        },
      };
    })
    .sort(
      (a, b) =>
        b.weightedPresence - a.weightedPresence ||
        b.recentFiveRate - a.recentFiveRate ||
        a.championId.localeCompare(b.championId),
    );
  const patchQuality = comparablePatchGames
    ? 0.4 + 0.6 * (samePatchGames / comparablePatchGames)
    : null;
  const patchStatus: OpponentProfile['patchRelevance']['status'] = !comparablePatchGames
    ? 'unavailable'
    : samePatchGames === comparablePatchGames
      ? 'same'
      : samePatchGames === 0
        ? 'different'
        : 'mixed';
  const sampleCoverage = target ? clamp(sample.length / target) : 0;
  const recencyQuality = sample.length ? clamp(recencyEffectiveSample / sample.length) : 0;
  const modeQuality = sample.length ? 1 - 0.25 * (unverifiedModeGames / sample.length) : 0;
  const confidence = clamp(sampleCoverage * recencyQuality * modeQuality * (patchQuality ?? 1));
  const routeAffinities = derivationOptions.routeSignatures?.length
    ? derivationOptions.routeSignatures
        .map((sig) =>
          deriveOpponentRouteAffinityV3(
            { puuid, riotId, historicalBoards, confidence } as OpponentProfile,
            sig,
          ),
        )
        .filter((aff): aff is OpponentRouteAffinity => aff !== null)
    : undefined;

  return {
    puuid,
    riotId,
      generatedAt: now,
      sourceMatchIds: sample.map((match) => match.id),
      set,
      patch,
      derivationVersion: opponentDerivationVersion(target, derivationOptions),
      relevantGames: sample.length,
      effectiveSample,
      unitEvidence,
      unitFrequency,
      traitFrequency,
      augmentFrequency,
      placement: {
        games: sample.length,
        average: placementWeight ? placementTotal / placementWeight : null,
        topFourRate: placementWeight ? topFourWeight / placementWeight : null,
      },
      patchRelevance: {
        status: patchStatus,
        comparableGames: comparablePatchGames,
        samePatchGames: comparablePatchGames ? samePatchGames : null,
        note: comparablePatchGames
          ? 'Compared only matches carrying an explicitly sourced TFT content patch.'
          : 'Riot game client builds are not mapped to TFT content patches; relevance is unavailable.',
      },
      unresolvedIds: {
        units: [...unresolved.units].sort(),
        items: [...unresolved.items].sort(),
        traits: [...unresolved.traits].sort(),
        augments: [...unresolved.augments].sort(),
      },
      repeatedUnitCandidates: unitEvidence
        .filter((unit) => unit.gamesAppeared >= 2)
        .map((unit) => unit.championId),
      freshness,
      classification: {
        family: 'unavailable',
        style: 'unavailable',
        note: 'M4 does not infer composition families, intent, or future strategic styles from final boards.',
      },
      confidenceFactors: {
        sampleCoverage,
        recencyQuality,
        modeQuality,
        patchQuality,
      },
      confidence,
      historicalBoards,
      routeAffinities,
    };
}

export interface OpponentResolution {
  input: string;
  state: 'resolved' | 'cached' | 'ignored-self' | 'invalid' | 'failed';
  identity?: RiotIdentity;
  error?: string;
}

export interface ResolveOpponentsResult {
  requested: number;
  resolved: RiotIdentity[];
  entries: OpponentResolution[];
  duplicates: string[];
  overflow: number;
}

function safeResolutionMessage(error: unknown) {
  if (error instanceof RiotProviderError) return error.message;
  return 'This Riot ID could not be resolved.';
}

async function resolveOne(
  parsed: ParsedRiotId,
  provider: RiotProvider,
  store: HistoryStore,
  platform: string,
  now: string,
  options: { signal?: AbortSignal; deadlineAt?: number },
): Promise<OpponentResolution> {
  const cached = await store.getIdentity(parsed.gameName, parsed.tagLine, platform);
  if (cached && isFresh(cached.fetchedAt, now, IDENTITY_TTL_MS))
    return { input: parsed.display, state: 'cached', identity: cached };
  try {
    const identity = await provider.resolveAccount(parsed.gameName, parsed.tagLine, options);
    await store.putIdentity(identity, now);
    return { input: parsed.display, state: 'resolved', identity };
  } catch (error) {
    if (cached) return { input: parsed.display, state: 'cached', identity: cached };
    return { input: parsed.display, state: 'failed', error: safeResolutionMessage(error) };
  }
}

export async function resolveOpponentIdentities(
  value: string,
  provider: RiotProvider,
  store: HistoryStore,
  platform: string,
  now = new Date().toISOString(),
  ownPuuid?: string,
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
): Promise<ResolveOpponentsResult> {
  const parsed = parseOpponentList(value);
  const entries: OpponentResolution[] = parsed.invalid.map((input) => ({
    input,
    state: 'invalid',
    error: 'Use a Riot ID in the form gameName#tagLine.',
  }));
  entries.push(
    ...(await Promise.all(
      parsed.valid.map((id) => resolveOne(id, provider, store, platform, now, options)),
    )),
  );
  if (ownPuuid)
    for (const entry of entries) {
      if (entry.identity?.puuid === ownPuuid) {
        entry.state = 'ignored-self';
        entry.error = undefined;
      }
    }
  const identities = entries.flatMap((entry) =>
    entry.identity && entry.state !== 'ignored-self' ? [entry.identity] : [],
  );
  return {
    requested: parsed.valid.length + parsed.invalid.length,
    resolved: [...new Map(identities.map((identity) => [identity.puuid, identity])).values()].slice(
      0,
      7,
    ),
    entries,
    duplicates: parsed.duplicates,
    overflow: parsed.overflow,
  };
}

async function bounded<T>(
  values: T[],
  fn: (value: T) => Promise<void>,
  signal: AbortSignal,
  workers = 7,
) {
  const queue = [...values];
  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      while (queue.length && !signal.aborted) await fn(queue.shift()!);
    }),
  );
}

export interface ScoutOptions {
  set: number;
  patch: string;
  now: string;
  historyWindow?: number;
  currentUnitIds?: string[];
  copyEligibleUnitIds?: ReadonlySet<string>;
  staticSourceVersion?: string;
  routeSignatures?: CanonicalRouteSignature[];
  timeoutMs?: number;
  routing?: string;
  requestedOpponents?: number;
  onWarmResult?: (result: LobbyPressure) => void;
  onProgress?: (progress: {
    opponentsAnalyzed: number;
    opponentsTotal: number;
    matchesProcessed: number;
    message?: string;
  }) => void;
}

type PersonState = {
  identity: RiotIdentity;
  index: RecentMatchIndex | null;
  ids: string[];
  nextStart: number;
  exhausted: boolean;
  needsRefresh: boolean;
  failed: boolean;
};

function fingerprint(ids: string[]) {
  return [...ids].sort().join('|');
}

function makeLobbyResult(
  people: RiotIdentity[],
  profiles: OpponentProfile[],
  target: number,
  options: ScoutOptions,
  errors: string[],
  telemetry: RiotTelemetry,
  elapsedMs: number,
  timedOut: boolean,
  profileDerivationMs = 0,
): LobbyPressure {
  const pressureStarted = performance.now();
  const unitPressure = deriveLobbyUnitPressure(
    profiles,
    options.currentUnitIds ??
      profiles.flatMap((profile) => profile.unitEvidence.map((u) => u.championId)),
  );
  const pressureDerivationMs = performance.now() - pressureStarted;
  const derivationMs = profileDerivationMs + pressureDerivationMs;
  const expectedOpponents = Math.min(
    M4_UNIT_MODEL.pressure.expectedLobbyOpponents,
    Math.max(people.length, options.requestedOpponents ?? people.length),
  );
  const relevantGamesAvailable = profiles.reduce(
    (total, profile) => total + profile.relevantGames,
    0,
  );
  const relevantGamesTarget = expectedOpponents * target;
  const coverage = relevantGamesTarget ? clamp(relevantGamesAvailable / relevantGamesTarget) : 0;
  return {
    state:
      profiles.length === 0
        ? 'unavailable'
        : profiles.length === expectedOpponents && coverage >= 1 && !errors.length && !timedOut
          ? 'complete'
          : 'partial',
    expectedOpponents,
    requestedOpponents: options.requestedOpponents ?? people.length,
    resolvedOpponents: people.length,
    profilesCompleted: profiles.length,
    profiles,
    unitPressure,
    unitPressureVersion: M4_UNIT_MODEL.version,
    coverage,
    relevantGamesAvailable,
    relevantGamesTarget,
    freshProfiles: profiles.filter((profile) => profile.freshness === 'fresh').length,
    cachedProfiles: profiles.filter((profile) => profile.freshness !== 'fresh').length,
    acquisitionMs: Math.max(0, elapsedMs - profileDerivationMs),
    derivationMs,
    elapsedMs: elapsedMs + pressureDerivationMs,
    telemetry,
    fetchedAt: options.now,
    errors: [...new Set(errors)],
  };
}

const identityRiotId = (identity: RiotIdentity) =>
  identity.gameName && identity.tagLine ? `${identity.gameName}#${identity.tagLine}` : undefined;

const identityDisplayName = (identity: RiotIdentity) => identity.gameName || 'Lobby participant';

export async function scanLobby(
  identities: Array<RiotIdentity | string>,
  provider: RiotProvider,
  store: HistoryStore,
  options: ScoutOptions,
): Promise<LobbyPressure> {
  const started = performance.now();
  const requestedTarget = Math.round(options.historyWindow ?? M4_UNIT_MODEL.defaultHistoryTarget);
  const target = M4_UNIT_MODEL.supportedHistoryTargets.includes(requestedTarget as 10 | 15 | 20)
    ? requestedTarget
    : M4_UNIT_MODEL.defaultHistoryTarget;
  const derivationOptions: OpponentDerivationOptions = {
    copyEligibleUnitIds: options.copyEligibleUnitIds,
    staticSourceVersion: options.staticSourceVersion,
    routeSignatures: options.routeSignatures,
  };
  const derivationVersion = opponentDerivationVersion(target, derivationOptions);
  const normalizedIdentities = identities.map(
    (identity): RiotIdentity =>
      typeof identity === 'string'
        ? {
            puuid: identity,
            gameName: identity,
            tagLine: 'fixture',
            platform: 'fixture',
            routing: options.routing ?? 'fixture',
          }
        : identity,
  );
  const people = [
    ...new Map(normalizedIdentities.map((identity) => [identity.puuid, identity])).values(),
  ].slice(0, 7);
  const errors: string[] = [];
  const telemetry = emptyTelemetry();
  const timeoutMs = options.timeoutMs ?? 8_000;
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;
  const metricStart = await provider.metrics();
  const abortable = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const abort = () => reject(new RiotProviderError('deadline'));
      if (signal.aborted) return reject(new RiotProviderError('deadline'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  const matches = new Map<string, CompletedMatch>();
  const cachedProfiles = new Map<string, OpponentProfile>();
  options.onProgress?.({
    opponentsAnalyzed: 0,
    opponentsTotal: people.length,
    matchesProcessed: 0,
    message: 'Checking cached opponent evidence…',
  });
  try {
    for (const identity of people) {
      const stored = await store.getProfile(
        identity.puuid,
        options.set,
        options.patch,
        derivationVersion,
      );
      if (stored) {
        const profile = {
          ...stored.profile,
          riotId: identityRiotId(identity),
          freshness: isFresh(stored.profile.generatedAt, options.now, RECENT_INDEX_TTL_MS)
            ? ('cached' as const)
            : ('stale' as const),
        };
        cachedProfiles.set(identity.puuid, profile);
      }
    }
    if (cachedProfiles.size) {
      options.onProgress?.({
        opponentsAnalyzed: cachedProfiles.size,
        opponentsTotal: people.length,
        matchesProcessed: 0,
        message: 'Loaded cached profiles…',
      });
      options.onWarmResult?.(
        makeLobbyResult(
          people,
          [...cachedProfiles.values()],
          target,
          options,
          ['Refreshing cached opponent evidence.'],
          telemetry,
          performance.now() - started,
          false,
        ),
      );
    }

    const states: PersonState[] = [];
    for (const identity of people) {
      const routing = identity.routing || options.routing || 'fixture';
      const index = await store.getRecentIndex(identity.puuid, routing);
      const fresh = Boolean(index && isFresh(index.fetchedAt, options.now, RECENT_INDEX_TTL_MS));
      states.push({
        identity,
        index,
        ids: fresh ? [...index!.ids] : [],
        nextStart: fresh ? index!.requestedCount : 0,
        exhausted: fresh ? index!.exhausted : false,
        needsRefresh: !fresh,
        failed: false,
      });
      if (fresh) telemetry.cacheHits++;
    }

    const countRelevant = (state: PersonState) =>
      state.ids.filter((id) => {
        const match = matches.get(id);
        return match && relevantMatch(match, state.identity.puuid, options.set);
      }).length;

    const loadDetails = async () => {
      // 1. Inspect existing memory and persistent store cache for candidate IDs up to target
      for (const state of states) {
        let usable = 0;
        for (const id of state.ids) {
          if (usable >= target) break;
          let match = matches.get(id);
          if (!match) {
            const cached = await store.getCompletedMatch(id);
            if (cached) {
              matches.set(id, cached);
              telemetry.cacheHits++;
              match = cached;
            }
          }
          if (match && relevantMatch(match, state.identity.puuid, options.set)) {
            usable++;
          }
        }
      }

      // 2. Identify network fetches strictly needed to reach target
      const neededNetworkIds = new Set<string>();
      for (const state of states) {
        let usable = 0;
        let unknownQueued = 0;
        for (const id of state.ids) {
          if (usable >= target) break;
          const match = matches.get(id);
          if (match) {
            if (relevantMatch(match, state.identity.puuid, options.set)) {
              usable++;
            }
          } else {
            const remainingNeeded = target - usable;
            if (unknownQueued < remainingNeeded) {
              neededNetworkIds.add(id);
              unknownQueued++;
            }
          }
        }
      }

      // 3. Fetch missing details concurrently
      if (neededNetworkIds.size > 0) {
        await bounded(
          [...neededNetworkIds],
          async (id) => {
            try {
              const match = await abortable(provider.completedMatch(id, { signal, deadlineAt }));
              if (match.id !== id) throw new RiotProviderError('malformed-response');
              matches.set(id, match);
              telemetry.uniqueMatchDetailsFetched++;
              await store.putCompletedMatch(match, options.now);
            } catch (error) {
              errors.push(
                error instanceof RiotProviderError && error.code === 'not-found'
                  ? `Completed match ${id} was no longer available.`
                  : 'A completed-match request was unavailable.',
              );
            }
          },
          signal,
        );
      }

      // 4. Record deduplication telemetry
      const references = states.reduce((total, state) => total + state.ids.length, 0);
      const uniqueIds = new Set(states.flatMap((state) => state.ids)).size;
      telemetry.sharedMatchesDeduplicated = Math.max(0, references - uniqueIds);
    };

    await loadDetails();
    options.onProgress?.({
      opponentsAnalyzed: cachedProfiles.size,
      opponentsTotal: people.length,
      matchesProcessed: matches.size,
      message: `Processed ${matches.size} historical matches…`,
    });
    for (let round = 0; round < MAX_HISTORY_IDS && !signal.aborted; round++) {
      const candidates = states.filter((state) => {
        if (state.failed || state.exhausted) return false;
        if (state.needsRefresh) return true;
        const relevant = countRelevant(state);
        if (relevant >= target || state.nextStart >= MAX_HISTORY_IDS) return false;
        const unloadedCount = state.ids.filter((id) => !matches.has(id)).length;
        return unloadedCount === 0;
      });

      if (!candidates.length) {
        const hasUnloadedWork = states.some((state) => {
          if (state.failed) return false;
          const relevant = countRelevant(state);
          if (relevant >= target) return false;
          return state.ids.some((id) => !matches.has(id));
        });
        if (!hasUnloadedWork) break;
      }

      if (candidates.length > 0) {
        await bounded(
          candidates,
          async (state) => {
            const relevant = countRelevant(state);
            const needed = Math.max(0, target - relevant);
            const start = state.needsRefresh ? 0 : state.nextStart;
            const count = Math.min(needed, MAX_HISTORY_IDS - start);
            if (count <= 0) {
              state.exhausted = true;
              return;
            }
            try {
              const ids = await abortable(
                provider.recentMatchIds(state.identity.puuid, start, count, {
                  signal,
                  deadlineAt,
                }),
              );
              state.ids = state.needsRefresh
                ? [...new Set(ids)]
                : [...new Set([...state.ids, ...ids])];
              state.needsRefresh = false;
              state.nextStart = start + ids.length;
              state.exhausted = ids.length < count || state.nextStart >= MAX_HISTORY_IDS;
              await store.putRecentIndex({
                puuid: state.identity.puuid,
                routing: state.identity.routing || options.routing || 'fixture',
                targetCount: target,
                requestedCount: state.nextStart,
                ids: state.ids,
                exhausted: state.exhausted,
                fetchedAt: options.now,
              });
            } catch {
              state.failed = true;
              errors.push(
                `Recent history for ${identityDisplayName(state.identity)} was unavailable.`,
              );
              if (state.index) {
                state.ids = [...state.index.ids];
                state.nextStart = state.index.requestedCount;
                state.exhausted = state.index.exhausted;
              }
            }
          },
          signal,
        );
      }

      await loadDetails();
      options.onProgress?.({
        opponentsAnalyzed: cachedProfiles.size,
        opponentsTotal: people.length,
        matchesProcessed: matches.size,
        message: `Processed ${matches.size} historical matches…`,
      });
    }

    const profiles: OpponentProfile[] = [];
    let profileDerivationMs = 0;
    for (const state of states) {
      const available = state.ids.flatMap((id) => (matches.has(id) ? [matches.get(id)!] : []));
      const profileStarted = performance.now();
      const derived = deriveOpponent(
        state.identity.puuid,
        available,
        options.set,
        options.patch,
        options.now,
        target,
        'fresh',
        identityRiotId(state.identity),
        derivationOptions,
      );
      profileDerivationMs += performance.now() - profileStarted;
      const old = cachedProfiles.get(state.identity.puuid);
      const profile = derived.relevantGames ? derived : old;
      if (!profile) continue;
      profiles.push(profile);
      if (derived.relevantGames)
        await store.putProfile(derived, fingerprint(derived.sourceMatchIds));
      options.onProgress?.({
        opponentsAnalyzed: profiles.length,
        opponentsTotal: people.length,
        matchesProcessed: matches.size,
      });
    }
    if (signal.aborted)
      errors.push('Time budget reached; cached and partial results were retained.');
    const metricEnd = await provider.metrics();
    telemetry.requestsAttempted = Math.max(
      0,
      metricEnd.requestsAttempted - metricStart.requestsAttempted,
    );
    telemetry.retries = Math.max(0, metricEnd.retries - metricStart.retries);
    telemetry.rateLimitWaits = Math.max(0, metricEnd.rateLimitWaits - metricStart.rateLimitWaits);
    telemetry.rateLimitWaitMs = Math.max(
      0,
      metricEnd.rateLimitWaitMs - metricStart.rateLimitWaitMs,
    );
    const result = makeLobbyResult(
      people,
      profiles,
      target,
      options,
      errors,
      telemetry,
      performance.now() - started,
      signal.aborted,
      profileDerivationMs,
    );
    await store.putScanSnapshot(result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
