import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock3,
  Compass,
  History,
  Link2,
  RefreshCw,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { projectBoardAnalysis } from '../strategy/personalClassifier';
import type {
  MatchRecommendationLink,
  PersonalCompPerformance,
  PersonalHistoryRefreshStatus,
  PersonalHistorySummary,
  PersonalMatchObservation,
  PersonalProfile,
  PlanSession,
  CalibrationV2Evaluation,
} from '../domain/models';
import type { RiotProvider } from '../providers/riot';
import type { HistoryStore } from '../storage/history';
import type { Repository } from '../storage/repository';
import type { ApplicationState } from '../services/application';
import {
  checkCompletedMatch,
  confirmCompletedMatch,
  loadPostGameHistory,
  rejectOrUnlinkCompletedMatch,
  type PostGameHistoryState,
} from '../services/postGame';
import { postGameReviewIsCurrent } from '../strategy/postGame';
import { Portrait } from '../components/Art';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { parseRiotId } from '../providers/riotId';
import { PREVIEW_OWN_RIOT_ID } from '../providers/riotPreview';
import {
  derivePersonalCompPerformance,
  derivePersonalHistorySummary,
  refreshPersonalHistory,
} from '../services/personalHistory';
import { linkMatchToRecommendation } from '../services/matchRecommendationLink';
import { evaluateCalibrationV2 } from '../strategy/calibration';

type PostGameTab = 'recent' | 'comps' | 'plans' | 'calibration';

export function PostGameHistory({
  state,
  repository,
  provider,
  historyStore,
  onUpdated,
}: {
  state: ApplicationState;
  repository: Repository;
  provider: RiotProvider;
  historyStore: HistoryStore;
  onUpdated: (personal: PersonalProfile, activeSession: PlanSession | null) => void;
}) {
  const [history, setHistory] = useState<PostGameHistoryState | null>(null);
  const [activeTab, setActiveTab] = useState<PostGameTab>('recent');
  const [observations, setObservations] = useState<PersonalMatchObservation[]>([]);
  const [refreshStatus, setRefreshStatus] = useState<PersonalHistoryRefreshStatus | null>(null);
  const [refreshingPersonal, setRefreshingPersonal] = useState(false);
  const [selectedObservation, setSelectedObservation] = useState<PersonalMatchObservation | null>(
    null,
  );
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const [pending, setPending] = useState<{
    chainId: string;
    action: 'confirm' | 'reject' | 'unlink';
    matchId: string | null;
  } | null>(null);

  const getAccountIdentity = async () => {
    const effectiveRiotId =
      state.settings.riotId ||
      (typeof window !== 'undefined' && window.location.search.includes('riot-fixture')
        ? PREVIEW_OWN_RIOT_ID
        : '');
    if (!effectiveRiotId) return null;
    try {
      const parsed = parseRiotId(effectiveRiotId);
      const cached = await historyStore.getIdentity(
        parsed.gameName,
        parsed.tagLine,
        state.settings.riotPlatform,
      );
      if (cached) return cached;
      const identity = await provider.resolveAccount(parsed.gameName, parsed.tagLine, {
        deadlineAt: Date.now() + 8_000,
      });
      await historyStore.putIdentity(identity, new Date().toISOString());
      return identity;
    } catch {
      return null;
    }
  };

  const reload = async () => {
    const loaded = await loadPostGameHistory(
      repository,
      state.data.version.set,
      state.data.version.patch,
    );
    setHistory(loaded);
    onUpdated(loaded.personal, await repository.getActivePlanSession());

    let obs: PersonalMatchObservation[] = [];
    const identity = await getAccountIdentity();
    if (identity) {
      obs = await repository.listPersonalMatchObservations(identity.puuid);
    } else {
      obs = await repository.listPersonalMatchObservations();
    }
    setObservations(obs);
  };

  useEffect(() => {
    void reload().catch(() =>
      setMessage('Local history could not be loaded. Your saved sessions have not been changed.'),
    );
    // Repository is stable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const handleRefreshPersonalHistory = async () => {
    if (refreshingPersonal) return;
    setRefreshingPersonal(true);
    setMessage('');
    try {
      const identity = await getAccountIdentity();
      if (!identity) {
        setMessage('Configure your Riot account in Data & Settings.');
        return;
      }
      const result = await refreshPersonalHistory(
        identity,
        provider,
        historyStore,
        repository,
        state.catalog ?? null,
        state.data,
        20,
        { force: true },
      );
      setRefreshStatus(result.status);
      setObservations(result.observations);
      setMessage(result.status.message ?? 'Personal history refreshed.');
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      if (
        errText.toLowerCase().includes('key') ||
        errText.toLowerCase().includes('auth') ||
        errText.toLowerCase().includes('403')
      ) {
        setMessage('Personal history unavailable · Riot API key required.');
      } else if (errText.toLowerCase().includes('rate')) {
        setMessage('Riot is rate limiting history refresh. Cached games are still available.');
      } else {
        setMessage(`History refresh issue: ${errText}. Cached games are still available.`);
      }
    } finally {
      setRefreshingPersonal(false);
    }
  };

  const run = async (chainId: string) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(chainId);
    setMessage('');
    try {
      const result = await checkCompletedMatch(
        chainId,
        repository,
        provider,
        historyStore,
        state.playbooks,
        state.data.version.set,
        state.data.version.patch,
      );
      setMessage(
        result.reconciliation.state === 'matched'
          ? 'Completed match linked and review rebuilt from immutable evidence.'
          : result.reconciliation.state === 'ambiguous'
            ? 'More than one match is plausible. Confirm the correct result explicitly.'
            : result.reconciliation.state === 'candidate'
              ? 'One plausible match needs explicit confirmation.'
              : 'No safe completed-match link was found in the bounded recent horizon.',
      );
      await reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Completed-match checking is unavailable. Session history is unchanged.',
      );
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const decide = async (
    chainId: string,
    action: 'confirm' | 'reject' | 'unlink',
    matchId: string | null,
  ) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(chainId);
    try {
      if (action === 'confirm')
        await confirmCompletedMatch(
          chainId,
          matchId!,
          repository,
          historyStore,
          state.playbooks,
          state.data.version.set,
          state.data.version.patch,
        );
      else
        await rejectOrUnlinkCompletedMatch(
          chainId,
          action,
          repository,
          state.data.version.set,
          state.data.version.patch,
        );
      setMessage(
        action === 'confirm'
          ? 'Match confirmed. The terminal route received the result attribution.'
          : action === 'unlink'
            ? 'Match link removed through an auditable action; personal evidence was rebuilt.'
            : 'Candidate rejected. No result was attributed.',
      );
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The reconciliation action failed.');
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  if (!history && message)
    return (
      <div className="empty-state">
        <History />
        <h2>History unavailable</h2>
        <p>{message}</p>
        <button
          className="secondary"
          onClick={() => {
            setMessage('');
            void reload().catch(() =>
              setMessage('Local history is still unavailable. Please restart Strategist.'),
            );
          }}
        >
          Retry history
        </button>
      </div>
    );
  if (!history)
    return (
      <div className="loading-state compact-loading">
        <RefreshCw className="spin" size={22} /> Loading local session history…
      </div>
    );

  const compPerformances: PersonalCompPerformance[] = derivePersonalCompPerformance(
    observations,
    state.catalog ?? null,
    state.data.version.set,
  );

  const profileSummary: PersonalHistorySummary = derivePersonalHistorySummary(
    observations,
    compPerformances,
    state.data.version.set,
  );

  const allSessions = history.chains.flatMap((c) => c.sessions);
  const recommendationLinks: MatchRecommendationLink[] = observations.map((obs) =>
    linkMatchToRecommendation(obs, allSessions, history.reconciliations),
  );

  const calibrationV2: CalibrationV2Evaluation = evaluateCalibrationV2(
    allSessions,
    history.reviews,
    observations,
    recommendationLinks,
  );

  const eligibleGames = history.personal.sourceReviewIds?.length ?? 0;

  return (
    <section className="postgame-page" aria-label="Post-game history">
      <header className="page-heading postgame-heading">
        <div>
          <span className="eyebrow">POST-GAME / YOUR PROGRESS</span>
          <h1>Personal History & Intelligence</h1>
          <p>Your actual match outcomes, personal comp mastery, and recommendation reviews.</p>
        </div>
        <div className="postgame-header-actions">
          <button
            className="primary refresh-personal-btn"
            onClick={() => void handleRefreshPersonalHistory()}
            disabled={refreshingPersonal}
          >
            <RefreshCw className={refreshingPersonal ? 'spin' : ''} size={15} />
            {refreshingPersonal ? 'Refreshing history…' : 'Refresh personal history'}
          </button>
        </div>
      </header>

      {/* Account Profile Summary Card */}
      <div className="personal-profile-banner" aria-label="Personal profile summary">
        <div className="profile-banner-top">
          <div className="profile-title-row">
            <Trophy size={18} className="gold-icon" />
            <strong>Your Current-Set Profile · Set {state.data.version.set}</strong>
          </div>
          <span className="profile-split-pill">
            {profileSummary.currentSetGames} current-set games
            {profileSummary.archivedOldSetGames > 0 &&
              ` · ${profileSummary.archivedOldSetGames} archived old sets`}
          </span>
        </div>

        <div className="profile-stats-grid">
          <div className="profile-stat-box">
            <span className="stat-label">Avg Placement</span>
            <strong className="stat-value">
              {profileSummary.currentSetAveragePlacement !== null
                ? `#${profileSummary.currentSetAveragePlacement.toFixed(2)}`
                : '—'}
            </strong>
          </div>
          <div className="profile-stat-box">
            <span className="stat-label">Top 4 Rate</span>
            <strong className="stat-value">
              {profileSummary.currentSetTop4Rate !== null
                ? `${Math.round(profileSummary.currentSetTop4Rate * 100)}%`
                : '—'}
            </strong>
          </div>
          <div className="profile-stat-box">
            <span className="stat-label">Win Rate</span>
            <strong className="stat-value">
              {profileSummary.currentSetWinRate !== null
                ? `${Math.round(profileSummary.currentSetWinRate * 100)}%`
                : '—'}
            </strong>
          </div>
          <div className="profile-stat-box highlight-box">
            <span className="stat-label">Most Played Comp</span>
            <strong className="stat-value comp-name">
              {profileSummary.mostPlayedComp
                ? `${profileSummary.mostPlayedComp.compTitle} (${profileSummary.mostPlayedComp.games})`
                : 'None yet'}
            </strong>
          </div>
        </div>

        <div className="profile-highlights-row">
          {profileSummary.strongestObserved && (
            <div className="highlight-tag positive">
              <span>Strong observed:</span>
              <strong>{profileSummary.strongestObserved.compTitle}</strong>
              <small>
                {profileSummary.strongestObserved.games} games ·{' '}
                {Math.round(profileSummary.strongestObserved.top4Rate * 100)}% Top 4 ·{' '}
                {profileSummary.strongestObserved.sampleConfidence}
              </small>
            </div>
          )}
          {profileSummary.weakerObserved && (
            <div className="highlight-tag subdued">
              <span>Weaker observed:</span>
              <strong>{profileSummary.weakerObserved.compTitle}</strong>
              <small>
                {profileSummary.weakerObserved.games} games · avg #
                {profileSummary.weakerObserved.averagePlacement.toFixed(2)} ·{' '}
                {profileSummary.weakerObserved.sampleConfidence}
              </small>
            </div>
          )}
        </div>

        <div className="profile-footer-note">
          <ShieldCheck size={14} />
          <span>
            Recommendation-learning evidence: <strong>{eligibleGames} attributed plan games</strong>{' '}
            (~{Math.round(state.settings.personalWeight * 100)}% influence) · Account match ledger:{' '}
            <strong>{profileSummary.currentSetGames} games</strong> (descriptive observation only)
          </span>
        </div>
      </div>

      {/* Status banner */}
      {(message || refreshStatus?.message) && (
        <div className="validation-notice" role="status">
          <AlertCircle size={16} /> {message || refreshStatus?.message}
        </div>
      )}

      {/* Tabs */}
      <nav className="postgame-tab-nav" aria-label="Post-game tabs">
        <button
          className={`postgame-tab-btn ${activeTab === 'recent' ? 'active' : ''}`}
          onClick={() => setActiveTab('recent')}
        >
          <Swords size={15} />
          <span>Recent Games</span>
          <span className="tab-count-badge">{observations.length}</span>
        </button>
        <button
          className={`postgame-tab-btn ${activeTab === 'comps' ? 'active' : ''}`}
          onClick={() => setActiveTab('comps')}
        >
          <BarChart3 size={15} />
          <span>Comp Performance</span>
          <span className="tab-count-badge">{compPerformances.length}</span>
        </button>
        <button
          className={`postgame-tab-btn ${activeTab === 'plans' ? 'active' : ''}`}
          onClick={() => setActiveTab('plans')}
        >
          <History size={15} />
          <span>Plan-Linked Reviews</span>
          <span className="tab-count-badge">{history.chains.length}</span>
        </button>
        <button
          className={`postgame-tab-btn ${activeTab === 'calibration' ? 'active' : ''}`}
          onClick={() => setActiveTab('calibration')}
        >
          <Compass size={15} />
          <span>Model Calibration</span>
          <span className="tab-count-badge">{calibrationV2.buckets.length}</span>
        </button>
      </nav>

      {/* Tab Content 1: Recent Games (Primary Experience) */}
      {activeTab === 'recent' && (
        <div className="recent-games-list">
          {observations.length === 0 ? (
            <article className="empty-history">
              <History size={28} />
              <strong>No recent personal TFT matches found yet.</strong>
              <span>
                Click &quot;Refresh personal history&quot; above to import your recent matches from your
                configured Riot account.
              </span>
            </article>
          ) : (
            observations.map((obs) => {
              const compTitle =
                obs.classificationState === 'classified' && obs.classifiedCompId
                  ? (state.catalog?.playbooks.find((p) => p.id === obs.classifiedCompId)?.title ??
                    state.catalog?.comps.find((c) => c.id === obs.classifiedCompId)?.title ??
                    obs.classifiedCompId)
                  : obs.classificationState === 'ambiguous'
                    ? 'Ambiguous Comp'
                    : obs.classificationState === 'incompatible-set'
                      ? `Old Set (Set ${obs.set})`
                      : 'Unclassified Board';

              const link = recommendationLinks.find((l) => l.actualPlacement === obs.placement && l.actualClassifiedCompId === obs.classifiedCompId);
              const isTop4 = obs.placement <= 4;
              const isWin = obs.placement === 1;

              return (
                <article
                  key={obs.matchId}
                  className={`recent-game-card ${isWin ? 'card-win' : isTop4 ? 'card-top4' : ''}`}
                >
                  <div className="recent-game-left">
                    <div
                      className={`placement-badge ${isWin ? 'badge-win' : isTop4 ? 'badge-top4' : 'badge-bot4'}`}
                    >
                      <span className="placement-hash">#</span>
                      <span className="placement-num">{obs.placement}</span>
                    </div>
                  </div>

                  <div className="recent-game-main">
                    <div className="recent-game-header-row">
                      <div className="recent-comp-title-group">
                        <h2 className="recent-comp-title">{compTitle}</h2>
                        <span className="recent-game-meta">
                          Level {obs.level} · {obs.gameType ?? 'TFT'} ·{' '}
                          {new Date(obs.gameTimestamp).toLocaleDateString()}{' '}
                          {new Date(obs.gameTimestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="recent-game-badges">
                        <span className={`classification-pill ${obs.classificationState}`}>
                          {obs.classificationState === 'classified'
                            ? `Classified · ${Math.round(obs.classificationConfidence * 100)}%`
                            : obs.classificationState}
                        </span>
                        {link && link.state === 'linked' && (
                          <span className="recommendation-link-pill linked">
                            Plan #{link.recommendedRank}
                          </span>
                        )}
                        {link && link.state === 'candidate' && (
                          <span className="recommendation-link-pill candidate">Snapshot Rec</span>
                        )}
                      </div>
                    </div>

                    {/* Unit Portraits */}
                    <div className="recent-board-roster">
                      {obs.units.map((unit, idx) => {
                        const champion = state.data.champions.find((c) => c.id === unit.championId);
                        return (
                          champion && (
                            <div className="unit-portrait-slot" key={`${unit.championId}-${idx}`}>
                              <Portrait champion={champion} assets={state.assets} compact />
                              {unit.stars && unit.stars > 1 && (
                                <span className={`star-badge star-${unit.stars}`}>
                                  {'★'.repeat(unit.stars)}
                                </span>
                              )}
                            </div>
                          )
                        );
                      })}
                    </div>
                  </div>

                  <div className="recent-game-right">
                    <button
                      className="secondary analyze-btn"
                      onClick={() => setSelectedObservation(obs)}
                    >
                      Analyze
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {/* Tab Content 2: Comp Performance */}
      {activeTab === 'comps' && (
        <div className="comp-performance-section">
          {compPerformances.length === 0 ? (
            <article className="empty-history">
              <BarChart3 size={28} />
              <strong>No classified comp history yet.</strong>
              <span>
                Personal comp mastery requires classified completed matches from the active set.
              </span>
            </article>
          ) : (
            <div className="comp-performance-grid">
              {compPerformances.map((comp) => (
                <div key={comp.compId} className="comp-perf-card">
                  <div className="comp-perf-header">
                    <h3>{comp.compTitle}</h3>
                    <span
                      className={`confidence-pill confidence-${comp.sampleConfidence.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {comp.sampleConfidence}
                    </span>
                  </div>

                  <div className="comp-perf-stats-row">
                    <div>
                      <span className="cp-label">Games</span>
                      <strong>{comp.games}</strong>
                    </div>
                    <div>
                      <span className="cp-label">Raw Avg</span>
                      <strong className="gold-text">#{comp.averagePlacement.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span className="cp-label">Top 4</span>
                      <strong>{Math.round(comp.top4Rate * 100)}%</strong>
                    </div>
                    <div>
                      <span className="cp-label">Win Rate</span>
                      <strong>{Math.round(comp.winRate * 100)}%</strong>
                    </div>
                    <div>
                      <span className="cp-label">Best</span>
                      <strong>#{comp.bestPlacement}</strong>
                    </div>
                  </div>

                  <div className="comp-perf-shrinkage-row">
                    <span className="shrinkage-label">Evidence-adjusted estimate:</span>
                    <strong className="shrinkage-val">#{comp.evidenceAdjustedEstimate.toFixed(2)}</strong>
                    <small>(shrunk toward neutral 4.5)</small>
                  </div>

                  <div className="recent-sequence-row">
                    <span className="seq-label">Recent:</span>
                    <div className="seq-numbers">
                      {comp.recentPlacements.map((p, idx) => (
                        <span key={idx} className={`seq-pill ${p <= 4 ? 'top4' : ''}`}>
                          #{p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab Content 3: Plan-Linked Reviews (Existing System Preserved) */}
      {activeTab === 'plans' && (
        <div className="history-list">
          {history.chains.length === 0 ? (
            <article className="empty-history">
              <History size={24} />
              <strong>No saved match-plan sessions yet.</strong>
              <span>
                Lock a plan before your next game. Return here to link the result and review your
                board.
              </span>
            </article>
          ) : (
            history.chains.map((chain) => {
              const reconciliation = history.reconciliations.find(
                (entry) => entry.chainId === chain.id,
              );
              const review = history.reviews.find((entry) => entry.chainId === chain.id);
              const reviewCurrent = review ? postGameReviewIsCurrent(review, chain) : false;
              const stale = chain.terminal.snapshot.playbook.set !== state.data.version.set;
              return (
                <article
                  className="history-card"
                  key={chain.id}
                  data-history-state={reconciliation?.state ?? 'unmatched'}
                >
                  <div className="history-card-top">
                    <div>
                      <span
                        className={`reconciliation-state ${reconciliation?.state ?? 'unmatched'}`}
                      >
                        {reconciliation?.state ?? 'unmatched'}
                      </span>
                      {stale && <span className="stale-pill">Old set · excluded from learning</span>}
                      {review && !reviewCurrent && (
                        <span className="stale-pill">Review model stale · rebuild</span>
                      )}
                      <h2>{chain.terminal.snapshot.playbook.title}</h2>
                      <p>
                        <Clock3 size={12} /> Locked{' '}
                        {new Date(chain.sessions[0].lockedAt).toLocaleString()} ·{' '}
                        {chain.sessions.length} plan{chain.sessions.length === 1 ? '' : 's'} in
                        chain
                      </p>
                    </div>
                    {!reconciliation || ['unmatched', 'rejected'].includes(reconciliation.state) ? (
                      <button
                        className="primary"
                        onClick={() => run(chain.id)}
                        disabled={working !== null}
                      >
                        {working === chain.id ? (
                          <RefreshCw className="spin" size={14} />
                        ) : (
                          <Link2 size={14} />
                        )}
                        Check completed match
                      </button>
                    ) : reconciliation.state === 'matched' ? (
                      <div className="history-actions">
                        <button
                          className="secondary"
                          onClick={() => run(chain.id)}
                          disabled={working !== null}
                        >
                          Rebuild review
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            setPending({
                              chainId: chain.id,
                              action: 'unlink',
                              matchId: reconciliation.matchId,
                            })
                          }
                          disabled={working !== null}
                        >
                          Unlink match
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {chain.sessions.length > 1 && (
                    <div className="switch-chain" aria-label="Switch chain">
                      {chain.sessions.map((session, index) => (
                        <span key={session.id}>
                          {index > 0 && <i>→</i>}
                          {session.snapshot.playbook.title}
                          {index === chain.sessions.length - 1 && (
                            <small>terminal attribution</small>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {reconciliation &&
                    ['candidate', 'ambiguous'].includes(reconciliation.state) && (
                      <div className="candidate-list">
                        <strong>Manual confirmation required</strong>
                        {reconciliation.candidates.map((candidate) => (
                          <div key={candidate.matchId}>
                            <span>
                              <b>#{candidate.placement}</b> ·{' '}
                              {new Date(candidate.gameTimestamp).toLocaleString()}
                              <small>
                                {Math.round(candidate.score * 100)}% reconciliation score ·
                                timestamp semantics{' '}
                                {candidate.timestampSemantics === 'fixture-completed-at'
                                  ? 'fixture-completed'
                                  : 'unspecified'}
                              </small>
                            </span>
                            <button
                              className="secondary"
                              onClick={() =>
                                setPending({
                                  chainId: chain.id,
                                  action: 'confirm',
                                  matchId: candidate.matchId,
                                })
                              }
                              disabled={working !== null}
                            >
                              Confirm this match
                            </button>
                          </div>
                        ))}
                        <button
                          className="text-button danger-text"
                          onClick={() =>
                            setPending({
                              chainId: chain.id,
                              action: 'reject',
                              matchId: reconciliation.candidates[0]?.matchId ?? null,
                            })
                          }
                          disabled={working !== null}
                        >
                          None of these
                        </button>
                      </div>
                    )}
                  {review && (
                    <div className="review-detail">
                      <div className="review-placement">
                        <CheckCircle2 size={18} />
                        <strong>#{review.participant.placement}</strong>
                        <span>
                          {review.relation.classification.state === 'classified'
                            ? (state.playbooks.find(
                                (p) => p.family.id === review.relation.classification.familyId,
                              )?.title ?? review.relation.classification.familyId)
                            : `final family ${review.relation.classification.state}`}
                        </span>
                      </div>
                      <div className="review-copy">
                        <div className="review-stats">
                          <div>
                            <strong>
                              {review.relation.similarity
                                ? `${Math.round(review.relation.similarity.value * 100)}%`
                                : '—'}
                            </strong>
                            <span>Target similarity</span>
                          </div>
                          <div>
                            <strong>
                              {review.relation.selectedCorePresent.length}/
                              {review.relation.selectedCorePresent.length +
                                review.relation.selectedCoreMissing.length}
                            </strong>
                            <span>Core present</span>
                          </div>
                          <div>
                            <strong>{review.baseline.expectedPlacement?.toFixed(2) ?? '—'}</strong>
                            <span>Baseline avg place</span>
                          </div>
                        </div>
                        <div className="review-roster" aria-label="Final board">
                          {review.relation.canonicalFinal?.units.map((unit) => {
                            const champion = chain.terminal.snapshot.staticData.champions.find(
                              (c) => c.id === unit.championId,
                            );
                            return (
                              champion && (
                                <Portrait
                                  key={unit.championId}
                                  champion={champion}
                                  assets={state.assets}
                                  compact
                                />
                              )
                            );
                          })}
                        </div>
                        <p className="review-core">
                          <b>Missing core: </b>
                          {review.relation.selectedCoreMissing
                            .map(
                              (id) =>
                                chain.terminal.snapshot.staticData.champions.find(
                                  (c) => c.id === id,
                                )?.name ?? id,
                            )
                            .join(', ') || 'None'}
                        </p>
                        <div className="review-adjustment">
                          <strong>{review.adjustment}</strong>
                        </div>
                        <details>
                          <summary>Result details & attribution</summary>
                          {review.summary.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </details>
                      </div>
                      <details>
                        <summary>{review.evidenceGaps.length} evidence boundary note(s)</summary>
                        {review.evidenceGaps.map((gap) => (
                          <p key={gap}>{gap}</p>
                        ))}
                      </details>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* Tab Content 4: Model Calibration V2 */}
      {activeTab === 'calibration' && (
        <div className="calibration-section">
          <div className="calibration-header-box">
            <h3>Calibration V2 · Descriptive Offline Analysis</h3>
            <p>
              {calibrationV2.totalOutcomes} observed outcome(s) evaluated across descriptive buckets.
              Model weights remain strictly unchanged.
            </p>
          </div>

          <div className="calibration-bucket-grid">
            {calibrationV2.buckets.map((bucket) => (
              <div key={bucket.key} className="calibration-bucket-card">
                <div className="bucket-card-top">
                  <span className="bucket-key">{bucket.key}</span>
                  <span className="bucket-games">{bucket.games} games</span>
                </div>
                <div className="bucket-card-stats">
                  <div>
                    <span className="b-label">Avg Place</span>
                    <strong>#{bucket.averagePlacement.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="b-label">Top 4 Rate</span>
                    <strong>{Math.round(bucket.top4Rate * 100)}%</strong>
                  </div>
                  <div>
                    <span className="b-label">Win Rate</span>
                    <strong>{Math.round(bucket.winRate * 100)}%</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="calibration-limitations-box">
            <strong>Observational Limitations:</strong>
            <ul>
              {calibrationV2.limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Game Analysis Modal */}
      {selectedObservation && (() => {
        const analysis = projectBoardAnalysis(
          selectedObservation.units,
          selectedObservation.set,
          state.catalog ?? null,
          state.data,
          selectedObservation.level,
        );
        const classification = analysis.classification;
        const stateKey = classification.state;
        const detectedCompId = classification.compId ?? selectedObservation.classifiedCompId;
        const detectedCompTitle = classification.compTitle ?? (detectedCompId ? state.catalog?.playbooks.find((p) => p.id === detectedCompId)?.title : null);
        const closestPlaybook = analysis.closestComp
          ? (state.catalog?.playbooks ?? []).find((p) => p.id === analysis.closestComp?.compId)
          : null;
        const closestCompTitle = closestPlaybook?.title ?? analysis.closestComp?.compTitle ?? 'None';

        return (
          <div className="analysis-modal-backdrop" onClick={() => setSelectedObservation(null)}>
            <div className="analysis-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="analysis-modal-header">
                <div className="amh-title-group">
                  <span
                    className={`modal-placement-badge ${selectedObservation.placement === 1 ? 'win' : selectedObservation.placement <= 4 ? 'top4' : ''}`}
                  >
                    #{selectedObservation.placement}
                  </span>
                  <div className="amh-title-text">
                    <h2>
                      {stateKey === 'classified'
                        ? (detectedCompTitle ?? 'Classified Comp')
                        : stateKey === 'ambiguous'
                          ? 'Ambiguous Comp Match'
                          : stateKey === 'incompatible-set'
                            ? 'Incompatible Set Match'
                            : 'Unclassified Board'}
                    </h2>
                    <p>
                      Level {selectedObservation.level} ·{' '}
                      {new Date(selectedObservation.gameTimestamp).toLocaleDateString()}{' '}
                      {new Date(selectedObservation.gameTimestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {stateKey === 'ambiguous' && analysis.nearestMatches.length >= 2 && (
                        <> · Closest: {analysis.nearestMatches[0].compTitle} / {analysis.nearestMatches[1].compTitle}</>
                      )}
                      {stateKey === 'unclassified' && analysis.closestComp && (
                        <> · Closest match: {analysis.closestComp.compTitle}</>
                      )}
                    </p>
                    <div className="amh-badges">
                      <span className={`classification-pill ${stateKey}`}>
                        {stateKey === 'classified'
                          ? 'Classified'
                          : stateKey === 'ambiguous'
                            ? 'Ambiguous'
                            : stateKey === 'incompatible-set'
                              ? 'Incompatible Set'
                              : 'Unclassified'}
                      </span>
                      {stateKey === 'classified' && (
                        <span className="amh-affinity-badge high">
                          {Math.round(classification.confidence * 100)} / 100 affinity · High Confidence
                        </span>
                      )}
                      {stateKey === 'ambiguous' && (
                        <span className="amh-affinity-badge ambiguous">
                          {analysis.nearestMatches[0] ? Math.round(analysis.nearestMatches[0].affinity * 100) : 0} vs{' '}
                          {analysis.nearestMatches[1] ? Math.round(analysis.nearestMatches[1].affinity * 100) : 0} / 100 affinity · Ambiguous
                        </span>
                      )}
                      {stateKey === 'unclassified' && (
                        <span className="amh-affinity-badge low">
                          {analysis.closestComp ? Math.round(analysis.closestComp.affinity * 100) : 0} / 100 affinity · Low Affinity
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button className="icon-close-btn" onClick={() => setSelectedObservation(null)} aria-label="Close analysis">
                  <X size={20} />
                </button>
              </div>

              <div className="analysis-modal-body">
                {/* Board Comparison: Two-Column Side-by-Side */}
                <div className="analysis-board-comparison">
                  {/* Column 1: YOUR FINAL BOARD */}
                  <div className="board-compare-card actual-card">
                    <div className="board-compare-header">
                      <h3><Users size={14} /> YOUR FINAL BOARD</h3>
                      <span className="board-unit-count-pill">{selectedObservation.units.length} units</span>
                    </div>
                    <div className="board-unit-grid">
                      {selectedObservation.units.map((unit, idx) => {
                        const champion = state.data.champions.find((c) => c.id === unit.championId);
                        const isMatched = analysis.closestComp
                          ? analysis.closestComp.matchedUnits.includes(unit.championId)
                          : false;
                        return (
                          <div key={`${unit.championId}-${idx}`} className="board-unit-cell">
                            <div className={`unit-portrait-wrapper ${isMatched ? 'matched' : 'extra'}`}>
                              {champion && <Portrait champion={champion} assets={state.assets} />}
                              {unit.stars && unit.stars > 1 && (
                                <span className="star-badge-modal">{'★'.repeat(unit.stars)}</span>
                              )}
                            </div>
                            <span className={`unit-status-tag ${isMatched ? 'matched' : 'extra'}`}>
                              {isMatched ? 'MATCHED' : 'EXTRA'}
                            </span>
                            <span className="unit-cell-name" title={champion?.name ?? unit.championId}>
                              {champion?.name ?? unit.championId}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Column 2: CLOSEST / EXPECTED CANONICAL BOARD */}
                  <div className="board-compare-card canonical-card">
                    <div className="board-compare-header">
                      <h3>
                        <Compass size={14} />{' '}
                        {stateKey === 'classified' ? 'EXPECTED CANONICAL BOARD' : 'CLOSEST CANONICAL BOARD'}
                      </h3>
                      <span className="board-unit-count-pill">
                        {closestPlaybook?.title ?? closestCompTitle}
                      </span>
                    </div>
                    <div className="board-unit-grid">
                      {closestPlaybook ? (
                        closestPlaybook.target.units.map((targetUnit) => {
                          const champion = state.data.champions.find((c) => c.id === targetUnit.championId);
                          const isMatched = analysis.closestComp
                            ? analysis.closestComp.matchedUnits.includes(targetUnit.championId)
                            : false;
                          const isCarry = closestPlaybook.roles.some(
                            (r) => r.role === 'carry' && r.championId === targetUnit.championId,
                          );
                          const isTank = closestPlaybook.roles.some(
                            (r) => r.role === 'tank' && r.championId === targetUnit.championId,
                          );
                          const isCore = closestPlaybook.family.core.includes(targetUnit.championId);
                          return (
                            <div key={targetUnit.championId} className="board-unit-cell">
                              <div className={`unit-portrait-wrapper ${isMatched ? 'matched' : 'missing'}`}>
                                {isCarry && <span className="unit-role-pill carry">Carry</span>}
                                {!isCarry && isTank && <span className="unit-role-pill tank">Tank</span>}
                                {!isCarry && !isTank && isCore && <span className="unit-role-pill core">Core</span>}
                                {champion && <Portrait champion={champion} assets={state.assets} />}
                              </div>
                              <span className={`unit-status-tag ${isMatched ? 'matched' : 'missing'}`}>
                                {isMatched ? 'MATCHED' : 'MISSING'}
                              </span>
                              <span className="unit-cell-name" title={champion?.name ?? targetUnit.championId}>
                                {champion?.name ?? targetUnit.championId}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="subdued-note">No canonical comp units available for comparison.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Comparison Summary Bar */}
                {analysis.closestComp && (
                  <div className="comparison-summary-bar">
                    <div className="summary-stat-chip">
                      <span className="chip-label">Matched Core</span>
                      <strong className="chip-val">
                        {analysis.closestComp.coreMatched.length} /{' '}
                        {closestPlaybook?.family.core.length ??
                          analysis.closestComp.coreMatched.length + analysis.closestComp.coreMissing.length}
                      </strong>
                    </div>
                    <div className="summary-stat-chip">
                      <span className="chip-label">Missing Core</span>
                      <span
                        className="chip-sub"
                        title={
                          analysis.closestComp.coreMissing
                            .map((id) => state.data.champions.find((c) => c.id === id)?.name ?? id)
                            .join(', ') || 'None'
                        }
                      >
                        {analysis.closestComp.coreMissing
                          .map((id) => state.data.champions.find((c) => c.id === id)?.name ?? id)
                          .join(', ') || 'None'}
                      </span>
                    </div>
                    <div className="summary-stat-chip">
                      <span className="chip-label">Extra / Splash</span>
                      <span
                        className="chip-sub"
                        title={
                          analysis.closestComp.extraUnits
                            .map((id) => state.data.champions.find((c) => c.id === id)?.name ?? id)
                            .join(', ') || 'None'
                        }
                      >
                        {analysis.closestComp.extraUnits
                          .map((id) => state.data.champions.find((c) => c.id === id)?.name ?? id)
                          .join(', ') || 'None'}
                      </span>
                    </div>
                    <div className="summary-stat-chip">
                      <span className="chip-label">Carry Anchor</span>
                      <strong
                        className={`chip-val ${analysis.closestComp.carryAnchorMatched ? 'matched' : 'missing'}`}
                      >
                        {analysis.closestComp.carryAnchorMatched ? (
                          <>
                            <Check size={13} /> Matched
                          </>
                        ) : (
                          'Missing'
                        )}
                      </strong>
                    </div>
                    <div className="summary-stat-chip">
                      <span className="chip-label">Tank Anchor</span>
                      <strong
                        className={`chip-val ${analysis.closestComp.tankAnchorMatched ? 'matched' : 'missing'}`}
                      >
                        {analysis.closestComp.tankAnchorMatched ? (
                          <>
                            <Check size={13} /> Matched
                          </>
                        ) : (
                          'Missing'
                        )}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Nearest Matches Section (Top 3 Comps for Ambiguous or Unclassified) */}
                {analysis && (stateKey === 'unclassified' || stateKey === 'ambiguous') && (
                  <div className="nearest-matches-section">
                    <h4>Closest Comp Matches (Similarity Index)</h4>
                    <div className="nearest-matches-list">
                      {analysis.nearestMatches.map((candidate, idx) => (
                        <div key={candidate.compId} className="nearest-match-row">
                          <div className="nm-left">
                            <span className="nm-rank">#{idx + 1}</span>
                            <span className="nm-title">{candidate.compTitle}</span>
                          </div>
                          <div className="nm-right">
                            <div className="affinity-bar-track">
                              <div
                                className="affinity-bar-fill"
                                style={{ width: `${Math.min(100, Math.round(candidate.affinity * 100))}%` }}
                              />
                            </div>
                            <span className="nm-affinity">
                              {Math.round(candidate.affinity * 100)} / 100 affinity
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className={`why-not-classified-box ${stateKey}`}>
                      <strong>
                        {stateKey === 'ambiguous'
                          ? 'Ambiguous because:'
                          : 'Not classified because:'}
                      </strong>
                      <ul>
                        {classification.reasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Personal Context vs Global Context */}
                <div className="analysis-dual-context">
                  <div className="context-box personal-context">
                    <h4>YOUR RESULTS</h4>
                    {stateKey === 'classified' && detectedCompId ? (
                      (() => {
                        const perf = compPerformances.find(
                          (cp) => cp.compId === detectedCompId,
                        );
                        return perf ? (
                          <div className="context-stats">
                            <p>
                              Games on this comp: <strong>{perf.games}</strong>
                            </p>
                            <p>
                              Personal average: <strong>#{perf.averagePlacement.toFixed(2)}</strong>
                            </p>
                            <p>
                              Personal Top 4: <strong>{Math.round(perf.top4Rate * 100)}%</strong>
                            </p>
                            <p>
                              Personal Win Rate: <strong>{Math.round(perf.winRate * 100)}%</strong>
                            </p>
                            <p>
                              Sample confidence:{' '}
                              <span className="confidence-inline">{perf.sampleConfidence}</span>
                            </p>
                            <p className="subdued-note">
                              Evidence-adjusted estimate: #{perf.evidenceAdjustedEstimate.toFixed(2)}{' '}
                              (shrunk toward 4.5)
                            </p>
                          </div>
                        ) : (
                          <p className="subdued-note">1st observed game on this comp.</p>
                        );
                      })()
                    ) : (
                      <div className="context-stats">
                        <p className="subdued-note">No reliable personal comp bucket yet.</p>
                        <p className="subdued-note">
                          Personal comp mastery requires confident classification to attribute results.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="context-box global-context">
                    <h4>GLOBAL META</h4>
                    {stateKey === 'classified' && detectedCompId ? (
                      (() => {
                        const obs = state.catalog?.metaObservations.find(
                          (m) => m.compId === detectedCompId,
                        );
                        return obs ? (
                          <div className="context-stats">
                            <p>
                              Global average:{' '}
                              <strong>#{obs.averagePlacement?.toFixed(2) ?? '—'}</strong>
                            </p>
                            <p>
                              Global Top 4:{' '}
                              <strong>
                                {obs.top4Rate ? `${Math.round(obs.top4Rate * 100)}%` : '—'}
                              </strong>
                            </p>
                            <p>
                              Global Win Rate:{' '}
                              <strong>
                                {obs.winRate ? `${Math.round(obs.winRate * 100)}%` : '—'}
                              </strong>
                            </p>
                            <p>
                              Observed Sample: <strong>{obs.sampleSize?.toLocaleString()}</strong>
                            </p>
                          </div>
                        ) : (
                          <p className="subdued-note">No external meta snapshot for this comp.</p>
                        );
                      })()
                    ) : (
                      <p className="subdued-note">Global meta comparison unavailable.</p>
                    )}
                  </div>
                </div>

                {/* Recommendation Context */}
                {(() => {
                  const link = recommendationLinks.find(
                    (l) => l.matchId === selectedObservation.matchId ||
                      (l.actualPlacement === selectedObservation.placement && l.actualClassifiedCompId === selectedObservation.classifiedCompId),
                  );
                  return (
                    link &&
                    link.state !== 'none' && (
                      <div className="analysis-section recommendation-link-section">
                        <h3>Recommendation vs Actual Outcome</h3>
                        <p className="rec-link-statement">{link.summaryStatement}</p>
                        <div className="rec-link-columns">
                          <div className="rec-col">
                            <div className="rec-col-title">Before Game Recommendation</div>
                            <div className="rec-col-body">
                              <span><b>Plan:</b> #{link.recommendedRank} recommended</span>
                              {link.finalSafety !== undefined && (
                                <span><b>Final Safety:</b> {link.finalSafety.toFixed(1)}</span>
                              )}
                              {link.contestState && (
                                <span><b>Lobby Contest:</b> {link.contestState}</span>
                              )}
                            </div>
                          </div>
                          <div className="rec-col">
                            <div className="rec-col-title">Actual Outcome</div>
                            <div className="rec-col-body">
                              <span><b>Played Board:</b> {detectedCompTitle ?? closestCompTitle}</span>
                              <span><b>Placement:</b> #{selectedObservation.placement}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  );
                })()}

                {/* Collapsed Technical Details */}
                {analysis.technicalDetails && (
                  <details className="analysis-tech-details">
                    <summary>Classification Technical Details</summary>
                    <div className="tech-details-grid">
                      <div className="tech-detail-item">
                        <span>Classifier Version:</span>
                        <strong>{analysis.technicalDetails.classifierVersion}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Best Affinity:</span>
                        <strong>{analysis.technicalDetails.bestAffinity}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Runner-Up Affinity:</span>
                        <strong>{analysis.technicalDetails.runnerUpAffinity}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Core Recall:</span>
                        <strong>{Math.round(analysis.technicalDetails.coreRecall * 100)}%</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Target Recall:</span>
                        <strong>{Math.round(analysis.technicalDetails.targetRecall * 100)}%</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Target Jaccard:</span>
                        <strong>{analysis.technicalDetails.targetJaccard}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Anchor Recall:</span>
                        <strong>{Math.round(analysis.technicalDetails.anchorRecall * 100)}%</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Winner Margin:</span>
                        <strong>{analysis.technicalDetails.winnerMargin}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Frontline Damped:</span>
                        <strong>{analysis.technicalDetails.frontlineDampingApplied ? 'Yes' : 'No'}</strong>
                      </div>
                      <div className="tech-detail-item">
                        <span>Cleared Gates:</span>
                        <strong>{analysis.technicalDetails.clearedGates ? 'Yes' : 'No'}</strong>
                      </div>
                    </div>
                  </details>
                )}
              </div>

              <div className="analysis-modal-footer">
                <button className="primary" onClick={() => setSelectedObservation(null)}>
                  Close Analysis
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {pending && (
        <ConfirmDialog
          title={
            pending.action === 'confirm'
              ? 'Link this completed match?'
              : pending.action === 'unlink'
                ? 'Unlink this match?'
                : 'Reject these candidates?'
          }
          confirmLabel={
            pending.action === 'confirm'
              ? 'Confirm link'
              : pending.action === 'unlink'
                ? 'Confirm unlink'
                : 'Reject candidates'
          }
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            void decide(action.chainId, action.action, action.matchId);
          }}
        >
          <p>
            {pending.action === 'confirm'
              ? 'This result will be linked to the final selected plan. Check the placement and date before continuing.'
              : 'Your saved plan remains in history. Personal evidence will be recalculated without this result.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
