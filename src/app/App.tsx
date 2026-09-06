import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Database,
  Hexagon,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { openRepository, type Repository, type Settings } from '../storage/repository';
import {
  createRecommendations,
  loadApplication,
  refreshApplication,
  selectPlan,
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
type Page = 'home' | 'library' | 'data';
export function App() {
  const [state, setState] = useState<ApplicationState | null>(null),
    [page, setPage] = useState<Page>('home'),
    [detail, setDetail] = useState<string | null>(null),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [refreshing, setRefreshing] = useState(false),
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
    main.current?.scrollTo(0, 0);
  };
  const open = (id: string) => {
    setDetail(id);
    main.current?.scrollTo(0, 0);
  };
  const refresh = async () => {
    if (!state || !repository.current || state.selection) return;
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
        ...createRecommendations(state.data, settings, new Date().toISOString(), state.meta),
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
  const lock = async () => {
    if (!state || !portfolio || !repository.current || !detail) return;
    try {
      const selection = await selectPlan(detail, { ...state, portfolio }, repository.current);
      setState({ ...state, selection });
      setToast('Plan locked. Recommendations are frozen for this game.');
    } catch {
      setToast(
        'This plan is outside the current three-plan portfolio. Choose a portfolio plan to lock.',
      );
    }
  };
  const unlock = async () => {
    if (!state || !repository.current) return;
    try {
      await repository.current.set('selection', null);
      setState({ ...state, selection: null });
      setToast('Portfolio unlocked.');
    } catch {
      setToast('Unable to update the saved plan.');
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
        }),
      ),
      now,
    );
  }, [lobby, state]);
  const portfolio = state?.selection?.snapshot ?? livePortfolio ?? state?.portfolio;
  const displayState = state && portfolio ? { ...state, portfolio } : state;
  const candidate =
    detail && state
      ? (portfolio?.plans.find((p) => p.candidate.playbook.id === detail)?.candidate ??
        (() => {
          const p = state.playbooks.find((p) => p.id === detail);
          return p
            ? scoreCandidate(p, {
                version: state.data.version,
                now: new Date().toISOString(),
                lobby: lobby ?? undefined,
                personalWeight: state.settings.personalWeight,
                meta: state.meta,
              })
            : undefined;
        })())
      : undefined;
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
              { id: 'library', label: 'Comps', icon: BookOpen },
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
                : page === 'home'
                  ? 'Your plans'
                  : page === 'library'
                    ? 'Comps'
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
              {state.selection && (
                <div className="lock-banner">
                  <LockKeyhole size={15} />
                  <span>
                    Portfolio locked ·{' '}
                    {state.playbooks.find((p) => p.id === state.selection?.playbookId)?.title}
                  </span>
                  <button onClick={unlock}>Unlock</button>
                </div>
              )}
              {state.notices.length > 0 && (
                <div className="validation-notice" role="status">
                  {state.notices.join(' ')}
                </div>
              )}
              {candidate ? (
                <Playbook
                  key={candidate.playbook.id}
                  plan={candidate.playbook}
                  candidate={candidate}
                  state={displayState!}
                  onBack={() => setDetail(null)}
                  onLock={lock}
                  onOpen={open}
                />
              ) : page === 'home' ? (
                <Home
                  state={displayState!}
                  portfolio={portfolio!}
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
                  riotProvider={riotProvider}
                  historyStore={historyStore}
                  fixturePreview={fixturePreview}
                  onLobby={setLobby}
                />
              ) : (
                <CompLibrary state={displayState!} onOpen={open} />
              )}
              <footer>
                <span>
                  Independent companion. Riot Games assets via CommunityDragon. Not endorsed by Riot
                  Games.
                </span>
                <button onClick={refresh} disabled={refreshing || !!state.selection}>
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
