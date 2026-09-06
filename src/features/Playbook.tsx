import { useState } from 'react';
import { CurrentGameEditor } from './SmartCompanion';
import { ObservedIntelligence } from './ObservedIntelligence';
import { SmartCompBuilder } from './SmartCompBuilder';
import { classifyObservedStyle } from '../strategy/observedStyle';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Copy,
  GitBranch,
  Radio,
  RotateCcw,
  ShieldQuestion,
  Square,
  Swords,
  WandSparkles,
} from 'lucide-react';
import type {
  Playbook as PlaybookModel,
  PlanSession,
  PlanSessionManualState,
  RecommendationCandidate,
  StrategyFactStatus,
  StrategyStageUnit,
} from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { candidatePlannerCode, teamPlanner } from '../rules/teamPlanner';
import { boardTraitCounts, validatePlaybook } from '../rules/validation';
import { usedBoardSlots } from '../rules/ruleSet';
import {
  buildPivotGraph,
  buildQuickStrip,
  traverseDecisionMap,
} from '../strategy/playbookIntelligence';

const statusLabel = (status: StrategyFactStatus) =>
  ({
    sourced: 'Sourced',
    derived: 'Derived',
    inherited: 'Inherited',
    unavailable: 'Unavailable',
    stale: 'Stale',
  })[status];

function FactBadge({ status }: { status: StrategyFactStatus }) {
  return <span className={`fact-badge status-${status}`}>{statusLabel(status)}</span>;
}

function BoardPortrait({
  championId,
  plan,
  state,
  slot,
  role,
}: {
  championId: string;
  plan: PlaybookModel;
  state: ApplicationState;
  slot: 'core' | 'flex' | 'temporary';
  role?: string;
}) {
  const champion = state.data.champions.find((unit) => unit.id === championId);
  if (!champion) return null;
  return (
    <Portrait
      champion={champion}
      assets={state.assets}
      compact
      role={role ?? plan.roles.find((item) => item.championId === championId)?.role ?? slot}
    />
  );
}

function TftBoard({ plan, state }: { plan: PlaybookModel; state: ApplicationState }) {
  const exact =
    plan.strategy.positioning.precision === 'exact'
      ? (plan.strategy.positioning.exact.value ?? [])
      : [];
  const byHex = new Map(exact.map((position) => [`${position.row}:${position.column}`, position]));
  const assigned = new Set(exact.map((position) => position.championId));
  const unplaced = plan.target.units.filter((unit) => !assigned.has(unit.championId));
  return (
    <div className="tft-board-wrap">
      {exact.length > 0 && (
        <div className="tft-board" aria-label="TFT board visualization">
          {Array.from({ length: 4 }, (_, row) => (
            <div className={`hex-row row-${row}`} key={row}>
              {Array.from({ length: 7 }, (_, column) => {
                const position = byHex.get(`${row}:${column}`);
                const unit = position
                  ? plan.target.units.find((entry) => entry.championId === position.championId)
                  : undefined;
                const name = unit
                  ? state.data.champions.find((champion) => champion.id === unit.championId)?.name
                  : null;
                return (
                  <div
                    className={`tft-hex ${unit ? `slot-${unit.slot}` : ''}`}
                    key={`${row}-${column}`}
                    aria-label={
                      unit
                        ? `${name} at row ${row + 1}, column ${column + 1}`
                        : `Empty hex row ${row + 1}, column ${column + 1}`
                    }
                  >
                    {unit && (
                      <BoardPortrait
                        championId={unit.championId}
                        plan={plan}
                        state={state}
                        slot={unit.slot}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {!exact.length && (
            <div className="positioning-watermark">
              <ShieldQuestion size={20} />
              <strong>Positioning not verified</strong>
              <span>No exact hexes assigned</span>
            </div>
          )}
        </div>
      )}
      {unplaced.length > 0 && (
        <div className="unplaced-roster" aria-label="Unpositioned target roster">
          {unplaced.map((unit) => (
            <div key={unit.championId} className={`unplaced-unit slot-${unit.slot}`}>
              <BoardPortrait
                championId={unit.championId}
                plan={plan}
                state={state}
                slot={unit.slot}
              />
              <span>
                {state.data.champions.find((champion) => champion.id === unit.championId)?.name}
              </span>
              <small>{unit.slot}</small>
            </div>
          ))}
        </div>
      )}
      {!exact.length && (
        <div className="positioning-note">
          <ShieldQuestion size={14} />
          Positioning not verified
        </div>
      )}
    </div>
  );
}

function StageRoster({
  roster,
  plan,
  state,
}: {
  roster: StrategyStageUnit[];
  plan: PlaybookModel;
  state: ApplicationState;
}) {
  return (
    <div className="stage-roster">
      {roster.map((unit, index) => (
        <div className={`stage-unit slot-${unit.slot}`} key={`${unit.championId}-${index}`}>
          <BoardPortrait
            championId={unit.championId}
            plan={plan}
            state={state}
            slot={unit.slot}
            role={unit.role === 'none' ? unit.slot : unit.role}
          />
          <span>
            {state.data.champions.find((champion) => champion.id === unit.championId)?.name}
          </span>
        </div>
      ))}
    </div>
  );
}

function Unavailable({ title, note }: { title: string; note: string }) {
  return (
    <div className="strategy-unavailable compact-unavailable">
      <ShieldQuestion size={18} />
      <strong>{title}</strong>
      <span>{note}</span>
    </div>
  );
}

export function Playbook({
  plan,
  candidate,
  state,
  onBack,
  onLock,
  onEnd,
  onManualState,
  onOpen,
  session,
  snapshotContext,
  activeMode,
  lobby,
  onCurrentGame,
}: {
  plan: PlaybookModel;
  candidate: RecommendationCandidate;
  state: ApplicationState;
  onBack: () => void;
  onLock: () => void;
  onEnd: () => void;
  onManualState: (
    change: Partial<
      Pick<
        PlanSessionManualState,
        'stageId' | 'decisionNodeId' | 'decisionPathEdgeIds' | 'pivotTargetId' | 'currentGame'
      >
    >,
  ) => void;
  onOpen: (id: string) => void;
  session: PlanSession | null;
  snapshotContext: boolean;
  activeMode: boolean;
  lobby?: import('../domain/models').LobbyPressure;
  onCurrentGame: (game: import('../domain/intelligence').CurrentGameState) => void;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const observedPlan =
    snapshotContext && session?.compatibility.state === 'stale'
      ? plan
      : (state.playbooks.find((p) => p.id === plan.id) ?? plan);
  const game = session?.manualState.currentGame ?? state.currentGame;
  const observedStyle = classifyObservedStyle(observedPlan, state.data);
  const isActivePlan = session?.selectedPlaybookId === plan.id;
  const [confirmation, setConfirmation] = useState<'end' | 'switch' | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [stageId, setStageId] = useState(
    (isActivePlan ? session.manualState.stageId : null) ?? plan.strategy.stages.at(-1)?.id ?? '',
  );
  const [decisionNodeId, setDecisionNodeId] = useState(
    (isActivePlan ? session.manualState.decisionNodeId : null) ??
      plan.strategy.decisionMap.rootNodeId ??
      '',
  );
  const [decisionPath, setDecisionPath] = useState<string[]>(
    isActivePlan ? session.manualState.decisionPathEdgeIds : [],
  );
  const { data, assets } = state;
  const plannerCandidate = candidatePlannerCode(plan.target, data);
  const [augmentSearch, setAugmentSearch] = useState('');
  const plannerSupport = teamPlanner.supportStatus(data.version);
  const canCopy =
    plannerSupport.state === 'supported' &&
    plannerCandidate.ok &&
    !(snapshotContext && session?.compatibility.state === 'stale');
  const stage = plan.strategy.stages.find((item) => item.id === stageId) ?? plan.strategy.stages[0];
  const locked = isActivePlan;
  const eligible = state.portfolio.plans.some((item) => item.candidate.playbook.id === plan.id);
  const warnings = validatePlaybook(plan, data);
  const itemName = (id: string) => data.items.find((item) => item.id === id)?.name ?? id;
  const championName = (id: string) => data.champions.find((unit) => unit.id === id)?.name ?? id;
  const measured =
    session && snapshotContext
      ? session.snapshot.evidence.metaFamilyStats.find((stat) => stat.familyId === plan.family.id)
      : state.meta?.familyStats.find((stat) => stat.familyId === plan.family.id);
  const discovered = plan.discovery
    ? session && snapshotContext
      ? session.snapshot.evidence.discoveryClusters.find(
          (cluster) => cluster.id === plan.discovery?.clusterId,
        )
      : state.discovery?.clusters.find((cluster) => cluster.id === plan.discovery?.clusterId)
    : undefined;
  const quickStrip = buildQuickStrip(plan, state.portfolio, championName, itemName);
  const pivotGraph = buildPivotGraph(state.portfolio);
  const outgoing = plan.strategy.decisionMap.edges.filter((edge) => edge.from === decisionNodeId);
  const decisionNode = plan.strategy.decisionMap.nodes.find((node) => node.id === decisionNodeId);
  const selectDecisionEdge = (edgeId: string) => {
    const next = traverseDecisionMap(plan.strategy.decisionMap, decisionNodeId, edgeId);
    if (!next) return;
    setDecisionPath((path) => [...path, edgeId]);
    setDecisionNodeId(next.id);
    if (isActivePlan)
      onManualState({
        decisionNodeId: next.id,
        decisionPathEdgeIds: [...decisionPath, edgeId],
      });
  };
  const resetDecision = () => {
    setDecisionPath([]);
    setDecisionNodeId(plan.strategy.decisionMap.rootNodeId ?? '');
    if (isActivePlan)
      onManualState({
        decisionNodeId: plan.strategy.decisionMap.rootNodeId,
        decisionPathEdgeIds: [],
      });
  };
  return (
    <div className={activeMode ? 'playbook-page match-mode' : 'playbook-page'}>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> {activeMode ? 'Back to current plans' : 'Back to plans'}
      </button>
      {activeMode && session && (
        <div className={`active-match-header ${session.compatibility.state}`}>
          <div>
            <span className="section-kicker">ACTIVE MATCH PLAN</span>
            <strong>
              {plan.title} · {stage?.label ?? 'Target roster'}
            </strong>
            <small>
              {session.compatibility.state === 'current'
                ? 'Local snapshot · safe to resume offline'
                : 'Historical snapshot · current data is incompatible'}
            </small>
          </div>
          <button className="end-session" onClick={() => setConfirmation('end')}>
            <Square size={14} /> End session
          </button>
        </div>
      )}
      {session?.compatibility.state === 'stale' && snapshotContext && (
        <div className="stale-session-notice" role="status">
          <ShieldQuestion size={17} />
          <span>
            <strong>Showing the exact historical snapshot.</strong>{' '}
            {session.compatibility.reasons.join(' ')} Team Planner copying stays disabled.
          </span>
        </div>
      )}
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            {observedStyle.kind !== 'unavailable'
              ? observedStyle.label.toUpperCase()
              : plan.features.style.toUpperCase()}{' '}
            <span> / </span> {discovered ? 'DISCOVERED STRUCTURE' : 'SOURCE PLAYBOOK'}
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
          <button className="secondary" onClick={() => setBuilderOpen(true)}>
            Optimize board
          </button>
          <button
            className="secondary"
            disabled={!canCopy}
            title={
              !plannerCandidate.ok
                ? plannerCandidate.error
                : snapshotContext && session?.compatibility.state === 'stale'
                  ? 'Locked data is stale. Open a current playbook to export.'
                  : plannerSupport.reason
            }
            onClick={async () => {
              if (!canCopy || !plannerCandidate.ok) return;
              try {
                await navigator.clipboard.writeText(plannerCandidate.value);
                setCopyMessage('Team code copied. Roster only; positioning not verified.');
              } catch {
                setCopyMessage(
                  'Clipboard unavailable. Select the verified code below to copy manually.',
                );
              }
            }}
          >
            <Copy size={16} /> Copy Team Code <span>{canCopy ? 'Roster' : 'Unavailable'}</span>
          </button>
          <button
            className="primary"
            onClick={() => (session ? setConfirmation('switch') : onLock())}
            disabled={
              locked ||
              !eligible ||
              Boolean(session && snapshotContext && session.compatibility.state === 'stale')
            }
            title={
              !eligible ? 'Only a plan in your three-plan portfolio can be locked.' : undefined
            }
          >
            <span>{locked ? <Check size={16} /> : <Bookmark size={16} />}</span>
            {locked
              ? 'Plan active'
              : !eligible
                ? 'Library preview'
                : session
                  ? 'Switch to this plan'
                  : 'Lock this plan'}
          </button>
        </div>
      </div>

      {activeMode && (
        <div className="match-now">
          <div>
            <span>RIGHT NOW · MANUAL STAGE</span>
            <strong>
              {stage?.instruction.value ?? stage?.instruction.note ?? 'Review the target roster'}
            </strong>
            <br />
            <a href="#stages">Change stage →</a>
          </div>
          <div>
            <span>CURRENT DECISION</span>
            <strong>{decisionNode?.label ?? 'No sourced Decision Map'}</strong>
            <br />
            <a href="#decision-map">Continue Decision Map →</a>
          </div>
        </div>
      )}

      <nav className="playbook-nav" aria-label="Playbook sections">
        {[
          ['strategy-intelligence', 'Intelligence'],
          ['board', 'Board'],
          ['stages', 'Stages'],
          ['items', 'Items'],
          ['augments', 'Augments'],
          ['decision-map', 'Decision Map'],
          ['pivots', 'Pivots'],
        ].map(([target, label]) => (
          <a href={`#${target}`} key={target}>
            {label}
          </a>
        ))}
        <span>
          {plan.strategy.coverage.supported}/{plan.strategy.coverage.total} fields
        </span>
      </nav>
      {builderOpen && (
        <SmartCompBuilder
          plan={observedPlan}
          data={data}
          intelligence={state.meta?.intelligence}
          game={game}
          lobby={lobby}
          assets={state.assets}
          onClose={() => setBuilderOpen(false)}
        />
      )}

      {activeMode && session && (
        <CurrentGameEditor data={state.data} value={game} onChange={onCurrentGame} />
      )}
      <ObservedIntelligence
        assets={state.assets}
        plan={observedPlan}
        data={data}
        intelligence={state.meta?.intelligence}
        game={game}
        plans={state.playbooks}
        onBuild={() => setBuilderOpen(true)}
      />
      <section className="panel target-board-panel" id="board">
        <div className="board-header">
          <div>
            <span className="section-kicker">TARGET BOARD</span>
            <h2>Build toward this board</h2>
          </div>
          <span>
            {usedBoardSlots(plan.target)} / {plan.target.capacity} slots
          </span>
        </div>
        <TftBoard plan={plan} state={state} />
        <div className="trait-strip" aria-label="Source trait membership counts">
          {boardTraitCounts(plan.target, data)
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
        <div className="board-legend">
          <span className="legend-core">Core</span>
          <span className="legend-flex">Flex</span>
          <span className="legend-temporary">Temporary</span>
          <span>{plan.strategy.positioning.note}</span>
        </div>
      </section>

      <div className="quick-strip" aria-label="What am I looking for?">
        {quickStrip.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <FactBadge status={item.status} />
          </div>
        ))}
      </div>

      <section className="panel stage-progression" id="stages">
        <div className="panel-heading">
          <GitBranch size={18} />
          <h2>Stage progression</h2>
          <FactBadge status={plan.strategy.coverage.fields.stageBoards} />
        </div>
        <div className="strategy-stage-tabs" role="tablist" aria-label="Strategy stage progression">
          {plan.strategy.stages.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={stage?.id === item.id}
              className={stage?.id === item.id ? 'active' : ''}
              onClick={() => {
                setStageId(item.id);
                if (isActivePlan) onManualState({ stageId: item.id });
              }}
            >
              <strong>{item.label}</strong>
              <span>
                {item.timing.value ?? 'Timing open'}
                {item.targetLevel.value ? ` · L${item.targetLevel.value}` : ''}
              </span>
            </button>
          ))}
        </div>
        {stage && (
          <div className="stage-detail" role="tabpanel">
            {stage.roster.value?.length ? (
              <StageRoster roster={stage.roster.value} plan={plan} state={state} />
            ) : (
              <Unavailable title="Exact board unavailable" note={stage.roster.note} />
            )}
            <div className="stage-instructions">
              <div>
                <span>DO</span>
                <strong>{stage.instruction.value ?? stage.instruction.note}</strong>
              </div>
              <div>
                <span>STAY WHEN</span>
                <strong>{stage.entryCondition.value ?? 'Unavailable'}</strong>
              </div>
              <div>
                <span>LEAVE WHEN</span>
                <strong>{stage.exitCondition.value ?? 'Unavailable'}</strong>
              </div>
            </div>
          </div>
        )}
        <div className="roll-track" aria-label="Level and roll plan">
          <span className="track-label">LEVEL / ROLL</span>
          {plan.strategy.rollPlan.value?.map((milestone, index) => (
            <div className="roll-milestone" key={milestone.id}>
              <i>{index + 1}</i>
              <div>
                <strong>{milestone.label}</strong>
                <span>
                  {milestone.timing ?? 'Timing unavailable'}
                  {milestone.targetLevel ? ` · Level ${milestone.targetLevel}` : ''}
                </span>
                {(milestone.stayCondition || milestone.leaveCondition) && (
                  <small>
                    {milestone.stayCondition ? `Stay: ${milestone.stayCondition}. ` : ''}
                    {milestone.leaveCondition ? `Leave: ${milestone.leaveCondition}.` : ''}
                  </small>
                )}
              </div>
            </div>
          ))}
          {!plan.strategy.rollPlan.value && <p>{plan.strategy.rollPlan.note}</p>}
        </div>
      </section>

      <div className="detail-grid strategy-detail-grid">
        <section className="panel" id="items">
          <div className="panel-heading">
            <Swords size={18} />
            <h2>Items & holders</h2>
            <FactBadge status={plan.strategy.coverage.fields.items} />
          </div>
          <div className="item-plans">
            {plan.strategy.itemHolders.map((holder) => {
              const champion = data.champions.find((unit) => unit.id === holder.holderId);
              if (!champion) return null;
              return (
                <div className="strategy-holder-row" key={holder.holderId}>
                  <Portrait champion={champion} assets={assets} compact />
                  <div>
                    <div className="holder-title">
                      <strong>{champion.name}</strong>
                      <span>{holder.role}</span>
                      <FactBadge status={holder.fact.status} />
                    </div>
                    {holder.groups.map((group) => (
                      <div className="item-group" key={`${holder.holderId}-${group.kind}`}>
                        <small>{group.kind}</small>
                        <div className="item-list">
                          {group.itemIds.map((id) => {
                            const item = data.items.find((entry) => entry.id === id);
                            return item ? (
                              <span key={id} title={item.name}>
                                <Art url={item.icon} alt={item.name} assets={assets} />
                                <span>{item.name}</span>
                              </span>
                            ) : null;
                          })}
                        </div>
                      </div>
                    ))}
                    {holder.temporaryHolderIds.length > 0 && (
                      <p>Temporary: {holder.temporaryHolderIds.map(championName).join(', ')}</p>
                    )}
                  </div>
                </div>
              );
            })}
            {!plan.strategy.itemHolders.length && (
              <Unavailable
                title="Item guidance unavailable"
                note="Final-board evidence does not establish holders or priorities."
              />
            )}
          </div>
        </section>
        <section className="panel" id="augments">
          <div className="panel-heading">
            <WandSparkles size={18} />
            <h2>Augment branches</h2>
            <FactBadge status={plan.strategy.coverage.fields.augments} />
          </div>
          {plan.strategy.augmentBranches.map((branch) => (
            <div className="augment-branch" key={branch.id}>
              <span className="branch-icon">
                <WandSparkles size={24} />
              </span>
              <div>
                <div className="holder-title">
                  <strong>{branch.category}</strong>
                  <FactBadge status={branch.signal.status} />
                </div>
                <div className="augment-tiles">
                  {branch.augmentIds.map((id) => {
                    const augment = data.augments.find((a) => a.id === id);
                    return augment ? (
                      <div className="augment-tile" key={id}>
                        <Art url={augment.icon} alt={augment.name} assets={assets} />
                        <div>
                          <strong>{augment.name}</strong>
                          <small>
                            {augment.tier ?? 'Augment'} ·{' '}
                            {augment.liveStatus === 'unverified'
                              ? 'Live availability unverified'
                              : augment.liveStatus}
                          </small>
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
                <p>{branch.signal.value}</p>
                <small>{branch.consequence.value}</small>
              </div>
            </div>
          ))}
          <details className="augment-reference">
            <summary>Augment reference</summary>
            <p className="fine-print">
              Browse augment names and artwork. These are not recommendations; live availability
              remains unverified.
            </p>
            <input
              aria-label="Find augment"
              placeholder="Find augment by name"
              value={augmentSearch}
              onChange={(e) => setAugmentSearch(e.target.value)}
            />
            <div className="augment-tiles">
              {data.augments
                .filter((a) => a.name.toLowerCase().includes(augmentSearch.toLowerCase()))
                .slice(0, 6)
                .map((a) => (
                  <div className="augment-tile" key={a.id}>
                    <Art url={a.icon} alt={a.name} assets={assets} />
                    <div>
                      <strong>{a.name}</strong>
                      <small>
                        {a.tier ?? 'Augment'} ·{' '}
                        {a.liveStatus === 'unverified' ? 'Availability unverified' : a.liveStatus}
                      </small>
                    </div>
                  </div>
                ))}
            </div>
          </details>
          {!plan.strategy.augmentBranches.length && (
            <Unavailable
              title="No sourced augment branch"
              note="Specific rankings and live availability remain unavailable."
            />
          )}
        </section>
        <section className="panel replacements-panel">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Flex & replacements</h2>
            <FactBadge status={plan.strategy.coverage.fields.replacements} />
          </div>
          {plan.strategy.replacements.map((replacement) => (
            <div className="replacement-row" key={replacement.id}>
              <strong>{championName(replacement.targetUnitId)}</strong>
              <ArrowRight size={14} />
              <strong>{championName(replacement.substituteUnitId)}</strong>
              <span>{replacement.boardLegal ? 'Legal board' : 'Illegal board'}</span>
            </div>
          ))}
          {!plan.strategy.replacements.length && (
            <Unavailable
              title="No verified substitute edge"
              note="Trait overlap alone is not treated as equal strength."
            />
          )}
          <div className="slot-key">
            <span className="legend-core">Locked core</span>
            <span className="legend-flex">Replaceable / flex</span>
            <span className="legend-temporary">Temporary</span>
          </div>
        </section>
        <section className="panel decision-panel" id="decision-map">
          <div className="panel-heading">
            <GitBranch size={18} />
            <h2>Decision Map</h2>
            <FactBadge status={plan.strategy.decisionMap.status} />
          </div>
          {decisionNode ? (
            <div className="interactive-decision-map">
              <div className="decision-progress">
                <span>{decisionPath.length + 1}</span>
                <i style={{ width: `${Math.min(100, (decisionPath.length + 1) * 34)}%` }} />
                <button onClick={resetDecision} aria-label="Reset Decision Map">
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
              <div className={`decision-current kind-${decisionNode.kind}`}>
                <small>{decisionNode.kind}</small>
                <strong>{decisionNode.label}</strong>
                <FactBadge status={decisionNode.fact.status} />
              </div>
              {outgoing.length > 0 ? (
                <div className="decision-options">
                  {outgoing.map((edge) => (
                    <button key={edge.id} onClick={() => selectDecisionEdge(edge.id)}>
                      <span>{edge.label}</span>
                      <strong>
                        {plan.strategy.decisionMap.nodes.find((node) => node.id === edge.to)?.label}
                      </strong>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="decision-terminal">
                  Branch complete. Reassess manually as the game changes.
                </p>
              )}
              <p className="fine-print">{plan.strategy.decisionMap.note}</p>
            </div>
          ) : (
            <Unavailable title="Decision Map unavailable" note={plan.strategy.decisionMap.note} />
          )}
        </section>
      </div>

      <section className="panel pivot-graph-panel" id="pivots">
        <div className="panel-heading">
          <GitBranch size={18} />
          <h2>Pivot options</h2>
          <span className="badge muted">Your three plans</span>
        </div>
        <div className="pivot-nodes">
          {pivotGraph.nodes.map((node) => (
            <button
              key={node.id}
              className={node.id === plan.id ? 'active' : ''}
              onClick={() => {
                if (node.id === plan.id) return;
                if (isActivePlan) onManualState({ pivotTargetId: node.id });
                onOpen(node.id);
              }}
            >
              <span>{node.role}</span>
              <strong>{node.title}</strong>
            </button>
          ))}
        </div>
        <div className="pivot-edges">
          {pivotGraph.edges
            .filter((edge) => edge.from === plan.id)
            .map((edge) => {
              const destination = pivotGraph.nodes.find((node) => node.id === edge.to);
              return (
                <button
                  key={edge.id}
                  onClick={() => {
                    if (isActivePlan) onManualState({ pivotTargetId: edge.to });
                    onOpen(edge.to);
                  }}
                >
                  <span className="pivot-arrow">→</span>
                  <div>
                    <strong>{destination?.title}</strong>
                    <small>{edge.reasons.join(' · ')}</small>
                  </div>
                  <div className="pivot-cost">
                    <b>{edge.transitionCost}</b>
                    <span>cost</span>
                    <FactBadge status={edge.status} />
                  </div>
                </button>
              );
            })}
          {!pivotGraph.edges.some((edge) => edge.from === plan.id) && (
            <Unavailable
              title="No supported pivot edge"
              note="Final-board overlap alone does not create an edge."
            />
          )}
        </div>
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
          <p className="fine-print">
            {discovered.recommendationEligible
              ? 'Every M6 recommendation gate cleared.'
              : `Not recommendation-eligible: ${discovered.recommendationGateReasons.join('; ') || 'inspection-only lifecycle'}.`}{' '}
            Strategy coverage remains {plan.strategy.coverage.supported}/
            {plan.strategy.coverage.total}; inherited facts are labeled individually.
          </p>
        </section>
      )}

      <details className="panel why-panel">
        <summary>Why this plan? · score & evidence</summary>
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
              {Math.round(discovered.stats.topFour.shrunk * 100)}% top 4
            </span>
          ) : measured ? (
            <span>
              {measured.games} classified games ·{' '}
              {measured.quality === 'eligible'
                ? `${measured.averagePlacement.toFixed(2)} avg · ${Math.round(measured.topFour.raw * 100)}% top 4`
                : 'Insufficient sample'}
            </span>
          ) : (
            <span>Unavailable · recommendation outcome inputs fall back to neutral.</span>
          )}
          <small>Strategy guidance never substitutes for measured outcome evidence.</small>
        </div>
        <div className="why-grid">
          <div className="score-breakdown">
            {candidate.components.map((component) => (
              <div key={component.key}>
                <span>{component.label}</span>
                <div className="bar-track">
                  <i style={{ width: `${Math.abs(component.input ?? 0)}%` }} />
                </div>
                <strong>
                  {component.contribution >= 0 ? '+' : ''}
                  {component.contribution.toFixed(1)}
                </strong>
                <small>{component.status}</small>
              </div>
            ))}
          </div>
          <div className="confidence-breakdown">
            <h3>{candidate.confidence.level} confidence</h3>
            <p>Evidence quality is separate from score.</p>
            {candidate.confidence.drivers.map((driver) => (
              <div key={driver.label}>
                <span>{driver.factor < 0.5 ? '○' : '◐'}</span>
                {driver.label}
              </div>
            ))}
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
                  <strong>{championName(unit.championId)}</strong>
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
            M4 historical pressure remains independent of strategy guidance and discovery.
          </small>
        </div>
      </details>

      <details className="planner-verification">
        <summary>
          Team Planner ·{' '}
          {plannerCandidate.ok ? 'Client verified · roster only' : 'Unavailable for this roster'}
        </summary>
        <p>{plannerSupport.reason}</p>
        {plannerCandidate.ok ? (
          <>
            <label className="setting-label" htmlFor="planner-candidate">
              Verified roster code
            </label>
            <input
              id="planner-candidate"
              readOnly
              value={plannerCandidate.value}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p>
              {plan.target.units.map((unit) => championName(unit.championId)).join(' · ')} ·{' '}
              {plan.target.units.length} filled slots
            </p>
          </>
        ) : (
          <p>{plannerCandidate.error}</p>
        )}
      </details>
      {copyMessage && <p role="status">{copyMessage}</p>}
      <details className="source-details">
        <summary>Sources, freshness & validation</summary>
        <p>
          Strategy {plan.strategy.guidanceVersion} · reviewed{' '}
          {new Date(plan.strategy.reviewedAt).toLocaleDateString()} · freshness{' '}
          <strong>{plan.strategy.freshness.state}</strong>.
        </p>
        {plan.strategy.freshness.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {plan.strategy.sources.map((source) => (
          <p key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title} ↗
            </a>{' '}
            · {source.scope}
          </p>
        ))}
        {warnings.map((warning, index) => (
          <p key={`${warning.code}-${index}`}>{warning.message}</p>
        ))}
        <p>Team Planner: {plan.planner.reason}</p>
      </details>
      {confirmation && (
        <ConfirmDialog
          title={confirmation === 'end' ? 'End this session?' : `Switch to ${plan.title}?`}
          confirmLabel={confirmation === 'end' ? 'End session & save' : 'Confirm switch'}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null);
            if (confirmation === 'end') onEnd();
            else onLock();
          }}
        >
          <p>
            {confirmation === 'end'
              ? 'Your plan and progress stay in Post-game. You can link a completed match later.'
              : 'The previous plan stays in history. This starts the selected route with fresh stage and decision progress.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
