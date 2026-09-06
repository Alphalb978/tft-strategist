import type {
  AggregateMetaDataset,
  CompRegistryEntry,
  DiscoveryDataset,
  LobbyPressure,
  PlanSession,
  PlanSessionManualState,
  Playbook,
  RecommendationPortfolio,
  SelectedPlan,
  StaticData,
} from '../domain/models';
import { CommunityDragonProvider } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import { validatePlaybook } from '../rules/validation';
import type { Repository, Settings } from '../storage/repository';
import { normalizeSettings } from '../storage/repository';
import { scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import { isStaticData } from '../domain/staticSchema';
import { auditStaticData } from '../rules/ruleSet';
import { COMP_CLASSIFIER } from '../strategy/compClassifier';
import { META_STATISTICS, compatibleMetaDataset } from '../strategy/metaStatistics';
import { familyDefinitionsFingerprint } from './metaPipeline';
import { buildCompRegistry } from './compRegistry';
import {
  compatibleDiscoveryDataset,
  DEFAULT_DISCOVERY_CONFIG,
  discoveryConfigurationFingerprint,
} from '../strategy/compDiscovery';
import {
  createPlanSession,
  endSessionRecord,
  evaluatePlanSessionCompatibility,
  isPlanSession,
  persistCompatibility,
  updateManualState,
  upgradeLegacySelection,
} from './planSession';
export interface ApplicationState {
  data: StaticData;
  playbooks: Playbook[];
  portfolio: RecommendationPortfolio;
  source: 'Bundled snapshot' | 'Local cache' | 'Locked snapshot' | 'Network';
  settings: Settings;
  activeSession: PlanSession | null;
  notices: string[];
  assets: Record<string, string>;
  meta: AggregateMetaDataset | null;
  discovery: DiscoveryDataset | null;
  registry: CompRegistryEntry[];
}
export function createRecommendations(
  data: StaticData,
  settings: Settings,
  now = new Date().toISOString(),
  meta: AggregateMetaDataset | null = null,
  discovery: DiscoveryDataset | null = null,
) {
  const dataIssues = auditStaticData(data);
  if (dataIssues.length)
    throw new Error(
      `Static data failed the audited rules: ${dataIssues.map((issue) => issue.message).join(' ')}`,
    );
  const all = loadPlaybooks(data),
    notices: string[] = [];
  const playbooks = all.filter((p) => {
    const errors = validatePlaybook(p, data).filter((i) => i.severity === 'error');
    if (errors.length)
      notices.push(`${p.title} excluded: ${errors.map((e) => e.message).join(' ')}`);
    return !errors.length;
  });
  const usableMeta = compatibleMetaDataset(meta, {
    classifierVersion: COMP_CLASSIFIER.version,
    statisticsVersion: META_STATISTICS.version,
    familyDefinitionsFingerprint: familyDefinitionsFingerprint(playbooks),
    staticSourceVersion: data.version.sourceVersion,
  })
    ? meta
    : null;
  if (meta && !usableMeta)
    notices.push('Incompatible aggregate-meta cache ignored and queued for recomputation.');
  const familyFingerprint = familyDefinitionsFingerprint(playbooks);
  const usableDiscovery = compatibleDiscoveryDataset(discovery, {
    set: data.version.set,
    staticSourceVersion: data.version.sourceVersion,
    familyDefinitionsFingerprint: familyFingerprint,
    configurationFingerprint: discoveryConfigurationFingerprint(DEFAULT_DISCOVERY_CONFIG),
  })
    ? discovery
    : null;
  if (discovery && !usableDiscovery)
    notices.push('Incompatible discovery cache ignored and queued for recomputation.');
  const registry = buildCompRegistry(playbooks, data, usableDiscovery);
  const recommendationPlaybooks = registry
    .filter((entry) => entry.recommendationEligible)
    .map((entry) => entry.playbook);
  const portfolio = optimizePortfolio(
    recommendationPlaybooks.map((p) =>
      scoreCandidate(p, {
        version: data.version,
        now,
        personalWeight: settings.personalWeight,
        meta: usableMeta,
        discovery: usableDiscovery,
      }),
    ),
    now,
  );
  return {
    playbooks: registry.map((entry) => entry.playbook),
    portfolio,
    notices,
    meta: usableMeta,
    discovery: usableDiscovery,
    registry,
  };
}
export async function loadApplication(repository: Repository): Promise<ApplicationState> {
  const [
    cached,
    savedSettings,
    legacySelection,
    savedMeta,
    savedDiscovery,
    storedSession,
    assetResponse,
  ] = await Promise.all([
    repository.get<StaticData>('static'),
    repository.get<Settings>('settings'),
    repository.get<SelectedPlan>('selection'),
    repository.get<AggregateMetaDataset>('aggregate-meta'),
    repository.get<DiscoveryDataset>('comp-discovery'),
    repository.getActivePlanSession(),
    fetch('/data/asset-manifest.json').catch(() => null),
  ]);
  const settings = normalizeSettings(savedSettings);
  let cacheUsable = isStaticData(cached);
  if (cacheUsable) {
    try {
      cacheUsable = createRecommendations(cached!, settings).playbooks.length > 0;
    } catch {
      cacheUsable = false;
    }
  }
  let response: Response | null = null;
  if (!cacheUsable) response = await fetch('/data/static-set18.json').catch(() => null);
  let data: unknown = cached;
  let source: ApplicationState['source'] = 'Local cache';
  if (!cacheUsable) {
    if (response?.ok) {
      data = await response.json();
      source = 'Bundled snapshot';
    } else if (isPlanSession(storedSession) && isStaticData(storedSession.snapshot.staticData)) {
      data = storedSession.snapshot.staticData;
      source = 'Locked snapshot';
    } else throw new Error('The bundled static snapshot could not be loaded.');
  }
  if (!isStaticData(data))
    throw new Error('Static snapshot schema is unsupported. Refresh the application data.');
  const assets: Record<string, string> = assetResponse?.ok
    ? await assetResponse.json().catch(() => ({}))
    : {};
  const result = createRecommendations(
    data,
    settings,
    new Date().toISOString(),
    savedMeta,
    savedDiscovery,
  );
  let activeSession =
    isPlanSession(storedSession) && storedSession.state === 'active' ? storedSession : null;
  const baseState: ApplicationState = {
    data,
    ...result,
    source,
    settings,
    activeSession,
    notices: result.notices,
    assets,
  };
  if (!activeSession && legacySelection) {
    activeSession = upgradeLegacySelection(legacySelection, baseState);
    if (activeSession) await repository.createPlanSession(activeSession);
    // The legacy pointer is one-shot. Its SQLite history row remains intact, but clearing the
    // settings value prevents an ended M8 session from being silently resurrected on restart.
    await repository.set('selection', null);
  }
  if (activeSession) {
    const compatibility = evaluatePlanSessionCompatibility(activeSession, data, result);
    if (
      compatibility.state !== activeSession.compatibility.state ||
      compatibility.reasons.join('\n') !== activeSession.compatibility.reasons.join('\n')
    )
      activeSession = await persistCompatibility(repository, activeSession, compatibility);
  }
  if (cached && !cacheUsable)
    result.notices.push('Incompatible cache ignored; using the bundled snapshot.');
  return {
    data,
    ...result,
    source,
    settings,
    activeSession,
    assets,
  };
}
export async function refreshApplication(
  current: ApplicationState,
  repository: Repository,
): Promise<ApplicationState> {
  const data = await new CommunityDragonProvider().fetch();
  const result = createRecommendations(
    data,
    current.settings,
    new Date().toISOString(),
    current.meta,
    current.discovery,
  );
  if (!result.playbooks.length)
    throw new Error('Refreshed roster failed playbook validation; previous cache retained.');
  await repository.set('static', data);
  let activeSession = current.activeSession;
  if (activeSession) {
    const compatibility = evaluatePlanSessionCompatibility(activeSession, data, result);
    activeSession = await persistCompatibility(repository, activeSession, compatibility);
  }
  return { ...current, data, ...result, activeSession, source: 'Network' };
}
export async function lockPlanSession(
  playbookId: string,
  state: ApplicationState,
  repository: Repository,
  lobby: LobbyPressure | null = null,
  now = new Date().toISOString(),
): Promise<PlanSession> {
  if (state.activeSession) throw new Error('An active plan session already exists.');
  const session = createPlanSession(playbookId, state, state.portfolio, lobby, now);
  await repository.createPlanSession(session);
  return session;
}

export async function switchPlanSession(
  playbookId: string,
  state: ApplicationState,
  portfolio: RecommendationPortfolio,
  repository: Repository,
  lobby: LobbyPressure | null = null,
  now = new Date().toISOString(),
): Promise<PlanSession> {
  const current = state.activeSession;
  if (!current) throw new Error('There is no active plan session to replace.');
  if (current.selectedPlaybookId === playbookId) throw new Error('This plan is already active.');
  const next = createPlanSession(
    playbookId,
    state,
    portfolio,
    lobby,
    now,
    crypto.randomUUID(),
    current.id,
  );
  const previous = endSessionRecord(current, 'replaced', now, next.id);
  await repository.replacePlanSession(previous, next);
  return next;
}

export async function endPlanSession(
  state: ApplicationState,
  repository: Repository,
  now = new Date().toISOString(),
) {
  if (!state.activeSession) throw new Error('There is no active plan session to end.');
  const ended = endSessionRecord(state.activeSession, 'ended-without-result', now);
  await repository.updatePlanSession(ended);
  return ended;
}

export async function savePlanSessionManualState(
  state: ApplicationState,
  repository: Repository,
  change: Partial<
    Pick<
      PlanSessionManualState,
      'stageId' | 'decisionNodeId' | 'decisionPathEdgeIds' | 'pivotTargetId'
    >
  >,
  now = new Date().toISOString(),
) {
  if (!state.activeSession) throw new Error('There is no active plan session to update.');
  const updated = updateManualState(state.activeSession, change, now);
  await repository.updatePlanSession(updated);
  return updated;
}
