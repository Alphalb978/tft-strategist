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
): Promise<MetaDiscoveryRefreshResult> {
  const storedPrevious = await repository.get<DiscoveryDataset>(DISCOVERY_REPOSITORY_KEY);
  const aggregate = await collectAggregateMeta(
    provider,
    history,
    repository,
    data,
    families,
    sample,
    now,
  );
  const discovery = deriveDiscoveryDataset({
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
  });
  await repository.set(DISCOVERY_REPOSITORY_KEY, discovery);
  return {
    meta: aggregate.dataset,
    discovery,
    status: {
      state: discovery.state,
      lastRefreshAt: discovery.generatedAt,
      activeDatasetId: discovery.id,
      message:
        discovery.state === 'complete'
          ? `${discovery.boardsAnalyzed} boards analyzed across ${discovery.clusterCount} clusters.`
          : discovery.errors.join(' ') || 'No compatible aggregate boards were available.',
    },
  };
}
