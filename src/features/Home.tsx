import { ArrowRight, Layers3, Radio, ShieldQuestion } from 'lucide-react';
import type { LobbyPressure, RecommendationPortfolio } from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';
import { LobbyPressureSummary } from '../components/LobbyPressureSummary';
import { CurrentGameEditor } from './SmartCompanion';
import type { CurrentGameState } from '../domain/intelligence';
export function Home({
  state,
  portfolio,
  onOpen,
  onData,
  onScout,
  lobby,
  onCurrentGame,
}: {
  state: ApplicationState;
  portfolio: RecommendationPortfolio;
  onOpen: (id: string) => void;
  onData: () => void;
  onScout: () => void;
  lobby: LobbyPressure | null;
  onCurrentGame?: (game: CurrentGameState) => void;
}) {
  const { data, assets } = state;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PRE-GAME / SET {data.version.set}</div>
          <h1>Your plans</h1>
          <p>Three complementary routes, selected together.</p>
        </div>
        <button className="secondary" onClick={onScout}>
          <Radio size={16} />
          Scan current lobby
        </button>
      </div>
      {onCurrentGame && (
        <CurrentGameEditor
          data={data}
          value={state.activeSession?.manualState.currentGame ?? state.currentGame}
          onChange={onCurrentGame}
          compact
        />
      )}
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
        <h2>Your three-plan portfolio</h2>
        <span>{state.playbooks.length} comps · optimized together</span>
      </div>
      <div className="plan-grid">
        {portfolio.plans.map(({ candidate: c, role }, index) => {
          const p = c.playbook,
            hero = data.champions.find((u) => u.id === p.hero)!;
          const measured = state.meta?.familyStats.find((s) => s.familyId === p.family.id);
          return (
            <article className={`plan-card ${index === 0 ? 'primary-plan' : ''}`} key={p.id}>
              <div className="card-art">
                <Art url={hero.splash} alt={`${hero.name} · Set 18 artwork`} assets={assets} />
                <div className="art-shade" />
                <span className="rank">0{index + 1}</span>
              </div>
              <div className="plan-identity">
                <div className="plan-role">
                  {role}
                  <span>{p.features.style}</span>
                </div>
                <h2>{p.title}</h2>
                <span className="plan-evidence">
                  {p.discovery ? 'Discovered' : 'Curated'} · {p.evidence}
                </span>
              </div>
              <div className="plan-lineup">
                {p.target.units.map((unit) => {
                  const champion = data.champions.find((u) => u.id === unit.championId);
                  return (
                    champion && (
                      <div key={unit.championId} className={unit.slot === 'core' ? 'is-core' : ''}>
                        <Portrait champion={champion} assets={assets} compact />
                        <span>{champion.name}</span>
                      </div>
                    )
                  );
                })}
              </div>
              <div className="plan-stat">
                <strong>
                  {Math.round(c.score)}
                  <small>/100</small>
                </strong>
                <span>Fit score</span>
                <b>{c.confidence.level} confidence</b>
              </div>
              <div className="plan-outcomes">
                {c.fusion && c.fusion.externalWeight >= 30 ? (
                  <>
                    <div>
                      <strong>{c.fusion.average?.toFixed(2)}</strong>
                      <span>Fused avg</span>
                    </div>
                    <div>
                      <strong>
                        {c.fusion.top4 === null ? '—' : `${Math.round(c.fusion.top4 * 100)}%`}
                      </strong>
                      <span>Top 4</span>
                    </div>
                    <div>
                      <strong>
                        {c.fusion.win === null ? '—' : `${Math.round(c.fusion.win * 100)}%`}
                      </strong>
                      <span>Win</span>
                    </div>
                    <small title={c.fusion.sources.join(' · ')}>
                      External aggregate + compatible direct observations
                    </small>
                  </>
                ) : measured?.quality === 'eligible' ? (
                  <>
                    <div>
                      <strong>{measured.averagePlacement.toFixed(2)}</strong>
                      <span>Avg place</span>
                    </div>
                    <div>
                      <strong>{Math.round(measured.topFour.raw * 100)}%</strong>
                      <span>Top 4</span>
                    </div>
                    <div>
                      <strong>{Math.round(measured.wins.raw * 100)}%</strong>
                      <span>Win</span>
                    </div>
                    <small>
                      {measured.games} games ·{' '}
                      {state.meta?.statisticsPopulation ?? 'discovery-lobby'} · {measured.quality}
                    </small>
                  </>
                ) : measured ? (
                  <>
                    <strong>{measured.games} games</strong>
                    <span>Insufficient sample</span>
                    <small>Outcomes stay neutral</small>
                  </>
                ) : (
                  <>
                    <span>Measured strength</span>
                    <strong>Unavailable</strong>
                    <small>Outcomes stay neutral</small>
                  </>
                )}
              </div>
              <div className="plan-decision">
                <span className="contest">
                  <Radio size={13} />
                  Historical contest: {c.contest.state.toLowerCase()}
                </span>
                {!(state.activeSession?.manualState.currentGame ?? state.currentGame) && (
                  <p className="card-reason">{c.reasons[0]}</p>
                )}
                {(state.activeSession?.manualState.currentGame ?? state.currentGame) && (
                  <div className="context-reasons" aria-label="Contextual reasons">
                    <strong>Fit with your current game</strong>
                    {c.components
                      .filter((x) => x.key.startsWith('context-') && x.contribution !== 0)
                      .map((x) => (
                        <p key={x.key}>{x.label}</p>
                      ))}
                  </div>
                )}
                {c.contest.pressuredUnits.length > 0 && (
                  <div className="card-pressure-units" aria-label="Pressured critical units">
                    {c.contest.pressuredUnits.slice(0, 3).map((u) => (
                      <span key={u.championId}>
                        {data.champions.find((c) => c.id === u.championId)?.name} ·{' '}
                        {u.equivalentHistoricalUsers.toFixed(1)} users
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
      <div className="evidence-banner">
        <ShieldQuestion size={17} />
        <span>
          {state.meta
            ? `${state.meta.uniqueMatches} ${state.meta.platform} matches · ${state.meta.rankCohort.join(' + ')} cohort`
            : 'No measured meta yet. Curated guidance remains available.'}
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
            {portfolio.plans.map(({ candidate: c }, i) => (
              <div key={c.playbook.id}>
                <span className="mini-rank">0{i + 1}</span>
                <strong>{c.playbook.features.itemCoverage.join(' + ')}</strong>
                <small>{c.playbook.features.style}</small>
              </div>
            ))}
          </div>
          <details>
            <summary>How this portfolio was selected</summary>
            <div className="interaction-list">
              {portfolio.interactions.map((i) => (
                <div key={i.label}>
                  <span>{i.label}</span>
                  <strong>
                    {i.value >= 0 ? '+' : ''}
                    {i.value.toFixed(1)}
                  </strong>
                </div>
              ))}
            </div>
            <p className="fine-print">
              Coverage weights are curated, not measured outcomes. Supported pivots are in each
              playbook.
            </p>
          </details>
        </section>
        <section className="panel lobby-panel">
          <div className="panel-heading">
            <Radio size={18} />
            <h2>Lobby pressure</h2>
            <span className="badge muted">{lobby?.state ?? 'Not scanned'}</span>
          </div>
          <div className="opponent-dots">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{lobby?.profiles[i] ? '✓' : '—'}</span>
            ))}
          </div>
          <p>
            {lobby
              ? `${lobby.profilesCompleted}/${lobby.resolvedOpponents} profiles · ${Math.round(lobby.coverage * 100)}% coverage`
              : 'Scan recent opponent history to compare contest across your plans.'}
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
