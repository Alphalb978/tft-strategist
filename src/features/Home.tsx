import { ArrowRight, Layers3, Plus, Radio, ShieldQuestion, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  LobbyPressure,
  RecommendationCandidate,
  RecommendationPortfolio,
} from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';
import { LobbyPressureSummary } from '../components/LobbyPressureSummary';
import { selectAlternativeCandidates } from '../strategy/homeScoring';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

function pickRate(candidate: RecommendationCandidate) {
  const pick = candidate.home?.pickRate;
  if (!pick) return '—';
  return pick.unit === 'percent' ? `${pick.value.toFixed(2)}%` : pick.value.toFixed(2);
}

function supportedRole(
  candidate: RecommendationCandidate,
  index: number,
  candidates: RecommendationCandidate[],
  primary: RecommendationPortfolio['plans'],
) {
  const home = candidate.home;
  if (!home) return primary[index]?.role ?? 'Portfolio route';
  const bestTop4 = candidates
    .filter((entry) => entry.home?.top4.raw !== null)
    .sort(
      (a, b) =>
        (b.home?.top4.raw ?? 0) - (a.home?.top4.raw ?? 0) ||
        a.playbook.id.localeCompare(b.playbook.id),
    )[0];
  if (index === 0)
    return bestTop4?.playbook.id === candidate.playbook.id
      ? 'BEST TOP-4 ROUTE'
      : 'BEST FINAL SAFETY';
  if (candidate.contest.state === 'Low' && primary[0]?.candidate.contest.state !== 'Low')
    return 'LOW-CONTEST ALTERNATIVE';
  if (
    home.winRate.raw !== null &&
    home.winRate.raw > (primary[0]?.candidate.home?.winRate.raw ?? Number.POSITIVE_INFINITY)
  )
    return 'HIGH-CAP OPTION';
  return 'COMPLEMENTARY ROUTE';
}

function exclusionReason(candidate: RecommendationCandidate, portfolio: RecommendationPortfolio) {
  const route = portfolio.plans
    .map((entry, index) => {
      const opening = candidate.playbook.features.openingCoverage.filter((value) =>
        entry.candidate.playbook.features.openingCoverage.includes(value),
      ).length;
      const items = candidate.playbook.features.itemCoverage.filter((value) =>
        entry.candidate.playbook.features.itemCoverage.includes(value),
      ).length;
      return {
        index,
        overlap: opening + items,
        sameStyle: candidate.playbook.features.style === entry.candidate.playbook.features.style,
      };
    })
    .sort((a, b) => b.overlap - a.overlap || Number(b.sameStyle) - Number(a.sameStyle))[0];
  if (route?.overlap)
    return `Not primary: overlaps the #${route.index + 1} route's opening/item profile.`;
  if (route?.sameStyle) return 'Not primary: portfolio kept a more distinct style mix.';
  return 'Outside primary three after portfolio optimization.';
}

function ScoreDecomposition({ candidate }: { candidate: RecommendationCandidate }) {
  const score = candidate.home;
  if (!score) return null;
  return (
    <div className="score-decomposition" aria-label="Final Safety calculation">
      <span>
        Base Performance <strong>{score.basePerformance.toFixed(1)}</strong>
      </span>
      <span>
        Low-pick edge <strong>{signed(score.lowPickEdge)}</strong>
      </span>
      <span>
        Lobby <strong>{signed(score.lobbyAdjustment)}</strong>
      </span>
      <span className="final">
        Final Safety <strong>{score.finalSafety.toFixed(1)}</strong>
      </span>
    </div>
  );
}

function OutcomeLine({ candidate }: { candidate: RecommendationCandidate }) {
  const score = candidate.home;
  if (!score) return null;
  return (
    <div className="home-outcomes">
      {score.reliability === 0 && <small>Insufficient sample · outcomes shrink to neutral</small>}
      <span>
        <strong>{percent(score.top4.raw)}</strong> Top 4
      </span>
      <span>
        <strong>{score.averagePlacement.raw?.toFixed(2) ?? '—'}</strong> Avg
      </span>
      <span>
        <strong>{percent(score.winRate.raw)}</strong> Win
      </span>
      <span title="Provider-displayed MetaTFT Pick Rate">
        <strong>{pickRate(candidate)}</strong> Pick
      </span>
    </div>
  );
}

export function Home({
  state,
  portfolio,
  candidates = state.homeCandidates,
  baselineCandidates = state.homeCandidates,
  onOpen,
  onData,
  onScout,
  lobby,
  onClearLobby = () => {},
}: {
  state: ApplicationState;
  portfolio: RecommendationPortfolio;
  candidates?: RecommendationCandidate[];
  baselineCandidates?: RecommendationCandidate[];
  onOpen: (id: string) => void;
  onData: () => void;
  onScout: () => void;
  lobby: LobbyPressure | null;
  onClearLobby?: () => void;
}) {
  const { data, assets } = state;
  const alternatives = useMemo(
    () => selectAlternativeCandidates(candidates, portfolio, 5),
    [candidates, portfolio],
  );
  const [checkerId, setCheckerId] = useState(candidates[0]?.playbook.id ?? '');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const checked = checkedIds.flatMap((id) => {
    const candidate = candidates.find((entry) => entry.playbook.id === id);
    return candidate ? [candidate] : [];
  });
  const currentOrder = portfolio.plans.map((entry) => entry.candidate.playbook.id);
  const baselineOrder = state.portfolio.plans.map((entry) => entry.candidate.playbook.id);
  const orderChanged = currentOrder.some((id, index) => baselineOrder[index] !== id);
  const baseline = new Map(baselineCandidates.map((entry) => [entry.playbook.id, entry]));

  return (
    <>
      <div className="page-heading home-heading">
        <div>
          <div className="eyebrow">YOUR BEST ROUTES / SET {data.version.set}</div>
          <h1>Your plans</h1>
          <p>Goal: Top 4 + low contest</p>
        </div>
        <button className="secondary" onClick={onScout}>
          <Radio size={16} /> Scan current lobby
        </button>
      </div>

      <section className="home-lobby-strip" aria-label="Active lobby status">
        <div>
          <Radio size={15} />
          <strong>Lobby</strong>
          <span>
            {lobby
              ? `${lobby.profilesCompleted}/${lobby.expectedOpponents} scouted · ${Math.round(lobby.coverage * 100)}% evidence`
              : 'Not scanned · neutral contest adjustment'}
          </span>
        </div>
        {lobby && (
          <>
            <strong className="scan-impact">
              {orderChanged
                ? 'Lobby scan changed recommendation order'
                : 'Recommendations unchanged'}
            </strong>
            <div className="lobby-deltas" aria-label="Lobby score changes">
              {portfolio.plans.map(({ candidate }) => (
                <span key={candidate.playbook.id}>
                  {candidate.playbook.title} {signed(candidate.home?.lobbyAdjustment ?? 0)} lobby
                </span>
              ))}
            </div>
            <button className="clear-lobby" onClick={onClearLobby}>
              Clear Lobby
            </button>
          </>
        )}
      </section>

      {!state.settings.riotId && (
        <div className="setup-strip">
          <span className="setup-number">01</span>
          <div>
            <strong>Ready to plan. Connect your Riot account for scouting.</strong>
            <span>Bundled TFT data and playbooks work offline. Riot features need an API key.</span>
          </div>
          <button onClick={onData}>
            Set up account <ArrowRight size={15} />
          </button>
        </div>
      )}

      <div className="section-line">
        <h2>Primary routes</h2>
        <span>{candidates.length} eligible comps considered · portfolio optimized together</span>
      </div>
      <div className="plan-grid home-plan-grid">
        {portfolio.plans.map(({ candidate: c }, index) => {
          const p = c.playbook;
          const hero = data.champions.find((unit) => unit.id === p.hero)!;
          const prior = baseline.get(p.id);
          return (
            <article className={`plan-card ${index === 0 ? 'primary-plan' : ''}`} key={p.id}>
              <div className="card-art">
                <Art url={hero.splash} alt={`${hero.name} · Set 18 artwork`} assets={assets} />
                <div className="art-shade" />
                <span className="rank">0{index + 1}</span>
              </div>
              <div className="plan-identity">
                <div className="plan-role">
                  {supportedRole(c, index, candidates, portfolio.plans)}
                  <span>{p.features.style}</span>
                </div>
                <h2>{p.title}</h2>
                <span className="plan-evidence">
                  {p.discovery ? 'Discovered' : 'Curated'} · {p.evidence} · {c.home?.modelVersion}
                </span>
              </div>
              <div className="plan-lineup">
                {p.target.units.map((unit) => {
                  const champion = data.champions.find((entry) => entry.id === unit.championId);
                  return champion ? (
                    <div key={unit.championId} className={unit.slot === 'core' ? 'is-core' : ''}>
                      <Portrait champion={champion} assets={assets} compact />
                      <span>{champion.name}</span>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="plan-stat">
                <strong>
                  {c.home?.finalSafety.toFixed(1) ?? c.score}
                  <small>/100</small>
                </strong>
                <span>Final Safety</span>
                <b>{c.confidence.level} confidence</b>
                {lobby && prior && (
                  <small className="score-delta">{signed(c.score - prior.score)} vs no lobby</small>
                )}
              </div>
              <div className="plan-outcomes home-score-panel">
                <ScoreDecomposition candidate={c} />
                <OutcomeLine candidate={c} />
              </div>
              <div className="plan-decision">
                <span className={`contest contest-${c.contest.state.toLowerCase()}`}>
                  <Radio size={13} /> Historical contest: {c.contest.state.toLowerCase()}
                </span>
                <p className="card-reason">{c.reasons[1]}</p>
                {c.contest.routeEvidence && c.contest.routeEvidence.opponentsWithRouteMatch > 0 && (
                  <div className="card-route-evidence" aria-label="Route overlap evidence">
                    <span>
                      {c.contest.routeEvidence.opponentsWithRouteMatch} opponent{c.contest.routeEvidence.opponentsWithRouteMatch === 1 ? '' : 's'} with whole-route history
                    </span>
                  </div>
                )}
                {c.contest.pressuredUnits.length > 0 && (
                  <div className="card-pressure-units" aria-label="Pressured critical units">
                    {c.contest.pressuredUnits.slice(0, 3).map((unit) => (
                      <span key={unit.championId}>
                        {data.champions.find((champion) => champion.id === unit.championId)?.name} ·{' '}
                        {unit.equivalentHistoricalUsers.toFixed(1)} equivalent users
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button className="open-plan" onClick={() => onOpen(p.id)}>
                Explore playbook <ArrowRight size={16} />
              </button>
            </article>
          );
        })}
      </div>

      {!portfolio.plans.length && (
        <div className="empty-state">
          <Layers3 />
          <h2>No eligible plans</h2>
          <p>Review data status, then refresh the source.</p>
          <button onClick={onData}>Review data</button>
        </div>
      )}

      {alternatives.length > 0 && (
        <section className="other-routes" aria-labelledby="other-routes-title">
          <div className="section-line">
            <h2 id="other-routes-title">Other strong routes</h2>
            <span>Next five by Final Safety</span>
          </div>
          <div className="alternative-list">
            {alternatives.map((candidate) => {
              const overallRank =
                candidates.findIndex((entry) => entry.playbook.id === candidate.playbook.id) + 1;
              return (
                <article key={candidate.playbook.id}>
                  <span className="alternative-rank">#{overallRank}</span>
                  <div className="alternative-name">
                    <strong>{candidate.playbook.title}</strong>
                    <span>{candidate.playbook.features.style}</span>
                  </div>
                  <strong className="alternative-safety">
                    {candidate.home?.finalSafety.toFixed(1)}
                    <small> Safety</small>
                  </strong>
                  <OutcomeLine candidate={candidate} />
                  <span className={`contest contest-${candidate.contest.state.toLowerCase()}`}>
                    {candidate.contest.state} contest
                  </span>
                  <p>{exclusionReason(candidate, portfolio)}</p>
                  <button
                    aria-label={`Open ${candidate.playbook.title}`}
                    onClick={() => onOpen(candidate.playbook.id)}
                  >
                    <ArrowRight size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel comp-checker" aria-labelledby="comp-checker-title">
        <div className="panel-heading">
          <ShieldQuestion size={18} />
          <h2 id="comp-checker-title">Check a comp in this lobby</h2>
          <span className="badge muted">
            Same {candidates[0]?.home?.modelVersion ?? 'Home model'}
          </span>
        </div>
        <p>Compare up to five eligible comps without changing your primary routes.</p>
        <div className="checker-controls">
          <select
            aria-label="Eligible comp"
            value={checkerId}
            onChange={(event) => setCheckerId(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option value={candidate.playbook.id} key={candidate.playbook.id}>
                {candidate.playbook.title}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={!checkerId || checkedIds.includes(checkerId) || checkedIds.length >= 5}
            onClick={() => setCheckedIds((current) => [...current, checkerId].slice(0, 5))}
          >
            <Plus size={14} /> Add comparison
          </button>
        </div>
        {checked.length === 0 ? (
          <p className="checker-empty">Choose a comp to inspect its exact Home score.</p>
        ) : (
          <div className="checker-table" role="table" aria-label="Comp checker comparison">
            <div className="checker-row checker-header" role="row">
              <span>Comp</span>
              <span>Base</span>
              <span>Low-pick</span>
              <span>Lobby</span>
              <span>Final</span>
              <span>Top 4</span>
              <span>Contest</span>
              <span />
            </div>
            {checked.map((candidate) => (
              <div className="checker-row" role="row" key={candidate.playbook.id}>
                <button className="checker-name" onClick={() => onOpen(candidate.playbook.id)}>
                  {candidate.playbook.title}
                </button>
                <span>{candidate.home?.basePerformance.toFixed(1)}</span>
                <span>{signed(candidate.home?.lowPickEdge ?? 0)}</span>
                <span>{signed(candidate.home?.lobbyAdjustment ?? 0)}</span>
                <strong>{candidate.home?.finalSafety.toFixed(1)}</strong>
                <span>{percent(candidate.home?.top4.raw ?? null)}</span>
                <span>{candidate.contest.state}</span>
                <button
                  aria-label={`Remove ${candidate.playbook.title}`}
                  onClick={() =>
                    setCheckedIds((current) => current.filter((id) => id !== candidate.playbook.id))
                  }
                >
                  <Trash2 size={13} />
                </button>
                <small className="checker-detail">
                  Avg {candidate.home?.averagePlacement.raw?.toFixed(2) ?? '—'} · Win{' '}
                  {percent(candidate.home?.winRate.raw ?? null)} · Pick Rate {pickRate(candidate)}
                </small>
                {candidate.contest.routeEvidence && candidate.contest.routeEvidence.opponentsWithRouteMatch > 0 && (
                  <small>
                    Route history: {candidate.contest.routeEvidence.opponentsWithRouteMatch} matching opponent{candidate.contest.routeEvidence.opponentsWithRouteMatch === 1 ? '' : 's'}
                  </small>
                )}
                {candidate.contest.pressuredUnits.length > 0 && (
                  <small>
                    Main pressure:{' '}
                    {candidate.contest.pressuredUnits
                      .slice(0, 2)
                      .map(
                        (unit) =>
                          `${data.champions.find((champion) => champion.id === unit.championId)?.name ?? unit.championId} ${unit.equivalentHistoricalUsers.toFixed(1)}`,
                      )
                      .join(' · ')}{' '}
                    equivalent users
                  </small>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="evidence-banner">
        <ShieldQuestion size={17} />
        <span>
          {state.meta
            ? `${state.meta.uniqueMatches} ${state.meta.platform} matches · ${state.meta.rankCohort.join(' + ')} cohort`
            : state.external
              ? `${state.external.manifest.provider} external evidence · ${state.external.comps.length} mapped comps · missing outcomes shrink to neutral`
              : 'No measured meta yet. Missing outcomes shrink to neutral.'}
        </span>
        <button onClick={onData}>
          Data status <ArrowRight size={14} />
        </button>
      </div>

      <div className="home-bottom">
        <section className="panel portfolio-panel">
          <div className="panel-heading">
            <Layers3 size={18} />
            <h2>Opening coverage</h2>
          </div>
          <div className="coverage-line">
            {portfolio.plans.map(({ candidate }, index) => (
              <div key={candidate.playbook.id}>
                <span className="mini-rank">0{index + 1}</span>
                <strong>
                  {candidate.playbook.features.itemCoverage.join(' + ') || 'Coverage unavailable'}
                </strong>
                <small>{candidate.playbook.features.style}</small>
              </div>
            ))}
          </div>
          <details>
            <summary>How this portfolio was selected</summary>
            <div className="interaction-list">
              {portfolio.interactions.map((interaction) => (
                <div key={interaction.label}>
                  <span>{interaction.label}</span>
                  <strong>{signed(interaction.value)}</strong>
                </div>
              ))}
            </div>
            <p className="fine-print">
              #1 is the highest Final Safety. #2 and #3 use only bounded shared-core,
              pressured-unit, and supported-style anti-redundancy.
            </p>
          </details>
        </section>
        <section className="panel lobby-panel">
          <div className="panel-heading">
            <Radio size={18} />
            <h2>Lobby diagnostics</h2>
            <span className="badge muted">{lobby?.state ?? 'Not scanned'}</span>
          </div>
          <div className="opponent-dots">
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>{lobby?.profiles[index] ? '✓' : '—'}</span>
            ))}
          </div>
          <p>
            {lobby
              ? `${lobby.profilesCompleted}/${lobby.resolvedOpponents} profiles · ${Math.round(lobby.coverage * 100)}% evidence`
              : 'No active lobby pressure. Adjustments are neutral.'}
          </p>
          {lobby && <LobbyPressureSummary lobby={lobby} data={data} assets={assets} compact />}
          <button className="text-button" onClick={onScout}>
            Open scouting <ArrowRight size={14} />
          </button>
          <small>Historical tendencies · {state.settings.historyWindow} games per opponent</small>
        </section>
      </div>
    </>
  );
}
