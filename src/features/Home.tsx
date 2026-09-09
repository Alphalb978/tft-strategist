import { ArrowRight, HelpCircle, Layers3, Plus, Radio, ShieldQuestion, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  LobbyPressure,
  LobbyScanState,
  RecommendationCandidate,
  RecommendationPortfolio,
} from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';
import { LobbyPressureSummary } from '../components/LobbyPressureSummary';
import { selectAlternativeCandidates } from '../strategy/homeScoring';

export const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
export const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

export function formatLobbyDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (Math.abs(rounded) < 0.05) {
    return 'Lobby scan had little effect';
  }
  if (rounded > 0) {
    return `Lobby scan improved this route by +${rounded.toFixed(1)}`;
  }
  return `Lobby scan reduced this route by ${rounded.toFixed(1)}`;
}

export function pickRate(candidate: RecommendationCandidate) {
  const pick = candidate.home?.pickRate;
  if (!pick) return '—';
  return pick.unit === 'percent' ? `${pick.value.toFixed(2)}%` : pick.value.toFixed(2);
}

function supportedRole(
  candidate: RecommendationCandidate,
  index: number,
  candidates: RecommendationCandidate[],
  primary: RecommendationPortfolio['plans'],
  scanState?: LobbyScanState,
) {
  if (scanState?.stage === 'scanning' || scanState?.isProvisional) {
    if (index === 0) return 'PROVISIONAL ROUTE';
    return 'PROVISIONAL OPTION';
  }
  if (scanState?.stage === 'partial-complete' && index === 0) {
    return `PARTIAL — ${scanState.opponentsAnalyzed}/${scanState.opponentsTotal} ROUTE`;
  }
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

export function humanizeExclusionReason(
  candidate: RecommendationCandidate,
  portfolio: RecommendationPortfolio,
) {
  if (candidate.contest.state === 'High') {
    return 'Good fallback · heavily pressured in this lobby';
  }

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

  if (route?.overlap) {
    return `Good fallback · overlaps opening & items with #${route.index + 1}`;
  }
  if (route?.sameStyle) {
    return 'Good fallback · primary routes favored style diversity';
  }
  return 'Good fallback · excluded for route diversity';
}

export function ScoreDecomposition({
  candidate,
  isProvisional,
}: {
  candidate: RecommendationCandidate;
  isProvisional?: boolean;
}) {
  const score = candidate.home;
  if (!score) return null;
  return (
    <div className="score-decomposition" aria-label="Final Safety calculation">
      <div className="score-row">
        <span className="term-label">Base</span>
        <strong className="term-val">{score.basePerformance.toFixed(1)}</strong>
      </div>
      <div className="score-row">
        <span className="term-label">+ Low-pick</span>
        <strong className="term-val">{signed(score.lowPickEdge)}</strong>
      </div>
      <div className="score-row">
        <span className="term-label">+ Lobby{isProvisional ? ' (prov.)' : ''}</span>
        <strong className="term-val">{signed(score.lobbyAdjustment)}</strong>
      </div>
      <div className="score-row final-row">
        <span className="term-label">{isProvisional ? 'Provisional' : 'Final Safety'}</span>
        <strong className="term-val final-val">{score.finalSafety.toFixed(1)}</strong>
      </div>
    </div>
  );
}

export function OutcomeLine({ candidate }: { candidate: RecommendationCandidate }) {
  const score = candidate.home;
  if (!score) return null;
  return (
    <div className="home-outcomes">
      {score.reliability === 0 && (
        <div
          className="limited-data-banner"
          title="Insufficient sample · small samples are shrunk toward neutral."
          role="note"
        >
          <span className="limited-data-badge">LIMITED DATA</span>
          <span>Not enough games to trust performance stats yet.</span>
        </div>
      )}
      <div className="outcome-metrics">
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
  scanState,
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
  scanState?: LobbyScanState;
  onClearLobby?: () => void;
}) {
  const { data, assets } = state;
  const activeScan: LobbyScanState = useMemo(() => {
    if (scanState) return scanState;
    if (lobby) {
      return {
        stage: lobby.profilesCompleted >= 7 ? 'complete' : 'partial-complete',
        opponentsAnalyzed: lobby.profilesCompleted,
        opponentsTotal: lobby.expectedOpponents,
        matchesProcessed: lobby.telemetry.uniqueMatchDetailsFetched + lobby.telemetry.cacheHits,
        relevantGamesAvailable: lobby.relevantGamesAvailable,
        relevantGamesTarget: lobby.relevantGamesTarget,
        coverage: lobby.coverage,
        lobby,
        isProvisional: false,
      };
    }
    return {
      stage: 'idle',
      opponentsAnalyzed: 0,
      opponentsTotal: 0,
      matchesProcessed: 0,
      relevantGamesAvailable: 0,
      relevantGamesTarget: 0,
      coverage: 0,
      lobby: null,
      isProvisional: false,
    };
  }, [scanState, lobby]);

  const alternatives = useMemo(
    () => selectAlternativeCandidates(candidates, portfolio, 5),
    [candidates, portfolio],
  );
  const isProvisional = activeScan.stage === 'scanning' || activeScan.isProvisional;
  const hasActiveLobby = Boolean(
    activeScan.lobby &&
      activeScan.stage !== 'failed' &&
      activeScan.stage !== 'not-in-game' &&
      activeScan.stage !== 'idle',
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
        <button
          className="secondary"
          onClick={onScout}
          disabled={activeScan.stage === 'scanning' || activeScan.stage === 'detected'}
          aria-label="Scan current lobby"
        >
          <Radio size={16} />
          {activeScan.stage === 'scanning'
            ? 'Analyzing lobby…'
            : activeScan.stage === 'detected'
              ? 'Preparing scan…'
              : 'Scan current lobby'}
        </button>
      </div>

      <section className="home-lobby-strip" aria-label="Active lobby status">
        <div>
          <Radio size={15} />
          <strong>
            {activeScan.stage === 'detected' || (activeScan.tftDetected && activeScan.stage === 'failed')
              ? 'TFT GAME DETECTED'
              : activeScan.stage === 'scanning'
                ? `ANALYZING — ${activeScan.opponentsAnalyzed}/${activeScan.opponentsTotal}`
                : activeScan.stage === 'complete'
                  ? `LOBBY READY — ${activeScan.opponentsAnalyzed}/${activeScan.opponentsTotal}`
                  : activeScan.stage === 'partial-complete'
                    ? activeScan.opponentsAnalyzed >= 6
                      ? `PARTIAL — ${activeScan.opponentsAnalyzed}/${activeScan.opponentsTotal}`
                      : 'PARTIAL LOBBY DATA'
                    : activeScan.stage === 'failed'
                      ? 'LOBBY SCAN FAILED'
                      : 'NO CURRENT LOBBY'}
          </strong>
          <span>
            {activeScan.stage === 'detected'
              ? (activeScan.reason ?? 'Preparing lobby scan…')
              : activeScan.tftDetected && activeScan.stage === 'failed'
                ? (activeScan.error ? `Lobby scan unavailable — ${activeScan.error}` : 'Lobby scan unavailable')
                : activeScan.stage === 'scanning'
                  ? `${activeScan.opponentsAnalyzed} / ${activeScan.opponentsTotal} opponents · ${activeScan.matchesProcessed} historical matches processed`
                  : activeScan.stage === 'complete'
                    ? `${activeScan.relevantGamesAvailable} / ${activeScan.relevantGamesTarget} relevant games · ${Math.round(activeScan.coverage * 100)}% coverage`
                    : activeScan.stage === 'partial-complete'
                      ? activeScan.opponentsAnalyzed >= 6
                        ? 'Lobby adjustment confidence reduced'
                        : `${activeScan.opponentsAnalyzed} / ${activeScan.opponentsTotal} opponents analyzed · Ranking confidence incomplete`
                      : activeScan.stage === 'not-in-game'
                        ? `${activeScan.reason ?? 'No active TFT game detected'} · neutral contest adjustment`
                        : activeScan.stage === 'failed'
                          ? `${activeScan.error ?? 'Scouting unavailable'} · neutral contest adjustment`
                          : (activeScan.reason ?? 'Waiting for a TFT game…')}
          </span>
        </div>
        {(activeScan.stage === 'scanning' || activeScan.stage === 'detected') && (
          <strong className="scan-impact provisional">
            Recommendations provisional — wait before locking a route
          </strong>
        )}
        {activeScan.lobby && activeScan.stage !== 'scanning' && activeScan.stage !== 'detected' && (
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
        <span className="eligible-comps-note">
          {candidates.length} eligible comps considered
          <span
            className="help-tooltip-trigger"
            tabIndex={0}
            role="button"
            aria-label="Eligible comps explanation: Meets quality and minimum game count gates for Set 18, drawn from curated playbooks, compatible external meta comps, and discovered variants."
            title="Eligible comps meet minimum quality and sample criteria for Set 18, drawn from curated playbooks, compatible external meta comps, and discovered variants."
          >
            <HelpCircle size={12} />
          </span>
          {' · '}portfolio optimized together
        </span>
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
                {(activeScan.stage === 'scanning' || activeScan.isProvisional) && (
                  <span className="provisional-tag">PROVISIONAL</span>
                )}
              </div>
              <div className="plan-identity">
                <div className="plan-role">
                  {supportedRole(c, index, candidates, portfolio.plans, activeScan)}
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
                <span>
                  {activeScan.stage === 'scanning' || activeScan.isProvisional
                    ? 'Provisional Safety'
                    : 'Final Safety'}
                </span>
                <b>Score confidence: {c.confidence.level}</b>
                {activeScan.lobby && prior && (
                  <small className="score-delta">{formatLobbyDelta(c.score - prior.score)}</small>
                )}
              </div>
              <div className="plan-outcomes home-score-panel">
                <ScoreDecomposition
                  candidate={c}
                  isProvisional={activeScan.stage === 'scanning' || activeScan.isProvisional}
                />
                <OutcomeLine candidate={c} />
              </div>
              <div className="plan-decision">
                <span
                  className={`contest-pill contest-${hasActiveLobby && c.contest.state !== 'Unavailable' ? c.contest.state.toLowerCase() : 'unavailable'}`}
                >
                  <Radio size={12} />{' '}
                  {!hasActiveLobby || c.contest.state === 'Unavailable'
                    ? 'CONTEST UNAVAILABLE'
                    : isProvisional
                      ? `${c.contest.state.toUpperCase()} CONTEST (PROV.)`
                      : `${c.contest.state.toUpperCase()} CONTEST`}
                </span>
                <p className="card-reason">{c.reasons[1]}</p>
                {c.contest.routeEvidence && c.contest.routeEvidence.opponentsWithRouteMatch > 0 && (
                  <div className="card-route-evidence" aria-label="Route overlap evidence">
                    <span className={`route-badge route-badge-${(c.contest.routeEvidence.pressureLevel ?? c.contest.state).toLowerCase()}`}>
                      {(c.contest.routeEvidence.pressureLevel ?? c.contest.state).toUpperCase()} ROUTE PRESSURE
                    </span>
                    <span>
                      {c.contest.routeEvidence.opponentsWithRouteMatch} matching opponent{c.contest.routeEvidence.opponentsWithRouteMatch === 1 ? '' : 's'}
                    </span>
                    {c.contest.routeEvidence.matchingOpponents.slice(0, 2).map((opp) => (
                      <small key={opp.puuid} className="route-opp-detail">
                        {opp.riotId ?? 'Opponent'}: {opp.matchSummary ?? `${opp.stronglyMatchingBoards}/${opp.totalBoards} strong matches`}
                      </small>
                    ))}
                  </div>
                )}
                {c.contest.pressuredUnits.length > 0 && (
                  <div className="card-shared-pressure" aria-label="Shared-unit pressure">
                    <div className="shared-pressure-header">
                      <span className="shared-pressure-title">Shared-unit pressure</span>
                      <span
                        className="help-tooltip-trigger"
                        tabIndex={0}
                        role="button"
                        aria-label="Equivalent users explanation: Evidence-weighted pressure from opponents' recent boards. This is not a count of players currently holding the unit."
                        title="Evidence-weighted pressure from opponents' recent boards. This is not a count of players currently holding the unit."
                      >
                        <HelpCircle size={12} />
                      </span>
                    </div>
                    <div className="shared-pressure-units">
                      {c.contest.pressuredUnits.slice(0, 3).map((unit, uIndex) => {
                        const champ = data.champions.find((champion) => champion.id === unit.championId);
                        return (
                          <span key={unit.championId}>
                            {champ?.name ?? unit.championId} {unit.equivalentHistoricalUsers.toFixed(1)}
                            {uIndex < Math.min(c.contest.pressuredUnits.length, 3) - 1 ? ' · ' : ''}
                          </span>
                        );
                      })}
                    </div>
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
            <span>Next {alternatives.length} alternatives by Final Safety</span>
          </div>
          <div className="alternative-cards" role="list">
            {alternatives.map((candidate) => {
              const overallRank =
                candidates.findIndex((entry) => entry.playbook.id === candidate.playbook.id) + 1;
              const p = candidate.playbook;
              const hasCandidateLobby =
                hasActiveLobby && candidate.contest.state !== 'Unavailable';
              const lobbyAdj = candidate.home?.lobbyAdjustment;

              return (
                <article className="alternative-card" key={p.id} role="listitem">
                  <div className="alt-card-main">
                    <div className="alternative-rank-title">
                      <span className="alternative-rank">#{overallRank}</span>
                      <div className="alternative-title-group">
                        <strong className="alternative-title">{p.title}</strong>
                        <span className="alternative-style-tag">{p.features.style}</span>
                      </div>
                    </div>

                    {/* Compact unit portraits strip */}
                    <div className="alternative-lineup" aria-label={`${p.title} units`}>
                      {p.target.units.map((unit) => {
                        const champion = data.champions.find((entry) => entry.id === unit.championId);
                        return champion ? (
                          <div
                            key={unit.championId}
                            className={`alt-unit ${unit.slot === 'core' ? 'is-core' : ''}`}
                            title={`${champion.name} (${unit.slot})`}
                          >
                            <Portrait champion={champion} assets={assets} compact />
                          </div>
                        ) : null;
                      })}
                    </div>

                    <OutcomeLine candidate={candidate} />
                    <p className="alternative-reason">{humanizeExclusionReason(candidate, portfolio)}</p>
                  </div>

                  <div className="alt-card-aside">
                    <strong className="alternative-safety">
                      {candidate.home?.finalSafety.toFixed(1) ?? candidate.score}
                      <small> SAFETY</small>
                    </strong>

                    <span
                      className={`contest-pill contest-${hasCandidateLobby ? candidate.contest.state.toLowerCase() : 'unavailable'}`}
                    >
                      {!hasCandidateLobby
                        ? 'CONTEST UNAVAILABLE'
                        : isProvisional
                          ? `${candidate.contest.state.toUpperCase()} CONTEST (PROV.)`
                          : `${candidate.contest.state.toUpperCase()} CONTEST`}
                    </span>

                    {hasCandidateLobby && lobbyAdj !== undefined && (
                      <span
                        className={`alt-lobby-adj ${lobbyAdj > 0 ? 'adj-positive' : lobbyAdj < 0 ? 'adj-negative' : 'adj-neutral'}`}
                      >
                        Lobby {signed(lobbyAdj)}
                        {isProvisional ? ' (prov.)' : ''}
                      </span>
                    )}

                    <button
                      className="alternative-open-btn"
                      aria-label={`View details for ${p.title}`}
                      onClick={() => onOpen(p.id)}
                    >
                      <span>View details</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
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
                    {candidate.contest.routeEvidence.matchingOpponents[0]
                      ? ` · ${candidate.contest.routeEvidence.matchingOpponents[0].riotId ?? 'Top'}: ${candidate.contest.routeEvidence.matchingOpponents[0].matchSummary ?? `${candidate.contest.routeEvidence.matchingOpponents[0].stronglyMatchingBoards} matches`}`
                      : ''}
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
