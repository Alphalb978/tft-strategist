import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Database,
  Hexagon,
  History,
  LockKeyhole,
  Play,
  RefreshCw,
} from 'lucide-react';
import { openRepository, type Repository, type Settings } from '../storage/repository';
import {
  createRecommendations,
  loadApplication,
  refreshApplication,
  endPlanSession,
  lockPlanSession,
  savePlanSessionManualState,
  switchPlanSession,
  type ApplicationState,
} from '../services/application';
import { scoreCandidate } from '../strategy/scoring';
import { optimizePortfolio } from '../strategy/portfolio';
import { Home } from '../features/Home';
import { Playbook } from '../features/Playbook';
import { DataSettings } from '../features/DataSettings';
import type { LobbyPressure } from '../domain/models';
import { NativeRiotProvider } from '../providers/riot';
import { createRiotPreviewProvider } from '../providers/riotPreview';
import { openHistoryStore, type HistoryStore } from '../storage/history';
import { CompLibrary } from '../features/CompLibrary';
import { refreshMetaDiscovery } from '../services/discoveryRefresh';
import { regionalRouteFor } from '../providers/riotRouting';
import { PostGameHistory } from '../features/PostGameHistory';
type Page = 'home' | 'active' | 'library' | 'history' | 'data';
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
    setPage(next);
    setDetail(null);
    setDetailContext(next === 'active' ? 'session' : 'current');
    main.current?.scrollTo(0, 0);
  };
  const open = (id: string, context: DetailContext = 'current') => {
    setDetail(id);
    setDetailContext(context);
    main.current?.scrollTo(0, 0);
  };
  const refresh = async () => {
    if (!state || !repository.current) return;
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
  const refreshMeta = async () => {
    if (!state || !repository.current || !historyStore || !riotProvider) return;
    setMetaRefreshing(true);
    try {
      const refreshed = await refreshMetaDiscovery(
        riotProvider,
        historyStore,
        repository.current,
        state.data,
        state.registry
          .filter((entry) => entry.sourceKind === 'curated')
          .map((entry) => entry.playbook),
        {
          platform: state.settings.riotPlatform,
          regionalRoute: regionalRouteFor(state.settings.riotPlatform),
          tiers: ['CHALLENGER'],
          playersPerTier: 3,
          matchesPerPlayer: 3,
          set: state.data.version.set,
        },
      );
      setState({
        ...state,
        ...createRecommendations(
          state.data,
          state.settings,
          refreshed.discovery.generatedAt,
          refreshed.meta,
          refreshed.discovery,
          state.personal,
        ),
      });
      setToast(refreshed.status.message);
    } catch {
      setToast('Meta refresh unavailable. Existing cached evidence remains active.');
    } finally {
      setMetaRefreshing(false);
    }
  };
  const lockOrSwitch = async () => {
    if (!state || !viewedPortfolio || !repository.current || !candidate) return;
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
    }
  };
  const end = async () => {
    if (!state?.activeSession || !repository.current) return;
    try {
      await endPlanSession(state, repository.current);
      setState({ ...state, activeSession: null });
      setPage('home');
      setDetail(null);
      setDetailContext('current');
      setToast('Session ended without a result. Its snapshot remains in history.');
    } catch {
      setToast('Unable to end the active session.');
    }
  };
  const saveManual = async (change: Parameters<typeof savePlanSessionManualState>[2]) => {
    if (!state?.activeSession || !repository.current) return;
    try {
      const activeSession = await savePlanSessionManualState(state, repository.current, change);
      setState((current) => (current ? { ...current, activeSession } : current));
    } catch {
      setToast('Match notes could not be saved.');
    }
  };
  const livePortfolio = useMemo(() => {
    if (!state) return null;
    const now = new Date().toISOString();
    return optimizePortfolio(
      state.playbooks.map((playbook) =>
        scoreCandidate(playbook, {
          version: state.data.version,
          now,
          lobby: lobby ?? undefined,
          personalWeight: state.settings.personalWeight,
          meta: state.meta,
          discovery: state.discovery,
          personal: state.personal ?? undefined,
        }),
      ),
      now,
    );
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
          data: state.activeSession.snapshot.staticData,
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
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Primary navigation">
          {(
            [
              { id: 'home', label: 'Your plans', icon: Compass },
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
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === 'active' && <span className="active-plan-dot" aria-hidden="true" />}
              {page === n.id && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span /> LOCAL FIRST
          </div>
          <p>
            Your plans stay with you.
            <br />
            No runtime AI required.
          </p>
          <span className="version-label">FOUNDATION / 0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>
              {detail
                ? 'Comp'
                : page === 'active'
                  ? 'Active plan'
                  : page === 'home'
                    ? 'Your plans'
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
              Patch 18.1 <small>Combat parity known stale</small>
            </span>
            <span className="top-divider" />
            <span className="profile-avatar">S</span>
          </div>
        </header>
        <main ref={main} id="main-content">
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
                  lobby={lobby}
                />
              ) : page === 'data' && riotProvider && historyStore ? (
                <DataSettings
                  state={state}
                  mode={repository.current?.mode ?? 'Unavailable'}
                  onSave={saveSettings}
                  onRefresh={refresh}
                  refreshing={refreshing}
                  onMetaRefresh={refreshMeta}
                  metaRefreshing={metaRefreshing}
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
                <CompLibrary state={state} onOpen={(id) => open(id, 'current')} />
              )}
              <footer>
                <span>
                  Independent companion. Riot Games assets via CommunityDragon. Not endorsed by Riot
                  Games.
                </span>
                <button onClick={refresh} disabled={refreshing}>
                  <RefreshCw size={12} />
                  {state.source}
                </button>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
