import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, History, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { PersonalProfile, PlanSession } from '../domain/models';
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
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const reload = async () => {
    const loaded = await loadPostGameHistory(
      repository,
      state.data.version.set,
      state.data.version.patch,
    );
    setHistory(loaded);
    onUpdated(loaded.personal, await repository.getActivePlanSession());
  };
  useEffect(() => {
    void reload();
    // Repository is stable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const run = async (chainId: string) => {
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
      setWorking(null);
    }
  };

  const decide = async (
    chainId: string,
    action: 'confirm' | 'reject' | 'unlink',
    matchId: string | null,
  ) => {
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
      setWorking(null);
    }
  };

  if (!history)
    return (
      <div className="loading-state compact-loading">
        <RefreshCw className="spin" size={22} /> Loading local session history…
      </div>
    );

  const eligibleGames = history.personal.sourceReviewIds?.length ?? 0;
  return (
    <section className="postgame-page" aria-label="Post-game history">
      <header className="page-heading postgame-heading">
        <div>
          <span className="eyebrow">POST-GAME · LOCAL EVIDENCE</span>
          <h1>Recent games & reviews</h1>
          <p>
            Link a saved plan to a completed Riot match, inspect the final board, and keep personal
            influence deliberately small.
          </p>
        </div>
        <div className="personal-evidence-card" aria-label="Personal evidence summary">
          <ShieldCheck size={18} />
          <div>
            <strong>{eligibleGames} attributed current-set games</strong>
            <span>
              {eligibleGames < (history.personal.minimumEvidenceGames ?? 5)
                ? 'Sample too small · recommendation adjustment stays neutral'
                : `${Math.round((history.personal.confidence ?? 0) * 100)}% model confidence · ${Math.round(state.settings.personalWeight * 100)}% score authority`}
            </span>
          </div>
        </div>
      </header>
      {message && (
        <div className="validation-notice" role="status">
          {message}
        </div>
      )}
      <div className="history-list">
        {history.chains.length === 0 ? (
          <article className="empty-history">
            <History size={24} />
            <strong>No saved match-plan sessions yet.</strong>
            <span>Lock a recommendation before a game; M9 will reuse that immutable history.</span>
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
                      {chain.sessions.length} plan{chain.sessions.length === 1 ? '' : 's'} in chain
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
                        onClick={() => decide(chain.id, 'unlink', reconciliation.matchId)}
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
                        {index === chain.sessions.length - 1 && <small>terminal attribution</small>}
                      </span>
                    ))}
                  </div>
                )}
                {reconciliation && ['candidate', 'ambiguous'].includes(reconciliation.state) && (
                  <div className="candidate-list">
                    <strong>Manual confirmation required</strong>
                    {reconciliation.candidates.map((candidate) => (
                      <div key={candidate.matchId}>
                        <span>
                          <b>#{candidate.placement}</b> ·{' '}
                          {new Date(candidate.gameTimestamp).toLocaleString()}
                          <small>
                            {Math.round(candidate.score * 100)}% reconciliation score · timestamp
                            semantics{' '}
                            {candidate.timestampSemantics === 'fixture-completed-at'
                              ? 'fixture-completed'
                              : 'unspecified'}
                          </small>
                        </span>
                        <button
                          className="secondary"
                          onClick={() => decide(chain.id, 'confirm', candidate.matchId)}
                          disabled={working !== null}
                        >
                          Confirm this match
                        </button>
                      </div>
                    ))}
                    <button
                      className="text-button danger-text"
                      onClick={() =>
                        decide(chain.id, 'reject', reconciliation.candidates[0]?.matchId ?? null)
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
                          ? review.relation.classification.familyId
                          : `final family ${review.relation.classification.state}`}
                      </span>
                    </div>
                    <div className="review-copy">
                      {review.summary.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      <strong>{review.adjustment}</strong>
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
    </section>
  );
}
