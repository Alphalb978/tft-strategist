import { useEffect, useRef, useState } from 'react';
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
import { Portrait } from '../components/Art';
import { ConfirmDialog } from '../components/ConfirmDialog';

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
  const busy = useRef(false);
  const [pending, setPending] = useState<{
    chainId: string;
    action: 'confirm' | 'reject' | 'unlink';
    matchId: string | null;
  } | null>(null);

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
    void reload().catch(() =>
      setMessage('Local history could not be loaded. Your saved sessions have not been changed.'),
    );
    // Repository is stable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

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

  const eligibleGames = history.personal.sourceReviewIds?.length ?? 0;
  return (
    <section className="postgame-page" aria-label="Post-game history">
      <header className="page-heading postgame-heading">
        <div>
          <span className="eyebrow">POST-GAME / YOUR PROGRESS</span>
          <h1>Recent games & reviews</h1>
          <p>Your plan, your result, and what to take into the next game.</p>
        </div>
        <div className="personal-evidence-card" aria-label="Personal evidence summary">
          <ShieldCheck size={18} />
          <div>
            <strong>{eligibleGames} attributed current-set games</strong>
            <span>
              {eligibleGames < (history.personal.minimumEvidenceGames ?? 5)
                ? 'Sample too small · recommendation adjustment stays neutral'
                : `${Math.round((history.personal.confidence ?? 0) * 100)}% evidence confidence · ${Math.round(state.settings.personalWeight * 100)}% personal influence`}
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
                              chain.terminal.snapshot.staticData.champions.find((c) => c.id === id)
                                ?.name ?? id,
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
