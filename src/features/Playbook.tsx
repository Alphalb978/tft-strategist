import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Copy,
  GitBranch,
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
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to plans
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            {plan.features.style.toUpperCase()} <span> / </span> SOURCE PLAYBOOK
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
            {plan.family.core
              .slice(0, 2)
              .map((id) => data.champions.find((c) => c.id === id)?.name)
              .join(' + ')}
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
            <i className="core-dot" /> Core roles are guide-curated
          </span>
          <span>Roster layout · positioning unverified</span>
        </div>
        <p className="stage-note">
          {selectedStage.instruction.value ?? selectedStage.instruction.note}
        </p>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <Swords size={18} />
            <h2>Item direction</h2>
            <span className="badge">Guide-curated</span>
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
          </div>
          <p className="fine-print">
            Suggested items from the source guide. Alternatives and temporary holders are
            unverified.
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
            <span className="badge muted">Static guide</span>
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
          <p className="fine-print">
            Guide signal → route. Reassess is a navigation prompt; no live board or economy is read.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Variants & pivots</h2>
          </div>
          <div className="variant-line">
            <span>Source board</span>
            <span className="badge">{plan.target.capacity} units · Experimental</span>
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
          <span className="badge muted">{Math.round(candidate.score)} / 100 · seeded score</span>
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
      </section>
      <details className="source-details">
        <summary>Provenance & validation limits</summary>
        <p>{plan.provenance.note}</p>
        <a href={plan.provenance.source} target="_blank" rel="noreferrer">
          Read original public guide ↗
        </a>
        <p>
          Reviewed September 6, 2026 · patch 18.1 · no measured sample. “Experimental” reflects this
          app’s limited evidence.
        </p>
        {warnings.map((w, i) => (
          <p key={`${w.code}-${i}`}>{w.message}</p>
        ))}
        <p>Team Planner: {plan.planner.reason}</p>
      </details>
    </>
  );
}
