import { ArrowRight, Layers3, Radio, ShieldQuestion, Sparkles } from 'lucide-react';
import type { LobbyPressure, RecommendationPortfolio } from '../domain/models';
import type { ApplicationState } from '../services/application';
import { Art, Portrait } from '../components/Art';
import { LobbyPressureSummary } from '../components/LobbyPressureSummary';
export function Home({
  state,
  portfolio,
  onOpen,
  onData,
  lobby,
}: {
  state: ApplicationState;
  portfolio: RecommendationPortfolio;
  onOpen: (id: string) => void;
  onData: () => void;
  lobby: LobbyPressure | null;
}) {
  const { data, assets } = state;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PRE-GAME FIELD GUIDE</div>
          <h1>Three plans. More possibilities.</h1>
          <p>A complementary set of openings, with room to adapt.</p>
        </div>
        <div className="set-seal">
          <Sparkles size={18} />
          <span>
            SET 18<strong>Enchanted Wilds</strong>
          </span>
        </div>
      </div>
      <div className="evidence-banner">
        <ShieldQuestion size={19} />
        <span>
          <strong>
            Curated boards. Measured outcomes {state.meta ? 'connected' : 'unavailable'}.
          </strong>{' '}
          {state.meta
            ? `${state.meta.uniqueMatches} ${state.meta.platform} matches · ${state.meta.rankCohort.join(' + ')} cohort.`
            : 'Outcome components use an explicit neutral fallback; they are not live meta statistics.'}
        </span>
        <button onClick={onData}>
          View evidence <ArrowRight size={14} />
        </button>
      </div>
      <div className="section-line">
        <h2>Your three-plan portfolio</h2>
        <span>
          {state.selection
            ? 'Locked for this game'
            : `${state.playbooks.length} source comps · optimized together`}
        </span>
      </div>
      {!portfolio.plans.length ? (
        <div className="empty-state">
          <Layers3 />
          <h2>No eligible plans</h2>
          <p>Review data validation issues, then refresh the source.</p>
          <button onClick={onData}>Review data</button>
        </div>
      ) : (
        <div className="plan-grid">
          {portfolio.plans.map(({ candidate: c, role }, index) => {
            const p = c.playbook,
              hero = data.champions.find((u) => u.id === p.hero)!,
              measured = state.meta?.familyStats.find((stat) => stat.familyId === p.family.id);
            return (
              <article className={`plan-card accent-${index}`} key={p.id}>
                <div className="card-art">
                  <Art url={hero.splash} alt={`${hero.name} · Set 18 artwork`} assets={assets} />
                  <div className="art-shade" />
                  <div className="card-top">
                    <span className="rank">0{index + 1}</span>
                    <span className="portfolio-role">{role}</span>
                  </div>
                  <div className="card-title">
                    <span className="style-tag">{p.features.style}</span>
                    <h2>{p.title}</h2>
                    <p>{p.subtitle}</p>
                  </div>
                </div>
                <div className="card-body">
                  <div className="score-row">
                    <div className="score">
                      <strong>{Math.round(c.score)}</strong>
                      <span>
                        /100
                        <small>
                          {measured?.quality === 'eligible' ? 'Measured calibrated' : 'Mixed score'}
                        </small>
                      </span>
                    </div>
                    <div className="confidence">
                      <span className="confidence-bars">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{c.confidence.level} confidence</strong>
                      <small>{p.evidence}</small>
                    </div>
                  </div>
                  <div className="core-portraits">
                    {p.family.core.map((id) => (
                      <Portrait
                        key={id}
                        champion={data.champions.find((u) => u.id === id)!}
                        assets={assets}
                        compact
                      />
                    ))}
                    <span>
                      Core
                      <br />
                      units
                    </span>
                  </div>
                  <p className="card-reason">{c.reasons[0]}</p>
                  {measured ? (
                    <div className="risk-cues measured-cues">
                      <span>
                        Avg <strong>{measured.shrunkAveragePlacement.toFixed(2)}</strong>
                      </span>
                      <span>
                        Top 4 <strong>{Math.round(measured.topFour.shrunk * 100)}%</strong>
                      </span>
                      <span>
                        Win <strong>{Math.round(measured.wins.shrunk * 100)}%</strong>
                      </span>
                      <small>
                        {measured.games} classified · {Math.round(measured.confidence * 100)}% meta
                        confidence
                      </small>
                    </div>
                  ) : (
                    <div className="risk-cues unavailable-cues">
                      <span>Measured strength</span>
                      <strong>Unavailable</strong>
                      <small>
                        Neutral outcome fallback · curated strategy metadata remains separate
                      </small>
                    </div>
                  )}
                  <div className="contest">
                    <Radio size={13} />
                    <span>Historical contest: {c.contest.state.toLowerCase()}</span>
                  </div>
                  {c.contest.pressuredUnits.length > 0 && (
                    <div className="card-pressure-units" aria-label="Pressured critical units">
                      {c.contest.pressuredUnits.slice(0, 3).map((unit) => (
                        <span key={unit.championId}>
                          {data.champions.find((champion) => champion.id === unit.championId)
                            ?.name ?? unit.championId}{' '}
                          · {unit.equivalentHistoricalUsers.toFixed(1)} users
                        </span>
                      ))}
                    </div>
                  )}
                  <button className="open-plan" onClick={() => onOpen(p.id)}>
                    Explore playbook <ArrowRight size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="home-bottom">
        <section className="panel portfolio-panel">
          <div className="panel-heading">
            <Layers3 size={18} />
            <h2>Built to complement each other</h2>
          </div>
          <p>Coverage and shared dependencies affect which three plans make the cut.</p>
          <div className="coverage-line">
            {portfolio.plans.map(({ candidate: c }, i) => (
              <div key={c.playbook.id}>
                <span className={`mini-rank accent-${i}`}>0{i + 1}</span>
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
              Optimizer weights and coverage tags are initial, uncalibrated inputs. Actionable
              cross-plan pivots are not yet verified.
            </p>
          </details>
        </section>
        <section className="panel lobby-panel">
          <div className="panel-heading">
            <Radio size={18} />
            <h2>Lobby intelligence</h2>
            <span className={`badge ${lobby?.state === 'complete' ? 'success' : 'muted'}`}>
              {lobby?.state ?? 'Unavailable'}
            </span>
          </div>
          <div className="opponent-dots">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{lobby?.profiles[i] ? '✓' : '?'}</span>
            ))}
          </div>
          <p>
            {lobby
              ? `${lobby.profilesCompleted}/${lobby.resolvedOpponents} profiles · ${Math.round(lobby.coverage * 100)}% evidence coverage · ${Math.round(lobby.elapsedMs)} ms.`
              : 'Opponent history evidence is not connected. Recommendations remain unchanged.'}
          </p>
          {lobby && <LobbyPressureSummary lobby={lobby} data={data} assets={assets} compact />}
          <button className="text-button" onClick={onData}>
            Connection & data setup <ArrowRight size={14} />
          </button>
          <small>
            {state.settings.historyWindow} relevant games per opponent · cache first · evidence only
          </small>
        </section>
      </div>
    </>
  );
}
