import type { CompletedMatch, LobbyPressure, OpponentProfile } from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { Repository } from '../storage/repository';
import { clamp } from '../strategy/scoring';
const VERSION = 'opponent-v1';
export function deriveOpponent(
  puuid: string,
  matches: CompletedMatch[],
  set: number,
  patch: string,
  now: string,
): OpponentProfile {
  const familyFrequency: Record<string, number> = {},
    unitFrequency: Record<string, number> = {},
    styleFrequency: Record<string, number> = {},
    placementByFamily: Record<string, number> = {};
  const relevant = [
    ...new Map(
      matches
        .filter((m) => m.set === set && m.participants.some((p) => p.puuid === puuid))
        .map((m) => [m.id, m]),
    ).values(),
  ];
  let total = 0;
  for (const match of relevant) {
    const p = match.participants.find((p) => p.puuid === puuid)!;
    const age = Math.max(0, Date.parse(now) - Date.parse(match.completedAt)) / 86400000;
    const weight = Math.exp(-age / 14) * (match.patch === patch ? 1 : 0.25);
    if (!Number.isFinite(weight)) continue;
    total += weight;
    if (p.familyId) {
      familyFrequency[p.familyId] = (familyFrequency[p.familyId] ?? 0) + weight;
      placementByFamily[p.familyId] = (placementByFamily[p.familyId] ?? 0) + weight * p.placement;
    }
    if (p.style) styleFrequency[p.style] = (styleFrequency[p.style] ?? 0) + weight;
    for (const id of new Set(p.units.map((u) => u.championId)))
      unitFrequency[id] = (unitFrequency[id] ?? 0) + weight;
  }
  for (const family of Object.keys(placementByFamily))
    placementByFamily[family] /= familyFrequency[family];
  for (const map of [familyFrequency, unitFrequency, styleFrequency])
    for (const key of Object.keys(map)) map[key] /= total || 1;
  const forceIndex = Math.max(0, ...Object.values(familyFrequency));
  return {
    puuid,
    generatedAt: now,
    sourceMatchIds: relevant.map((m) => m.id),
    set,
    patch,
    derivationVersion: VERSION,
    relevantGames: relevant.length,
    effectiveSample: total,
    familyFrequency,
    unitFrequency,
    styleFrequency,
    placementByFamily,
    forceIndex,
    flexIndex: Object.keys(familyFrequency).length ? 1 - forceIndex : 0,
    confidence: clamp(total / 15),
  };
}
async function bounded<T>(values: T[], fn: (value: T) => Promise<void>, signal: AbortSignal) {
  const queue = [...values];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && !signal.aborted) await fn(queue.shift()!);
    }),
  );
}
export interface ScoutOptions {
  set: number;
  patch: string;
  now: string;
  historyWindow?: number;
  timeoutMs?: number;
}
export async function scanLobby(
  puuids: string[],
  provider: RiotProvider,
  repository: Repository,
  options: ScoutOptions,
): Promise<LobbyPressure> {
  const people = [...new Set(puuids)].slice(0, 7),
    errors: string[] = [],
    matches = new Map<string, CompletedMatch>();
  const indexes = new Map<string, string[]>(),
    profiles: OpponentProfile[] = [];
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  const signal = controller.signal;
  // Race every provider call: even a non-cooperative adapter cannot block partial results.
  const abortable = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Scout timeout'));
      if (signal.aborted) {
        reject(new Error('Scout timeout'));
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  try {
    await bounded(
      people,
      async (puuid) => {
        const key = `recent:${puuid}`;
        const cached = await repository.get<{ ids: string[]; fetchedAt: string; count: number }>(
          key,
        );
        const count = Math.round(clamp(options.historyWindow ?? 15, 10, 20));
        try {
          if (
            cached &&
            cached.count >= count &&
            Date.parse(options.now) - Date.parse(cached.fetchedAt) < 300000
          )
            indexes.set(puuid, cached.ids.slice(0, count));
          else {
            const ids = await abortable(provider.recentMatchIds(puuid, count, signal));
            indexes.set(puuid, ids);
            await repository.set(key, { ids, fetchedAt: options.now, count });
          }
        } catch {
          errors.push('A recent-history request was unavailable.');
          if (cached) indexes.set(puuid, cached.ids.slice(0, count));
        }
      },
      signal,
    );
    const ids = [...new Set([...indexes.values()].flat())];
    // Cached immutable matches remain usable even after a deadline.
    for (const id of ids) {
      const cached = await repository.get<CompletedMatch>(`match:${id}`);
      if (cached) matches.set(id, cached);
    }
    await bounded(
      ids.filter((id) => !matches.has(id)),
      async (id) => {
        try {
          const match = await abortable(provider.completedMatch(id, signal));
          if (match.id !== id) throw new Error('Match identity mismatch');
          matches.set(id, match);
          await repository.set(`match:${id}`, match);
        } catch {
          errors.push('A completed match was unavailable.');
        }
      },
      signal,
    );
    for (const puuid of people) {
      const available = (indexes.get(puuid) ?? []).flatMap((id) =>
        matches.has(id) ? [matches.get(id)!] : [],
      );
      const profile = deriveOpponent(puuid, available, options.set, options.patch, options.now);
      if (profile.relevantGames) {
        profiles.push(profile);
        await repository.set(`opponent:${puuid}:${VERSION}`, profile);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (signal.aborted) errors.push('Time budget reached; results are partial.');
  const coverage = people.length
    ? profiles.reduce((s, p) => s + clamp(p.effectiveSample / (options.historyWindow ?? 15)), 0) /
      people.length
    : 0;
  return {
    state: !profiles.length
      ? 'unavailable'
      : coverage >= 0.95 && !errors.length
        ? 'complete'
        : 'partial',
    expectedOpponents: people.length,
    profiles,
    coverage,
    fetchedAt: options.now,
    errors: [...new Set(errors)],
  };
}
