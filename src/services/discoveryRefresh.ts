import type {
  DiscoveryConfigSnapshot,
  DiscoveryDataset,
  DiscoveryRefreshStatus,
  Playbook,
  StaticData,
} from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { HistoryStore } from '../storage/history';
import type { Repository } from '../storage/repository';
import { deriveIntelligenceAsync } from './intelligenceRefresh';
import {
  compatibleDiscoveryDataset,
  DEFAULT_DISCOVERY_CONFIG,
  deriveDiscoveryDataset,
  discoveryConfigurationFingerprint,
} from '../strategy/compDiscovery';
import {
  familyDefinitionsFingerprint,
  collectAggregateMeta,
  type MetaSampleConfig,
  type MetaCollectionOptions,
} from './metaPipeline';

export const DISCOVERY_REPOSITORY_KEY = 'comp-discovery';

export async function loadCompatibleDiscovery(
  repository: Repository,
  data: StaticData,
  families: Playbook[],
): Promise<DiscoveryDataset | null> {
  const stored = await repository.get<DiscoveryDataset>(DISCOVERY_REPOSITORY_KEY);
  return compatibleDiscoveryDataset(stored, {
    set: data.version.set,
    staticSourceVersion: data.version.sourceVersion,
    familyDefinitionsFingerprint: familyDefinitionsFingerprint(families),
    configurationFingerprint: discoveryConfigurationFingerprint(DEFAULT_DISCOVERY_CONFIG),
  })
    ? stored
    : null;
}

export interface MetaDiscoveryRefreshResult {
  meta: Awaited<ReturnType<typeof collectAggregateMeta>>['dataset'];
  discovery: DiscoveryDataset;
  status: DiscoveryRefreshStatus;
}

export async function refreshMetaDiscovery(
  provider: RiotProvider,
  history: HistoryStore,
  repository: Repository,
  data: StaticData,
  families: Playbook[],
  sample: MetaSampleConfig,
  now = new Date().toISOString(),
  config: DiscoveryConfigSnapshot = DEFAULT_DISCOVERY_CONFIG,
  options: MetaCollectionOptions = {},
): Promise<MetaDiscoveryRefreshResult> {
  let storedPrevious = await repository.get<DiscoveryDataset>(DISCOVERY_REPOSITORY_KEY);
  const aggregate = await collectAggregateMeta(
    provider,
    history,
    repository,
    data,
    families,
    sample,
    now,
    { ...options, deferPublish: Boolean(sample.mode) },
  );
  if (sample.mode)
    storedPrevious =
      (
        await repository.get<MetaBundle>(
          `meta-catalog:v1:${aggregate.dataset.sampleDefinitionFingerprint}`,
        )
      )?.discovery ?? storedPrevious;
  if (sample.mode && aggregate.dataset.state === 'unavailable')
    throw new Error('No eligible ranked matches returned. Cached evidence retained.');
  const input = {
    matches: aggregate.matches,
    families,
    data,
    sampleDefinitionFingerprint: aggregate.dataset.sampleDefinitionFingerprint,
    sourceType: aggregate.dataset.sourceType,
    source: aggregate.dataset.source,
    now,
    config,
    previous: compatibleDiscoveryDataset(storedPrevious, {
      set: data.version.set,
      staticSourceVersion: data.version.sourceVersion,
      familyDefinitionsFingerprint: familyDefinitionsFingerprint(families),
      sampleDefinitionFingerprint: aggregate.dataset.sampleDefinitionFingerprint,
      configurationFingerprint: discoveryConfigurationFingerprint(config),
    })
      ? storedPrevious
      : null,
  };
  const discovery = await deriveDiscoveryAsync(input, options.signal);
  aggregate.dataset.intelligence = await deriveIntelligenceAsync(
    [
      aggregate.matches,
      families,
      discovery,
      data,
      now,
      {
        region: sample.platform,
        ranks: sample.tiers,
        windowDays: sample.windowDays,
        membership: aggregate.dataset.verifiedRank?.membership,
      },
    ],
    options.signal,
  );
  if (options.signal?.aborted) throw new Error('Meta refresh cancelled. Cached evidence retained.');
  if (sample.mode) {
    const bundle = { version: 1 as const, meta: aggregate.dataset, discovery };
    const key = `meta-catalog:v1:${aggregate.dataset.sampleDefinitionFingerprint}`;
    await repository.set(key, bundle);
    const keys = (await repository.get<string[]>('meta-catalog-index:v1')) ?? [];
    await repository.set('meta-catalog-index:v1', [...new Set([...keys, key])]);
    // One SQLite upsert / localStorage replacement publishes a consistent pair.
    await repository.set('meta-current:v1', bundle);
  } else {
    await repository.set('aggregate-meta', aggregate.dataset);
    await repository.set(DISCOVERY_REPOSITORY_KEY, discovery);
  }
  return {
    meta: aggregate.dataset,
    discovery,
    status: {
      state: aggregate.dataset.state === 'partial' ? 'partial' : discovery.state,
      lastRefreshAt: discovery.generatedAt,
      activeDatasetId: discovery.id,
      message:
        aggregate.dataset.state === 'partial'
          ? `${aggregate.dataset.currentSetBoards} boards available. Partial collection; refresh again to continue.`
          : discovery.state === 'complete'
            ? `${discovery.boardsAnalyzed} boards analyzed across ${discovery.clusterCount} clusters.`
            : discovery.errors.join(' ') || 'No compatible aggregate boards were available.',
    },
  };
}

export interface MetaBundle {
  version: 1;
  meta: MetaDiscoveryRefreshResult['meta'];
  discovery: DiscoveryDataset;
}
async function deriveDiscoveryAsync(
  input: Parameters<typeof deriveDiscoveryDataset>[0],
  signal?: AbortSignal,
): Promise<DiscoveryDataset> {
  if (typeof Worker === 'undefined') return deriveDiscoveryDataset(input);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./metaDiscovery.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error('Meta refresh cancelled.'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) reject(new Error('Discovery failed. Cached evidence retained.'));
      else resolve(event.data.dataset);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Discovery unavailable. Cached evidence retained.'));
    };
    worker.postMessage(input);
  });
}
