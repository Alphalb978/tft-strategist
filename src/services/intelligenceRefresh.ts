import type {
  AggregateMetaDataset,
  CompletedMatch,
  DiscoveryDataset,
  Playbook,
  StaticData,
} from '../domain/models';
import type { IntelligenceModel } from '../domain/intelligence';
import { deriveIntelligence } from '../strategy/observedIntelligence';
import type { Repository } from '../storage/repository';
import type { HistoryStore } from '../storage/history';

export function deriveIntelligenceAsync(
  args: Parameters<typeof deriveIntelligence>,
  signal?: AbortSignal,
): Promise<IntelligenceModel> {
  if (typeof Worker === 'undefined') return Promise.resolve(deriveIntelligence(...args));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./intelligence.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error('Intelligence derivation cancelled.'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) reject(new Error('Intelligence derivation failed.'));
      else resolve(event.data.model);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Intelligence worker unavailable.'));
    };
    worker.postMessage(args);
  });
}
/** Explicit offline upgrade; only reads immutable IDs already in this selected dataset. */
export async function rebuildCachedIntelligence(
  meta: AggregateMetaDataset,
  discovery: DiscoveryDataset,
  data: StaticData,
  families: Playbook[],
  history: HistoryStore,
  repository: Repository,
  now = new Date().toISOString(),
) {
  const ids = [...new Set(meta.observations.map((o) => o.matchId))];
  const matches: CompletedMatch[] = [];
  for (let start = 0; start < ids.length; start += 32) {
    const batch = await Promise.all(
      ids.slice(start, start + 32).map((id) => history.getCompletedMatch(id)),
    );
    matches.push(...batch.filter((m): m is CompletedMatch => m !== null));
  }
  if (!matches.length)
    throw new Error('No immutable completed matches are available for this dataset.');
  const intelligence = await deriveIntelligenceAsync([
    matches,
    families,
    discovery,
    data,
    now,
    {
      region: meta.platform,
      ranks: meta.rankCohort,
      windowDays: meta.scope?.windowDays,
      membership: meta.verifiedRank?.membership,
    },
  ]);
  const next = { ...meta, intelligence };
  const bundle = { version: 1 as const, meta: next, discovery };
  await repository.set(`meta-catalog:v1:${meta.sampleDefinitionFingerprint}`, bundle);
  await repository.set('meta-current:v1', bundle);
  return next;
}
