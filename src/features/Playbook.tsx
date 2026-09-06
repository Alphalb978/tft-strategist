import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Copy,
  GitBranch,
  Radio,
  ShieldQuestion,
  Swords,
  WandSparkles,
} from 'lucide-react';
import type { Playbook as PlaybookModel, RecommendationCandidate } from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Portrait, Art } from '../components/Art';
import { boardTraitCounts, validatePlaybook } from '../rules/validation';
import { usedBoardSlots } from '../rules/ruleSet';
export function Playbook({
  plan,
  candidate,
  state,
  onBack,
  onLock,
  onOpen,
}: {
  plan: PlaybookModel;
  candidate: RecommendationCandidate;
  state: ApplicationState;
  onBack: () => void;
  onLock: () => void;
  onOpen: (id: string) => void;
}) {
  const [stage, setStage] = useState('final');
  const { data, assets } = state;
  const selectedStage = plan.stages.find((s) => s.stage === stage)!;
  const board = selectedStage.board.value;
  const locked = state.selection?.playbookId === plan.id;
  const eligible = state.portfolio.plans.some((p) => p.candidate.playbook.id === plan.id);
  const warnings = validatePlaybook(plan, data);
  const itemName = (id: string) => data.items.find((i) => i.id === id)?.name ?? id;
  const measured = state.meta?.familyStats.find((stat) => stat.familyId === plan.family.id);
  const discovered = plan.discovery
    ? state.discovery?.clusters.find((cluster) => cluster.id === plan.discovery?.clusterId)
    : undefined;
  const championName = (id: string) => data.champions.find((unit) => unit.id === id)?.name ?? id;
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to plans
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            {plan.features.style.toUpperCase()} <span> / </span>{' '}
            {discovered ? 'DISCOVERED STRUCTURE' : 'SOURCE PLAYBOOK'}
          </div>
          <h1>{plan.title}</h1>
          <p>
            {plan.subtitle}{' '}
            <span className="inline-badge">
              {plan.evidence} · {candidate.confidence.level} confidence
            </span>
          </p>
        </div>
        <div className="detail-actions">
          <button className="secondary" disabled title={plan.planner.reason}>
            <Copy size={16} /> Copy Team Code <span>Unverified</span>
          </button>
          <button
            className="primary"
            onClick={onLock}
            disabled={locked || !eligible || Boolean(state.selection)}
            title={
              !eligible ? 'Only a plan in your three-plan portfolio can be locked.' : undefined
            }
          >
            <span>{locked ? <Check size={16} /> : <Bookmark size={16} />}</span>
            {locked ? 'Plan locked' : !eligible ? 'Library preview' : 'Lock this plan'}
          </button>
        </div>
      </div>
      <div className="quick-strip">
        <div>
          <span>LOOK FOR</span>
          <strong>
            {plan.family.core.length
              ? plan.family.core
                  .slice(0, 2)
                  .map((id) => data.champions.find((c) => c.id === id)?.name)
                  .join(' + ')
              : 'Representative board'}
          </strong>
        </div>
        <div>
          <span>COMPONENTS</span>
          <strong>{plan.components.map(itemName).join(' · ')}</strong>
        </div>
        <div>
          <span>AUGMENT SIGNAL</span>
          <strong>{plan.augments[0]?.category ?? 'Unverified'}</strong>
        </div>
        <div>
          <span>ROUTE</span>
          <strong>{plan.features.style}</strong>
        </div>
      </div>
      <section className="panel board-panel">
        <div className="board-header">
          <h2>Build toward this board</h2>
          <span>
            {board
              ? `${usedBoardSlots(board)} / ${board.capacity} audited slots`
              : 'Board unavailable'}
          </span>
        </div>
        <div className="stage-tabs" role="tablist" aria-label="Stage progression">
          {plan.stages.map((s) => (
            <button
              key={s.stage}
              role="tab"
              aria-selected={stage === s.stage}
              onClick={() => setStage(s.stage)}
              className={s.stage === stage ? 'active' : ''}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="board-roster" role="tabpanel">
          {board ? (
            board.units.map((u, i) => (
              <Portrait
                key={`${u.championId}-${i}`}
                champion={data.champions.find((c) => c.id === u.championId)!}
                assets={assets}
                role={plan.roles.find((r) => r.championId === u.championId)?.role ?? u.slot}
              />
            ))
          ) : (
            <div className="unavailable-board">
              <ShieldQuestion size={25} />
              <strong>Stabilization board unverified</strong>
              <span>{selectedStage.board.note}</span>
            </div>
          )}
        </div>
        {board && (
          <div className="trait-strip" aria-label="Source trait membership counts">
            {boardTraitCounts(board, data)
              .filter(({ activeBreakpoint }) => activeBreakpoint !== null)
              .slice(0, 7)
              .map(({ trait, count, activeBreakpoint }) => (
                <span key={trait.id} title={`Active breakpoint: ${activeBreakpoint}`}>
                  <b>{count}</b>
                  {trait.name}
                </span>
              ))}
            <small>Active thresholds · audited unique-unit counting</small>
          </div>
        )}
        <div className="board-foot">
          <span>
            <i className="core-dot" />{' '}
            {discovered
              ? 'Core slots reflect ≥80% cluster prevalence'
              : 'Core roles are guide-curated'}
          </span>
          <span>Roster layout · positioning unverified</span>
        </div>
        <p className="stage-note">
          {selectedStage.instruction.value ?? selectedStage.instruction.note}
        </p>
      </section>
      {discovered && (
        <section className="panel discovery-detail" aria-label="Discovery evidence detail">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Discovery evidence</h2>
            <span className="badge">Discovered · {discovered.lifecycle}</span>
          </div>
          <div className="discovery-evidence-grid">
            <div>
              <strong>{discovered.stats.games}</strong>
              <span>boards</span>
            </div>
            <div>
              <strong>{discovered.stats.effectiveSample.toFixed(1)}</strong>
              <span>effective sample</span>
            </div>
            <div>
              <strong>{Math.round(discovered.stats.cohesion * 100)}%</strong>
              <span>cohesion</span>
            </div>
            <div>
              <strong>{Math.round(discovered.relation.certainty * 100)}%</strong>
              <span>relation certainty</span>
            </div>
          </div>
          <p>
            {discovered.relation.state === 'variant-candidate'
              ? `Closest curated anchor: ${discovered.relation.familyId} · structural distance ${discovered.relation.diff?.structuralDistance.toFixed(2)}.`
              : `Relation: ${discovered.relation.state} · nearest-anchor similarity ${discovered.relation.similarity.toFixed(2)}.`}
          </p>
          <div className="prevalence-list">
            {discovered.unitPrevalence.map((unit) => (
              <span key={unit.championId}>
                <b>{Math.round(unit.prevalence * 100)}%</b> {championName(unit.championId)}
              </span>
            ))}
          </div>
          {discovered.relation.diff && (
            <p className="fine-print">
              Shared core:{' '}
              {discovered.relation.diff.sharedCore.map(championName).join(', ') || 'none'}
              <br />
              Repeated additions:{' '}
              {discovered.relation.diff.consistentlyAdded.map(championName).join(', ') || 'none'}
              <br />
              Repeated omissions:{' '}
              {discovered.relation.diff.consistentlyOmitted.map(championName).join(', ') || 'none'}
            </p>
          )}
          <p className="fine-print">
            {discovered.recommendationEligible
              ? 'Every configured legality, support, freshness, cohesion, relation, and outcome gate cleared.'
              : `Not recommendation-eligible: ${discovered.recommendationGateReasons.join('; ') || 'lifecycle state is inspection-only'}.`}
            <br />
            Recent adoption:{' '}
            {discovered.stats.adoption.mature
              ? `${discovered.stats.adoption.delta >= 0 ? '+' : ''}${Math.round(discovered.stats.adoption.delta * 100)} percentage points`
              : 'insufficient window support'}
            . Patch relevance unavailable.
          </p>
        </section>
      )}
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <Swords size={18} />
            <h2>Item direction</h2>
            <span className="badge">{discovered ? 'Unavailable' : 'Guide-curated'}</span>
          </div>
          <div className="item-plans">
            {plan.items.map((itemPlan) => (
              <div className="holder-row" key={itemPlan.holder}>
                <Portrait
                  champion={data.champions.find((c) => c.id === itemPlan.holder)!}
                  assets={assets}
                  compact
                />
                <div>
                  <strong>{data.champions.find((c) => c.id === itemPlan.holder)?.name}</strong>
                  <div className="item-list">
                    {itemPlan.priorities.map((id) => {
                      const item = data.items.find((i) => i.id === id)!;
                      return (
                        <span key={id} title={item.name}>
                          <Art url={item.icon} alt={item.name} assets={assets} />
                          <span>{item.name}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            {!plan.items.length && (
              <p className="fine-print">
                {discovered
                  ? 'Final-board clustering does not establish item holders or priorities.'
                  : 'Source-backed item roles unavailable.'}
              </p>
            )}
          </div>
          <p className="fine-print">
            {discovered
              ? 'No item direction is inferred from structural discovery.'
              : 'Suggested items from the source guide. Alternatives and temporary holders are unverified.'}
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <WandSparkles size={18} />
            <h2>Augment branches</h2>
          </div>
          {plan.augments.map((a) => (
            <div className="augment-branch" key={a.category}>
              <span className="branch-icon">◇</span>
              <div>
                <strong>{a.category}</strong>
                <p>{a.change.value ?? a.change.note}</p>
              </div>
            </div>
          ))}
          {!plan.augments.length && (
            <p className="fine-print">
              {discovered
                ? 'No augment branch is inferred from structural discovery.'
                : 'No specific augment branch was imported from this source.'}
            </p>
          )}
          <div className="signal-list">
            <span>WHEN TO CONSIDER</span>
            {plan.playSignals.value?.map((s) => (
              <p key={s}>
                <Check size={13} />
                {s}
              </p>
            ))}
          </div>
          <p className="fine-print">
            Specific augment rankings and avoid thresholds are unavailable. Live augment enablement
            is unverified.
          </p>
        </section>
        <section className="panel decision-panel">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Decision Map</h2>
            <span className="badge muted">{discovered ? 'Unavailable' : 'Static guide'}</span>
          </div>
          <div className="decision-map">
            <div className="decision-start">{plan.decisionMap.nodes[0]?.label}</div>
            <div className="decision-paths">
              {plan.decisionMap.edges.map((e) => (
                <div key={e.to}>
                  <span>{e.condition}</span>
                  <span className="path-line">↓</span>
                  <div>{plan.decisionMap.nodes.find((n) => n.id === e.to)?.label}</div>
                </div>
              ))}
            </div>
          </div>
          {discovered && (
            <p className="fine-print">No Decision Map is inferred from final boards.</p>
          )}
          <p className="fine-print">
            {discovered
              ? 'A future curated playbook may add verified transitions without changing the observed structure.'
              : 'Guide signal → route. Reassess is a navigation prompt; no live board or economy is read.'}
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Variants & pivots</h2>
          </div>
          <div className="variant-line">
            <span>{discovered ? 'Observed representative' : 'Source board'}</span>
            <span className="badge">
              {plan.target.capacity} units · {discovered?.lifecycle ?? 'Experimental'}
            </span>
          </div>
          <p className="fine-print">{plan.replacements.note}</p>
          <div className="pivot-list">
            {state.portfolio.plans
              .filter((p) => p.candidate.playbook.id !== plan.id)
              .map(({ candidate: c }) => (
                <button key={c.playbook.id} onClick={() => onOpen(c.playbook.id)}>
                  <div>
                    <strong>{c.playbook.title}</strong>
                    <small>Alternative plan · pivot conditions unverified</small>
                  </div>
                  <ArrowRight size={16} />
                </button>
              ))}
          </div>
        </section>
      </div>
      <section className="panel why-panel">
        <div className="panel-heading">
          <ShieldQuestion size={18} />
          <h2>Why this plan?</h2>
          <span className="badge muted">
            {Math.round(candidate.score)} / 100 ·{' '}
            {discovered?.recommendationEligible || measured?.quality === 'eligible'
              ? 'measured calibrated'
              : 'neutral meta fallback'}
          </span>
        </div>
        <div className="meta-evidence-detail">
          <strong>Aggregate meta evidence</strong>
          {discovered ? (
            <span>
              {discovered.stats.games} clustered boards ·{' '}
              {discovered.stats.averagePlacement.toFixed(2)} avg ·{' '}
              {Math.round(discovered.stats.topFour.shrunk * 100)}% top 4 ·{' '}
              {Math.round(discovered.stats.wins.shrunk * 100)}% win ·{' '}
              {Math.round(discovered.stats.confidence * 100)}% confidence
            </span>
          ) : measured ? (
            <span>
              {measured.games} classified games · {measured.shrunkAveragePlacement.toFixed(2)}
              {' avg · '}
              {Math.round(measured.topFour.shrunk * 100)}% top 4 ·{' '}
              {Math.round(measured.wins.shrunk * 100)}% win ·{' '}
              {Math.round(measured.confidence * 100)}% confidence
            </span>
          ) : (
            <span>Unavailable · recommendation outcome inputs fall back to neutral.</span>
          )}
          <small>
            {discovered
              ? `${state.discovery?.sourceType === 'fixture' ? 'Fixture' : 'Riot'} aggregate discovery · patch relevance unavailable`
              : state.meta
                ? `${state.meta.platform} ${state.meta.rankCohort.join(' + ')} · Riot aggregate · patch relevance unavailable`
                : 'No compatible stored aggregate dataset. Curated board metadata is not outcome evidence.'}
          </small>
        </div>
        <div className="why-grid">
          <div className="score-breakdown">
            {candidate.components.map((c) => (
              <div key={c.key}>
                <span>{c.label}</span>
                <div className="bar-track">
                  <i style={{ width: `${Math.abs(c.input ?? 0)}%` }} />
                </div>
                <strong>
                  {c.contribution >= 0 ? '+' : ''}
                  {c.contribution.toFixed(1)}
                </strong>
                <small>{c.status}</small>
              </div>
            ))}
          </div>
          <div className="confidence-breakdown">
            <h3>{candidate.confidence.level} confidence</h3>
            <p>Evidence quality is assessed separately from recommendation score.</p>
            {candidate.confidence.drivers.map((d) => (
              <div key={d.label}>
                <span>{d.factor < 0.5 ? '○' : '◐'}</span>
                {d.label}
              </div>
            ))}
            <p className="fine-print">
              Personal history contributes no adjustment until relevant games exist.
            </p>
          </div>
        </div>
        <div className="contest-explanation">
          <div>
            <Radio size={15} />
            <strong>Lobby / contest fit</strong>
            <span className="badge muted">
              {candidate.contest.lobbyFit === null
                ? 'Unavailable · neutral'
                : `${Math.round(candidate.contest.lobbyFit)} / 100 · ${candidate.contest.state}`}
            </span>
          </div>
          <p>{candidate.contest.note}</p>
          {candidate.contest.pressuredUnits.length > 0 && (
            <div className="contest-unit-list">
              {candidate.contest.pressuredUnits.slice(0, 3).map((unit) => (
                <div key={unit.championId}>
                  <strong>
                    {data.champions.find((champion) => champion.id === unit.championId)?.name ??
                      unit.championId}
                  </strong>
                  <span>{Math.round(unit.criticality * 100)}% seeded criticality</span>
                  <span>
                    {unit.equivalentHistoricalUsers.toFixed(1)} equivalent historical users
                  </span>
                  <span>+{(unit.contribution * 100).toFixed(1)} raw penalty contribution</span>
                </div>
              ))}
            </div>
          )}
          <small>
            {Math.round(candidate.contest.evidenceCoverage * 100)}% seven-player evidence coverage ·
            {Math.round(candidate.contest.contestElasticity * 100)}% seeded contest elasticity ·
            {candidate.contest.styleFactor.toFixed(2)}× curated roll-style factor · historical
            signal, not a future-choice probability
          </small>
        </div>
      </section>
      <details className="source-details">
        <summary>Provenance & validation limits</summary>
        <p>{plan.provenance.note}</p>
        {plan.provenance.source.startsWith('http') && (
          <a href={plan.provenance.source} target="_blank" rel="noreferrer">
            Read original public guide ↗
          </a>
        )}
        <p>
          {discovered
            ? `${discovered.stats.games} aggregate clustered observations · generated ${new Date(plan.provenance.fetchedAt).toLocaleString()}. Lifecycle remains evidence-gated.`
            : `Reviewed September 6, 2026 · patch 18.1 · ${measured ? `${measured.games} classified observations.` : 'no measured sample.'} “Experimental” reflects this app’s limited outcome evidence.`}
        </p>
        {warnings.map((w, i) => (
          <p key={`${w.code}-${i}`}>{w.message}</p>
        ))}
        <p>Team Planner: {plan.planner.reason}</p>
      </details>
    </>
  );
}
