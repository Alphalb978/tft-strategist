import { AdoptionMetric } from '../components/AdoptionMetric';
import { optimizeBoards } from '../strategy/boardOptimizer';
import { useMemo, useState } from 'react';
import type { ApplicationState } from '../services/application';
import { rescoreRecommendations } from '../services/application';
import type { CurrentGameState } from '../domain/intelligence';
import type { LobbyPressure, Playbook, RecommendationCandidate } from '../domain/models';
import { positionBoard } from '../strategy/positioning';
import { targetGap, emptyCurrentGame } from '../strategy/currentGame';
import { classifyObservedStyle } from '../strategy/observedStyle';
import { IntelligenceHover } from '../components/IntelligenceHover';
import { CurrentGameEditor } from './SmartCompanion';
import { fusedForPlan, relatedExternal, externalTrend } from '../strategy/evidenceFusion';
import { opportunitySignals } from '../strategy/opportunities';
import { externalStatus } from '../providers/externalMeta';
export function GameCompanion({
  plan,
  state,
  candidate,
  lobby,
  onCurrentGame,
}: {
  plan: Playbook;
  state: ApplicationState;
  candidate: RecommendationCandidate;
  lobby?: LobbyPressure;
  onCurrentGame: (g: CurrentGameState) => void;
}) {
  const game = state.activeSession?.manualState.currentGame ?? state.currentGame;
  const [scenario, setScenario] = useState<CurrentGameState | null>(null);
  const [contest, setContest] = useState(false);
  const now = new Date().toISOString();
  const live = useMemo(() => rescoreRecommendations(state, lobby, now), [state, lobby, now]);
  const current =
    live.plans.find((p) => p.candidate.playbook.id === plan.id)?.candidate ?? candidate;
  const simulated = useMemo(
    () =>
      scenario
        ? rescoreRecommendations(
            {
              ...state,
              currentGame: scenario,
              activeSession: state.activeSession
                ? {
                    ...state.activeSession,
                    manualState: { ...state.activeSession.manualState, currentGame: scenario },
                  }
                : null,
            },
            lobby,
            now,
            contest ? plan.family.core : undefined,
          )
        : null,
    [state, scenario, contest, lobby, now, plan.family.core],
  );
  const scenarioBoards = useMemo(
    () =>
      scenario
        ? optimizeBoards({
            data: state.data,
            plan,
            game: scenario,
            intelligence: state.meta?.intelligence,
            lobby,
            external: state.external,
            targetLevel: scenario.level,
          })
        : [],
    [scenario, state.data, state.meta?.intelligence, state.external, plan, lobby],
  );
  const positioning = positionBoard(
      plan,
      state.data,
      externalStatus(state.external, state.data, now).startsWith('Compatible') &&
        relatedExternal(plan, state.external)?.relation === 'strong'
        ? {
            comp: relatedExternal(plan, state.external)!.comp,
            source: `MetaTFT · ${state.external!.manifest.retrievedAt} · ${state.external!.manifest.scope.rank} · ${state.external!.manifest.scope.window}`,
          }
        : undefined,
    ),
    gap = targetGap(plan, game),
    style = classifyObservedStyle(plan, state.data);
  const fused = fusedForPlan(plan, state.external, state.data, now),
    external = relatedExternal(plan, state.external);
  const trend =
    external && state.external
      ? (state.externalHistory ?? [])
          .slice()
          .reverse()
          .map((old) => externalTrend(old, state.external!, external.comp.id))
          .find(Boolean)
      : null;
  const usable =
    externalStatus(state.external, state.data, now).startsWith('Compatible') ||
    externalStatus(state.external, state.data, now).startsWith('Stale');
  const name = (id: string) =>
    [...state.data.champions, ...state.data.items].find((e) => e.id === id)?.name ?? id;
  const hover = (id: string) => (
    <IntelligenceHover
      key={id}
      id={id}
      data={state.data}
      plan={plan}
      assets={state.assets}
      external={usable ? state.external : null}
    />
  );
  const holders =
    plan.observed?.items
      .filter((i) => i.estimate.sample >= 5 && i.ids.length >= 2)
      .sort((a, b) => b.ids.length - a.ids.length || b.estimate.sample - a.estimate.sample)
      .filter((p, index, all) => all.findIndex((q) => q.holder === p.holder) === index)
      .slice(0, 3) ?? [];
  return (
    <section className="game-companion" aria-label="Game companion">
      <div className="companion-metrics">
        <strong>Fit {Math.round(current.score)}</strong>
        <span>
          {usable && external?.relation === 'strong' && external.comp.style
            ? external.comp.style
            : style.label}{' '}
          · Target Lv{plan.target.targetLevel}
        </span>
        <span>{current.confidence.level} confidence</span>
        <span>
          {current.contest.state === 'Unavailable'
            ? 'Contest not known'
            : `Contest: ${current.contest.state}`}
        </span>
        <AdoptionMetric plan={plan} state={state} />
        <span title={fused.sources.join('\n')}>
          {' '}
          {fused.externalWeight > 0
            ? `Fused avg ${fused.average?.toFixed(2)} · Top 4 ${fused.top4 === null ? '—' : Math.round(fused.top4 * 100) + '%'}`
            : 'External outcomes unavailable'}
        </span>
      </div>
      <div className="companion-grid">
        <section className="panel companion-board">
          <div className="panel-heading">
            <h2>Target board</h2>
            <small>{positioning.confidence} confidence</small>
          </div>
          <div className="companion-hexboard" aria-label="TFT hex board">
            {[0, 1, 2, 3].map((row) => (
              <div className={`hex-row row-${row}`} key={row}>
                {[0, 1, 2, 3, 4, 5, 6].map((column) => {
                  const p = positioning.positions.find((p) => p.row === row && p.column === column);
                  return (
                    <div
                      className="companion-hex"
                      key={column}
                      aria-label={`Row ${row + 1}, column ${column + 1}${p ? `: ${name(p.championId)}` : ''}`}
                    >
                      {p ? hover(p.championId) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <small title={positioning.reasons.join('\n')}>{positioning.label}</small>
          <div className="companion-roster">
            <b>{plan.family.core.length ? 'CORE' : 'Core roles not established'}</b>
            {plan.family.core.map(hover)}
          </div>
          <div className="companion-roster">
            <b>{plan.family.core.length ? 'FLEX' : 'REFERENCE ROSTER'}</b>
            {plan.target.units
              .filter((u) => !plan.family.core.includes(u.championId))
              .map((u) => hover(u.championId))}
          </div>
        </section>
        <section className="panel companion-decisions">
          <span className="section-kicker">NEXT DECISION</span>
          <h2>
            {!plan.family.core.length
              ? 'Review owned units against the reference roster'
              : gap.missingCore.length
                ? `Look for ${gap.missingCore.slice(0, 3).map(name).join(' / ')}`
                : 'Core owned · review upgrades and flex'}
          </h2>
          <p>
            {gap.levelGap == null
              ? 'Current level unknown. '
              : gap.levelGap
                ? `Requires Lv ${plan.target.targetLevel} transition. `
                : ''}
            {plan.strategy.rollPlan.value?.[0]?.label ?? 'Exact roll timing not established.'}
          </p>
          <h3>Carries & item packages</h3>
          {holders.length ? (
            holders.map((p, i) => (
              <div className="companion-holder" key={i}>
                {hover(p.holder)}
                <span>{p.ids.map(hover)}</span>
                <small>
                  {p.estimate.sample} direct observed boards ·{' '}
                  {p.estimate.eligible ? 'supported association' : 'limited sample'}
                </small>
              </div>
            ))
          ) : (
            <>
              <div>
                {plan.roles
                  .filter((r) => r.role === 'carry' || r.role === 'tank')
                  .map((r) => hover(r.championId))}
              </div>
              <p className="fine-print">
                Supported complete item packages unavailable. Consult sourced item guidance in
                Details.
              </p>
            </>
          )}
          <h3>Why this route</h3>
          <p className="fine-print">
            {current.components
              .filter((c) => c.key.startsWith('context') && c.contribution !== 0)
              .map((c) => c.label)
              .join(' · ') || current.reasons[0]}
          </p>
          {opportunitySignals(fused, current.contest.value, trend?.adoption ?? null).map(
            (signal) => (
              <p key={signal}>
                {signal} · confidence {Math.round(fused.confidence * 100)}%
              </p>
            ),
          )}
          <button
            className="secondary"
            onClick={() => {
              setScenario(structuredClone(game ?? emptyCurrentGame(state.data.version.set, now)));
              setContest(false);
            }}
          >
            What If
          </button>
        </section>
        <CurrentGameEditor data={state.data} value={game} onChange={onCurrentGame} compact />
        <section className="panel">
          <h2>Alternative routes</h2>
          {live.plans
            .filter((p) => p.candidate.playbook.id !== plan.id)
            .map((p) => (
              <p key={p.candidate.playbook.id}>
                {p.candidate.playbook.title} · Fit {Math.round(p.candidate.score)} ·{' '}
                {p.candidate.contest.state} contest
              </p>
            ))}
          <details>
            <summary>Evidence & method</summary>
            <AdoptionMetric plan={plan} state={state} details />
            <p>{fused.sources.join(' · ')}</p>
            <p>
              {usable && external
                ? `Related public structure: ${external.comp.name} · ${external.relation}. Snapshot ${state.external?.manifest.retrievedAt}`
                : externalStatus(state.external, state.data)}
            </p>
            <p>{positioning.reasons.join(' ')}</p>
          </details>
        </section>
      </div>
      {scenario && (
        <section className="panel what-if" aria-label="What If simulator">
          <div className="panel-heading">
            <h2>What If · temporary scenario</h2>
            <button onClick={() => setScenario(null)}>Discard scenario</button>
          </div>
          <p>
            Changes below affect this comparison only. Fit is a model score, not expected placement.
          </p>
          <CurrentGameEditor data={state.data} value={scenario} onChange={setScenario} compact />
          <label>
            <input
              type="checkbox"
              checked={contest}
              onChange={(e) => setContest(e.target.checked)}
            />
            Simulate heavy core contest
          </label>
          <details>
            <summary>Legal boards at scenario level {scenario.level}</summary>
            {scenarioBoards.length ? (
              scenarioBoards.map((b) => (
                <p key={b.label}>
                  {b.label} · {b.evidence} ·{' '}
                  {b.board.units.map((u) => name(u.championId)).join(' / ')}
                </p>
              ))
            ) : (
              <p>The selected core does not fit this level or no legal candidate is supported.</p>
            )}
          </details>
          <div className="what-if-results">
            {simulated?.plans.map(({ candidate: c }) => {
              const before = live.plans.find(
                (p) => p.candidate.playbook.id === c.playbook.id,
              )?.candidate;
              return (
                <div key={c.playbook.id}>
                  <strong>
                    {c.playbook.title} · {c.score}{' '}
                    {before
                      ? `(${c.score - before.score >= 0 ? '+' : ''}${(c.score - before.score).toFixed(1)})`
                      : '(enters portfolio)'}
                  </strong>
                  <p>
                    {before
                      ? c.components
                          .flatMap((component) => {
                            const b = before.components.find((b) => b.key === component.key);
                            const delta = component.contribution - (b?.contribution ?? 0);
                            return Math.abs(delta) > 0.001
                              ? [`${component.label}: ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`]
                              : [];
                          })
                          .join(' · ')
                      : c.reasons[0]}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
