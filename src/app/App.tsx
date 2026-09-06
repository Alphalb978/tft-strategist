import { lazy, Suspense, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Info,
  ChevronRight,
  Compass,
  Database,
  Hexagon,
  History,
  LockKeyhole,
  Play,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { openRepository, type Repository, type Settings } from '../storage/repository';
import {
  createRecommendations,
  rescoreRecommendations,
  loadApplication,
  refreshApplication,
  endPlanSession,
  lockPlanSession,
  savePlanSessionManualState,
  switchPlanSession,
  type ApplicationState,
} from '../services/application';
import { scoreCandidate } from '../strategy/scoring';
import { Home } from '../features/Home';
import { validateCurrentGame } from '../strategy/currentGame';
import { updateManualState } from '../services/planSession';
import { OBSERVED_MODEL } from '../strategy/observedIntelligence';
import type { CurrentGameState } from '../domain/intelligence';
const Playbook = lazy(() =>
  import('../features/Playbook').then((module) => ({ default: module.Playbook })),
);
const DataSettings = lazy(() =>
  import('../features/DataSettings').then((module) => ({ default: module.DataSettings })),
);
import type { LobbyPressure } from '../domain/models';
import { NativeRiotProvider } from '../providers/riot';
import { createRiotPreviewProvider } from '../providers/riotPreview';
import { openHistoryStore, type HistoryStore } from '../storage/history';
const CompLibrary = lazy(() =>
  import('../features/CompLibrary').then((module) => ({ default: module.CompLibrary })),
);
import { META_BUDGETS, type MetaSampleConfig, type MetaProgress } from '../services/metaPipeline';
import { RiotProviderError } from '../providers/riot';
import { regionalRouteFor } from '../providers/riotRouting';
const PostGameHistory = lazy(() =>
  import('../features/PostGameHistory').then((module) => ({ default: module.PostGameHistory })),
);
import { RiotScouting } from '../features/RiotScouting';
type Page = 'home' | 'scout' | 'active' | 'library' | 'history' | 'data';
type DetailContext = 'current' | 'session';
export function App() {
  const [state, setState] = useState<ApplicationState | null>(null),
    [page, setPage] = useState<Page>('home'),
    [detail, setDetail] = useState<string | null>(null),
    [detailContext, setDetailContext] = useState<DetailContext>('current'),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [refreshing, setRefreshing] = useState(false),
    [metaRefreshing, setMetaRefreshing] = useState(false),
    [attempt, setAttempt] = useState(0),
    [historyStore, setHistoryStore] = useState<HistoryStore | null>(null),
    [lobby, setLobby] = useState<LobbyPressure | null>(null);
  const repository = useRef<Repository | null>(null),
    main = useRef<HTMLElement | null>(null);
  const operation = useRef(false);
  const manualWrites = useRef(Promise.resolve());
  const metaController = useRef<AbortController | null>(null);
  const [metaProgress, setMetaProgress] = useState<MetaProgress | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [repo, history] = await Promise.all([openRepository(), openHistoryStore()]);
        const loaded = await loadApplication(repo);
        if (alive) {
          repository.current = repo;
          setHistoryStore(history);
          setState(loaded);
          setError('');
          if (
            loaded.meta &&
            loaded.discovery &&
            (loaded.meta.intelligence?.derivationVersion !== OBSERVED_MODEL.version ||
              loaded.meta.intelligence?.knowledgeFingerprint !== loaded.data.knowledge?.fingerprint)
          ) {
            setMetaRefreshing(true);
            setState({
              ...loaded,
              notices: [
                ...loaded.notices,
                'Building strategy intelligence from your cached matches…',
              ],
            });
            try {
              const { rebuildCachedIntelligence } = await import('../services/intelligenceRefresh');
              const meta = await rebuildCachedIntelligence(
                loaded.meta,
                loaded.discovery,
                loaded.data,
                loaded.registry.filter((e) => e.sourceKind === 'curated').map((e) => e.playbook),
                history,
                repo,
              );
              if (alive)
                setState((current) =>
                  current
                    ? {
                        ...current,
                        ...createRecommendations(
                          current.data,
                          current.settings,
                          undefined,
                          meta,
                          current.discovery,
                          current.personal,
                        ),
                      }
                    : current,
                );
            } catch {
              if (alive)
                setState((current) =>
                  current
                    ? {
                        ...current,
                        notices: [
                          ...loaded.notices,
                          'Cached intelligence could not be rebuilt. Retry from Data & settings.',
                        ],
                      }
                    : current,
                );
            } finally {
              if (alive) setMetaRefreshing(false);
            }
          }
        }
      } catch {
        if (alive)
          setError(
            'Unable to load local data. Check the bundled snapshot and storage availability, then retry.',
          );
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);
  const fixturePreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('riot-fixture');
  const riotProvider = useMemo(() => {
    if (!state) return null;
    if (fixturePreview) return createRiotPreviewProvider(state.data);
    return new NativeRiotProvider(state.settings.riotPlatform, {
      unitIds: new Set(state.data.champions.map((unit) => unit.id)),
      itemIds: new Set(state.data.items.map((item) => item.id)),
      traitIds: new Set(state.data.traits.map((trait) => trait.id)),
      augmentIds: new Set(state.data.augments.map((augment) => augment.id)),
    });
  }, [fixturePreview, state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (next: Page) => {
    startTransition(() => {
      setPage(next);
      setDetail(null);
      setDetailContext(next === 'active' ? 'session' : 'current');
    });
    main.current?.scrollTo(0, 0);
  };
  const open = (id: string, context: DetailContext = 'current') => {
    startTransition(() => {
      setDetail(id);
      setDetailContext(context);
    });
    main.current?.scrollTo(0, 0);
  };
  const refresh = async () => {
    if (!state || !repository.current || refreshing || metaRefreshing) return;
    setRefreshing(true);
    try {
      setState(await refreshApplication(state, repository.current));
      setLobby(null);
      setToast('Static source refreshed. Combat-value parity remains known stale.');
    } catch {
      setToast('Refresh unavailable. Your previous data and plans are still available.');
    } finally {
      setRefreshing(false);
    }
  };
  const saveSettings = async (settings: Settings) => {
    if (!state || !repository.current) return;
    try {
      await repository.current.set('settings', settings);
      setState({
        ...state,
        settings,
        ...createRecommendations(
          state.data,
          settings,
          new Date().toISOString(),
          state.meta,
          state.discovery,
          state.personal,
        ),
      });
      if (
        settings.historyWindow !== state.settings.historyWindow ||
        settings.riotPlatform !== state.settings.riotPlatform
      )
        setLobby(null);
      setToast('Settings saved locally.');
    } catch {
      setToast('Settings could not be saved. Your previous settings are unchanged.');
    }
  };
  const rebuildIntelligence = async () => {
    if (!state?.meta || !state.discovery || !historyStore || !repository.current || metaRefreshing)
      return;
    setMetaRefreshing(true);
    try {
      const { rebuildCachedIntelligence } = await import('../services/intelligenceRefresh');
      const meta = await rebuildCachedIntelligence(
        state.meta,
        state.discovery,
        state.data,
        state.registry.filter((e) => e.sourceKind === 'curated').map((e) => e.playbook),
        historyStore,
        repository.current,
      );
      setState((current) =>
        current
          ? {
              ...current,
              ...createRecommendations(
                current.data,
                current.settings,
                undefined,
                meta,
                current.discovery,
                current.personal,
              ),
            }
          : current,
      );
      setToast('Intelligence rebuilt from cached matches. No Riot collection was needed.');
    } catch {
      setToast('Cached matches could not be derived. Existing evidence retained.');
    } finally {
      setMetaRefreshing(false);
    }
  };
  const refreshMeta = async (
    selection: Pick<MetaSampleConfig, 'mode' | 'platform' | 'tiers' | 'windowDays'>,
  ) => {
    if (
      !state ||
      !repository.current ||
      !historyStore ||
      !riotProvider ||
      metaRefreshing ||
      metaController.current ||
      refreshing
    )
      return;
    const controller = new AbortController();
    metaController.current = controller;
    setMetaProgress(null);
    setMetaRefreshing(true);
    try {
      const { refreshMetaDiscovery } = await import('../services/discoveryRefresh');
      const refreshed = await refreshMetaDiscovery(
        fixturePreview
          ? riotProvider
          : new NativeRiotProvider(selection.platform, {
              unitIds: new Set(state.data.champions.map((x) => x.id)),
              itemIds: new Set(state.data.items.map((x) => x.id)),
              traitIds: new Set(state.data.traits.map((x) => x.id)),
              augmentIds: new Set(state.data.augments.map((x) => x.id)),
            }),
        historyStore,
        repository.current,
        state.data,
        state.registry
          .filter((entry) => entry.sourceKind === 'curated')
          .map((entry) => entry.playbook),
        {
          ...selection,
          regionalRoute: regionalRouteFor(selection.platform),
          playersPerTier: META_BUDGETS[selection.mode ?? 'standard'].playersPerTier,
          matchesPerPlayer: META_BUDGETS[selection.mode ?? 'standard'].matchesPerPlayer,
          set: state.data.version.set,
          sourceType: fixturePreview ? 'fixture' : 'riot-api',
        },
        new Date().toISOString(),
        undefined,
        { signal: controller.signal, onProgress: setMetaProgress },
      );
      setState((current) =>
        current
          ? {
              ...current,
              ...createRecommendations(
                current.data,
                current.settings,
                refreshed.discovery.generatedAt,
                refreshed.meta,
                refreshed.discovery,
                current.personal,
              ),
            }
          : current,
      );
      setMetaProgress((current) => (current ? { ...current, phase: 'complete' } : null));
      setToast(refreshed.status.message);
    } catch (error) {
      setToast(
        controller.signal.aborted
          ? 'Meta refresh cancelled. Cached evidence retained.'
          : error instanceof RiotProviderError
            ? error.message
            : 'Meta refresh unavailable. Existing cached evidence remains active.',
      );
    } finally {
      metaController.current = null;
      setMetaRefreshing(false);
    }
  };
  const lockOrSwitch = async () => {
    if (!state || !viewedPortfolio || !repository.current || !candidate || operation.current)
      return;
    operation.current = true;
    try {
      const activeSession = state.activeSession
        ? await switchPlanSession(
            candidate.playbook.id,
            state,
            viewedPortfolio,
            repository.current,
            detailContext === 'current' ? lobby : null,
          )
        : await lockPlanSession(
            candidate.playbook.id,
            { ...state, portfolio: viewedPortfolio },
            repository.current,
            lobby,
          );
      setState({ ...state, activeSession });
      setPage('active');
      setDetail(null);
      setDetailContext('session');
      setToast(
        activeSession.replacesSessionId
          ? 'Plan switched. The previous session remains in history.'
          : 'Plan locked. The exact plan and evidence are saved locally.',
      );
    } catch (caught) {
      setToast(
        caught instanceof Error
          ? caught.message
          : 'This plan could not be locked from the current portfolio.',
      );
    } finally {
      operation.current = false;
    }
  };
  const end = async () => {
    if (!state?.activeSession || !repository.current || operation.current) return;
    operation.current = true;
    try {
      await endPlanSession(state, repository.current);
      await repository.current.set('current-game:v1', null);
      setState({ ...state, activeSession: null, currentGame: undefined });
      setPage('home');
      setDetail(null);
      setDetailContext('current');
      setToast('Session ended without a result. Its snapshot remains in history.');
    } catch {
      setToast('Unable to end the active session.');
    } finally {
      operation.current = false;
    }
  };
  const saveManual = async (change: Parameters<typeof savePlanSessionManualState>[2]) => {
    if (!state?.activeSession || !repository.current) return;
    try {
      const activeSession = updateManualState(state.activeSession, change);
      setState((current) =>
        current
          ? {
              ...current,
              activeSession,
              currentGame: activeSession.manualState.currentGame ?? current.currentGame,
            }
          : current,
      );
      const repo = repository.current;
      manualWrites.current = manualWrites.current
        .catch(() => {})
        .then(async () => {
          await repo.updatePlanSession(activeSession);
        });
      await manualWrites.current;
    } catch {
      setToast('Match notes could not be saved.');
    }
  };
  const saveGame = async (input: CurrentGameState) => {
    if (!state || !repository.current) return;
    try {
      const game = validateCurrentGame(input, state.data);
      if (state.activeSession) {
        await saveManual({ currentGame: game });
        return;
      }
      setState((current) => (current ? { ...current, currentGame: game } : current));
      const repo = repository.current;
      manualWrites.current = manualWrites.current
        .catch(() => {})
        .then(() => repo.set('current-game:v1', game));
      await manualWrites.current;
    } catch {
      setToast('Current game could not be saved.');
    }
  };
  const livePortfolio = useMemo(() => {
    if (!state) return null;
    return rescoreRecommendations(state, lobby ?? undefined);
  }, [lobby, state]);
  const currentPortfolio = livePortfolio ?? state?.portfolio;
  const sessionPortfolio = state?.activeSession?.snapshot.portfolio ?? null;
  const viewedPortfolio =
    page === 'active' || detailContext === 'session' ? sessionPortfolio : currentPortfolio;
  const displayState = state && viewedPortfolio ? { ...state, portfolio: viewedPortfolio } : state;
  const requestedPlanId =
    page === 'active' ? (detail ?? state?.activeSession?.selectedPlaybookId) : detail;
  const candidate =
    requestedPlanId && state
      ? (viewedPortfolio?.plans.find((p) => p.candidate.playbook.id === requestedPlanId)
          ?.candidate ??
        (() => {
          const p = state.playbooks.find((p) => p.id === requestedPlanId);
          return p
            ? scoreCandidate(p, {
                data: state.data,
                currentGame: state.activeSession?.manualState.currentGame ?? state.currentGame,
                version: state.data.version,
                now: new Date().toISOString(),
                lobby: lobby ?? undefined,
                personalWeight: state.settings.personalWeight,
                meta: state.meta,
                discovery: state.discovery,
                personal: state.personal ?? undefined,
              })
            : undefined;
        })())
      : undefined;
  const playbookState =
    state?.activeSession && (page === 'active' || detailContext === 'session')
      ? {
          ...displayState!,
          data: {
            ...state.activeSession.snapshot.staticData,
            knowledge:
              state.data.knowledge?.fingerprint ===
              state.activeSession.snapshot.knowledgeFingerprint
                ? state.data.knowledge
                : (state.sessionKnowledge ?? state.activeSession.snapshot.staticData.knowledge),
          },
          assets: state.assets,
        }
      : displayState;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <Hexagon size={29} />
          <span>S</span>
        </div>
        <div className="brand-name">
          STRATEGIST<span>TEAMFIGHT TACTICS</span>
        </div>
        <div className="nav-label">PREPARE</div>
        <nav aria-label="Primary navigation">
          {(
            [
              { id: 'home', label: 'Your plans', icon: Compass },
              { id: 'scout', label: 'Scouting', icon: Radio },
              ...(state?.activeSession
                ? ([{ id: 'active', label: 'Active plan', icon: Play }] as const)
                : []),
              { id: 'library', label: 'Comps', icon: BookOpen },
              { id: 'history', label: 'Post-game', icon: History },
              { id: 'data', label: 'Data & settings', icon: Database },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              aria-current={page === n.id ? 'page' : undefined}
              title={n.label}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              <span className="nav-text">{n.label}</span>
              {n.id === 'active' && <span className="active-plan-dot" aria-hidden="true" />}
              {page === n.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span /> LOCAL FIRST
          </div>
          <span className="version-label">V1 · RELEASE CANDIDATE</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Strategist <ChevronRight size={13} />
            <strong>
              {detail
                ? 'Comp'
                : page === 'active'
                  ? 'Active plan'
                  : page === 'home'
                    ? 'Your plans'
                    : page === 'scout'
                      ? 'Scouting'
                      : page === 'library'
                        ? 'Comps'
                        : page === 'history'
                          ? 'Post-game'
                          : 'Data & settings'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="patch-dot" />
            <span>
              Set {state?.data.version.set ?? '18'} · {state?.data.version.patch ?? '18.1'}{' '}
              <small>Combat data: known stale</small>
            </span>
            <span className="top-divider" />
            <span className="profile-avatar">S</span>
          </div>
        </header>
        <main ref={main} id="main-content">
          <Suspense
            fallback={
              <div className="loading-state" role="status">
                Opening view…
              </div>
            }
          >
            {!state ? (
              <div className="loading-state">
                {error ? (
                  <>
                    <Database size={36} />
                    <h1>Let’s get your data ready.</h1>
                    <p>{error}</p>
                    <button
                      className="primary"
                      onClick={() => {
                        setError('');
                        setAttempt((a) => a + 1);
                      }}
                    >
                      Retry local load
                    </button>
                  </>
                ) : (
                  <>
                    <Hexagon className="spin" size={38} />
                    <h1>Preparing your plans</h1>
                    <p>Loading the active set and validating source playbooks…</p>
                  </>
                )}
              </div>
            ) : (
              <>
                {state.activeSession && page !== 'active' && (
                  <div className={`lock-banner ${state.activeSession.compatibility.state}`}>
                    <LockKeyhole size={15} />
                    <span>
                      Active · {state.activeSession.snapshot.playbook.title}
                      {state.activeSession.compatibility.state === 'stale'
                        ? ' · historical snapshot'
                        : ''}
                    </span>
                    <button onClick={() => navigate('active')}>Resume</button>
                  </div>
                )}
                {state.notices.length > 0 && (
                  <div className="validation-notice" role="status">
                    {state.notices.join(' ')}
                  </div>
                )}
                {candidate ? (
                  <Playbook
                    lobby={lobby ?? undefined}
                    key={`${state.activeSession?.id ?? 'preview'}-${candidate.playbook.id}`}
                    plan={candidate.playbook}
                    candidate={candidate}
                    state={playbookState!}
                    session={state.activeSession}
                    snapshotContext={page === 'active' || detailContext === 'session'}
                    activeMode={page === 'active' && !detail}
                    onBack={() => {
                      if (page === 'active' && detail) setDetail(null);
                      else if (page === 'active') navigate('home');
                      else setDetail(null);
                    }}
                    onLock={lockOrSwitch}
                    onEnd={end}
                    onManualState={saveManual}
                    onCurrentGame={saveGame}
                    onOpen={(id) =>
                      open(
                        id,
                        page === 'active' || detailContext === 'session' ? 'session' : 'current',
                      )
                    }
                  />
                ) : page === 'home' ? (
                  <Home
                    state={state}
                    portfolio={currentPortfolio!}
                    onOpen={open}
                    onData={() => navigate('data')}
                    onScout={() => navigate('scout')}
                    lobby={lobby}
                    onCurrentGame={saveGame}
                  />
                ) : page === 'scout' && riotProvider && historyStore ? (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow">LOBBY / RECENT HISTORY</div>
                        <h1>Scouting</h1>
                        <p>Discover opponents. Compare historical unit pressure.</p>
                      </div>
                    </div>
                    <RiotScouting
                      data={state.data}
                      assets={state.assets}
                      settings={state.settings}
                      provider={riotProvider}
                      store={historyStore}
                      fixturePreview={fixturePreview}
                      onSave={saveSettings}
                      onLobby={setLobby}
                    />
                  </>
                ) : page === 'data' && riotProvider && historyStore ? (
                  <DataSettings
                    onRebuildIntelligence={rebuildIntelligence}
                    state={state}
                    mode={repository.current?.mode ?? 'Unavailable'}
                    onSave={saveSettings}
                    onRefresh={refresh}
                    refreshing={refreshing}
                    onMetaRefresh={refreshMeta}
                    metaRefreshing={metaRefreshing}
                    metaProgress={metaProgress}
                    onMetaCancel={() => metaController.current?.abort()}
                    riotProvider={riotProvider}
                    historyStore={historyStore}
                    fixturePreview={fixturePreview}
                    onLobby={setLobby}
                  />
                ) : page === 'history' && riotProvider && historyStore && repository.current ? (
                  <PostGameHistory
                    state={state}
                    repository={repository.current}
                    provider={riotProvider}
                    historyStore={historyStore}
                    onUpdated={(personal, activeSession) => {
                      const next = createRecommendations(
                        state.data,
                        state.settings,
                        new Date().toISOString(),
                        state.meta,
                        state.discovery,
                        personal,
                      );
                      setState({ ...state, ...next, personal, activeSession });
                    }}
                  />
                ) : (
                  <CompLibrary
                    state={state}
                    onOpen={(id) => open(id, 'current')}
                    onSelectMeta={(bundle) =>
                      setState((current) =>
                        current
                          ? {
                              ...current,
                              ...createRecommendations(
                                current.data,
                                current.settings,
                                new Date().toISOString(),
                                bundle.meta,
                                bundle.discovery,
                                current.personal,
                              ),
                            }
                          : current,
                      )
                    }
                  />
                )}
                <footer>
                  <span>
                    Independent companion. Riot Games assets via CommunityDragon. Not endorsed by
                    Riot Games.
                  </span>
                  <button onClick={refresh} disabled={refreshing}>
                    <RefreshCw size={12} />
                    {state.source}
                  </button>
                </footer>
              </>
            )}
          </Suspense>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
