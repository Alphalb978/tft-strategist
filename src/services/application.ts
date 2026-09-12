import { globalEntityIndex } from '../strategy/entityIntelligence';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExternalSnapshot } from '../domain/externalMeta';
import { externalSnapshotSchema } from '../domain/externalMeta';
import { validateExternal, externalHash } from '../providers/externalMeta';
import type {
  AggregateMetaDataset,
  CompRegistryEntry,
  DiscoveryDataset,
  LobbyPressure,
  PlanSession,
  PlanSessionManualState,
  PersonalProfile,
  Playbook,
  RecommendationPortfolio,
  RecommendationCandidate,
  SelectedPlan,
  StaticData,
} from '../domain/models';
import { CommunityDragonProvider } from '../providers/communityDragon';
import { loadPlaybooks } from '../providers/playbooks';
import { validatePlaybook } from '../rules/validation';
import type { MetaBundle } from './discoveryRefresh';
import type { Repository, Settings } from '../storage/repository';
import { normalizeSettings } from '../storage/repository';
import { scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import { homeRecommendations } from '../strategy/homeScoring';
import { isStaticData } from '../domain/staticSchema';
import { stableFingerprint, staticSetCompatibilityFingerprint } from '../domain/fingerprint';
import { reconcileIntelligence } from '../strategy/intelligenceCompatibility';
import type { CurrentGameState } from '../domain/intelligence';
import type { LiveScreenState } from '../strategy/liveScreenFusion';
import { validateCurrentGame } from '../strategy/currentGame';
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
import { type RuntimeKnowledgeCatalog, loadRuntimeKnowledgeCatalog } from './knowledgeCatalog';
import {
  bootstrapKnowledgeDatabase,
  populateMemoryKnowledgeRepository,
} from './knowledgeBootstrap';
import {
  type KnowledgeRepository,
  MemoryKnowledgeRepository,
} from '../storage/knowledgeRepository';
import type { SqlDatabase } from '../storage/knowledgeDatabase';
import { openKnowledgeRepository } from '../storage/repository';
import {
  importCommunityDragonKnowledge,
  importCuratedPlaybooks,
  importMetaTFTExternal,
} from '../storage/knowledgeImporter';
import { externalStatus } from '../providers/externalMeta';

export interface ApplicationState {
  external?: ExternalSnapshot | null;
  externalHistory?: ExternalSnapshot[];
  externalNotice?: string;
  knowledgeNotice?: string;
  catalog?: RuntimeKnowledgeCatalog;
  activeStaticSnapshotId?: string | null;
  activeCuratedSnapshotId?: string | null;
  activeExternalSnapshotId?: string | null;
  knowledgeVersion?: {
    set: number;
    patch: string | null;
    hotfix: string | null;
  };
  currentGame?: CurrentGameState;
  sessionKnowledge?: StaticData['knowledge'];
  data: StaticData;
  playbooks: Playbook[];
  portfolio: RecommendationPortfolio;
  homeCandidates: RecommendationCandidate[];
  source: 'Bundled snapshot' | 'Local cache' | 'Locked snapshot' | 'Network';
  settings: Settings;
  activeSession: PlanSession | null;
  notices: string[];
  assets: Record<string, string>;
  meta: AggregateMetaDataset | null;
  discovery: DiscoveryDataset | null;
  registry: CompRegistryEntry[];
  personal: PersonalProfile | null;
}
export function createRecommendations(
  data: StaticData,
  settings: Settings,
  now = new Date().toISOString(),
  meta: AggregateMetaDataset | null = null,
  discovery: DiscoveryDataset | null = null,
  personal: PersonalProfile | null = null,
  external: ExternalSnapshot | null = null,
  canonicalPlaybooks?: Playbook[],
) {
  const dataIssues = auditStaticData(data);
  if (dataIssues.length)
    throw new Error(
      `Static data failed the audited rules: ${dataIssues.map((issue) => issue.message).join(' ')}`,
    );
  const all = canonicalPlaybooks ?? loadPlaybooks(data),
    notices: string[] = [];
  const playbooks = all.filter((p) => {
    const errors = validatePlaybook(p, data).filter((i) => i.severity === 'error');
    if (errors.length)
      notices.push(`${p.title} excluded: ${errors.map((e) => e.message).join(' ')}`);
    return !errors.length;
  });
  let usableMeta = compatibleMetaDataset(meta, {
    classifierVersion: COMP_CLASSIFIER.version,
    statisticsVersion: META_STATISTICS.version,
    familyDefinitionsFingerprint: familyDefinitionsFingerprint(playbooks),
    staticSourceVersion: data.version.sourceVersion,
  })
    ? meta
    : null;
  if (
    usableMeta?.scope &&
    Date.parse(now) - Date.parse(usableMeta.collectedAt) > usableMeta.scope.windowDays * 86400000
  ) {
    usableMeta = {
      ...usableMeta,
      familyStats: usableMeta.familyStats.map((stat) => ({
        ...stat,
        quality: 'insufficient' as const,
      })),
    };
    notices.push('Cached meta window has expired. Refresh before using it as current evidence.');
  }
  if (meta && !usableMeta)
    notices.push('Incompatible aggregate-meta cache ignored and queued for recomputation.');
  const familyFingerprint = familyDefinitionsFingerprint(playbooks);
  let usableDiscovery = compatibleDiscoveryDataset(discovery, {
    set: data.version.set,
    staticSourceVersion: data.version.sourceVersion,
    familyDefinitionsFingerprint: familyFingerprint,
    configurationFingerprint: discoveryConfigurationFingerprint(DEFAULT_DISCOVERY_CONFIG),
  })
    ? discovery
    : null;
  if (
    usableDiscovery &&
    usableMeta?.scope &&
    Date.parse(now) - Date.parse(usableMeta.collectedAt) > usableMeta.scope.windowDays * 86400000
  ) {
    usableDiscovery = {
      ...usableDiscovery,
      clusters: usableDiscovery.clusters.map((cluster) => ({
        ...cluster,
        lifecycle: 'Stale' as const,
        recommendationEligible: false,
      })),
    };
  }
  if (discovery && !usableDiscovery)
    notices.push('Incompatible discovery cache ignored and queued for recomputation.');
  const intelligence = usableMeta?.intelligence;
  const intelligenceCurrent =
    intelligence?.version === 'intelligence-v1' &&
    intelligence.knowledgeFingerprint ===
      (data.knowledge?.fingerprint ?? data.version.sourceVersion) &&
    Date.parse(now) - Date.parse(intelligence.generatedAt) <=
      (usableMeta?.scope?.windowDays ?? 21) * 86400000;
  const registry = buildCompRegistry(
    playbooks,
    data,
    usableDiscovery,
    intelligenceCurrent ? intelligence : undefined,
    external,
  );
  const recommendationPlaybooks = registry
    .filter((entry) => entry.recommendationEligible)
    .map((entry) => entry.playbook);
  const home = homeRecommendations(recommendationPlaybooks, {
    data,
    now,
    config: settings.homeRecommendation,
    meta: usableMeta,
    discovery: usableDiscovery,
    external,
  });
  const catalog = registry.map((entry) => entry.playbook);
  globalEntityIndex(data, intelligence, catalog);
  return {
    playbooks: catalog,
    portfolio: home.portfolio,
    homeCandidates: home.candidates,
    notices,
    meta: usableMeta,
    discovery: usableDiscovery,
    registry,
    personal,
  };
}
/** Shared registry boundary for every live re-score, including partial lobby scans. */
export function rescoreRecommendations(
  state: ApplicationState,
  lobby?: LobbyPressure,
  now = new Date().toISOString(),
  scenarioPressure?: string[],
  liveScreen?: LiveScreenState | null,
) {
  return optimizePortfolio(
    state.registry
      .filter((e) => e.recommendationEligible && !['Stale', 'Retired'].includes(e.lifecycle))
      .map((e) =>
        scoreCandidate(e.playbook, {
          data: state.data,
          version: state.data.version,
          now,
          lobby,
          meta: state.meta,
          discovery: state.discovery,
          personal: state.personal ?? undefined,
          personalWeight: state.settings.personalWeight,
          currentGame: state.activeSession?.manualState.currentGame ?? state.currentGame,
          external: state.external,
          scenarioPressure,
          liveScreen,
        }),
      ),
    now,
  );
}

/** Normal Home ranking. Manual current-game and personal state are intentionally absent. */
export function rescoreHomeRecommendations(
  state: ApplicationState,
  lobby?: LobbyPressure,
  now = new Date().toISOString(),
  liveScreen?: LiveScreenState | null,
) {
  return homeRecommendations(
    state.registry
      .filter(
        (entry) => entry.recommendationEligible && !['Stale', 'Retired'].includes(entry.lifecycle),
      )
      .map((entry) => entry.playbook),
    {
      data: state.data,
      now,
      config: state.settings.homeRecommendation,
      external: state.external,
      meta: state.meta,
      discovery: state.discovery,
      lobby,
      liveScreen,
    },
  );
}
export async function loadApplication(
  repository: Repository,
  knowledgeRepository?: KnowledgeRepository,
  sqlDatabase?: SqlDatabase,
): Promise<ApplicationState> {
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
  const bundle = await repository.get<MetaBundle>('meta-current:v1');
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
  if (!data.knowledge) {
    const bundled = await fetch('/data/static-set18.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (
      isStaticData(bundled) &&
      bundled.knowledge &&
      staticSetCompatibilityFingerprint(bundled) === staticSetCompatibilityFingerprint(data)
    )
      data = { ...data, knowledge: bundled.knowledge };
  }
  if (!isStaticData(data)) throw new Error('Knowledge upgrade is incompatible.');
  const assets: Record<string, string> = assetResponse?.ok
    ? await assetResponse.json().catch(() => ({}))
    : {};
  let result = createRecommendations(
    data,
    settings,
    new Date().toISOString(),
    bundle?.version === 1 ? bundle.meta : savedMeta,
    bundle?.version === 1 ? bundle.discovery : savedDiscovery,
    await repository.getPersonalProfile(data.version.set),
  );
  let activeSession =
    isPlanSession(storedSession) && storedSession.state === 'active' ? storedSession : null;
  const sessionKnowledge = activeSession?.snapshot.knowledgeFingerprint
    ? ((await repository.get<NonNullable<StaticData['knowledge']>>(
        `knowledge:${activeSession.snapshot.knowledgeFingerprint}`,
      )) ?? undefined)
    : undefined;
  let external: ExternalSnapshot | null = null;
  let externalNotice: string | undefined;
  try {
    const cachedExternal = await repository.get<ExternalSnapshot>('external-meta:v1');
    const response = await fetch('/data/external/current.json').catch(() => null);
    const incoming = isTauri()
      ? ((await invoke<string>('external_meta_snapshot')
          .then(JSON.parse)
          .catch(() => null)) ?? (response?.ok ? await response.json().catch(() => null) : null))
      : response?.ok
        ? await response.json().catch(() => null)
        : null;
    external = validateExternal(incoming ?? cachedExternal, data);
    await repository.set('external-meta:v1', external);
  } catch (error) {
    externalNotice = String(error).includes('Wrong set or patch')
      ? 'External meta snapshot incompatible with current patch. Refresh required.'
      : 'External refresh unavailable or invalid. Using compatible cached evidence when available.';
    try {
      external = validateExternal(await repository.get('external-meta:v1'), data);
    } catch {
      /* explicit offline fallback */
    }
  }

  const knowledgeRepo =
    knowledgeRepository ??
    repository.getKnowledgeRepository?.() ??
    (await openKnowledgeRepository());
  const sqlDb = sqlDatabase ?? repository.getSqlDatabase?.() ?? null;

  let catalog: RuntimeKnowledgeCatalog | null = null;
  let knowledgeNotice: string | undefined;
  const rawPlaybooks = loadPlaybooks(data);

  try {
    if (sqlDb) {
      await bootstrapKnowledgeDatabase(sqlDb, data, rawPlaybooks, external);
    } else if (knowledgeRepo instanceof MemoryKnowledgeRepository) {
      populateMemoryKnowledgeRepository(knowledgeRepo, data, rawPlaybooks, external);
    }

    catalog = await loadRuntimeKnowledgeCatalog(knowledgeRepo, {
      existingStaticData: data,
      existingExternalSnapshot: external,
    });
  } catch (error) {
    knowledgeNotice = `Knowledge database deferred: ${String(error)}`;
  }

  const canonicalPlaybooks =
    catalog?.playbooks && catalog.playbooks.length > 0 ? catalog.playbooks : rawPlaybooks;
  if (catalog && catalog.playbooks.length === 0) {
    catalog.playbooks = canonicalPlaybooks;
  }

  result = createRecommendations(
    data,
    settings,
    new Date().toISOString(),
    result.meta,
    result.discovery,
    result.personal,
    external,
    canonicalPlaybooks,
  );
  let externalHistory: ExternalSnapshot[] = [];
  try {
    const history: unknown = isTauri()
      ? await invoke<string>('external_meta_history').then(JSON.parse)
      : await fetch('/data/external/history.json').then((r) => r.json());
    if (Array.isArray(history))
      externalHistory = history.slice(-12).flatMap((raw) => {
        const parsed = externalSnapshotSchema.safeParse(raw);
        return parsed.success && externalHash(parsed.data) === parsed.data.manifest.contentHash
          ? [parsed.data]
          : [];
      });
  } catch {
    /* Trend unavailable; current evidence remains usable. */
  }
  const baseState: ApplicationState = {
    data,
    ...result,
    source,
    settings,
    activeSession,
    notices: result.notices,
    assets,
    personal: result.personal,
    catalog: catalog ?? undefined,
    activeStaticSnapshotId: catalog?.snapshots.static?.snapshotId ?? null,
    activeCuratedSnapshotId: catalog?.snapshots.curated?.snapshotId ?? null,
    activeExternalSnapshotId: catalog?.snapshots.external?.snapshotId ?? null,
    knowledgeVersion: catalog
      ? catalog.version
      : {
          set: data.version.set,
          patch: data.version.provenance.patch,
          hotfix: data.knowledge?.balanceHotfix ?? null,
        },
  };
  let currentGame: CurrentGameState | undefined;
  try {
    const savedGame = await repository.get('current-game:v1');
    if (savedGame) currentGame = validateCurrentGame(savedGame, data);
  } catch {
    /* A previous-set draft must not become current-game evidence. */
  }
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
    sessionKnowledge,
    external,
    externalHistory,
    externalNotice,
    knowledgeNotice,
    catalog: catalog ?? undefined,
    activeStaticSnapshotId: catalog?.snapshots.static?.snapshotId ?? null,
    activeCuratedSnapshotId: catalog?.snapshots.curated?.snapshotId ?? null,
    activeExternalSnapshotId: catalog?.snapshots.external?.snapshotId ?? null,
    knowledgeVersion: catalog
      ? catalog.version
      : {
          set: data.version.set,
          patch: data.version.provenance.patch,
          hotfix: data.knowledge?.balanceHotfix ?? null,
        },
    currentGame: activeSession?.manualState.currentGame ?? currentGame,
  };
}
export async function refreshApplication(
  current: ApplicationState,
  repository: Repository,
  knowledgeRepository?: KnowledgeRepository,
  sqlDatabase?: SqlDatabase,
): Promise<ApplicationState> {
  const data = await new CommunityDragonProvider().fetch();
  const structureUnchanged =
    staticSetCompatibilityFingerprint(data) === staticSetCompatibilityFingerprint(current.data);
  // Same-set balance-field changes do not erase structurally compatible classification or raw history.
  const intelligence = reconcileIntelligence(current.meta?.intelligence, data);
  const meta =
    structureUnchanged && current.meta
      ? {
          ...current.meta,
          staticSourceVersion: data.version.sourceVersion,
          intelligence,
          derivationFingerprint: stableFingerprint({
            prior: current.meta.derivationFingerprint,
            source: data.version.sourceVersion,
          }),
        }
      : current.meta;
  const discovery =
    structureUnchanged && current.discovery
      ? {
          ...current.discovery,
          staticSourceVersion: data.version.sourceVersion,
          derivationFingerprint: stableFingerprint({
            prior: current.discovery.derivationFingerprint,
            source: data.version.sourceVersion,
          }),
        }
      : current.discovery;

  const knowledgeRepo =
    knowledgeRepository ??
    repository.getKnowledgeRepository?.() ??
    (await openKnowledgeRepository());
  const sqlDb = sqlDatabase ?? repository.getSqlDatabase?.() ?? null;

  let catalog: RuntimeKnowledgeCatalog | null = null;
  const rawPlaybooks = loadPlaybooks(data);

  if (sqlDb) {
    const staticRes = await importCommunityDragonKnowledge(sqlDb, data, { activate: true });
    await importCuratedPlaybooks(sqlDb, rawPlaybooks, staticRes.snapshotId, { activate: true });
    if (current.external && externalStatus(current.external, data).startsWith('Compatible')) {
      try {
        await importMetaTFTExternal(sqlDb, current.external, data, { activate: true });
      } catch {
        /* fail-closed on external refresh */
      }
    }
  } else if (knowledgeRepo instanceof MemoryKnowledgeRepository) {
    populateMemoryKnowledgeRepository(knowledgeRepo, data, rawPlaybooks, current.external);
  }

  catalog = await loadRuntimeKnowledgeCatalog(knowledgeRepo, {
    existingStaticData: data,
    existingExternalSnapshot: current.external,
  });

  const canonicalPlaybooks =
    catalog?.playbooks && catalog.playbooks.length > 0 ? catalog.playbooks : rawPlaybooks;
  if (catalog && catalog.playbooks.length === 0) {
    catalog.playbooks = canonicalPlaybooks;
  }

  const result = createRecommendations(
    data,
    current.settings,
    new Date().toISOString(),
    meta,
    discovery,
    current.personal,
    current.external,
    canonicalPlaybooks,
  );
  if (!result.playbooks.length)
    throw new Error('Refreshed roster failed playbook validation; previous cache retained.');
  await repository.set('static', data);
  if (result.meta && result.discovery)
    await repository.set('meta-current:v1', {
      version: 1,
      meta: result.meta,
      discovery: result.discovery,
    });
  let activeSession = current.activeSession;
  if (activeSession) {
    const compatibility = evaluatePlanSessionCompatibility(activeSession, data, result);
    activeSession = await persistCompatibility(repository, activeSession, compatibility);
  }
  return {
    ...current,
    data,
    ...result,
    activeSession,
    source: 'Network',
    catalog: catalog ?? current.catalog,
    activeStaticSnapshotId: catalog?.snapshots.static?.snapshotId ?? current.activeStaticSnapshotId,
    activeCuratedSnapshotId:
      catalog?.snapshots.curated?.snapshotId ?? current.activeCuratedSnapshotId,
    activeExternalSnapshotId:
      catalog?.snapshots.external?.snapshotId ?? current.activeExternalSnapshotId,
    knowledgeVersion: catalog ? catalog.version : current.knowledgeVersion,
  };
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
  if (state.currentGame) session.manualState.currentGame = structuredClone(state.currentGame);
  if (state.data.knowledge)
    await repository.set(`knowledge:${state.data.knowledge.fingerprint}`, state.data.knowledge);
  if (state.external)
    await repository.set(`external:${state.external.manifest.contentHash}`, state.external);
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
  if (state.data.knowledge)
    await repository.set(`knowledge:${state.data.knowledge.fingerprint}`, state.data.knowledge);
  if (current.manualState.currentGame)
    next.manualState.currentGame = structuredClone(current.manualState.currentGame);
  if (state.external)
    await repository.set(`external:${state.external.manifest.contentHash}`, state.external);
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
      'stageId' | 'decisionNodeId' | 'decisionPathEdgeIds' | 'pivotTargetId' | 'currentGame'
    >
  >,
  now = new Date().toISOString(),
) {
  if (!state.activeSession) throw new Error('There is no active plan session to update.');
  const updated = updateManualState(state.activeSession, change, now);
  await repository.updatePlanSession(updated);
  return updated;
}
